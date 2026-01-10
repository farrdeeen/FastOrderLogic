# auth/clerk_auth.py

import os
import requests
from fastapi import Request, HTTPException
from jose import jwt, JWTError

CLERK_ISSUER = os.getenv(
    "CLERK_ISSUER",
    "https://divine-lobster-20.clerk.accounts.dev",
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

        request.state.user_id = payload["sub"]
        return payload

    except JWTError as e:
        print("Clerk auth error:", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")
