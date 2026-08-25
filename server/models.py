"""Pydantic request bodies for the API. Response payloads are mostly the raw
dicts app.py already produces (slide/scene structures) — no need to re-model
those, they pass through as-is so the AI-generated shape never drifts from
what app.py actually returns."""

from typing import List, Optional

from pydantic import BaseModel, Field


class SettingsRequest(BaseModel):
    skip_diagrams: bool


class FullStructureRequest(BaseModel):
    topic: str = ""
    target_duration_minutes: int = Field(15, ge=5, le=30)
    skip_diagrams: bool = False


class SlidesVoiceoverRequest(BaseModel):
    context: str = ""


class VoiceoverEditRequest(BaseModel):
    voiceover: str


class TopicStructureRequest(BaseModel):
    topic: str
    context: str = ""
    target_minutes: int = Field(7, ge=3, le=12)


class SlideEditRequest(BaseModel):
    title: str
    bullets: List[str]
    voiceover: str
    type: str = "text"
    diagram: str = "none"
    image_needed: bool = False
    image_queries: List[str] = []


class SlideRegenRequest(BaseModel):
    mode: str = "full"  # full | voiceover_only
    custom_prompt: str = ""


class SceneEditRequest(BaseModel):
    title: str
    voiceover: str
    scene_type: str
    duration_seconds: int = Field(30, ge=8, le=120)


class SceneRegenRequest(BaseModel):
    custom_prompt: str = ""
