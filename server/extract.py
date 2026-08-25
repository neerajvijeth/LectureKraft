"""
Text extraction from uploaded reference files — a port of streamlit_app.py's
_extract() to work on raw (filename, bytes) pairs instead of Streamlit's
UploadedFile, since FastAPI hands us bytes off python-multipart.
"""

import logging
import os
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple

from docx import Document
from pptx import Presentation

from app import load_pdf_text

logger = logging.getLogger(__name__)


def extract_one(filename: str, data: bytes) -> Optional[str]:
    suffix = Path(filename).suffix.lower()
    tmp_path = None
    try:
        if suffix == ".pdf":
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            return load_pdf_text(tmp_path)

        if suffix == ".docx":
            with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            doc = Document(tmp_path)
            return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())

        if suffix == ".pptx":
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pptx") as tmp:
                tmp.write(data)
                tmp_path = tmp.name
            prs = Presentation(tmp_path)
            texts = []
            for sl in prs.slides:
                for shape in sl.shapes:
                    if shape.has_text_frame:
                        texts.append(shape.text)
            return "\n\n".join(texts)

        if suffix in (".txt", ".md"):
            return data.decode("utf-8", errors="ignore")

        logger.warning(f"Unsupported reference file type: {filename}")
        return None
    except Exception as e:
        logger.warning(f"Could not read {filename}: {e}")
        return None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def extract_many(files: List[Tuple[str, bytes]]) -> str:
    """Concatenate extracted text from several uploads, same join style as
    streamlit_app.py._extract()."""
    texts = []
    for filename, data in files:
        t = extract_one(filename, data)
        if t and t.strip():
            texts.append(t)
    return "\n\n".join(texts)
