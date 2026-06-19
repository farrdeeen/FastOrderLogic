"""
services/product_catalogue.py
──────────────────────────────
In-memory Wix product catalogue for the AI sales agent.

Features:
- Fetches products from Wix Stores API (no DB)
- Auto-refreshes every CATALOGUE_REFRESH_MINUTES (default 60)
- Provides search/filter helpers for the AI
- Formats product cards for WhatsApp (text + link)
- Thread-safe using asyncio.Lock for async callers
- FIX: Sale price (discountedPrice) now takes priority over regular price
"""

import os
import re
import asyncio
import logging
import httpx
import mimetypes
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus, unquote, urlparse

from services.chat_media_service import media_public_url, save_media_bytes

logger = logging.getLogger(__name__)

_REFRESH_MINS  = int(os.getenv("CATALOGUE_REFRESH_MINUTES", "60"))

# mtm-store.com online store — the source of the product catalogue, the product
# links and the photos the AI sales agent shares with customers.
# Product pages live at  {store}/shop/<slug>
# Photos are served from the site root: /uploads/... and /product_images/...
_STORE_URL = (
    os.getenv("MTM_STORE_URL") or os.getenv("STORE_BASE_URL") or "https://mtm-store.com"
).rstrip("/")
_PRODUCT_IMAGE_PUBLIC_BASE_URL = (
    os.getenv("PRODUCT_IMAGE_PUBLIC_BASE_URL") or _STORE_URL
).rstrip("/")

# Public catalogue API on the mtm-store app (same host, served by Apache).
_PRODUCTS_API = f"{_STORE_URL}/api/products"

# ── In-memory store ───────────────────────────────────────────────────────────
_catalogue: list[dict] = []           # list of normalised product dicts
_last_fetched: Optional[datetime] = None
_lock = asyncio.Lock()


# ─── Public API ───────────────────────────────────────────────────────────────

async def get_catalogue(force_refresh: bool = False) -> list[dict]:
    """
    Return the in-memory catalogue, refreshing from Wix if stale or empty.
    Thread-safe for async callers.
    """
    global _catalogue, _last_fetched

    needs_refresh = (
        force_refresh
        or not _catalogue
        or _last_fetched is None
        or datetime.now() - _last_fetched > timedelta(minutes=_REFRESH_MINS)
    )

    if needs_refresh:
        async with _lock:
            # Double-check after acquiring lock
            still_needs = (
                force_refresh
                or not _catalogue
                or _last_fetched is None
                or datetime.now() - _last_fetched > timedelta(minutes=_REFRESH_MINS)
            )
            if still_needs:
                await _fetch_catalogue()

    return _catalogue


async def search_products(query: str, limit: int = 5) -> list[dict]:
    """
    Search catalogue by name, SKU, or description.
    Returns up to `limit` matching products.
    """
    catalogue = await get_catalogue()
    if not query:
        return catalogue[:limit]

    q = _normalise_search_text(query)
    if not q:
        return catalogue[:limit]

    tokens = [tok for tok in q.split() if len(tok) > 1]
    scored = []
    for p in catalogue:
        name  = _normalise_search_text(p.get("name") or "")
        sku   = _normalise_search_text(p.get("sku") or "")
        desc  = _normalise_search_text(p.get("description") or "")
        hay   = f"{name} {sku} {desc}"
        score = 0.0
        if q in name:
            score += 5
        if q and q in sku:
            score += 4
        if q in desc:
            score += 1

        token_hits = sum(1 for word in tokens if word in hay)
        score += token_hits * 2
        if tokens and all(word in hay for word in tokens):
            score += 5
        # Require REAL textual relevance before counting this product. Without
        # this guard the in-stock bonus below would give every product a score,
        # so unrelated text (names, phone numbers, "haan", addresses) would
        # return the first few catalogue items — the source of "random products".
        if score <= 0:
            continue
        if p.get("in_stock") is True:
            score += 0.25
        scored.append((score, p))

    scored.sort(key=lambda x: -x[0])
    return [p for _, p in scored[:limit]]


def _normalise_search_text(value: str) -> str:
    return re.sub(r"[^0-9a-zA-Z]+", " ", str(value or "")).lower().strip()


def format_product_card(product: dict) -> str:
    """
    Format a single product as a WhatsApp-friendly text card.
    Shows sale price + original price when a discount is active.
    Returns a multi-line string suitable for a WA text message.
    """
    name           = product.get("name") or "Product"
    sale_price     = product.get("sale_price_display")
    regular_price  = product.get("price_display") or "—"
    sku            = product.get("sku") or ""
    desc           = (product.get("description") or "").strip()
    link           = product.get("link") or ""
    stock          = product.get("in_stock")
    on_sale        = product.get("on_sale", False)

    lines = [f"📦 *{name}*"]

    # Price display — show sale price prominently, regular price struck through
    if on_sale and sale_price:
        lines.append(f"💰 Price: {sale_price} ~~{regular_price}~~")
    else:
        lines.append(f"💰 Price: {regular_price}")

    if sku:
        lines.append(f"SKU: {sku}")
    if desc:
        short_desc = desc[:120] + ("…" if len(desc) > 120 else "")
        lines.append(short_desc)
    if stock is not None:
        lines.append("✅ In Stock" if stock else "❌ Out of Stock")
    if not link and _STORE_URL and name:
        link = f"{_STORE_URL}/shop"
    if link:
        lines.append(f"🔗 {link}")

    return "\n".join(lines)


def format_product_list_for_whatsapp(products: list[dict], intro: str = "") -> str:
    """
    Format multiple products as a single WhatsApp message.
    Max 3 products per message to keep it readable.
    """
    if not products:
        return (
            "I couldn't find any matching products right now. "
            "Please try a different search or visit our store."
        )

    products = products[:3]  # WA messages should stay short
    parts = []
    if intro:
        parts.append(intro)
    for p in products:
        parts.append(format_product_card(p))
    if len(products) == 3 and _STORE_URL:
        parts.append(f"👉 See full catalogue: {_STORE_URL}/shop")

    return "\n\n".join(parts)


def get_catalogue_summary_for_prompt() -> str:
    """
    Return a compact text summary of the catalogue for injection into the AI system prompt.
    Shows the effective selling price (sale price if discounted, else regular price).
    Keeps token count low — names, SKUs, prices only.
    """
    if not _catalogue:
        return "Product catalogue not loaded yet."

    lines = ["PRODUCT CATALOGUE (use this to answer product questions):"]
    for p in _catalogue[:60]:   # cap at 60 to keep prompt lean
        name  = p.get("name") or "?"
        sku   = p.get("sku") or "?"
        stock = "In Stock" if p.get("in_stock") else "Out of Stock"

        # Always show the effective customer-facing price
        on_sale    = p.get("on_sale", False)
        sale_price = p.get("sale_price_display")
        reg_price  = p.get("price_display") or "?"
        price_str  = sale_price if (on_sale and sale_price) else reg_price

        lines.append(f"- {name} | SKU: {sku} | {price_str} | {stock}")

    if len(_catalogue) > 60:
        lines.append(f"... and {len(_catalogue) - 60} more products.")

    return "\n".join(lines)


async def refresh_catalogue() -> dict:
    """Force a refresh. Returns summary dict."""
    await get_catalogue(force_refresh=True)
    return {
        "product_count": len(_catalogue),
        "last_fetched":  _last_fetched.isoformat() if _last_fetched else None,
    }


async def download_product_image_to_media(
    image_url: str,
    product_sku: str = "",
    product_name: str = "",
    public_base_url: str = "",
) -> Optional[dict]:
    """
    Download a product image from the public mtm-store static route into local
    chat media, so WhatsApp receives a stable media URL from this app.
    """
    source_url = _normalise_product_image_url(image_url)
    if not source_url:
        return None
    if not source_url.startswith(f"{_STORE_URL}/"):
        logger.info("Skipping product image download for non-mtm-store URL: %s", source_url[:120])
        return None

    parsed_path = unquote(urlparse(source_url).path)
    suffix = Path(parsed_path).suffix.lower() or ".jpg"
    filename_source = product_sku or product_name or "product"
    filename = f"{filename_source}{suffix}"

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(source_url)
            resp.raise_for_status()

        content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        guessed_type = mimetypes.guess_type(filename)[0] or "image/jpeg"
        is_image = content_type.startswith("image/") or guessed_type.startswith("image/")
        if not is_image:
            raise ValueError(f"Product image URL did not return an image content type: {content_type or 'unknown'}")
        if len(resp.content) > 8 * 1024 * 1024:
            raise ValueError("Product image is larger than 8 MB")

        saved = save_media_bytes(
            resp.content,
            filename=filename,
            folder="chat/products",
            content_type=content_type or guessed_type,
            public_base_url=public_base_url or None,
        )
        saved["source_url"] = source_url
        return saved
    except Exception as exc:
        logger.warning("Product image download failed for %s: %s", source_url[:160], exc)
        return None


# ─── Internal mtm-store fetch ─────────────────────────────────────────────────

async def _fetch_catalogue() -> None:
    """
    Fetch all active products from the mtm-store.com catalogue API using
    pagination (?limit=&skip=). Normalises each product and stores in _catalogue.
    """
    global _catalogue, _last_fetched

    all_products: list[dict] = []
    skip  = 0
    limit = 100  # API caps limit at 100

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                resp = await client.get(
                    _PRODUCTS_API,
                    params={"limit": limit, "skip": skip},
                )

                if resp.status_code != 200:
                    logger.error(
                        "mtm-store Products API error %s: %s",
                        resp.status_code, resp.text[:300],
                    )
                    break

                data  = resp.json()
                items = data.get("items") or []
                all_products.extend(items)

                total = data.get("total") or len(all_products)
                skip += limit

                if not items or len(all_products) >= total or skip > 5000:
                    break

    except Exception as exc:
        logger.exception("Failed to fetch mtm-store catalogue: %s", exc)
        return

    if not all_products:
        logger.warning("mtm-store catalogue returned 0 products.")
        return

    _catalogue    = [
        _normalise_product(p)
        for p in all_products
        if p.get("is_active", True)
    ]
    _last_fetched = datetime.now()
    logger.info(
        "mtm-store catalogue refreshed: %d products loaded at %s",
        len(_catalogue), _last_fetched.strftime("%H:%M:%S"),
    )


def _normalise_product(raw: dict) -> dict:
    """
    Convert a raw mtm-store product dict into a clean flat dict for the catalogue.

    mtm-store price structure (/api/products):
      {
        "price":             <selling price the customer pays>,
        "compare_at_price":  <original MRP — HIGHER than price when on sale>,
        "stock":             <integer units in stock>,
        "slug":              "<seo-slug>",            # page = {store}/shop/<slug>
        "image_url":         "/uploads/products/.../primary-....png",
        "og_image_url":      "/product_images/..._sq.png",
      }

    The selling `price` is shown as the live price; `compare_at_price` is shown
    as the crossed-out "was" price when it is higher (i.e. a discount is active).
    """
    def _to_float(value) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    product_id = raw.get("id") or ""
    name       = raw.get("name") or ""
    sku        = (raw.get("sku") or "").strip()
    slug       = (raw.get("slug") or "").strip()
    currency   = "INR"
    logger.debug("_normalise_product: name=%r sku=%r slug=%r", name, sku, slug)

    # ── Price parsing ─────────────────────────────────────────────────────────
    selling = _to_float(raw.get("price"))
    mrp     = _to_float(raw.get("compare_at_price"))
    on_sale = selling is not None and mrp is not None and mrp > selling

    # Struck-through "regular" price = MRP when discounted, else the selling price.
    regular_amount = mrp if on_sale else selling
    sale_amount    = selling if on_sale else None

    def _fmt(amount: Optional[float]) -> Optional[str]:
        if amount is None:
            return None
        return f"₹{amount:,.0f}" if currency == "INR" else f"{currency} {amount:,.2f}"

    regular_display   = _fmt(regular_amount)
    sale_display      = _fmt(sale_amount) if on_sale else None
    effective_display = sale_display if on_sale else regular_display

    # ── Stock ─────────────────────────────────────────────────────────────────
    stock_val = raw.get("stock")
    if isinstance(stock_val, (int, float)):
        in_stock = stock_val > 0
    else:
        in_stock = None

    # ── Description — strip HTML tags ─────────────────────────────────────────
    desc_raw    = raw.get("description") or raw.get("short_description") or ""
    description = re.sub(r"<[^>]+>", " ", desc_raw).strip()
    description = re.sub(r"\s+", " ", description)

    # ── Product page link ─────────────────────────────────────────────────────
    if slug:
        link = f"{_STORE_URL}/shop/{slug}"
    else:
        link = f"{_STORE_URL}/shop"

    # ── Image URLs (served from the mtm-store site root) ──────────────────────
    # og_image_url is a square crop ideal for WhatsApp; primary is the full shot.
    og_image_url = _normalise_product_image_url(raw.get("og_image_url") or "")
    image_url    = _normalise_product_image_url(raw.get("image_url") or "")
    primary_image = image_url or og_image_url

    return {
        "id":                 product_id,
        "name":               name,
        "sku":                sku,
        "slug":               slug,
        # Amounts (numeric)
        "price_amount":       regular_amount,
        "sale_price_amount":  sale_amount,
        # Display strings
        "price_display":      regular_display,
        "sale_price_display": sale_display,
        "effective_price":    effective_display,   # what the customer actually pays
        "on_sale":            on_sale,
        "currency":           currency,
        # Other fields
        "in_stock":           in_stock,
        "description":        description[:500],   # cap for prompt injection
        "link":               link,
        "image_url":          primary_image,
        "og_image_url":       og_image_url,
        "category":           raw.get("category_name") or "",
    }

async def get_product_images_by_sku(sku: str, product_name: str = "") -> list[str]:
    """
    Fetch product image URLs from DB.
    Lookup order:
      1. In-memory mtm-store catalogue (primary + square og image)
      2. DB product_images via sku_id exact match
      3. DB product_images via product name LIKE match
    Returns max 2 absolute URLs.
    """
    if not sku and not product_name:
        logger.warning("get_product_images_by_sku: both sku and product_name are empty")
        return []

    # ── 1. In-memory mtm-store catalogue (live, always-resolvable URLs) ─────
    catalogue_urls = _catalogue_image_fallback(sku, product_name)
    if catalogue_urls:
        logger.info(
            "Returning %d catalogue image(s) for sku=%r / name=%r",
            len(catalogue_urls), sku, product_name,
        )
        return catalogue_urls

    db = None
    try:
        from database import SessionLocal
        from sqlalchemy import text

        db = SessionLocal()
        urls: list[str] = []

        # ── 1. DB lookup by sku_id ─────────────────────────────────────────
        if sku:
            rows = db.execute(
                text("""
                    WITH matched_product AS (
                        SELECT p.product_id
                        FROM products p
                        WHERE LOWER(TRIM(p.sku_id)) = LOWER(TRIM(:sku))
                        ORDER BY
                            CASE
                                WHEN LOWER(TRIM(p.sku_id)) = LOWER(TRIM(:sku)) THEN 0
                                ELSE 2
                            END,
                            p.product_id ASC
                        LIMIT 1
                    )
                    SELECT pi.image_url
                    FROM product_images pi
                    JOIN matched_product mp ON mp.product_id = pi.product_id
                    WHERE pi.product_id = mp.product_id
                      AND pi.image_url IS NOT NULL
                      AND pi.image_url != ''
                    ORDER BY
                        CASE WHEN pi.color_id IS NULL THEN 0 ELSE 1 END,
                        pi.image_id ASC
                    LIMIT 2
                """),
                {"sku": sku},
            ).fetchall()
            logger.debug("SKU DB lookup: sku=%s → %d rows", sku, len(rows))
            urls = _to_absolute_urls([r.image_url for r in rows])

        # ── 2. DB lookup by product name (fallback) ────────────────────────
        if not urls and product_name:
            rows = db.execute(
                text("""
                    SELECT pi.image_url
                    FROM product_images pi
                    JOIN products p ON p.product_id = pi.product_id
                    WHERE LOWER(p.name) LIKE :name
                      AND pi.image_url IS NOT NULL
                      AND pi.image_url != ''
                    ORDER BY
                        CASE WHEN pi.color_id IS NULL THEN 0 ELSE 1 END,
                        pi.image_id ASC
                    LIMIT 2
                """),
                {"name": f"%{product_name.lower()[:40]}%"},
            ).fetchall()
            logger.debug("Name DB lookup: name=%r → %d rows", product_name[:40], len(rows))
            urls = _to_absolute_urls([r.image_url for r in rows])

        if urls:
            logger.info("Returning %d DB image(s) for sku=%r / name=%r", len(urls), sku, product_name)
            return urls

        logger.warning("No images found at all for sku=%r / name=%r", sku, product_name)
        return []

    except Exception as exc:
        logger.error("get_product_images_by_sku error sku=%r: %s", sku, exc)
        return _catalogue_image_fallback(sku, product_name)
    finally:
        if db is not None:
            db.close()


def _catalogue_image_fallback(sku: str, product_name: str = "") -> list[str]:
    sku_l  = (sku or "").lower().strip()
    name_l = (product_name or "").lower().strip()
    for p in _catalogue:
        p_sku  = (p.get("sku") or "").lower()
        p_name = (p.get("name") or "").lower()
        if (sku_l and p_sku == sku_l) or (name_l and name_l[:20] in p_name):
            urls: list[str] = []
            for raw in (p.get("image_url"), p.get("og_image_url")):
                img = _normalise_product_image_url(raw or "")
                if img and img not in urls:
                    urls.append(img)
            if urls:
                logger.info("Catalogue image(s) for sku=%r: %d found", sku, len(urls))
                return urls[:2]
    return []


def _to_absolute_urls(raw_urls: list[str]) -> list[str]:
    """Ensure all URLs are absolute. Filter empty strings."""
    result = []
    for url in raw_urls:
        url = _normalise_product_image_url(url)
        if not url:
            continue
        result.append(url)
    return result[:2]


def _normalise_product_image_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return ""

    parsed = urlparse(url)
    path = unquote(parsed.path.lstrip("/")) if parsed.scheme else unquote(url.lstrip("/"))

    # mtm-store catalogue images live at the site root: /product_images/... and
    # /uploads/...  (NOT under /api/static — that path 404s).
    if path.startswith("media/product_images/"):
        return f"{_PRODUCT_IMAGE_PUBLIC_BASE_URL}/{path.removeprefix('media/')}"
    if path.startswith("product_images/"):
        return f"{_PRODUCT_IMAGE_PUBLIC_BASE_URL}/{path}"
    if path.startswith("uploads/"):
        return f"{_PRODUCT_IMAGE_PUBLIC_BASE_URL}/{path}"

    if path.startswith("media/"):
        return media_public_url(path)

    if parsed.scheme in ("http", "https"):
        return url

    store = (_STORE_URL or "").rstrip("/")
    return f"{store}/{url.lstrip('/')}" if store else url
