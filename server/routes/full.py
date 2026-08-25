"""Full AI pipeline: notes/transcript/slides -> AI structure -> review (edit,
regen, images) -> render. Ports streamlit_app.py's full-pipeline phase
functions (_handle_generate_full, _render_card, _render_image_section,
_auto_prefetch_previews, _phase_rendering) onto the job/session model."""

import logging
import os
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from app import (
    OUTPUT_DIR,
    create_lecture,
    fetch_preview_image,
    generate_lecture_structure,
    invalidate_preview_cache,
    regenerate_single_slide,
)
from groq_client import IS_FREE_TIER
from server.jobs import Job, manager as job_manager
from server.models import FullStructureRequest, SettingsRequest, SlideEditRequest, SlideRegenRequest
from server.routes.common import get_session_or_404, session_public_state
from server.sessions import Session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/full")


# ════════════════════════════════════════════════════════════════════════════
# STRUCTURE GENERATION
# ════════════════════════════════════════════════════════════════════════════

def _structure_job(job: Job, s: Session, req: FullStructureRequest) -> dict:
    job.set_progress(10, "Calling Groq for lecture structure…")
    structure = generate_lecture_structure(
        topic=req.topic,
        transcript_text=s.transcript_text,
        slides_text=s.slides_text,
        notes_text=s.notes_text,
        target_duration_minutes=req.target_duration_minutes,
        course=s.course,
    )
    n = len(structure["slides"])

    s.structure = structure
    s.topic = req.topic
    s.skip_diagrams = req.skip_diagrams
    s.target_duration_minutes = req.target_duration_minutes
    s.slide_statuses = {i: "original" for i in range(n)}
    s.slide_edits = {}
    s.slide_preview_images = {}
    s.slide_custom_images = {}
    s.images_prefetched = False
    s.pipeline = "full"
    s.phase = "review"

    job.set_progress(100, f"Structure ready — {n} slides")
    return {"n_slides": n}


@router.post("/{session_id}/structure")
def generate_structure(session_id: str, req: FullStructureRequest):
    s = get_session_or_404(session_id)
    if not req.topic and not any([s.transcript_text, s.slides_text, s.notes_text]):
        raise HTTPException(400, "Provide a topic or upload at least one reference file first")
    job = job_manager.submit(session_id, "full_structure", _structure_job, s, req)
    return {"job_id": job.id}


# ════════════════════════════════════════════════════════════════════════════
# IMAGE PREFETCH  (auto-runs on entering review, mirrors _auto_prefetch_previews)
# ════════════════════════════════════════════════════════════════════════════

def _prefetch_job(job: Job, s: Session) -> dict:
    slides = s.structure["slides"]
    to_fetch = [
        i for i in range(len(slides))
        if slides[i].get("type") == "text"
        and slides[i].get("image", {}).get("needed")
        and bool(slides[i].get("image", {}).get("search_queries"))
        and i not in s.slide_custom_images
        and i not in s.slide_preview_images
    ]
    if not to_fetch:
        s.images_prefetched = True
        job.set_progress(100, "No images to fetch")
        return {"fetched": 0, "total": 0}

    max_workers = 2 if IS_FREE_TIER else 4  # vision-check burst is the TPM peak
    done = 0
    fetched = 0

    def _fetch_one(idx: int):
        path = fetch_preview_image(idx, slides[idx], topic=s.topic, force_refresh=False)
        if path and os.path.exists(path) and os.path.getsize(path) > 100:
            with open(path, "rb") as f:
                return idx, f.read()
        return idx, None

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_fetch_one, i): i for i in to_fetch}
        for fut in as_completed(futures):
            idx, img_bytes = fut.result()
            if img_bytes:
                s.slide_preview_images[idx] = img_bytes
                fetched += 1
            done += 1
            job.set_progress(
                int(5 + 90 * done / len(to_fetch)),
                f"Fetching images: {done}/{len(to_fetch)}…",
            )

    s.images_prefetched = True
    job.set_progress(100, f"Fetched {fetched}/{len(to_fetch)} images")
    return {"fetched": fetched, "total": len(to_fetch)}


@router.patch("/{session_id}/settings")
def update_settings(session_id: str, req: SettingsRequest):
    """Lets the review screen's 'Skip Manim' toggle take effect even though
    it was originally set at structure-generation time."""
    s = get_session_or_404(session_id)
    s.skip_diagrams = req.skip_diagrams
    return {"skip_diagrams": s.skip_diagrams}


@router.post("/{session_id}/prefetch-images")
def prefetch_images_route(session_id: str):
    s = get_session_or_404(session_id)
    if not s.structure:
        raise HTTPException(400, "No structure yet")
    job = job_manager.submit(session_id, "full_prefetch_images", _prefetch_job, s)
    return {"job_id": job.id}


# ════════════════════════════════════════════════════════════════════════════
# SLIDE EDIT / RESET / REGEN
# ════════════════════════════════════════════════════════════════════════════

@router.patch("/{session_id}/slide/{i}")
def edit_slide(session_id: str, i: int, req: SlideEditRequest):
    s = get_session_or_404(session_id)
    _check_slide_index(s, i)
    edited = s.save_slide_edit(
        i, title=req.title, bullets=req.bullets, voiceover=req.voiceover,
        slide_type=req.type, diagram=req.diagram,
        image_needed=req.image_needed, image_queries=req.image_queries,
    )
    job_id = None
    if req.type == "text" and req.image_needed and req.image_queries:
        job = job_manager.submit(session_id, "image_refetch", _refetch_job, s, i)
        job_id = job.id
    return {"slide": edited, "status": s.slide_status(i), "image_job_id": job_id}


@router.post("/{session_id}/slide/{i}/reset")
def reset_slide(session_id: str, i: int):
    s = get_session_or_404(session_id)
    _check_slide_index(s, i)
    original = s.structure["slides"][i]
    slide = s.reset_slide(i)
    job_id = None
    if (original.get("type") == "text" and original.get("image", {}).get("needed")
            and original.get("image", {}).get("search_queries")):
        job = job_manager.submit(session_id, "image_refetch", _refetch_job, s, i)
        job_id = job.id
    return {"slide": slide, "status": s.slide_status(i), "image_job_id": job_id}


def _regen_job(job: Job, s: Session, i: int, req: SlideRegenRequest) -> dict:
    job.set_progress(10, f"Regenerating slide {i + 1}…")
    slides_all = s.structure["slides"]
    surrounding = [slides_all[j] for j in range(max(0, i - 2), min(len(slides_all), i + 3)) if j != i]
    result = regenerate_single_slide(
        slide_idx=i, current_slide=s.get_slide(i),
        structure_metadata=s.structure["metadata"], surrounding_slides=surrounding,
        transcript_text=s.transcript_text, slides_text=s.slides_text, notes_text=s.notes_text,
        mode=req.mode, custom_prompt=req.custom_prompt,
    )
    s.apply_regenerated_slide(i, result)
    job.set_progress(85, "Regeneration complete")

    image = result.get("image") or {}
    if result.get("type") == "text" and image.get("needed") and image.get("search_queries"):
        job.set_progress(90, "Fetching image for regenerated slide…")
        try:
            path = fetch_preview_image(i, result, topic=s.topic, force_refresh=False)
            if path and os.path.exists(path) and os.path.getsize(path) > 100:
                with open(path, "rb") as f:
                    s.slide_preview_images[i] = f.read()
        except Exception as e:
            logger.warning(f"Image fetch after regen failed for slide {i + 1}: {e}")

    job.set_progress(100, "Done")
    return {"slide": result, "status": "regenerated"}


@router.post("/{session_id}/slide/{i}/regen")
def regen_slide(session_id: str, i: int, req: SlideRegenRequest):
    s = get_session_or_404(session_id)
    _check_slide_index(s, i)
    job = job_manager.submit(session_id, "slide_regen", _regen_job, s, i, req)
    return {"job_id": job.id}


def _check_slide_index(s: Session, i: int) -> None:
    if not s.structure or i < 0 or i >= len(s.structure["slides"]):
        raise HTTPException(404, f"No slide at index {i}")


# ════════════════════════════════════════════════════════════════════════════
# IMAGES
# ════════════════════════════════════════════════════════════════════════════

@router.get("/{session_id}/slide/{i}/image")
def get_slide_image(session_id: str, i: int):
    s = get_session_or_404(session_id)
    data = s.slide_custom_images.get(i) or s.slide_preview_images.get(i)
    if not data:
        raise HTTPException(404, "No image for this slide yet")
    return Response(content=data, media_type="image/jpeg")


def _refetch_job(job: Job, s: Session, i: int) -> dict:
    job.set_progress(20, "Fetching from Google + Vision check…")
    ok = False
    try:
        path = fetch_preview_image(i, s.get_slide(i), topic=s.topic, force_refresh=True)
        if path and os.path.exists(path) and os.path.getsize(path) > 100:
            with open(path, "rb") as f:
                s.slide_preview_images[i] = f.read()
            ok = True
        else:
            s.slide_preview_images.pop(i, None)
    except Exception as e:
        logger.warning(f"Image refetch failed for slide {i + 1}: {e}")
    job.set_progress(100, "Image ready" if ok else "No relevant image found")
    return {"ok": ok}


@router.post("/{session_id}/slide/{i}/image/refetch")
def refetch_image(session_id: str, i: int):
    s = get_session_or_404(session_id)
    _check_slide_index(s, i)
    s.slide_preview_images.pop(i, None)
    job = job_manager.submit(session_id, "image_refetch", _refetch_job, s, i)
    return {"job_id": job.id}


@router.post("/{session_id}/slide/{i}/image/upload")
async def upload_slide_image(session_id: str, i: int, file: UploadFile = File(...)):
    s = get_session_or_404(session_id)
    _check_slide_index(s, i)
    data = await file.read()
    if not data:
        raise HTTPException(400, "Uploaded image is empty")
    s.slide_custom_images[i] = data
    s.slide_preview_images.pop(i, None)
    return {"ok": True}


@router.delete("/{session_id}/slide/{i}/image")
def delete_custom_image(session_id: str, i: int):
    s = get_session_or_404(session_id)
    _check_slide_index(s, i)
    s.slide_custom_images.pop(i, None)
    return {"ok": True}


# ════════════════════════════════════════════════════════════════════════════
# RENDER
# ════════════════════════════════════════════════════════════════════════════

def _render_job(job: Job, s: Session) -> dict:
    try:
        job.set_progress(5, "Assembling final slide list…")
        final_slides = s.get_final_slides()
        n_ed = sum(1 for v in s.slide_statuses.values() if v == "edited")
        n_reg = sum(1 for v in s.slide_statuses.values() if v == "regenerated")
        n_cust = len(s.slide_custom_images)
        logger.info(f"Rendering {len(final_slides)} slides ({n_ed} edited, {n_reg} regen, {n_cust} custom images)")

        job.set_progress(10, "Starting render pipeline…")
        start = time.time()
        out = create_lecture(
            topic=s.topic,
            transcript_text=s.transcript_text,
            slides_text=s.slides_text,
            notes_text=s.notes_text,
            skip_diagrams=s.skip_diagrams,
            slides_override=final_slides,
            custom_images_bytes=dict(s.slide_custom_images),
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
        s.phase = "review"
        raise


@router.post("/{session_id}/render")
def render(session_id: str):
    s = get_session_or_404(session_id)
    if not s.structure:
        raise HTTPException(400, "No structure to render yet")
    s.phase = "rendering"
    job = job_manager.submit(session_id, "full_render", _render_job, s)
    return {"job_id": job.id}
