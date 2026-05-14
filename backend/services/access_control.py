import os
import time
from typing import Any, Dict, List, Optional

import requests

ALL_PAGE_IDS = [
    "dashboard",
    "orders",
    "create-order",
    "device-entry",
    "serial-search",
    "chat",
]

PAGE_ALIASES = {
    "dashboard": {"dashboard", "home"},
    "orders": {"orders", "order"},
    "create-order": {"create-order", "create_order", "createorder", "orders:create"},
    "device-entry": {"device-entry", "device_entry", "deviceentry", "bulk-device"},
    "serial-search": {"serial-search", "serial_search", "serialsearch", "serial"},
    "chat": {"chat", "support", "whatsapp"},
}

ALIAS_TO_PAGE = {
    alias: page
    for page, aliases in PAGE_ALIASES.items()
    for alias in ({page} | aliases)
}

_USER_CACHE: Dict[str, tuple[float, dict]] = {}


def _truthy(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on", "allow", "allowed"}
    return False


def _normalize_page(value: Any) -> Optional[str]:
    if not value:
        return None
    return ALIAS_TO_PAGE.get(str(value).strip().lower().replace(" ", "-"))


def _parse_access_value(value: Any) -> Optional[List[str]]:
    if value is None:
        return None

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"admin", "all", "full", "full_access"}:
            return list(ALL_PAGE_IDS)
        pages = [_normalize_page(item) for item in value.split(",")]
        return [page for page in pages if page]

    if isinstance(value, list):
        pages = [_normalize_page(item) for item in value]
        return [page for page in pages if page]

    if isinstance(value, dict):
        pages = [_normalize_page(page) for page, allowed in value.items() if _truthy(allowed)]
        return [page for page in pages if page]

    return None


def access_from_metadata(metadata: Optional[dict], default_allowed: Optional[bool] = None) -> dict:
    meta = metadata or {}
    if default_allowed is None:
        default_allowed = os.getenv("CLERK_ACCESS_DEFAULT", "deny").strip().lower() == "allow"

    if meta.get("active") is False or _truthy(meta.get("blocked")) or _truthy(meta.get("disabled")):
        return {"allowed_pages": [], "is_admin": False}

    role = str(meta.get("role") or meta.get("fol_role") or "").strip().lower()
    if role in {"admin", "owner", "superadmin"} or _truthy(meta.get("is_admin")):
        return {"allowed_pages": list(ALL_PAGE_IDS), "is_admin": True}

    raw = (
        meta.get("fol_access")
        if "fol_access" in meta
        else meta.get("fastorder_access")
        if "fastorder_access" in meta
        else meta.get("allowed_pages")
        if "allowed_pages" in meta
        else meta.get("permissions")
        if "permissions" in meta
        else meta.get("pages")
        if "pages" in meta
        else meta.get("access")
    )
    parsed = _parse_access_value(raw)
    if parsed is not None:
        return {"allowed_pages": list(dict.fromkeys(parsed)), "is_admin": False}

    return {
        "allowed_pages": list(ALL_PAGE_IDS) if default_allowed else [],
        "is_admin": False,
    }


def _clerk_secret_key() -> str:
    return os.getenv("CLERK_SECRET_KEY", "").strip()


def fetch_clerk_metadata(user_id: str) -> dict:
    """Fetch Clerk public/private metadata when CLERK_SECRET_KEY is available."""
    secret = _clerk_secret_key()
    if not secret or not user_id:
        return {}

    ttl = int(os.getenv("CLERK_USER_CACHE_SECONDS", "300") or "300")
    now = time.time()
    cached = _USER_CACHE.get(user_id)
    if cached and now - cached[0] < ttl:
        return cached[1]

    response = requests.get(
        f"https://api.clerk.com/v1/users/{user_id}",
        headers={"Authorization": f"Bearer {secret}"},
        timeout=5,
    )
    response.raise_for_status()
    data = response.json()
    metadata = {
        **(data.get("public_metadata") or {}),
        **(data.get("private_metadata") or {}),
        **(data.get("unsafe_metadata") or {}),
    }
    _USER_CACHE[user_id] = (now, metadata)
    return metadata


def metadata_from_jwt(payload: dict) -> dict:
    """Support Clerk token templates that expose metadata as custom claims."""
    return {
        **(payload.get("public_metadata") or {}),
        **(payload.get("private_metadata") or {}),
        **(payload.get("unsafe_metadata") or {}),
        **(payload.get("metadata") or {}),
    }
