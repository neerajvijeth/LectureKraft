"""Topic Video pipeline — pure Manim, no uploads. Ports streamlit_app.py's
_handle_generate_topic / _phase_topic_review / _phase_topic_rendering onto
the job/session model."""

import logging
import time
import traceback

from fastapi import APIRouter, HTTPException

from app import create_topic_video, generate_topic_structure, regenerate_topic_scene
from server.jobs import Job, manager as job_manager
from server.models import SceneEditRequest, SceneRegenRequest, TopicStructureRequest
from server.routes.common import get_session_or_404
from server.sessions import Session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/topic")


# ════════════════════════════════════════════════════════════════════════════
# STRUCTURE GENERATION
# ════════════════════════════════════════════════════════════════════════════

def _structure_job(job: Job, s: Session, req: TopicStructureRequest) -> dict:
    job.set_progress(10, f"Designing a {req.target_minutes}-minute scene plan for '{req.topic}'…")
    structure = generate_topic_structure(
        topic=req.topic, context=req.context, target_minutes=req.target_minutes
    )
    scenes = structure.get("scenes", [])
    if not scenes:
        raise RuntimeError("Groq returned an empty scene plan — try again or rephrase the topic")
    n = len(scenes)

    s.topic_structure = structure
    s.topic_topic = req.topic
    s.topic_context = req.context
    s.topic_minutes = req.target_minutes
    s.topic_scenes = scenes
    s.topic_scene_edits = {}
    s.topic_scene_statuses = {i: "original" for i in range(n)}
    s.pipeline = "topic"
    s.phase = "topic_review"

    job.set_progress(100, f"Scene plan ready — {n} scenes")
    return {"n_scenes": n}


@router.post("/{session_id}/structure")
def generate_structure(session_id: str, req: TopicStructureRequest):
    s = get_session_or_404(session_id)
    if not req.topic.strip():
        raise HTTPException(400, "Topic is required")
    job = job_manager.submit(session_id, "topic_structure", _structure_job, s, req)
    return {"job_id": job.id}


# ════════════════════════════════════════════════════════════════════════════
# SCENE EDIT / RESET / REGEN
# ════════════════════════════════════════════════════════════════════════════

def _check_scene_index(s: Session, i: int) -> None:
    if not s.topic_scenes or i < 0 or i >= len(s.topic_scenes):
        raise HTTPException(404, f"No scene at index {i}")


@router.patch("/{session_id}/scene/{i}")
def edit_scene(session_id: str, i: int, req: SceneEditRequest):
    s = get_session_or_404(session_id)
    _check_scene_index(s, i)
    edited = s.save_topic_scene_edit(
        i, title=req.title, voiceover=req.voiceover,
        scene_type=req.scene_type, duration_seconds=req.duration_seconds,
    )
    return {"scene": edited, "status": s.topic_scene_status(i)}


@router.post("/{session_id}/scene/{i}/reset")
def reset_scene(session_id: str, i: int):
    s = get_session_or_404(session_id)
    _check_scene_index(s, i)
    scene = s.reset_topic_scene(i)
    return {"scene": scene, "status": s.topic_scene_status(i)}


def _regen_job(job: Job, s: Session, i: int, req: SceneRegenRequest) -> dict:
    job.set_progress(20, f"Regenerating scene {i + 1}…")
    all_scenes = s.topic_scenes
    surrounding = [all_scenes[j] for j in range(max(0, i - 2), min(len(all_scenes), i + 3)) if j != i]
    result = regenerate_topic_scene(
        scene_idx=i, current_scene=s.get_topic_scene(i),
        topic=s.topic_topic, context=s.topic_context,
        surrounding_scenes=surrounding, custom_prompt=req.custom_prompt,
    )
    s.apply_regenerated_scene(i, result)
    job.set_progress(100, "Done")
    return {"scene": result, "status": "regenerated"}


@router.post("/{session_id}/scene/{i}/regen")
def regen_scene(session_id: str, i: int, req: SceneRegenRequest):
    s = get_session_or_404(session_id)
    _check_scene_index(s, i)
    job = job_manager.submit(session_id, "scene_regen", _regen_job, s, i, req)
    return {"job_id": job.id}


# ════════════════════════════════════════════════════════════════════════════
# RENDER
# ════════════════════════════════════════════════════════════════════════════

def _render_job(job: Job, s: Session) -> dict:
    try:
        job.set_progress(10, "Starting Manim render + TTS generation in parallel…")
        start = time.time()
        final_scenes = s.get_final_topic_scenes()
        out = create_topic_video(
            topic=s.topic_topic, context=s.topic_context,
            target_minutes=s.topic_minutes, scenes_override=final_scenes,
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
        s.phase = "topic_review"
        raise


@router.post("/{session_id}/render")
def render(session_id: str):
    s = get_session_or_404(session_id)
    if not s.topic_scenes:
        raise HTTPException(400, "No scene plan to render yet")
    s.phase = "topic_rendering"
    job = job_manager.submit(session_id, "topic_render", _render_job, s)
    return {"job_id": job.id}
