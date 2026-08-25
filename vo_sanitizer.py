"""
vo_sanitizer.py — Voiceover text cleanup for TTS
=================================================
Call sanitize_voiceover(text) before passing any string to Edge TTS.

Fixes:
  **word**  → word          (bold markdown → read aloud as "asterisk asterisk")
  *word*    → word          (italic markdown)
  `code`    → code          (backtick code)
  b_n       → b sub n       (underscore subscripts)
  x_i       → x sub i
  a_0       → a sub 0
  #Heading  → Heading       (hash headers)
  ---       → (silence/pause)
  [link](url) → link
  \\n       → space
"""

import re

# ── Reasoning-leak guard ────────────────────────────────────────────────────
# Last line of defence before Edge TTS. The model layer already sets
# reasoning_format="hidden" and rejects unclosed <think> blocks, but if any
# chain-of-thought ever reaches here it must not be spoken aloud.

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_THINK_TAG = re.compile(r"</?think>", re.IGNORECASE)

# Meta-commentary the model writes *about* the task rather than narration.
_META_OPENER = re.compile(
    r"^\s*(?:"
    r"okay[,!.]?\s|ok[,!.]?\s|alright[,!.]?\s|sure[,!.]?\s|"
    r"let me\s|let's\s|i (?:need|should|will|'ll|am going)\s|"
    r"first[,]?\s+i\s|the user\s(?:wants|asked|is)|"
    r"we need to\s|now,?\s+i\s"
    r")",
    re.IGNORECASE,
)

# An explicit hand-off to the real answer — keep only what follows it.
# The bare forms require a colon: narration legitimately containing the word
# "script" must not be truncated at it.
_ANSWER_MARKER = re.compile(
    r"(?:here(?:'s| is)\s+(?:the\s+)?(?:narration|voiceover|script)\s*[:\-—]?"
    r"|\b(?:narration|voiceover|script)\s*:)\s*",
    re.IGNORECASE,
)

# Only trust a hand-off marker near the start; later on it is probably content.
_MARKER_WINDOW = 200

_MIN_WORDS = 8


def strip_reasoning_leak(text: str) -> str:
    """
    Remove chain-of-thought that leaked into a voiceover.

    Returns "" when nothing usable survives, so the caller falls back to its
    own placeholder rather than narrating the model's thinking.
    """
    if not text:
        return ""

    text = _THINK_BLOCK.sub(" ", text)
    text = _THINK_TAG.sub(" ", text).strip()

    # If the model announced its answer, everything before that is scaffolding.
    marker = None
    for m in _ANSWER_MARKER.finditer(text):
        if m.start() < _MARKER_WINDOW:
            marker = m
    if marker and len(text) - marker.end() >= 40:
        text = text[marker.end():].strip()

    # Otherwise drop leading meta-commentary sentences one at a time.
    guard = 0
    while text and _META_OPENER.match(text) and guard < 6:
        guard += 1
        parts = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)
        if len(parts) < 2:
            return ""          # the whole thing was commentary
        text = parts[1].strip()

    if len(text.split()) < _MIN_WORDS:
        return ""
    return text


def sanitize_voiceover(text: str) -> str:
    """
    Clean a voiceover script so TTS reads it naturally.
    Removes markdown formatting that gets read aloud literally, and refuses to
    pass through leaked model reasoning.
    """
    if not text:
        return text

    text = strip_reasoning_leak(text)
    if not text:
        return ""

    # 1. Remove markdown bold: **word** → word
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)

    # 2. Remove markdown italic: *word* → word  (but not multiplication *)
    text = re.sub(r'\*([^\*\n]+?)\*', r'\1', text)

    # 3. Remove inline code backticks: `code` → code
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # 4. Convert subscript underscores: x_n → x sub n, b_n → b sub n
    #    Match single letter/digit subscripts: a_0, b_n, x_i, F_g etc.
    text = re.sub(r'([A-Za-z])_([A-Za-z0-9])\b', r'\1 sub \2', text)
    #    Multi-char subscripts: x_{max} → x sub max
    text = re.sub(r'([A-Za-z])_\{([^}]+)\}', r'\1 sub \2', text)

    # 5. Convert superscript carets: x^2 → x squared, x^n → x to the n
    text = re.sub(r'([A-Za-z0-9])\^2\b', r'\1 squared', text)
    text = re.sub(r'([A-Za-z0-9])\^3\b', r'\1 cubed', text)
    text = re.sub(r'([A-Za-z0-9])\^\{([^}]+)\}', r'\1 to the power of \2', text)
    text = re.sub(r'([A-Za-z0-9])\^([A-Za-z0-9]+)', r'\1 to the \2', text)

    # 6. Remove markdown headers: ## Title → Title
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)

    # 7. Remove horizontal rules
    text = re.sub(r'^[-*_]{3,}\s*$', '', text, flags=re.MULTILINE)

    # 8. Remove markdown links: [text](url) → text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)

    # 9. Remove bare URLs
    text = re.sub(r'https?://\S+', '', text)

    # 10. Remove blockquote markers
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)

    # 11. Remove bullet/list markers at start of lines
    text = re.sub(r'^\s*[-•]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)

    # 12. Collapse multiple newlines to a single space
    text = re.sub(r'\n+', ' ', text)

    # 13. Collapse multiple spaces
    text = re.sub(r' {2,}', ' ', text)

    return text.strip()


if __name__ == "__main__":
    # Quick test
    samples = [
        "**Fourier Series** is an expansion of a *periodic* function f(x).",
        "The coefficient b_n is computed by integrating over one period.",
        "Using x^2 + y^2 = r^2 we get the circle equation.",
        "## Introduction\nThis lecture covers the **key** concepts.",
        "The formula `f(x) = sin(x)` is fundamental.",
        "See [this link](https://example.com) for more.",
        "b_0, b_n, a_i, F_g, x_{max}, omega_{0}",
    ]
    for s in samples:
        print(f"IN:  {s}")
        print(f"OUT: {sanitize_voiceover(s)}")
        print()
