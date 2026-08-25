"""
rag.py — persistent hybrid-retrieval corpus for lecture source material
=======================================================================

Replaces the old approach of pasting `notes_text[:8000]` into every prompt.
That sent the *first* 8,000 characters of a textbook — cover page, table of
contents, preface — re-sent identically in every batch, so the model paid for
thousands of tokens of front-matter and still had nothing specific to say about
any given slide.

Here, uploads are chunked once into a persistent corpus and each slide
retrieves only the passages that are actually about it.

Retrieval is hybrid:
  * BM25 via SQLite FTS5 — exact technical terms, no dependencies
  * dense vectors via fastembed (ONNX, no PyTorch) — paraphrase, so a slide on
    "steepest descent" still finds a textbook that says "gradient descent"
fused with reciprocal rank fusion.

Storage lives in outputs/corpus/ and is shared across sessions; documents are
deduplicated by SHA-256 of their extracted text, so re-uploading the same
textbook is a no-op.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ════════════════════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════════════════════

CORPUS_DIR = os.getenv("RAG_CORPUS_DIR", os.path.join("outputs", "corpus"))
DB_PATH = os.path.join(CORPUS_DIR, "corpus.db")
VECTORS_PATH = os.path.join(CORPUS_DIR, "vectors.npy")
VECTOR_IDS_PATH = os.path.join(CORPUS_DIR, "vector_ids.npy")

EMBED_MODEL = os.getenv("RAG_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
EMBED_DIM = 384

CHUNK_CHARS = int(os.getenv("RAG_CHUNK_CHARS", "1100"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "150"))

# Candidates pulled from each retrieval arm before fusion.
CANDIDATES = int(os.getenv("RAG_CANDIDATES", "30"))
RRF_K = 60  # standard reciprocal-rank-fusion damping
# Keep only fused hits scoring at least this fraction of the best hit.
REL_THRESHOLD = float(os.getenv("RAG_REL_THRESHOLD", "0.55"))

_lock = threading.Lock()


# ════════════════════════════════════════════════════════════════════════════
# TYPES
# ════════════════════════════════════════════════════════════════════════════


@dataclass
class Chunk:
    chunk_id: int
    doc_id: int
    filename: str
    category: str
    heading: str
    text: str
    score: float = 0.0

    def cite(self) -> str:
        return f"{self.filename}{' · ' + self.heading if self.heading else ''}"


def format_citations(chunks: Sequence["Chunk"]) -> List[str]:
    """
    One entry per source document, headings collapsed into it.

    Listing raw cite() strings repeats the filename once per chunk, which reads
    as "notes.txt · Ch 2 · notes.txt · Ch 3" in the review UI.
    """
    by_file: Dict[str, List[str]] = {}
    for c in chunks:
        headings = by_file.setdefault(c.filename, [])
        if c.heading and c.heading not in headings:
            headings.append(c.heading)
    return [
        f"{fn} · {', '.join(hs)}" if hs else fn
        for fn, hs in by_file.items()
    ]


@dataclass
class Document:
    doc_id: int
    filename: str
    category: str
    course: str
    char_count: int
    chunk_count: int
    added_at: float
    already_indexed: bool = False


# ════════════════════════════════════════════════════════════════════════════
# SCHEMA
# ════════════════════════════════════════════════════════════════════════════

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    doc_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    sha256      TEXT UNIQUE NOT NULL,
    filename    TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'notes',
    course      TEXT NOT NULL DEFAULT '',
    char_count  INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    added_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id   INTEGER NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    ordinal  INTEGER NOT NULL,
    heading  TEXT NOT NULL DEFAULT '',
    text     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

-- External-content FTS5: the index points at `chunks` instead of copying it.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
USING fts5(text, content='chunks', content_rowid='chunk_id', tokenize='porter');
"""


def _connect() -> sqlite3.Connection:
    os.makedirs(CORPUS_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_SCHEMA)
    return conn


# ════════════════════════════════════════════════════════════════════════════
# EMBEDDINGS  (lazy — the model downloads on first real use)
# ════════════════════════════════════════════════════════════════════════════

_embedder = None
_embedder_failed = False


def _get_embedder():
    """
    Load the ONNX embedding model on demand.

    Returns None if fastembed is unavailable or the model cannot be fetched;
    retrieval then runs BM25-only rather than failing. Lexical search alone is
    still far better than the front-matter prefix this replaces.
    """
    global _embedder, _embedder_failed
    if _embedder is not None or _embedder_failed:
        return _embedder
    with _lock:
        if _embedder is not None or _embedder_failed:
            return _embedder
        try:
            from fastembed import TextEmbedding

            t = time.time()
            _embedder = TextEmbedding(model_name=EMBED_MODEL)
            logger.info(f"RAG embedder ready ({EMBED_MODEL}) in {time.time() - t:.1f}s")
        except Exception as e:
            _embedder_failed = True
            logger.warning(f"RAG: dense embeddings unavailable ({e}) — BM25 only")
        return _embedder


def _embed(texts: Sequence[str]) -> Optional[np.ndarray]:
    model = _get_embedder()
    if model is None or not texts:
        return None
    try:
        vecs = np.array(list(model.embed(list(texts))), dtype=np.float32)
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        return vecs / np.clip(norms, 1e-9, None)  # cosine via dot product
    except Exception as e:
        logger.warning(f"RAG: embedding failed ({e}) — BM25 only for this call")
        return None


def _load_vectors() -> Tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    if not (os.path.exists(VECTORS_PATH) and os.path.exists(VECTOR_IDS_PATH)):
        return None, None
    try:
        return np.load(VECTORS_PATH), np.load(VECTOR_IDS_PATH)
    except Exception as e:
        logger.warning(f"RAG: could not read vector store ({e})")
        return None, None


def _append_vectors(vecs: np.ndarray, ids: Sequence[int]) -> None:
    existing, existing_ids = _load_vectors()
    new_ids = np.asarray(ids, dtype=np.int64)
    if existing is not None and existing.shape[1] == vecs.shape[1]:
        vecs = np.vstack([existing, vecs])
        new_ids = np.concatenate([existing_ids, new_ids])
    np.save(VECTORS_PATH, vecs)
    np.save(VECTOR_IDS_PATH, new_ids)


# ════════════════════════════════════════════════════════════════════════════
# CHUNKING
# ════════════════════════════════════════════════════════════════════════════

# A heading is a short standalone line: numbered, ALL CAPS, or Title Case.
_HEADING = re.compile(
    r"^\s*(?:"
    r"(?:chapter|section|part|unit|lecture|module)\s+[\dIVXLC]+.*"
    r"|\d+(?:\.\d+)*\s+\S.*"
    r"|[A-Z][A-Z0-9 ,&:'\-/]{3,60}"
    r")\s*$",
    re.IGNORECASE,
)


def _looks_like_heading(line: str) -> bool:
    s = line.strip()
    if not (3 <= len(s) <= 90) or s.endswith((".", ",", ";")):
        return False
    return bool(_HEADING.match(s))


def chunk_text(text: str) -> List[Tuple[str, str]]:
    """Split into (heading, chunk_text), packing paragraphs up to CHUNK_CHARS."""
    text = re.sub(r"\r\n?", "\n", text or "")
    text = re.sub(r"[ \t]+", " ", text)
    if not text.strip():
        return []

    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    out: List[Tuple[str, str]] = []
    heading = ""
    buf = ""

    def flush():
        nonlocal buf
        if buf.strip():
            out.append((heading, buf.strip()))
        buf = ""

    for block in blocks:
        lines = block.split("\n")
        # A block that is just a heading line retitles what follows.
        if len(lines) == 1 and _looks_like_heading(lines[0]):
            flush()
            heading = lines[0].strip()
            continue

        if len(buf) + len(block) + 2 <= CHUNK_CHARS:
            buf = f"{buf}\n\n{block}" if buf else block
            continue

        flush()
        if len(block) <= CHUNK_CHARS:
            buf = block
            continue

        # Oversized block: slice it with overlap so a concept spanning the cut
        # is still fully present in one of the pieces.
        start = 0
        while start < len(block):
            piece = block[start:start + CHUNK_CHARS]
            if len(piece) < 120 and out:
                break
            out.append((heading, piece.strip()))
            start += max(1, CHUNK_CHARS - CHUNK_OVERLAP)

    flush()
    return [(h, t) for h, t in out if len(t) >= 60 and not _is_boilerplate(h, t)]


# Front-matter carries no teachable content but competes for retrieval slots —
# and was the bulk of what the old notes_text[:8000] prefix actually sent.
_BOILERPLATE_HEADING = re.compile(
    r"^\s*(table\s+of\s+contents|contents|copyright|acknowledge?ments?|"
    r"preface|foreword|dedication|about\s+the\s+authors?|index|bibliography)\b",
    re.IGNORECASE,
)
_BOILERPLATE_BODY = re.compile(
    r"all rights reserved|no part of this (?:publication|book)|"
    r"printed in |isbn\b|library of congress",
    re.IGNORECASE,
)


def _is_boilerplate(heading: str, body: str) -> bool:
    if _BOILERPLATE_HEADING.match(heading or ""):
        return True
    if _BOILERPLATE_BODY.search(body):
        return True
    # Dot leaders ("Optimisation .......... 57") are an unambiguous contents
    # page. A "most lines end in a number" heuristic was tried and rejected: it
    # cannot separate a contents page from a results table or a dated timeline,
    # and dropping real teaching content is far worse than letting a little
    # front-matter through — the relevance threshold in retrieve() filters the
    # remainder anyway.
    lines = [l.strip() for l in body.split("\n") if l.strip()]
    if len(lines) >= 3:
        leaders = sum(1 for l in lines if re.search(r"[.·]{4,}\s*\d{1,4}$", l))
        if leaders / len(lines) > 0.5:
            return True
    return False


# ════════════════════════════════════════════════════════════════════════════
# INGESTION
# ════════════════════════════════════════════════════════════════════════════


def ingest(
    text: str,
    filename: str,
    category: str = "notes",
    course: str = "",
) -> Optional[Document]:
    """
    Index extracted text. Returns the Document, with `already_indexed` set when
    the same content was seen before (dedupe by SHA-256), or None if empty.
    """
    if not text or not text.strip():
        return None

    digest = hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()
    course = (course or "").strip().lower()

    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT * FROM documents WHERE sha256 = ?", (digest,)
            ).fetchone()
            if row:
                logger.info(f"RAG: '{filename}' already indexed ({row['chunk_count']} chunks)")
                return Document(
                    row["doc_id"], row["filename"], row["category"], row["course"],
                    row["char_count"], row["chunk_count"], row["added_at"],
                    already_indexed=True,
                )

            pieces = chunk_text(text)
            if not pieces:
                return None

            cur = conn.execute(
                "INSERT INTO documents (sha256, filename, category, course, "
                "char_count, chunk_count, added_at) VALUES (?,?,?,?,?,?,?)",
                (digest, filename, category, course, len(text), len(pieces), time.time()),
            )
            doc_id = cur.lastrowid

            chunk_ids: List[int] = []
            for ordinal, (heading, body) in enumerate(pieces):
                c = conn.execute(
                    "INSERT INTO chunks (doc_id, ordinal, heading, text) VALUES (?,?,?,?)",
                    (doc_id, ordinal, heading, body),
                )
                chunk_ids.append(c.lastrowid)

            # Keep the external-content FTS index in step with `chunks`.
            conn.executemany(
                "INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)",
                [(cid, body) for cid, (_, body) in zip(chunk_ids, pieces)],
            )
            conn.commit()
        finally:
            conn.close()

    vecs = _embed([body for _, body in pieces])
    if vecs is not None:
        _append_vectors(vecs, chunk_ids)

    logger.info(
        f"RAG: indexed '{filename}' — {len(pieces)} chunks"
        f"{'' if vecs is not None else ' (BM25 only)'}"
    )
    return Document(doc_id, filename, category, course, len(text), len(pieces), time.time())


def ingest_file(path: str, category: str = "notes", course: str = "") -> Optional[Document]:
    """Extract a file with the server's own extractor, then index it."""
    from server.extract import extract_one

    with open(path, "rb") as f:
        text = extract_one(os.path.basename(path), f.read())
    return ingest(text, os.path.basename(path), category=category, course=course)


# ════════════════════════════════════════════════════════════════════════════
# RETRIEVAL
# ════════════════════════════════════════════════════════════════════════════

_FTS_STRIP = re.compile(r"[^\w\s]")


def _fts_query(text: str) -> str:
    """Turn free text into a safe FTS5 OR-query."""
    words = [w for w in _FTS_STRIP.sub(" ", text or "").split() if len(w) > 2]
    seen, terms = set(), []
    for w in words[:24]:
        lw = w.lower()
        if lw not in seen:
            seen.add(lw)
            terms.append(f'"{lw}"')
    return " OR ".join(terms)


def _bm25(conn, query: str, course: str, limit: int) -> List[int]:
    q = _fts_query(query)
    if not q:
        return []
    sql = (
        "SELECT c.chunk_id FROM chunks_fts f "
        "JOIN chunks c ON c.chunk_id = f.rowid "
        "JOIN documents d ON d.doc_id = c.doc_id "
        "WHERE chunks_fts MATCH ? "
    )
    params: List = [q]
    if course:
        sql += "AND d.course = ? "
        params.append(course)
    sql += "ORDER BY bm25(chunks_fts) LIMIT ?"
    params.append(limit)
    try:
        return [r["chunk_id"] for r in conn.execute(sql, params)]
    except sqlite3.OperationalError as e:
        logger.warning(f"RAG: FTS query failed ({e})")
        return []


def _dense(conn, query: str, course: str, limit: int) -> List[int]:
    vecs, ids = _load_vectors()
    if vecs is None or not len(ids):
        return []
    qv = _embed([query])
    if qv is None:
        return []

    allowed: Optional[set] = None
    if course:
        allowed = {
            r["chunk_id"] for r in conn.execute(
                "SELECT c.chunk_id FROM chunks c JOIN documents d ON d.doc_id = c.doc_id "
                "WHERE d.course = ?", (course,)
            )
        }
        if not allowed:
            return []

    sims = vecs @ qv[0]
    order = np.argsort(-sims)
    out: List[int] = []
    for i in order:
        cid = int(ids[i])
        if allowed is not None and cid not in allowed:
            continue
        out.append(cid)
        if len(out) >= limit:
            break
    return out


def retrieve(query: str, course: str = "", k: int = 6) -> List[Chunk]:
    """Hybrid BM25 + dense retrieval, fused by reciprocal rank."""
    if not query or not query.strip():
        return []
    course = (course or "").strip().lower()

    conn = _connect()
    try:
        lex = _bm25(conn, query, course, CANDIDATES)
        vec = _dense(conn, query, course, CANDIDATES)
        if not lex and not vec:
            return []

        scores: Dict[int, float] = {}
        for rank, cid in enumerate(lex):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        for rank, cid in enumerate(vec):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)

        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        # RRF always returns *something*, so on a narrow query the tail is
        # padding. Keep only chunks scoring within a band of the best one,
        # otherwise weak matches crowd out the passages that actually apply.
        if ranked:
            cutoff = ranked[0][1] * REL_THRESHOLD
            ranked = [(cid, sc) for cid, sc in ranked if sc >= cutoff]
        top = ranked[:k]
        if not top:
            return []

        placeholders = ",".join("?" * len(top))
        rows = {
            r["chunk_id"]: r for r in conn.execute(
                f"SELECT c.chunk_id, c.doc_id, c.heading, c.text, "
                f"d.filename, d.category FROM chunks c "
                f"JOIN documents d ON d.doc_id = c.doc_id "
                f"WHERE c.chunk_id IN ({placeholders})",
                [cid for cid, _ in top],
            )
        }
        out = []
        for cid, score in top:
            r = rows.get(cid)
            if r:
                out.append(Chunk(
                    chunk_id=cid, doc_id=r["doc_id"], filename=r["filename"],
                    category=r["category"], heading=r["heading"] or "",
                    text=r["text"], score=score,
                ))
        return out
    finally:
        conn.close()


def retrieve_block(
    query: str,
    course: str = "",
    k: int = 6,
    budget_chars: int = 3500,
    exclude_ids: Optional[set] = None,
) -> Tuple[str, List[Chunk]]:
    """
    Retrieve and format a prompt-ready source block.

    Returns ("", []) when the corpus has nothing — callers fall back to their
    previous behaviour rather than sending an empty SOURCE MATERIAL section.
    """
    chunks = retrieve(query, course=course, k=k)
    if exclude_ids:
        chunks = [c for c in chunks if c.chunk_id not in exclude_ids]
    if not chunks:
        return "", []

    parts, used, total = [], [], 0
    for c in chunks:
        body = c.text
        if total + len(body) > budget_chars:
            room = budget_chars - total
            if room < 200:
                break
            body = body[:room].rsplit(" ", 1)[0] + "…"
        parts.append(f"[{c.cite()}]\n{body}")
        used.append(c)
        total += len(body)
        if total >= budget_chars:
            break

    return "\n\n---\n\n".join(parts), used


# ════════════════════════════════════════════════════════════════════════════
# CORPUS MANAGEMENT
# ════════════════════════════════════════════════════════════════════════════


def list_documents(course: str = "") -> List[Document]:
    conn = _connect()
    try:
        sql = "SELECT * FROM documents"
        params: List = []
        if course:
            sql += " WHERE course = ?"
            params.append(course.strip().lower())
        sql += " ORDER BY added_at DESC"
        return [
            Document(r["doc_id"], r["filename"], r["category"], r["course"],
                     r["char_count"], r["chunk_count"], r["added_at"])
            for r in conn.execute(sql, params)
        ]
    finally:
        conn.close()


def digest(course: str = "", budget_chars: int = 3000) -> str:
    """
    A breadth-first overview of the corpus for prompts that must see the whole
    shape of the material rather than one topic — the outline pass especially.

    Per document: its opening lines plus the headings found across its chunks.
    That covers a 300-page textbook in a few hundred characters, where a raw
    `notes_text[:8000]` prefix would spend the entire budget on the cover page
    and table of contents and never reach chapter one.
    """
    conn = _connect()
    try:
        sql = "SELECT doc_id, filename FROM documents"
        params: List = []
        if course:
            sql += " WHERE course = ?"
            params.append(course.strip().lower())
        sql += " ORDER BY added_at"
        docs = list(conn.execute(sql, params))
        if not docs:
            return ""

        per_doc = max(300, budget_chars // len(docs))
        parts: List[str] = []
        for d in docs:
            opening = conn.execute(
                "SELECT text FROM chunks WHERE doc_id = ? ORDER BY ordinal LIMIT 1",
                (d["doc_id"],),
            ).fetchone()
            headings = [
                r["heading"] for r in conn.execute(
                    "SELECT DISTINCT heading FROM chunks "
                    "WHERE doc_id = ? AND heading != '' ORDER BY ordinal",
                    (d["doc_id"],),
                )
            ]
            block = [f"### {d['filename']}"]
            if headings:
                block.append("SECTIONS: " + " | ".join(headings[:40]))
            if opening:
                block.append(opening["text"][: max(200, per_doc // 2)].strip())
            parts.append("\n".join(block)[:per_doc])
        return "\n\n---\n\n".join(parts)
    finally:
        conn.close()


def stats() -> Dict:
    conn = _connect()
    try:
        docs = conn.execute("SELECT COUNT(*) n FROM documents").fetchone()["n"]
        chunks = conn.execute("SELECT COUNT(*) n FROM chunks").fetchone()["n"]
        courses = [
            r["course"] for r in conn.execute(
                "SELECT DISTINCT course FROM documents WHERE course != ''"
            )
        ]
    finally:
        conn.close()
    vecs, _ = _load_vectors()
    return {
        "documents": docs,
        "chunks": chunks,
        "courses": sorted(courses),
        "vectors": int(vecs.shape[0]) if vecs is not None else 0,
        "dense_enabled": _get_embedder() is not None,
        "embed_model": EMBED_MODEL,
    }


def delete_document(doc_id: int) -> bool:
    """Remove a document and its chunks. Vectors are pruned by chunk id."""
    with _lock:
        conn = _connect()
        try:
            ids = [r["chunk_id"] for r in conn.execute(
                "SELECT chunk_id FROM chunks WHERE doc_id = ?", (doc_id,))]
            if not ids:
                return False
            conn.executemany("INSERT INTO chunks_fts (chunks_fts, rowid, text) "
                             "VALUES ('delete', ?, ?)",
                             [(r["chunk_id"], r["text"]) for r in conn.execute(
                                 "SELECT chunk_id, text FROM chunks WHERE doc_id = ?",
                                 (doc_id,))])
            conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
            conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
            conn.commit()
        finally:
            conn.close()

    vecs, vids = _load_vectors()
    if vecs is not None:
        keep = ~np.isin(vids, np.asarray(ids, dtype=np.int64))
        np.save(VECTORS_PATH, vecs[keep])
        np.save(VECTOR_IDS_PATH, vids[keep])
    logger.info(f"RAG: deleted document {doc_id} ({len(ids)} chunks)")
    return True
