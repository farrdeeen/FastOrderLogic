"""
services/chat_media_service.py
───────────────────────────────
Handles local storage of media files and URL generation.

Key design decisions
────────────────────
• Every saved file gets ONE canonical public URL:  /media/<folder>/<stored_name>
  That path is mounted as a StaticFiles mount in main.py (or served via the
  /media/{path:path} route below).  There is NO separate /media-download/ path
  — that was the root cause of ".html file" downloads (the SPA catch-all was
  answering the request instead of the file).

• download_url == public_url + ?dl=1  so the same route can serve inline
  (for images/PDFs) or with Content-Disposition: attachment (for other files).

• public_url is ALWAYS absolute when PUBLIC_BASE_URL is set and ALWAYS starts
  with /media/ so resolveMediaUrl() in the frontend can safely prefix API_BASE.
"""

import os
import re
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import quote


# ── Storage root ──────────────────────────────────────────────────────────────
MEDIA_ROOT = Path(
    os.getenv(
        "CHAT_MEDIA_ROOT",
        str(Path(__file__).resolve().parents[1] / "media"),
    )
)

# ── Public base URL (set this env-var in production!) ─────────────────────────
# e.g. https://api.yourdomain.com
# If empty the URL is returned as a root-relative path and the frontend's
# resolveMediaUrl() will prepend VITE_API_URL / window.location.origin.
PUBLIC_BASE_URL = (
    os.getenv("CHAT_MEDIA_PUBLIC_BASE_URL")
    or os.getenv("PUBLIC_BACKEND_URL")
    or os.getenv("BACKEND_PUBLIC_URL")
    or os.getenv("BASE_URL")
    or ""
).rstrip("/")


# ── Helpers ───────────────────────────────────────────────────────────────────

def safe_filename(filename: str, fallback: str = "file") -> str:
    stem = Path(filename or fallback).stem
    suffix = Path(filename or "").suffix.lower()
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._") or fallback
    suffix = re.sub(r"[^A-Za-z0-9.]+", "", suffix)[:12]
    return f"{stem[:80]}{suffix}"


def is_public_http_url(url: str) -> bool:
    return str(url or "").startswith(("https://", "http://"))


def _build_url(relative_path: str, public_base_url: Optional[str] = None) -> str:
    """
    Turn a relative storage path like  media/chat/42/abc-photo.jpg
    into a fully-qualified URL  https://api.example.com/media/chat/42/abc-photo.jpg
    or a root-relative path     /media/chat/42/abc-photo.jpg  when no base is set.

    The path always starts with /media/ so the frontend can detect it.
    """
    # Normalise — strip leading slash, ensure starts with media/
    path = relative_path.lstrip("/")
    if not path.startswith("media/"):
        path = f"media/{path}"

    root_relative = f"/{path}"
    base = (public_base_url or PUBLIC_BASE_URL).rstrip("/")
    return f"{base}{root_relative}" if base else root_relative


def media_public_url(relative_path: str, public_base_url: Optional[str] = None) -> str:
    """URL for inline viewing (browser renders image / PDF in <img> or new tab)."""
    return _build_url(relative_path, public_base_url)


def media_download_url(
    relative_path: str,
    filename: str = "",
    public_base_url: Optional[str] = None,
) -> str:
    """
    URL that forces a file-save dialog.
    We append ?dl=1 (and optionally &filename=...) to the same /media/ path.
    The /media/{path:path} route in main.py inspects this query param and sets
    Content-Disposition: attachment.
    """
    base = _build_url(relative_path, public_base_url)
    qs = "dl=1"
    if filename:
        qs += f"&filename={quote(filename)}"
    return f"{base}?{qs}"


# ── Core save function ────────────────────────────────────────────────────────

def save_media_bytes(
    data: bytes,
    filename: str,
    folder: str = "chat",
    content_type: Optional[str] = None,
    public_base_url: Optional[str] = None,
) -> dict:
    """
    Write *data* to disk and return a dict with all URL variants.

    Returns
    -------
    {
        filename        : str   # cleaned original name, e.g. "invoice.pdf"
        stored_filename : str   # name on disk with UUID prefix
        path            : str   # absolute filesystem path
        relative_path   : str   # "media/<folder>/<stored_filename>"
        public_url      : str   # absolute or root-relative URL for inline view
        download_url    : str   # same path + ?dl=1  for forced download
        content_type    : str
        size            : int
    }
    """
    folder = re.sub(r"[^A-Za-z0-9/_-]+", "-", folder.strip("/")) or "chat"
    clean_name = safe_filename(filename)
    stored_name = f"{uuid.uuid4().hex[:12]}-{clean_name}"
    target_dir = MEDIA_ROOT / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / stored_name

    target_path.write_bytes(data)

    relative_path = f"media/{folder}/{stored_name}"

    return {
        "filename":         clean_name,
        "stored_filename":  stored_name,
        "path":             str(target_path),
        "relative_path":    relative_path,
        # kept for legacy callers that still read relative_url
        "relative_url":     f"/{relative_path}",
        "public_url":       media_public_url(relative_path, public_base_url),
        "download_url":     media_download_url(relative_path, clean_name, public_base_url),
        "content_type":     content_type or "application/octet-stream",
        "size":             len(data),
    }