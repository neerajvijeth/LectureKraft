"""
Session state — a direct port of streamlit_app.py's st.session_state defaults
and helpers (_init, _get_slide, _get_final_slides, _save_edit, _reset_slide,
_get_topic_scene, _get_final_topic_scenes, _get_final_slides_for_slides_pipeline)
to a plain in-memory object keyed by session_id, since there's no Streamlit
script-rerun model to hang state off of anymore.

Single-process, in-memory — matches the "just me, a few runs/day" scale this
was built for. If that changes, this is the file to swap for a Redis-backed
store; nothing else needs to know.
"""

import copy
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from diagrams import AVAILABLE_DIAGRAM_TYPES

from app import OUTPUT_DIR

SESSIONS_DIR = os.path.join(OUTPUT_DIR, "sessions")
os.makedirs(SESSIONS_DIR, exist_ok=True)

SESSION_TTL_SECONDS = 6 * 3600  # stale sessions are swept after 6h idle


@dataclass
class Session:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: float = field(default_factory=time.time)
    last_touched: float = field(default_factory=time.time)

    phase: str = "upload"            # upload | review | rendering | slides_review |
                                      # slides_rendering | topic_review | topic_rendering | done
    pipeline: str = "full"           # full | slides | topic

    # ── Full AI pipeline ─────────────────────────────────────────────────
    structure: Optional[dict] = None
    topic: str = ""
    course: str = ""          # scopes RAG retrieval to one subject
    transcript_text: Optional[str] = None
    slides_text: Optional[str] = None
    notes_text: Optional[str] = None
    skip_diagrams: bool = False
    target_duration_minutes: int = 15
    slide_statuses: Dict[int, str] = field(default_factory=dict)     # original|edited|regenerated
    slide_edits: Dict[int, dict] = field(default_factory=dict)
    slide_preview_images: Dict[int, bytes] = field(default_factory=dict)
    slide_custom_images: Dict[int, bytes] = field(default_factory=dict)
    images_prefetched: bool = False

    # ── Slides-as-is pipeline ────────────────────────────────────────────
    slides_pptx_filename: str = ""
    slides_pptx_path: Optional[str] = None
    slides_context: str = ""
    slides_structure: Optional[List[dict]] = None
    slides_voiceover_overrides: Dict[int, str] = field(default_factory=dict)

    # ── Topic Video pipeline ────────────────────────────────────────────
    topic_topic: str = ""
    topic_context: str = ""
    topic_minutes: int = 7
    topic_structure: Optional[dict] = None
    topic_scenes: Optional[List[dict]] = None
    topic_scene_edits: Dict[int, dict] = field(default_factory=dict)
    topic_scene_statuses: Dict[int, str] = field(default_factory=dict)

    # ── Shared output ────────────────────────────────────────────────────
    output_path: Optional[str] = None
    render_elapsed: Optional[float] = None
    render_error: Optional[str] = None
    render_traceback: Optional[str] = None

    def work_dir(self) -> str:
        d = os.path.join(SESSIONS_DIR, self.id)
        os.makedirs(d, exist_ok=True)
        return d

    def touch(self) -> None:
        self.last_touched = time.time()

    # ── Full pipeline helpers (ports of streamlit_app.py's _get_slide etc.) ─
    def get_slide(self, i: int) -> dict:
        return self.slide_edits.get(i, self.structure["slides"][i])

    def get_final_slides(self) -> List[dict]:
        return [self.get_slide(i) for i in range(len(self.structure["slides"]))]

    def slide_status(self, i: int) -> str:
        return self.slide_statuses.get(i, "original")

    def n_modified(self) -> int:
        return sum(1 for v in self.slide_statuses.values() if v != "original")

    def save_slide_edit(self, i: int, *, title: str, bullets: List[str],
                         voiceover: str, slide_type: str, diagram: str,
                         image_needed: bool, image_queries: List[str]) -> dict:
        original = self.structure["slides"][i]
        edited = copy.deepcopy(original)
        edited["title"] = title[:55]
        edited["bullets"] = bullets
        edited["voiceover"] = voiceover
        edited["type"] = slide_type
        edited["diagram"] = diagram if diagram != "none" else "none"
        edited["diagram_needed"] = diagram != "none"
        edited["image"] = {
            "needed": image_needed,
            "search_queries": image_queries,
            "placement": "right",
        }
        self.slide_edits[i] = edited
        self.slide_statuses[i] = "edited"
        self._clear_preview(i)
        if slide_type == "diagram":
            self.slide_preview_images.pop(i, None)
            self.slide_custom_images.pop(i, None)
        return edited

    def apply_regenerated_slide(self, i: int, result: dict) -> None:
        self.slide_edits[i] = result
        self.slide_statuses[i] = "regenerated"
        self._clear_preview(i)

    def reset_slide(self, i: int) -> dict:
        self.slide_edits.pop(i, None)
        self.slide_statuses.pop(i, None)
        self._clear_preview(i)
        return self.get_slide(i)

    def _clear_preview(self, i: int) -> None:
        self.slide_preview_images.pop(i, None)
        try:
            from app import invalidate_preview_cache
            invalidate_preview_cache(i)
        except Exception:
            pass

    # ── Slides-as-is pipeline helpers ───────────────────────────────────
    def slide_voiceover(self, i: int) -> str:
        base = self.slides_structure[i]
        return self.slides_voiceover_overrides.get(i, base.get("voiceover", ""))

    def get_final_slides_for_slides_pipeline(self) -> List[dict]:
        result = []
        for i, slide in enumerate(self.slides_structure or []):
            vo = self.slide_voiceover(i)
            wc = max(1, len(vo.split()))
            dur = max(6, min(120, int(wc / 2.4)))
            result.append({**slide, "voiceover": vo, "slide_duration_seconds": dur})
        return result

    # ── Topic pipeline helpers ──────────────────────────────────────────
    def get_topic_scene(self, i: int) -> dict:
        return self.topic_scene_edits.get(i, self.topic_scenes[i])

    def get_final_topic_scenes(self) -> List[dict]:
        return [self.get_topic_scene(i) for i in range(len(self.topic_scenes))]

    def topic_scene_status(self, i: int) -> str:
        return self.topic_scene_statuses.get(i, "original")

    def save_topic_scene_edit(self, i: int, *, title: str, voiceover: str,
                               scene_type: str, duration_seconds: int) -> dict:
        scene = self.get_topic_scene(i)
        edited = copy.deepcopy(scene)
        edited["title"] = title[:55]
        edited["voiceover"] = voiceover
        edited["scene_type"] = scene_type
        edited["duration_seconds"] = duration_seconds
        if "params" in edited:
            edited["params"]["title"] = title[:55]
        self.topic_scene_edits[i] = edited
        self.topic_scene_statuses[i] = "edited"
        return edited

    def apply_regenerated_scene(self, i: int, result: dict) -> None:
        self.topic_scene_edits[i] = result
        self.topic_scene_statuses[i] = "regenerated"

    def reset_topic_scene(self, i: int) -> dict:
        self.topic_scene_edits.pop(i, None)
        self.topic_scene_statuses.pop(i, None)
        return self.get_topic_scene(i)

    # ── Start over (keeps the session/URL, clears generated content) ──────
    def start_over(self) -> None:
        self.phase = "upload"
        self.structure = None
        self.topic = ""
        self.course = ""
        self.transcript_text = None
        self.slides_text = None
        self.notes_text = None
        self.slide_statuses = {}
        self.slide_edits = {}
        self.slide_preview_images = {}
        self.slide_custom_images = {}
        self.images_prefetched = False

        self.slides_pptx_filename = ""
        self.slides_pptx_path = None
        self.slides_context = ""
        self.slides_structure = None
        self.slides_voiceover_overrides = {}

        self.topic_topic = ""
        self.topic_context = ""
        self.topic_structure = None
        self.topic_scenes = None
        self.topic_scene_edits = {}
        self.topic_scene_statuses = {}

        self.output_path = None
        self.render_elapsed = None
        self.render_error = None
        self.render_traceback = None


class SessionStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: Dict[str, Session] = {}

    def create(self) -> Session:
        s = Session()
        with self._lock:
            self._sessions[s.id] = s
        return s

    def get(self, session_id: str) -> Optional[Session]:
        with self._lock:
            s = self._sessions.get(session_id)
        if s:
            s.touch()
        return s

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def sweep_stale(self) -> int:
        now = time.time()
        with self._lock:
            stale = [sid for sid, s in self._sessions.items()
                     if now - s.last_touched > SESSION_TTL_SECONDS]
            for sid in stale:
                del self._sessions[sid]
        return len(stale)


store = SessionStore()
