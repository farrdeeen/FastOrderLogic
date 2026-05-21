from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from auth.clerk_auth import get_current_user as require_user
from services.meta_datafeed_service import (
    get_datafeed_path,
    get_datafeed_status,
    refresh_meta_datafeed_if_changed,
)

router = APIRouter(tags=["Meta Datafeed"])


@router.get("/datafeed.csv")
def meta_catalogue_datafeed():
    path = get_datafeed_path()
    return FileResponse(
        path,
        media_type="text/csv; charset=utf-8",
        filename="datafeed.csv",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Disposition": 'inline; filename="datafeed.csv"',
        },
    )


@router.post("/datafeed/refresh")
def refresh_meta_catalogue_datafeed(_=Depends(require_user)):
    return refresh_meta_datafeed_if_changed(force=True)


@router.get("/datafeed/status")
def meta_catalogue_datafeed_status(_=Depends(require_user)):
    return get_datafeed_status()
