"""
routers/media.py
────────────────
Serves files that were saved by chat_media_service.save_media_bytes.

Mount point: /media/{path:path}

Why a router instead of StaticFiles?
  • StaticFiles always forces Content-Disposition: inline and can't add ?dl=1
    download behaviour.
  • We need to set the correct Content-Type from our own mime-type map so that
    images render in <img> tags and PDFs open in the browser rather than
    being downloaded as application/octet-stream.
  • StaticFiles does NOT add CORS or auth hooks easily.

Usage in main.py
────────────────
    from routers.media import router as media_router
    app.include_router(media_router)

    # Remove any existing StaticFiles("/media") mount if present — this router
    # replaces it.
"""

import mimetypes
import os
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

router = APIRouter(tags=["Media"])

MEDIA_ROOT = Path(
    os.getenv(
        "CHAT_MEDIA_ROOT",
        str(Path(__file__).resolve().parents[1] / "media"),
    )
)

# Mime types that the browser can display inline — everything else gets
# Content-Disposition: attachment so the user's OS opens it with the right app.
_INLINE_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/svg+xml", "image/avif", "image/heic", "image/heif",
    "application/pdf",
    "video/mp4", "video/webm", "video/ogg",
    "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
}


def _mime(path: Path) -> str:
    """Best-effort MIME type from extension."""
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "application/octet-stream"


@router.head("/media/{path:path}", include_in_schema=False)
@router.get("/media/{path:path}")
async def serve_media(
    path: str,
    dl: bool = Query(False, description="Force download (Content-Disposition: attachment)"),
    filename: str = Query("", description="Override filename for Content-Disposition"),
):
    """
    Serve a stored media file.

    • ?dl=1               → force browser file-save dialog
    • ?dl=1&filename=foo  → also override the suggested filename
    • No query params     → inline for images/PDFs, attachment for everything else
    """
    # Security: prevent path traversal
    safe_path = Path(unquote(path))
    if ".." in safe_path.parts:
        raise HTTPException(status_code=400, detail="Invalid path")

    file_path = MEDIA_ROOT / safe_path
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")

    mime = _mime(file_path)
    suggested_name = filename or file_path.name

    if dl:
        # Caller explicitly asked for a download
        disposition = f'attachment; filename="{suggested_name}"'
    elif mime in _INLINE_TYPES:
        # Browser can render this inline
        disposition = "inline"
    else:
        # Unknown / binary type — force download so the OS picks the right app
        disposition = f'attachment; filename="{suggested_name}"'

    return FileResponse(
        path=str(file_path),
        media_type=mime,
        headers={
            "Content-Disposition": disposition,
            # Allow cross-origin requests (e.g. from the React dev server)
            "Access-Control-Allow-Origin": "*",
            # Cache for 1 hour; files are immutable (UUID-prefixed names)
            "Cache-Control": "public, max-age=3600",
        },
    )
