"""Slides-as-is pipeline: user's PPTX kept byte-for-byte, AI writes narration
per slide. Ports streamlit_app.py's _handle_generate_slides / _phase_slides_review
/ _phase_slides_rendering onto the job/session model."""

import logging
import time
import traceback

from fastapi import APIRouter, HTTPException

from app import (
    create_slides_lecture,
    extract_slide_content_from_pptx,
    generate_voiceovers_for_slide_titles,
)
from server.jobs import Job, manager as job_manager
from server.models import SlidesVoiceoverRequest, VoiceoverEditRequest
from server.routes.common import get_session_or_404
from server.sessions import Session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/slides")


def _voiceovers_job(job: Job, s: Session, req: SlidesVoiceoverRequest) -> dict:
    job.set_progress(10, "Reading slide content…")
    # Titles alone leave the model nothing slide-specific to say, which is how
    # narration ended up generic and repetitive. extract_slide_content_from_pptx
    # also returns each slide's body text, and
    # generate_voiceovers_for_slide_titles accepts either shape.
    slide_data = extract_slide_content_from_pptx(s.slides_pptx_path)
    if not slide_data:
        raise RuntimeError("No slides found in the uploaded PPTX")

    with_body = sum(1 for d in slide_data if d.get("text_content", "").strip())
    logger.info(
        f"Slides pipeline: {len(slide_data)} slides, {with_body} with body text"
    )

    job.set_progress(30, f"Generating voiceovers for {len(slide_data)} slides…")
    slides = generate_voiceovers_for_slide_titles(
        slide_data, s.transcript_text, s.notes_text, req.context or None,
        course=s.course,
    )

    s.slides_structure = slides
    s.slides_context = req.context
    s.slides_voiceover_overrides = {}
    s.pipeline = "slides"
    s.phase = "slides_review"

    job.set_progress(100, f"Generated {len(slides)} voiceovers")
    return {"n_slides": len(slides)}


@router.post("/{session_id}/voiceovers")
def generate_voiceovers_route(session_id: str, req: SlidesVoiceoverRequest):
    s = get_session_or_404(session_id)
    if not s.slides_pptx_path:
        raise HTTPException(400, "Upload a PPTX first (POST /api/upload/{session_id}/pptx)")
    job = job_manager.submit(session_id, "slides_voiceovers", _voiceovers_job, s, req)
    return {"job_id": job.id}


@router.patch("/{session_id}/slide/{i}")
def edit_voiceover(session_id: str, i: int, req: VoiceoverEditRequest):
    s = get_session_or_404(session_id)
    if not s.slides_structure or i < 0 or i >= len(s.slides_structure):
        raise HTTPException(404, f"No slide at index {i}")
    s.slides_voiceover_overrides[i] = req.voiceover
    wc = max(1, len(req.voiceover.split()))
    dur = max(6, min(120, int(wc / 2.4)))
    return {"voiceover": req.voiceover, "word_count": wc, "slide_duration_seconds": dur}


def _render_job(job: Job, s: Session) -> dict:
    try:
        job.set_progress(10, "Assembling final voiceovers…")
        final_slides = s.get_final_slides_for_slides_pipeline()

        job.set_progress(15, "Starting render pipeline…")
        start = time.time()
        out = create_slides_lecture(
            pptx_path=s.slides_pptx_path,
            transcript_text=s.transcript_text,
            notes_text=s.notes_text,
            context=s.slides_context,
            slides_override=final_slides,
        )
        elapsed = time.time() - start

        s.output_path = out
        s.render_elapsed = elapsed
        s.render_error = None
        s.render_traceback = None
        s.phase = "done"
        job.set_progress(100, "Complete")
        return {"output_path": out, "elapsed": elapsed}
    except Exception as e:
        s.render_error = str(e)
        s.render_traceback = traceback.format_exc()
        s.phase = "slides_review"
        raise


@router.post("/{session_id}/render")
def render(session_id: str):
    s = get_session_or_404(session_id)
    if not s.slides_structure:
        raise HTTPException(400, "No voiceovers to render yet")
    s.phase = "slides_rendering"
    job = job_manager.submit(session_id, "slides_render", _render_job, s)
    return {"job_id": job.id}
