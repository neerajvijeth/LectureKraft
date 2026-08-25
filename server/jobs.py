"""
Job registry — replaces Streamlit's blocking st.spinner()/st.progress() model.

Each long-running pipeline call (structure generation, regen, render) runs on
a small thread pool. The route handler gets a job_id back immediately; the
frontend streams progress via SSE (see main.py's /api/jobs/{id}/events).

Log capture: app.py logs through the root logger, exactly like it did under
Streamlit. Two jobs can run concurrently (max_workers=2), so each job's log
handler filters by the thread id it was dispatched to, mirroring what
streamlit_app.py's _LogHandler did for a single script-thread.
"""

import logging
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_WORKERS = 2
MAX_LOG_LINES = 500


@dataclass
class Job:
    id: str
    session_id: str
    kind: str
    status: str = "queued"  # queued | running | done | error
    progress: int = 0
    message: str = ""
    log: List[str] = field(default_factory=list)
    result: Optional[Any] = None
    error: Optional[str] = None
    traceback: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def set_progress(self, pct: int, message: str) -> None:
        with self._lock:
            self.progress = pct
            self.message = message

    def append_log(self, line: str) -> None:
        with self._lock:
            self.log.append(line)
            if len(self.log) > MAX_LOG_LINES:
                self.log = self.log[-MAX_LOG_LINES:]

    def snapshot(self, log_from: int = 0) -> Dict:
        with self._lock:
            return {
                "id": self.id,
                "kind": self.kind,
                "status": self.status,
                "progress": self.progress,
                "message": self.message,
                "new_log": list(self.log[log_from:]),
                "log_len": len(self.log),
                "result": self.result,
                "error": self.error,
                "traceback": self.traceback,
            }


class _JobLogHandler(logging.Handler):
    """Only accepts records emitted from this job's own worker thread, so
    concurrent jobs on the shared thread pool don't cross-contaminate logs."""

    def __init__(self, job: Job, thread_id: int):
        super().__init__()
        self.job = job
        self.thread_id = thread_id

    def emit(self, record: logging.LogRecord) -> None:
        if record.thread != self.thread_id:
            return
        try:
            self.job.append_log(self.format(record))
        except Exception:
            pass


class JobManager:
    def __init__(self, max_workers: int = MAX_WORKERS):
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, session_id: str, kind: str,
               fn: Callable[..., Any], *args, **kwargs) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], session_id=session_id, kind=kind)
        with self._lock:
            self._jobs[job.id] = job

        def _run() -> None:
            job.status = "running"
            job.started_at = time.time()
            thread_id = threading.get_ident()
            handler = _JobLogHandler(job, thread_id)
            handler.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))
            root = logging.getLogger()
            root.addHandler(handler)
            try:
                result = fn(job, *args, **kwargs)
                job.result = result
                job.status = "done"
                job.progress = 100
            except Exception as e:  # noqa: BLE001 — surfaced to the client, not swallowed
                job.status = "error"
                job.error = str(e)
                job.traceback = traceback.format_exc()
                logger.error(f"Job {job.id} ({kind}) failed: {e}")
            finally:
                root.removeHandler(handler)
                job.finished_at = time.time()

        self._executor.submit(_run)
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)


manager = JobManager()
