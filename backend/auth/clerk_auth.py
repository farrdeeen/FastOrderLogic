# auth/clerk_auth.py

import os
import requests
from fastapi import Request, HTTPException
from jose import jwt, JWTError

from services.access_control import access_from_metadata, fetch_clerk_metadata, metadata_from_jwt


CLERK_ISSUER = os.getenv(
    "CLERK_ISSUER",
    "https://prompt-piranha-26.clerk.accounts.dev",
)

JWKS_URL = f"{CLERK_ISSUER}/.well-known/jwks.json"

ALGORITHMS = ["RS256"]


def get_jwks():
    try:
        return requests.get(JWKS_URL).json()
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to fetch Clerk JWKS")


JWKS = get_jwks()


def get_current_user(request: Request):
    auth_header = request.headers.get("authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = auth_header.replace("Bearer ", "").strip()

    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")

        key = next((k for k in JWKS["keys"] if k["kid"] == kid), None)
        if not key:
            raise HTTPException(status_code=401, detail="Invalid token key")

        payload = jwt.decode(
            token,
            key,
            algorithms=ALGORITHMS,
            audience=None,  # Clerk does not require aud validation
            issuer=CLERK_ISSUER,
        )

        user_id = payload["sub"]
        metadata = metadata_from_jwt(payload)
        try:
            clerk_metadata = fetch_clerk_metadata(user_id)
            if clerk_metadata:
                metadata = {**metadata, **clerk_metadata}
        except Exception:
            # If CLERK_SECRET_KEY is missing or Clerk API is unavailable, fall back
            # to token metadata. Empty metadata remains denied by default.
            pass

        access = access_from_metadata(metadata, default_allowed=False)
        if not access["is_admin"] and not access["allowed_pages"]:
            raise HTTPException(status_code=403, detail="Access not assigned")

        request.state.user_id = user_id
        request.state.user_access = access
        payload["fol_access"] = access["allowed_pages"]
        payload["fol_is_admin"] = access["is_admin"]
        return payload

    except HTTPException:
        raise
    except JWTError as e:
        print("Clerk auth error:", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")
