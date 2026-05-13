from fastapi import APIRouter, Depends

from auth.clerk_auth import get_current_user as require_user
from services.access_control import access_from_metadata, fetch_clerk_metadata, metadata_from_jwt

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.get("/me")
def me(user=Depends(require_user)):
    user_id = user.get("sub")
    metadata = metadata_from_jwt(user)
    source = "jwt"

    try:
        clerk_metadata = fetch_clerk_metadata(user_id)
        if clerk_metadata:
            metadata = {**metadata, **clerk_metadata}
            source = "clerk_api"
    except Exception:
        # Keep sign-in working even if Clerk's backend API is temporarily unavailable.
        source = "jwt_fallback"

    access = access_from_metadata(metadata)
    return {
        "user_id": user_id,
        "allowed_pages": access["allowed_pages"],
        "is_admin": access["is_admin"],
        "role": metadata.get("role") or metadata.get("fol_role"),
        "source": source,
    }
