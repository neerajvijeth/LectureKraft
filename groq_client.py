"""
Groq LLM layer with multi-key rotation.

Replaces `google.genai` with Groq's `qwen/qwen3.6-27b`. Exposes a shim with the
same surface app.py already calls:

    client.models.generate_content(model=..., contents=...)  -> .text

so the eight call sites in app.py need no rewriting.

Free-tier Groq limits are low enough that a single run of the full pipeline will
exhaust one key mid-way. `GroqKeyRotator` tracks RPM / TPM / RPD / TPD per key
locally, picks whichever key has headroom, and cools down keys that 429.
"""

import base64
import io
import logging
import os
import random
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional, Tuple, Union

from dotenv import load_dotenv
from groq import Groq
from PIL import Image

load_dotenv()

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════════════════════

GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.6-27b")
GROQ_TIER = os.getenv("GROQ_TIER", "free").strip().lower()

# Per-key free-tier limits. Verify yours at console.groq.com/settings/limits —
# they vary by model and organisation. Override via .env.
LIMIT_RPM = int(os.getenv("GROQ_RPM", "30"))
LIMIT_TPM = int(os.getenv("GROQ_TPM", "6000"))
LIMIT_RPD = int(os.getenv("GROQ_RPD", "1000"))
LIMIT_TPD = int(os.getenv("GROQ_TPD", "500000"))

MAX_RETRIES = int(os.getenv("GROQ_MAX_RETRIES", "4"))
MAX_WAIT_SECONDS = float(os.getenv("GROQ_MAX_WAIT", "180"))

# Default completion cap. Keep well under the model's 16,384 so a single
# request has a chance of fitting inside a free-tier TPM window.
#
# This is a *fallback* — every caller should pass an explicit
# max_completion_tokens sized to what it actually returns. The cap is also the
# TPM reservation size, so an oversized default starves the rotator: a vision
# check that really costs ~900 tokens would reserve ~3,900 and monopolise a key.
DEFAULT_MAX_COMPLETION_TOKENS = int(os.getenv("GROQ_MAX_COMPLETION", "1200"))

# qwen3.6-27b accepts reasoning_effort "none" | "default". Reasoning tokens are
# billed as completion tokens and generated serially before the answer, so they
# are the single biggest cost on a 6k-TPM budget. Default it off; the handful of
# genuine planning calls opt back in with reasoning="default".
DEFAULT_REASONING = os.getenv("GROQ_REASONING", "none").strip().lower()

# Hard ceiling for retry growth, independent of the per-key TPM window.
MAX_COMPLETION_CEILING = int(os.getenv("GROQ_MAX_COMPLETION_CEILING", "8000"))

IS_FREE_TIER = GROQ_TIER == "free"


def _load_keys() -> List[Tuple[str, str]]:
    """Collect GROQ_API_KEY_1..N (plus a bare GROQ_API_KEY) from the environment."""
    found: List[Tuple[str, str]] = []
    seen = set()

    bare = (os.getenv("GROQ_API_KEY") or "").strip()
    if bare:
        found.append(("GROQ_API_KEY", bare))
        seen.add(bare)

    i = 1
    misses = 0
    while misses < 5:  # tolerate gaps in the numbering
        name = f"GROQ_API_KEY_{i}"
        val = (os.getenv(name) or "").strip()
        if val:
            if val not in seen:
                found.append((name, val))
                seen.add(val)
            misses = 0
        else:
            misses += 1
        i += 1

    return found


# ════════════════════════════════════════════════════════════════════════════
# ERRORS
# ════════════════════════════════════════════════════════════════════════════


class GroqLayerError(RuntimeError):
    pass


class NoKeysConfigured(GroqLayerError):
    pass


class PromptTooLargeError(GroqLayerError):
    """The request cannot fit in a single key's TPM window — chunk the caller."""


class AllKeysExhausted(GroqLayerError):
    """Every key is rate-limited; carries a hint for how long to wait."""

    def __init__(self, message: str, retry_after: float = 0.0):
        super().__init__(message)
        self.retry_after = retry_after


class TruncatedReasoning(GroqLayerError):
    """
    The model was still thinking when max_completion_tokens cut it off.

    Never treat the partial output as content: an unclosed <think> block is a
    raw chain of thought, and returning it means the reasoning gets spoken
    aloud by TTS. Callers retry with a larger budget instead.
    """


# ════════════════════════════════════════════════════════════════════════════
# PER-KEY STATE
# ════════════════════════════════════════════════════════════════════════════


@dataclass
class KeyState:
    label: str
    key: str
    client: Groq

    req_times: Deque[float] = field(default_factory=deque)
    # (timestamp, tokens, ticket) — the ticket lets a thread settle *its own*
    # reservation. Without it, concurrent callers on one key correct each
    # other's entries and the TPM window drifts badly out of sync.
    tok_events: Deque[Tuple[float, int, int]] = field(default_factory=deque)
    _next_ticket: int = 0

    day_requests: int = 0
    day_tokens: int = 0
    day_started: float = field(default_factory=time.time)

    cooldown_until: float = 0.0
    consecutive_429: int = 0
    total_requests: int = 0
    total_429: int = 0

    # Per-key limits. The .env values are only a starting estimate — Groq
    # reports the account's real allowance on every response, so these get
    # corrected from headers after the first successful call. Guessing low
    # throttles us for no reason; the published free-tier default of 6k TPM
    # turned out to be 8k on this account.
    tpm_limit: int = LIMIT_TPM
    rpm_limit: int = LIMIT_RPM
    rpd_limit: int = LIMIT_RPD
    tpd_limit: int = LIMIT_TPD
    limits_calibrated: bool = False

    # ── window maintenance ────────────────────────────────────────────────
    def _prune(self, now: float) -> None:
        cutoff = now - 60.0
        while self.req_times and self.req_times[0] < cutoff:
            self.req_times.popleft()
        while self.tok_events and self.tok_events[0][0] < cutoff:
            self.tok_events.popleft()
        if now - self.day_started >= 86400.0:
            self.day_started = now
            self.day_requests = 0
            self.day_tokens = 0

    def minute_tokens(self, now: float) -> int:
        self._prune(now)
        return sum(t for _, t, _ in self.tok_events)

    def minute_requests(self, now: float) -> int:
        self._prune(now)
        return len(self.req_times)

    # ── calibration ───────────────────────────────────────────────────────
    def calibrate(self, headers) -> None:
        """
        Adopt the account's real limits from Groq's rate-limit headers.

        Only ever *relaxes* a limit and only ever *tightens* remaining headroom,
        so a missing or malformed header can never make us more aggressive than
        the .env seed.
        """
        if not headers:
            return

        def _int(name: str) -> Optional[int]:
            raw = headers.get(name)
            if raw is None:
                return None
            try:
                return int(float(str(raw).strip()))
            except (TypeError, ValueError):
                return None

        limit_tok = _int("x-ratelimit-limit-tokens")
        if limit_tok and limit_tok > self.tpm_limit:
            logger.info(
                f"  {self.label}: TPM limit {self.tpm_limit:,} -> {limit_tok:,} "
                f"(from Groq headers)"
            )
            self.tpm_limit = limit_tok

        limit_req = _int("x-ratelimit-limit-requests")
        if limit_req and limit_req > self.rpd_limit:
            self.rpd_limit = limit_req

        # Server-side accounting beats our chars/4 heuristic. If Groq says we
        # have less headroom than our local window implies, we under-counted —
        # top the window up so the next admission decision reflects reality.
        remaining = _int("x-ratelimit-remaining-tokens")
        if remaining is not None:
            now = time.time()
            local_used = self.minute_tokens(now)
            server_used = max(0, self.tpm_limit - remaining)
            if server_used > local_used:
                self._next_ticket += 1
                self.tok_events.append(
                    (now, server_used - local_used, self._next_ticket)
                )

        self.limits_calibrated = True

    # ── admission ─────────────────────────────────────────────────────────
    def headroom(self, now: float) -> int:
        """Tokens still available in this key's 60s window."""
        return self.tpm_limit - self.minute_tokens(now)

    def can_serve(self, est_tokens: int, now: float) -> bool:
        if now < self.cooldown_until:
            return False
        self._prune(now)
        if len(self.req_times) + 1 > self.rpm_limit:
            return False
        if self.minute_tokens(now) + est_tokens > self.tpm_limit:
            return False
        if self.day_requests + 1 > self.rpd_limit:
            return False
        if self.day_tokens + est_tokens > self.tpd_limit:
            return False
        return True

    def wait_hint(self, est_tokens: int, now: float) -> float:
        """Seconds until this key could plausibly serve `est_tokens`."""
        waits = [max(0.0, self.cooldown_until - now)]
        self._prune(now)

        if len(self.req_times) + 1 > self.rpm_limit and self.req_times:
            waits.append(max(0.0, self.req_times[0] + 60.0 - now))

        if self.minute_tokens(now) + est_tokens > self.tpm_limit:
            # Walk the window forward until enough tokens have aged out.
            need = self.minute_tokens(now) + est_tokens - self.tpm_limit
            freed = 0
            for ts, tok, _ in self.tok_events:
                freed += tok
                if freed >= need:
                    waits.append(max(0.0, ts + 60.0 - now))
                    break
            else:
                waits.append(60.0)

        if (self.day_requests + 1 > self.rpd_limit
                or self.day_tokens + est_tokens > self.tpd_limit):
            waits.append(max(0.0, self.day_started + 86400.0 - now))

        return max(waits)

    # ── bookkeeping ───────────────────────────────────────────────────────
    def reserve(self, est_tokens: int, now: float) -> int:
        """
        Provisionally charge the estimate so concurrent threads see it.
        Returns a ticket identifying this reservation.
        """
        self._next_ticket += 1
        ticket = self._next_ticket
        self.req_times.append(now)
        self.tok_events.append((now, est_tokens, ticket))
        self.day_requests += 1
        self.day_tokens += est_tokens
        self.total_requests += 1
        return ticket

    def settle(self, ticket: int, actual_tokens: int) -> None:
        """Replace this thread's reserved estimate with the real usage."""
        for i, (ts, tok, tk) in enumerate(self.tok_events):
            if tk == ticket:
                self.tok_events[i] = (ts, max(0, actual_tokens), tk)
                self.day_tokens = max(0, self.day_tokens - tok + actual_tokens)
                return
        # Aged out of the 60s window already — only the daily total still cares.
        self.day_tokens = max(0, self.day_tokens + actual_tokens)

    def snapshot(self) -> Dict:
        now = time.time()
        self._prune(now)
        return {
            "label": self.label,
            "key_suffix": self.key[-4:] if len(self.key) >= 4 else "????",
            "rpm_used": len(self.req_times),
            "rpm_limit": self.rpm_limit,
            "tpm_used": self.minute_tokens(now),
            "tpm_limit": self.tpm_limit,
            "rpd_used": self.day_requests,
            "rpd_limit": self.rpd_limit,
            "tpd_used": self.day_tokens,
            "tpd_limit": self.tpd_limit,
            "cooling_down": now < self.cooldown_until,
            "cooldown_remaining": max(0.0, round(self.cooldown_until - now, 1)),
            "total_requests": self.total_requests,
            "total_429": self.total_429,
        }


# ════════════════════════════════════════════════════════════════════════════
# ROTATOR
# ════════════════════════════════════════════════════════════════════════════


class GroqKeyRotator:
    def __init__(self, keys: Optional[List[Tuple[str, str]]] = None):
        pairs = keys if keys is not None else _load_keys()
        if not pairs:
            raise NoKeysConfigured(
                "No Groq API keys found. Set GROQ_API_KEY_1..N in .env "
                "(5 keys recommended for the free tier)."
            )
        self._lock = threading.Lock()
        self._cv = threading.Condition(self._lock)
        self.keys: List[KeyState] = [
            KeyState(label=name, key=val, client=Groq(api_key=val)) for name, val in pairs
        ]
        self._cursor = 0
        logger.info(
            f"Groq rotator ready: {len(self.keys)} key(s), model={GROQ_MODEL}, "
            f"tier={GROQ_TIER} (rpm={LIMIT_RPM} tpm={LIMIT_TPM} "
            f"rpd={LIMIT_RPD} tpd={LIMIT_TPD})"
        )

    # ── selection ─────────────────────────────────────────────────────────
    def acquire(
        self, est_tokens: int, exclude: Optional[set] = None
    ) -> Tuple[KeyState, int]:
        """
        Block until a key can serve `est_tokens`, then reserve capacity on it.
        `exclude` holds labels that just 429'd, so a retry lands elsewhere.

        Returns (key, ticket); pass the ticket back to settle/release_failed.
        """
        ceiling = self.max_tpm()
        if est_tokens > ceiling:
            # generate_content shrinks before calling here, so reaching this is
            # a caller bug rather than a user-facing condition.
            raise PromptTooLargeError(
                f"Request needs ~{est_tokens:,} tokens but the largest key's TPM "
                f"limit is {ceiling:,}. The prompt should have been shrunk first."
            )

        exclude = exclude or set()
        deadline = time.time() + MAX_WAIT_SECONDS

        with self._cv:
            while True:
                now = time.time()
                candidates = [
                    k for k in self.keys
                    if k.label not in exclude and k.can_serve(est_tokens, now)
                ]

                if candidates:
                    # Most headroom first; round-robin cursor breaks ties so a
                    # single key doesn't absorb every small request.
                    best = max(
                        candidates,
                        key=lambda k: (k.headroom(now), -self.keys.index(k)),
                    )
                    ticket = best.reserve(est_tokens, now)
                    self._cursor = (self.keys.index(best) + 1) % len(self.keys)
                    return best, ticket

                pool = [k for k in self.keys if k.label not in exclude] or self.keys
                wait = min(k.wait_hint(est_tokens, now) for k in pool)
                # Capped low: settle()/penalize() notify waiters, so a long
                # sleep here just adds dead time after a key frees up early.
                wait = max(0.15, min(wait, 5.0)) + random.uniform(0, 0.25)

                if now + wait > deadline:
                    longest = min(k.wait_hint(est_tokens, now) for k in pool)
                    raise AllKeysExhausted(
                        f"All {len(self.keys)} Groq key(s) are rate-limited. "
                        f"Earliest capacity in ~{longest:.0f}s. "
                        f"Add more keys to GROQ_API_KEY_N or wait.",
                        retry_after=longest,
                    )

                logger.info(
                    f"  All keys saturated (need ~{est_tokens:,} tok) — "
                    f"waiting {wait:.1f}s"
                )
                self._cv.wait(timeout=wait)

    def settle(self, key_state: KeyState, ticket: int, actual_tokens: int) -> None:
        with self._cv:
            key_state.settle(ticket, actual_tokens)
            key_state.consecutive_429 = 0
            self._cv.notify_all()

    def calibrate(self, key_state: KeyState, headers) -> None:
        """Adopt real limits from a response's rate-limit headers."""
        with self._cv:
            key_state.calibrate(headers)
            self._cv.notify_all()   # a raised limit may unblock waiters

    def max_tpm(self) -> int:
        """Largest TPM any single key can serve — the true prompt ceiling."""
        with self._lock:
            return max(k.tpm_limit for k in self.keys)

    def penalize(
        self, key_state: KeyState, retry_after: Optional[float], ticket: int = 0
    ) -> float:
        """Cool a key down after a 429. Returns the cooldown length."""
        with self._cv:
            if ticket:
                key_state.settle(ticket, 0)  # the request never landed
            key_state.consecutive_429 += 1
            key_state.total_429 += 1
            if retry_after and retry_after > 0:
                cool = float(retry_after)
            else:
                cool = min(60.0, 2.0 ** key_state.consecutive_429)
            cool += random.uniform(0, 0.5)
            key_state.cooldown_until = time.time() + cool
            # A 429 means our local view undercounted — assume the window is full.
            key_state._next_ticket += 1
            key_state.tok_events.append(
                (time.time(), key_state.tpm_limit, key_state._next_ticket)
            )
            logger.warning(
                f"  429 on {key_state.label} — cooling down {cool:.1f}s "
                f"(strike {key_state.consecutive_429})"
            )
            self._cv.notify_all()
            return cool

    def release_failed(self, key_state: KeyState, ticket: int) -> None:
        """Give back capacity reserved for a request that never reached Groq."""
        with self._cv:
            key_state.settle(ticket, 0)
            self._cv.notify_all()

    def status(self) -> Dict:
        with self._lock:
            keys = [k.snapshot() for k in self.keys]
        active = sum(1 for k in keys if not k["cooling_down"])
        return {
            "model": GROQ_MODEL,
            "tier": GROQ_TIER,
            "keys_configured": len(keys),
            "keys_active": active,
            "keys_cooling_down": len(keys) - active,
            "tokens_today": sum(k["tpd_used"] for k in keys),
            "tokens_today_limit": sum(k["tpd_limit"] for k in keys),
            "requests_today": sum(k["rpd_used"] for k in keys),
            "keys": keys,
        }


# ════════════════════════════════════════════════════════════════════════════
# CONTENT ENCODING
# ════════════════════════════════════════════════════════════════════════════

_MAX_IMAGE_EDGE = 384  # matches what app.py already downscales vision inputs to


def _image_to_data_url(img: Image.Image) -> str:
    img = img.convert("RGB")
    if max(img.size) > _MAX_IMAGE_EDGE:
        img.thumbnail((_MAX_IMAGE_EDGE, _MAX_IMAGE_EDGE), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _build_message(contents: Union[str, List]) -> Tuple[Dict, int, int]:
    """
    Turn Gemini-style `contents` into a Groq chat message.

    Returns (message, text_chars, n_images).
    """
    if isinstance(contents, str):
        return {"role": "user", "content": contents}, len(contents), 0

    parts: List[Dict] = []
    text_chars = 0
    n_images = 0

    for item in contents:
        if isinstance(item, str):
            parts.append({"type": "text", "text": item})
            text_chars += len(item)
        elif isinstance(item, Image.Image):
            if n_images >= 5:  # model caps at 5 images per request
                logger.warning("  Dropping image beyond the 5-per-request limit")
                continue
            parts.append(
                {"type": "image_url", "image_url": {"url": _image_to_data_url(item)}}
            )
            n_images += 1
        elif isinstance(item, (bytes, bytearray)):
            if n_images >= 5:
                continue
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": _image_to_data_url(Image.open(io.BytesIO(item)))
                    },
                }
            )
            n_images += 1
        else:
            text = str(item)
            parts.append({"type": "text", "text": text})
            text_chars += len(text)

    return {"role": "user", "content": parts}, text_chars, n_images


def _truncate_contents(contents: Union[str, List], keep_chars: int):
    """
    Cut prompt text down to `keep_chars`, trimming the longest text part first
    and keeping images intact. Preserves the head and tail of the part that is
    cut, because instructions usually live at both ends of these prompts and
    lopping the tail alone would drop the output-format spec.
    """
    if isinstance(contents, str):
        if len(contents) <= keep_chars:
            return contents
        marker = "\n\n[... source material trimmed ...]\n\n"
        # The marker counts against the budget — leaving it out overshoots the
        # window by exactly its length, which is enough to fail admission.
        room = max(200, keep_chars - len(marker))
        head = room * 2 // 3
        tail = room - head
        return contents[:head] + marker + contents[-tail:]

    parts = list(contents)
    text_idx = [i for i, p in enumerate(parts) if isinstance(p, str)]
    total = sum(len(parts[i]) for i in text_idx)
    if total <= keep_chars or not text_idx:
        return parts

    # Take the whole reduction out of the longest text part.
    biggest = max(text_idx, key=lambda i: len(parts[i]))
    others = total - len(parts[biggest])
    allowance = max(500, keep_chars - others)
    parts[biggest] = _truncate_contents(parts[biggest], allowance)
    return parts


# A 384x384 JPEG costs roughly this many tokens on a 27B vision model.
_TOKENS_PER_IMAGE = 800


def estimate_tokens(text_chars: int, n_images: int, max_completion: int) -> int:
    """Conservative pre-flight estimate: ~4 chars/token, plus image and reply cost."""
    return (
        (text_chars // 4)
        + (n_images * _TOKENS_PER_IMAGE)
        + max_completion
        + 64  # role/system overhead
    )


def _retry_after_from(exc) -> Optional[float]:
    """Pull `retry-after` off a Groq 429, tolerating SDK shape differences."""
    for attr in ("response", "http_response"):
        resp = getattr(exc, attr, None)
        headers = getattr(resp, "headers", None)
        if not headers:
            continue
        for name in ("retry-after", "x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"):
            raw = headers.get(name)
            if not raw:
                continue
            try:
                return float(str(raw).rstrip("s"))
            except ValueError:
                continue
    return None


def _is_rate_limit(exc) -> bool:
    if getattr(exc, "status_code", None) == 429:
        return True
    return "429" in str(exc) or "rate limit" in str(exc).lower()


# ════════════════════════════════════════════════════════════════════════════
# RESPONSE SHIM
# ════════════════════════════════════════════════════════════════════════════


class GroqResponse:
    """Mimics `google.genai`'s response object — app.py only ever reads `.text`."""

    def __init__(self, text: str, usage: Optional[object] = None, key_label: str = ""):
        self._text = text
        self.usage = usage
        self.key_label = key_label

    @property
    def text(self) -> str:
        return self._text

    def __str__(self) -> str:
        return self._text


_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"


def _strip_reasoning(text: str) -> str:
    """
    Drop a completed <think> block. With reasoning_format="hidden" none should
    ever arrive, so this is a defensive second layer.

    An *unclosed* <think> means the response was truncated mid-thought. There is
    no answer in it — only reasoning — so this raises rather than returning the
    remainder. The previous version did `split(_THINK_OPEN, 1)[-1]` here, which
    handed the entire chain of thought back as if it were the narration.
    """
    if _THINK_CLOSE in text:
        return text.split(_THINK_CLOSE)[-1].strip()
    if _THINK_OPEN in text:
        raise TruncatedReasoning(
            "Model was cut off mid-reasoning (unclosed <think>). "
            "Raise max_completion_tokens or set reasoning='none'."
        )
    return text.strip()


# ════════════════════════════════════════════════════════════════════════════
# CLIENT
# ════════════════════════════════════════════════════════════════════════════


class _Models:
    def __init__(self, rotator: "GroqKeyRotator"):
        self._rotator = rotator

    # Never emit less than this; below it a reply is useless anyway.
    _MIN_COMPLETION = 400

    def _fit_to_window(self, contents, text_chars, n_images, budget, shrink):
        """
        Bring a request under the largest key's TPM window, then return the
        (possibly rebuilt) contents and budget.

        Refusing to call is never the right answer to a big prompt — the job
        dies for something we could have done smaller. Degrade in three steps:
        ask the caller to rebuild, then cut the reply budget, then truncate.
        """
        # 2% headroom: chars/4 is an approximation, and landing exactly on the
        # limit means any drift fails admission.
        hard = int(self._rotator.max_tpm() * 0.98)
        fixed = (n_images * _TOKENS_PER_IMAGE) + 64

        if estimate_tokens(text_chars, n_images, budget) <= hard:
            return contents, text_chars, budget

        # Once we are rebuilding anyway, aim well under the hard limit rather
        # than right up against it. A request sized to the whole window blocks
        # every other call on that key until the minute rolls over.
        ceiling = max(int(hard * 0.7), self._MIN_COMPLETION + fixed + 500)

        # 1. Let the caller rebuild against a real character budget. Callers
        #    that retrieve (outline, detail, voiceover) can do this losslessly
        #    by asking for fewer chunks.
        if shrink is not None:
            room_tokens = ceiling - fixed - budget
            if room_tokens > 200:
                room_chars = room_tokens * 4
                try:
                    rebuilt = shrink(room_chars)
                except Exception as e:                       # noqa: BLE001
                    logger.warning(f"  shrink() failed ({e}) — falling through")
                else:
                    if rebuilt is not None:
                        contents = rebuilt
                        _, text_chars, n_images = _build_message(contents)
                        logger.info(
                            f"  Prompt rebuilt to fit {ceiling:,}-token window "
                            f"(~{room_chars:,} chars)"
                        )
                        if estimate_tokens(text_chars, n_images, budget) <= ceiling:
                            return contents, text_chars, budget

        # 2. Trade reply length for prompt room.
        room_for_reply = ceiling - fixed - (text_chars // 4)
        if room_for_reply >= self._MIN_COMPLETION and room_for_reply < budget:
            logger.warning(
                f"  Completion budget {budget} -> {room_for_reply} to fit the window"
            )
            return contents, text_chars, room_for_reply

        # 3. Last resort: cut the prompt itself, and say so rather than
        #    silently dropping the teacher's material.
        budget = min(budget, max(self._MIN_COMPLETION, room_for_reply))
        keep_chars = max(1000, (ceiling - fixed - budget) * 4)
        if text_chars > keep_chars:
            logger.warning(
                f"  Prompt truncated {text_chars:,} -> {keep_chars:,} chars "
                f"to fit the {ceiling:,}-token window"
            )
            contents = _truncate_contents(contents, keep_chars)
            _, text_chars, n_images = _build_message(contents)
        return contents, text_chars, budget

    def _grow_budget(self, budget: int, text_chars: int, n_images: int) -> Optional[int]:
        """
        Next completion budget to try after a truncation, or None if the prompt
        already fills the TPM window. Growth is clamped to what one key can
        actually serve so a retry never turns into PromptTooLargeError.
        """
        overhead = (text_chars // 4) + (n_images * _TOKENS_PER_IMAGE) + 64
        # The calibrated limit, not the .env seed — otherwise a key that has
        # learned it can serve 8k still refuses to grow past the 6k guess.
        ceiling = min(MAX_COMPLETION_CEILING, self._rotator.max_tpm() - overhead)
        if ceiling <= budget:
            return None
        return min(ceiling, budget * 2)

    def generate_content(
        self,
        model: str = None,
        contents: Union[str, List] = "",
        temperature: float = 0.7,
        max_completion_tokens: int = None,
        reasoning: str = None,
        shrink=None,
        **kwargs,
    ) -> GroqResponse:
        """
        Drop-in for `genai.Client().models.generate_content`.

        `model` is accepted and ignored — GROQ_MODEL is always used, so the
        existing "gemini-2.0-flash" arguments in app.py stay harmless.

        `reasoning` is "none" (default) or "default". Pass "default" only for
        genuine planning calls — it multiplies both latency and token cost.

        `shrink(budget_chars) -> contents` lets a caller rebuild its prompt
        smaller when the request will not fit a key's TPM window. Supply it
        wherever the prompt has a natural size knob (retrieved chunks, source
        caps); without it the layer falls back to cutting the reply budget and
        finally to truncating the text.
        """
        max_completion = max_completion_tokens or DEFAULT_MAX_COMPLETION_TOKENS
        effort = (reasoning or DEFAULT_REASONING).strip().lower()
        _, text_chars, n_images = _build_message(contents)

        # Fit before reserving: a prompt too big for any key used to abort the
        # whole job here rather than simply being made smaller.
        contents, text_chars, max_completion = self._fit_to_window(
            contents, text_chars, n_images, max_completion, shrink
        )
        message, text_chars, n_images = _build_message(contents)

        exclude: set = set()
        last_exc: Optional[Exception] = None
        budget = max_completion

        for attempt in range(MAX_RETRIES):
            est = estimate_tokens(text_chars, n_images, budget)
            key_state, ticket = self._rotator.acquire(est, exclude=exclude)
            try:
                # with_raw_response so the rate-limit headers are visible —
                # they carry the account's real limits, which beat our guess.
                raw_resp = key_state.client.chat.completions.with_raw_response.create(
                    model=GROQ_MODEL,
                    messages=[message],
                    temperature=temperature,
                    max_completion_tokens=budget,
                    reasoning_effort=effort,
                    # "hidden" keeps any chain of thought out of the content
                    # entirely, so it can never reach the JSON parser or TTS.
                    reasoning_format="hidden",
                )
                completion = raw_resp.parse()
                self._rotator.calibrate(key_state, getattr(raw_resp, "headers", None))
            except Exception as exc:  # noqa: BLE001 — must classify by shape
                last_exc = exc
                if _is_rate_limit(exc):
                    self._rotator.penalize(key_state, _retry_after_from(exc), ticket)
                    exclude.add(key_state.label)
                    if len(exclude) >= len(self._rotator.keys):
                        exclude.clear()  # everyone struck out; start over
                    continue
                self._rotator.release_failed(key_state, ticket)
                raise

            usage = getattr(completion, "usage", None)
            actual = int(getattr(usage, "total_tokens", 0) or 0) or est
            self._rotator.settle(key_state, ticket, actual)

            choice = completion.choices[0]
            raw = choice.message.content or ""

            # Hitting the cap is only a *failure* when nothing usable came
            # back. The caller chose this budget, so a long answer that ran to
            # the limit is normal and gets returned as-is — retrying it would
            # fight the caller's own sizing. A cut-off reasoning block, by
            # contrast, yields empty or fragmentary content and must not ship.
            hit_cap = getattr(choice, "finish_reason", None) == "length"
            truncated = False
            try:
                text = _strip_reasoning(raw)
                if hit_cap and not text.strip():
                    truncated = True          # all budget went to reasoning
                else:
                    return GroqResponse(text, usage, key_state.label)
            except TruncatedReasoning as exc:
                last_exc = exc
                truncated = True

            if truncated:
                grown = self._grow_budget(budget, text_chars, n_images)
                if grown is None:
                    # Already at the ceiling a single key can serve. Growing
                    # further would only raise PromptTooLargeError, which is a
                    # worse error than saying the reply did not fit.
                    raise TruncatedReasoning(
                        f"Reply did not fit in {budget} tokens and the prompt "
                        f"leaves no room to grow (TPM limit "
                        f"{self._rotator.max_tpm():,}). Shorten the prompt or "
                        f"lower reasoning."
                    ) from last_exc
                last_exc = last_exc or TruncatedReasoning(
                    f"Response hit the {budget}-token cap before finishing."
                )
                logger.warning(f"  Truncated at {budget} tokens — retrying with {grown}")
                budget = grown
                continue

        if isinstance(last_exc, TruncatedReasoning):
            raise last_exc
        raise AllKeysExhausted(
            f"Groq request failed after {MAX_RETRIES} attempts across "
            f"{len(self._rotator.keys)} key(s). Last error: {last_exc}"
        ) from last_exc


class GroqCompatClient:
    def __init__(self, rotator: "GroqKeyRotator"):
        self.rotator = rotator
        self.models = _Models(rotator)


# ── module-level singletons (mirrors how app.py used `client`) ──────────────
rotator = GroqKeyRotator()
client = GroqCompatClient(rotator)


def status() -> Dict:
    return rotator.status()
