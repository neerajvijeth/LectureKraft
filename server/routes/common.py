"""Session lifecycle, file uploads, static meta, key-rotator health, job SSE
stream, and file downloads — the endpoints shared by all three pipelines."""

import asyncio
import json
import logging
import os
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from sse_starlette.sse import EventSourceResponse

import rag
from app import OUTPUT_DIR
from diagrams import AVAILABLE_DIAGRAM_TYPES, AVAILABLE_SCENE_TYPES
from groq_client import rotator
from server.extract import extract_many, extract_one
from server.jobs import manager as job_manager
from server.sessions import Session, store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


# ════════════════════════════════════════════════════════════════════════════
# SESSION STATE VIEW
# ════════════════════════════════════════════════════════════════════════════

def session_public_state(s: Session) -> dict:
    slides_view = None
    if s.structure:
        n = len(s.structure["slides"])
        slides_view = [
            {
                **s.get_slide(i),
                "status": s.slide_status(i),
                "has_preview_image": i in s.slide_preview_images,
                "has_custom_image": i in s.slide_custom_images,
            }
            for i in range(n)
        ]

    scenes_view = None
    if s.topic_scenes:
        scenes_view = [
            {**s.get_topic_scene(i), "status": s.topic_scene_status(i)}
            for i in range(len(s.topic_scenes))
        ]

    slides_pipeline_view = None
    if s.slides_structure:
        slides_pipeline_view = []
        for i, sl in enumerate(s.slides_structure):
            vo = s.slide_voiceover(i)
            wc = max(1, len(vo.split()))
            dur = max(6, min(120, int(wc / 2.4)))
            slides_pipeline_view.append({**sl, "voiceover": vo, "slide_duration_seconds": dur})

    topic_meta = None
    if s.topic_structure:
        topic_meta = {
            "video_title": s.topic_structure.get("video_title"),
            "description": s.topic_structure.get("description"),
            "total_scenes": s.topic_structure.get("total_scenes"),
            "estimated_minutes": s.topic_structure.get("estimated_minutes"),
        }

    return {
        "session_id": s.id,
        "phase": s.phase,
        "pipeline": s.pipeline,

        "topic": s.topic,
        "target_duration_minutes": s.target_duration_minutes,
        "skip_diagrams": s.skip_diagrams,
        "structure_metadata": (s.structure or {}).get("metadata"),
        "slides": slides_view,
        "n_modified": s.n_modified() if s.structure else 0,
        "images_prefetched": s.images_prefetched,

        "slides_pptx_filename": s.slides_pptx_filename,
        "slides_context": s.slides_context,
        "slides_pipeline": slides_pipeline_view,

        "topic_topic": s.topic_topic,
        "topic_context": s.topic_context,
        "topic_minutes": s.topic_minutes,
        "topic_structure_meta": topic_meta,
        "topic_scenes": scenes_view,

        "output_ready": bool(s.output_path and os.path.exists(s.output_path)),
        "metadata_available": os.path.exists(os.path.join(OUTPUT_DIR, "lecture_metadata.json")),
        "description_available": os.path.exists(os.path.join(OUTPUT_DIR, "lecture_description.md")),
        "render_elapsed": s.render_elapsed,
        "render_error": s.render_error,
        "render_traceback": s.render_traceback,
    }


def get_session_or_404(session_id: str) -> Session:
    s = store.get(session_id)
    if not s:
        raise HTTPException(404, f"Unknown session {session_id}")
    return s


# ════════════════════════════════════════════════════════════════════════════
# SESSION CRUD
# ════════════════════════════════════════════════════════════════════════════

@router.post("/session")
def create_session():
    s = store.create()
    return session_public_state(s)


@router.get("/session/{session_id}")
def get_session(session_id: str):
    return session_public_state(get_session_or_404(session_id))


@router.delete("/session/{session_id}")
def delete_session(session_id: str):
    store.delete(session_id)
    return {"ok": True}


@router.post("/session/{session_id}/reset")
def reset_session(session_id: str):
    """Equivalent of streamlit_app.py's 'Create New Lecture' — drop this
    session's state and start a fresh one."""
    store.delete(session_id)
    s = store.create()
    return session_public_state(s)


@router.post("/session/{session_id}/start-over")
def start_over(session_id: str):
    """Equivalent of streamlit_app.py's per-pipeline 'Start Over' button —
    clears generated content but keeps this session's id/URL, unlike
    /reset which mints a brand new session."""
    s = get_session_or_404(session_id)
    s.start_over()
    return session_public_state(s)


@router.post("/session/{session_id}/back-to-review")
def back_to_review(session_id: str):
    """Equivalent of streamlit_app.py's '← Back to Review' button."""
    s = get_session_or_404(session_id)
    target = {"full": "review", "slides": "slides_review", "topic": "topic_review"}.get(s.pipeline, "review")
    s.phase = target
    s.output_path = None
    s.render_elapsed = None
    return session_public_state(s)


# ════════════════════════════════════════════════════════════════════════════
# UPLOADS
# ════════════════════════════════════════════════════════════════════════════

@router.post("/upload/{session_id}/pptx")
async def upload_pptx(session_id: str, file: UploadFile = File(...)):
    """Slides-as-is pipeline: store the PPTX exactly as-is on disk.

    NOTE: this fixed-path route MUST stay registered before
    /upload/{session_id}/{category} below — Starlette matches path
    operations in registration order, and the generic {category} route
    would otherwise swallow every request to .../pptx first."""
    s = get_session_or_404(session_id)
    data = await file.read()
    if not data:
        raise HTTPException(400, "Uploaded PPTX is empty")

    path = os.path.join(s.work_dir(), "uploaded_slides.pptx")
    with open(path, "wb") as f:
        f.write(data)

    s.slides_pptx_path = path
    s.slides_pptx_filename = file.filename or "slides.pptx"
    return {"filename": s.slides_pptx_filename, "bytes": len(data)}


@router.post("/upload/{session_id}/{category}")
async def upload_reference(
    session_id: str,
    category: str,
    files: List[UploadFile] = File(...),
    course: str = Form(""),
):
    """category: notes | transcript | slides (full pipeline) or
    notes | transcript (slides pipeline, reference material only)."""
    s = get_session_or_404(session_id)
    if category not in ("notes", "transcript", "slides"):
        raise HTTPException(400, f"Unknown upload category '{category}'")

    pairs = [(f.filename, await f.read()) for f in files]
    text = extract_many(pairs)

    # Keep the raw text on the session: it is the fallback whenever the corpus
    # has nothing to return, so behaviour never regresses to an empty prompt.
    if category == "notes":
        s.notes_text = text or None
    elif category == "transcript":
        s.transcript_text = text or None
    elif category == "slides":
        s.slides_text = text or None

    if course:
        s.course = course.strip().lower()

    # Index each file separately so provenance cites the real filename.
    indexed = 0
    chunks = 0
    for filename, data in pairs:
        try:
            one = extract_one(filename, data)
            if not one or not one.strip():
                continue
            doc = await run_in_threadpool(
                rag.ingest, one, filename, category, s.course
            )
            if doc:
                indexed += 1
                chunks += doc.chunk_count
        except Exception as e:
            # Indexing is an optimisation — never fail the upload over it.
            logger.warning(f"RAG indexing failed for {filename}: {e}")

    return {
        "category": category,
        "files": len(pairs),
        "chars": len(text),
        "indexed": indexed,
        "chunks": chunks,
    }


# ════════════════════════════════════════════════════════════════════════════
# CORPUS
# ════════════════════════════════════════════════════════════════════════════

@router.get("/corpus")
def corpus_status(course: str = ""):
    docs = rag.list_documents(course)
    return {
        **rag.stats(),
        "items": [
            {
                "doc_id": d.doc_id, "filename": d.filename, "category": d.category,
                "course": d.course, "chars": d.char_count, "chunks": d.chunk_count,
                "added_at": d.added_at,
            }
            for d in docs
        ],
    }


@router.delete("/corpus/{doc_id}")
def corpus_delete(doc_id: int):
    if not rag.delete_document(doc_id):
        raise HTTPException(404, f"No document {doc_id}")
    return {"deleted": doc_id}


# ════════════════════════════════════════════════════════════════════════════
# STATIC META
# ════════════════════════════════════════════════════════════════════════════

@router.get("/meta")
def get_meta():
    return {
        "diagram_types": sorted(AVAILABLE_DIAGRAM_TYPES),
        "scene_types": sorted(AVAILABLE_SCENE_TYPES),
    }


@router.get("/health/keys")
def get_key_health():
    return rotator.status()


# ════════════════════════════════════════════════════════════════════════════
# JOB EVENTS (SSE)
# ════════════════════════════════════════════════════════════════════════════

@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    job = job_manager.get(job_id)
    if not job:
        raise HTTPException(404, f"Unknown job {job_id}")

    async def _stream():
        log_from = 0
        while True:
            snap = job.snapshot(log_from=log_from)
            log_from = snap["log_len"]
            yield {"event": "update", "data": json.dumps(snap)}
            if snap["status"] in ("done", "error"):
                break
            await asyncio.sleep(0.35)

    return EventSourceResponse(_stream())


# ════════════════════════════════════════════════════════════════════════════
# DOWNLOADS
# ════════════════════════════════════════════════════════════════════════════

_DOWNLOAD_KINDS = {
    "video":       ("output_path", None, "video/mp4"),
    "metadata":    (None, "lecture_metadata.json", "application/json"),
    "description": (None, "lecture_description.md", "text/markdown"),
}


@router.get("/session/{session_id}/download/{kind}")
def download(session_id: str, kind: str):
    s = get_session_or_404(session_id)
    if kind not in _DOWNLOAD_KINDS:
        raise HTTPException(404, f"Unknown download kind '{kind}'")

    attr, filename, mime = _DOWNLOAD_KINDS[kind]
    if attr:
        path = getattr(s, attr)
    else:
        path = os.path.join(OUTPUT_DIR, filename)

    if not path or not os.path.exists(path):
        raise HTTPException(404, f"{kind} not available yet")

    download_name = {
        "video": f"{(s.topic or s.topic_topic or s.slides_pptx_filename or 'lecture')[:35]}.mp4",
        "metadata": "lecture_metadata.json",
        "description": "lecture_description.md",
    }[kind]
    return FileResponse(path, media_type=mime, filename=download_name)
