import asyncio
import csv
import hashlib
import logging
import os
import re
from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Optional
from urllib.parse import quote, unquote, urlparse

from sqlalchemy import text

from database import SessionLocal

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATAFEED_PATH = Path(
    os.getenv("META_DATAFEED_PATH") or BACKEND_DIR / "datafeeds" / "datafeed.csv"
)
REFRESH_SECONDS = max(60, int(os.getenv("META_DATAFEED_REFRESH_SECONDS", "300")))
STORE_BASE_URL = (os.getenv("DATAFEED_STORE_BASE_URL") or "https://mtm-store.com").rstrip("/")
IMAGE_PUBLIC_BASE_URL = (
    os.getenv("PRODUCT_IMAGE_PUBLIC_BASE_URL") or "https://mtm-store.com/api/static"
).rstrip("/")
BRAND_NAME = os.getenv("DATAFEED_BRAND_NAME") or "mTm DaSh Store"
DEFAULT_CATEGORY = os.getenv("DATAFEED_GOOGLE_PRODUCT_CATEGORY") or "Electronics"

_refresh_task: Optional[asyncio.Task] = None
_last_refresh: Optional[dict] = None

FEED_COLUMNS = [
    "id",
    "title",
    "description",
    "availability",
    "condition",
    "price",
    "link",
    "image_link",
    "brand",
    "mpn",
    "google_product_category",
]


def start_meta_datafeed_auto_refresh() -> None:
    """Start a single background refresh task for this FastAPI worker."""
    global _refresh_task
    if _refresh_task and not _refresh_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Meta datafeed auto-refresh skipped: no running event loop")
        return
    _refresh_task = loop.create_task(_auto_refresh_loop())


async def _auto_refresh_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(refresh_meta_datafeed_if_changed)
        except Exception as exc:
            logger.exception("Meta datafeed refresh failed: %s", exc)
        await asyncio.sleep(REFRESH_SECONDS)


def get_datafeed_path() -> Path:
    if not DATAFEED_PATH.exists() or _last_refresh is None:
        refresh_meta_datafeed_if_changed(force=not DATAFEED_PATH.exists())
    return DATAFEED_PATH


def get_datafeed_status() -> dict:
    return {
        "path": str(DATAFEED_PATH),
        "exists": DATAFEED_PATH.exists(),
        "last_refresh": _last_refresh,
    }


def refresh_meta_datafeed_if_changed(force: bool = False) -> dict:
    """Rebuild the CSV and atomically replace the file only when contents change."""
    global _last_refresh
    rows = build_meta_datafeed_rows()
    csv_text = render_meta_datafeed_csv(rows)
    new_hash = hashlib.sha256(csv_text.encode("utf-8")).hexdigest()

    old_hash = None
    if DATAFEED_PATH.exists():
        try:
            old_hash = hashlib.sha256(DATAFEED_PATH.read_bytes()).hexdigest()
        except OSError:
            old_hash = None

    changed = force or old_hash != new_hash
    if changed:
        DATAFEED_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = DATAFEED_PATH.with_suffix(".csv.tmp")
        with tmp_path.open("w", encoding="utf-8", newline="") as feed_file:
            feed_file.write(csv_text)
        tmp_path.replace(DATAFEED_PATH)

    _last_refresh = {
        "changed": changed,
        "rows": len(rows),
        "sha256": new_hash,
        "refreshed_at": datetime.now().isoformat(timespec="seconds"),
    }
    logger.info(
        "Meta datafeed refresh complete: rows=%s changed=%s path=%s",
        len(rows),
        changed,
        DATAFEED_PATH,
    )
    return _last_refresh


def build_meta_datafeed_rows() -> list[dict]:
    db = SessionLocal()
    try:
        products = _fetch_visible_products(db)
        image_map = _fetch_product_images(db)
        price_map = _fetch_store_prices(db)

        rows: list[dict] = []
        for product in products:
            sku = (product.get("sku_id") or "").strip()
            name = (product.get("name") or "").strip()
            if not name:
                continue

            product_id = product.get("product_id")
            price = _positive_float(price_map.get(product_id))
            image_url = image_map.get(product_id) or ""

            rows.append({
                "id": sku or f"MTM-{product_id}",
                "title": name[:150],
                "description": _description(product),
                "availability": "in stock",
                "condition": "new",
                "price": _meta_price(price),
                "link": _product_link(name),
                "image_link": _absolute_image_url(image_url),
                "brand": BRAND_NAME,
                "mpn": sku or f"MTM-{product_id}",
                "google_product_category": DEFAULT_CATEGORY,
            })

        return rows
    finally:
        db.close()


def render_meta_datafeed_csv(rows: list[dict]) -> str:
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=FEED_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({col: row.get(col, "") for col in FEED_COLUMNS})
    return buf.getvalue()


def _fetch_visible_products(db) -> list[dict]:
    rows = db.execute(
        text("""
            SELECT product_id, name, description, sku_id, is_visible, preference, updated_at
            FROM products
            WHERE COALESCE(is_visible, 1) = 1
              AND name IS NOT NULL
              AND name != ''
            ORDER BY COALESCE(preference, 0) DESC, name ASC
        """)
    ).mappings().all()
    return [dict(row) for row in rows]


def _fetch_product_images(db) -> dict[int, str]:
    rows = db.execute(
        text("""
            SELECT pi.product_id, pi.image_url
            FROM product_images pi
            JOIN (
                SELECT product_id, MIN(image_id) AS image_id
                FROM product_images
                WHERE image_url IS NOT NULL AND image_url != ''
                GROUP BY product_id
            ) first_image ON first_image.image_id = pi.image_id
        """)
    ).mappings().all()
    return {row["product_id"]: row["image_url"] for row in rows}


def _fetch_store_prices(db) -> dict[int, float]:
    rows = db.execute(
        text("""
            SELECT
                product_id,
                MIN(COALESCE(NULLIF(price, 0), NULLIF(original_price, 0))) AS price
            FROM product_colors
            WHERE product_id IS NOT NULL
              AND (price > 0 OR original_price > 0)
            GROUP BY product_id
        """)
    ).mappings().all()
    return {
        int(row["product_id"]): float(row["price"])
        for row in rows
        if row["product_id"] and row["price"] is not None
    }


def _description(product: dict) -> str:
    desc = _strip_html(product.get("description") or "")
    if not desc:
        desc = f"{product.get('name')} available from mTm DaSh Store."
    return desc[:5000]


def _meta_price(value: Optional[float]) -> str:
    amount = _positive_float(value) or 0.0
    return f"{amount:.2f} INR"


def _positive_float(value) -> Optional[float]:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    return amount if amount > 0 else None


def _product_link(name: str) -> str:
    slug = _product_slug(name)
    return f"{STORE_BASE_URL}/products/{slug}"


def _product_slug(name: str) -> str:
    value = re.sub(r"\s+", "-", str(name or "").strip().lower())
    value = re.sub(r"-+", "-", value).strip("-")
    return quote(value, safe="-(),&")


def _absolute_image_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme in ("http", "https"):
        return url

    path = unquote(url.lstrip("/"))
    if path.startswith("media/product_images/"):
        path = path.removeprefix("media/")
    return f"{IMAGE_PUBLIC_BASE_URL}/{path}"


def _strip_html(value: str) -> str:
    text_value = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", text_value).strip()


def _normalise_key(value: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", str(value or "").lower())
