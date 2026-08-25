"""
FastAPI entrypoint. Thin HTTP layer over app.py's existing pipeline functions
— routes/full.py, routes/slides.py, routes/topic.py, routes/common.py do the
wiring; nothing in app.py is reimplemented here.

Run with:
    uvicorn server.main:app --reload --port 8000
"""

import asyncio
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from server.routes import common, full, slides, topic
from server.sessions import store

logger = logging.getLogger(__name__)

app = FastAPI(title="AI Lecture Generator API")

# Dev: Vite runs on 5173/5174 and proxies /api here anyway, but CORS is set
# permissively for local development regardless of proxy config.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(common.router)
app.include_router(full.router)
app.include_router(slides.router)
app.include_router(topic.router)


@app.get("/api/ping")
def ping():
    return {"ok": True}


async def _sweep_loop():
    while True:
        await asyncio.sleep(1800)  # 30 min
        n = store.sweep_stale()
        if n:
            logger.info(f"Swept {n} stale session(s)")


@app.on_event("startup")
async def _on_startup():
    asyncio.create_task(_sweep_loop())
    logger.info("AI Lecture Generator API ready")


# ── Serve the built React app in production ──────────────────────────────────
# `npm run build` in frontend/ outputs to frontend/dist. If it exists, mount
# it as static files so a single `uvicorn server.main:app` serves both API
# and UI. In dev, run the Vite dev server separately (`npm run dev`) instead
# — it proxies /api to this process.
_FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.isdir(_FRONTEND_DIST):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")
    logger.info(f"Serving built frontend from {_FRONTEND_DIST}")
else:
    logger.info("frontend/dist not found — run `npm run dev` in frontend/ for local UI")
