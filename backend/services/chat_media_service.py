import os
import re
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import quote


MEDIA_ROOT = Path(
    os.getenv(
        "CHAT_MEDIA_ROOT",
        str(Path(__file__).resolve().parents[1] / "media"),
    )
)
PUBLIC_BASE_URL = (
    os.getenv("CHAT_MEDIA_PUBLIC_BASE_URL")
    or os.getenv("PUBLIC_BACKEND_URL")
    or os.getenv("BACKEND_PUBLIC_URL")
    or os.getenv("BASE_URL")
    or ""
).rstrip("/")


def safe_filename(filename: str, fallback: str = "file") -> str:
    stem = Path(filename or fallback).stem
    suffix = Path(filename or "").suffix.lower()
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._") or fallback
    suffix = re.sub(r"[^A-Za-z0-9.]+", "", suffix)[:12]
    return f"{stem[:80]}{suffix}"


def is_public_http_url(url: str) -> bool:
    return str(url or "").startswith(("https://", "http://"))


def media_public_url(relative_path: str, public_base_url: Optional[str] = None) -> str:
    path = "/" + relative_path.strip("/")
    base_url = (public_base_url or PUBLIC_BASE_URL).rstrip("/")
    if base_url:
        return f"{base_url}{path}"
    return path


def media_download_url(
    relative_path: str,
    filename: str = "",
    public_base_url: Optional[str] = None,
) -> str:
    clean_relative = relative_path.strip("/")
    if clean_relative.startswith("media/"):
        clean_relative = clean_relative[len("media/"):]
    path = f"/media-download/{clean_relative}"
    if filename:
        path = f"{path}?filename={quote(filename)}"
    base_url = (public_base_url or PUBLIC_BASE_URL).rstrip("/")
    if base_url:
        return f"{base_url}{path}"
    return path


def save_media_bytes(
    data: bytes,
    filename: str,
    folder: str = "chat",
    content_type: Optional[str] = None,
) -> dict:
    folder = re.sub(r"[^A-Za-z0-9/_-]+", "-", folder.strip("/")) or "chat"
    clean_name = safe_filename(filename)
    stored_name = f"{uuid.uuid4().hex[:12]}-{clean_name}"
    target_dir = MEDIA_ROOT / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / stored_name
    target_path.write_bytes(data)

    relative_path = f"media/{folder}/{stored_name}"
    return {
        "filename": clean_name,
        "stored_filename": stored_name,
        "path": str(target_path),
        "relative_path": relative_path,
        "relative_url": f"/{relative_path}",
        "public_url": media_public_url(relative_path),
        "download_url": media_download_url(relative_path, clean_name),
        "content_type": content_type or "application/octet-stream",
        "size": len(data),
    }
