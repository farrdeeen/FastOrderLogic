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
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote_plus, unquote, urlparse

from services.chat_media_service import media_public_url

logger = logging.getLogger(__name__)

_WIX_API_KEY   = os.getenv("WIX_API_KEY", "")
_WIX_SITE_ID   = os.getenv("WIX_SITE_ID", "")
_REFRESH_MINS  = int(os.getenv("CATALOGUE_REFRESH_MINUTES", "60"))

# Your Wix store URL — used for product links sent to customers
_WIX_STORE_URL = (os.getenv("WIX_STORE_URL") or os.getenv("STORE_BASE_URL") or "https://www.cspbank.in").rstrip("/")

_PRODUCTS_API  = "https://www.wixapis.com/stores/v1/products/query"

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
                await _fetch_from_wix()

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
        if p.get("in_stock") is True:
            score += 0.25
        if score > 0:
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
    if not link and _WIX_STORE_URL and name:
        link = f"{_WIX_STORE_URL}/search?q={quote_plus(name)}"
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
    if len(products) == 3 and _WIX_STORE_URL:
        parts.append(f"👉 See full catalogue: {_WIX_STORE_URL}")

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


# ─── Internal Wix fetch ───────────────────────────────────────────────────────

async def _fetch_from_wix() -> None:
    """
    Fetch all products from Wix Stores v1 API using pagination.
    Normalises each product and stores in _catalogue.
    """
    global _catalogue, _last_fetched

    if not _WIX_API_KEY or not _WIX_SITE_ID:
        logger.warning("Wix credentials not set — catalogue not loaded.")
        return

    headers = {
        "Authorization": _WIX_API_KEY,
        "wix-site-id":   _WIX_SITE_ID,
        "Content-Type":  "application/json",
    }

    all_products = []
    offset = 0
    limit  = 100

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                body = {
                    "query": {
                        "paging": {"limit": limit, "offset": offset},
                        "filter": '{"productType": "physical"}',
                    }
                }
                resp = await client.post(_PRODUCTS_API, json=body, headers=headers)

                if resp.status_code != 200:
                    logger.error(
                        "Wix Products API error %s: %s",
                        resp.status_code, resp.text[:300],
                    )
                    break

                data = resp.json()
                products = data.get("products") or []
                all_products.extend(products)

                metadata = data.get("metadata") or data.get("query", {}).get("paging", {})
                total = (
                    metadata.get("total")
                    or data.get("totalResults")
                    or len(all_products)
                )

                if len(products) < limit or len(all_products) >= total:
                    break
                offset += limit

    except Exception as exc:
        logger.exception("Failed to fetch Wix catalogue: %s", exc)
        return

    if not all_products:
        logger.warning("Wix catalogue returned 0 products.")
        return

    _catalogue    = [_normalise_product(p) for p in all_products]
    _last_fetched = datetime.now()
    logger.info(
        "Wix catalogue refreshed: %d products loaded at %s",
        len(_catalogue), _last_fetched.strftime("%H:%M:%S"),
    )


def _normalise_product(raw: dict) -> dict:
    """
    Convert a raw Wix product dict into a clean flat dict for the catalogue.

    Wix price structure (v1 Stores API):
    {
      "price": {
        "price":             <regular price as string/float>,
        "discountedPrice":   <sale/discounted price — LOWER than price when on sale>,
        "formatted": {
          "price":           "₹X,XXX",
          "discountedPrice": "₹X,XXX"
        },
        "currency": "INR"
      }
    }

    We ALWAYS show discountedPrice as the selling price when it is lower than
    price (i.e. a sale is active). The original `price` is shown as the
    crossed-out "was" price.
    """
    product_id = raw.get("id") or raw.get("_id") or ""
    name       = raw.get("name") or ""
    _variants  = raw.get("variants") or []
    _v0        = _variants[0] if _variants else {}
    sku = (
        raw.get("sku")
        or _v0.get("sku")
        or _v0.get("variantId", "")
        or ""
    )
    sku = sku.strip()
    logger.debug("_normalise_product: name=%r sku=%r", raw.get("name"), sku)
    slug       = raw.get("slug") or ""

    # ── Price parsing ─────────────────────────────────────────────────────────
    price_data = raw.get("price") or {}
    currency   = "INR"

    regular_amount:  Optional[float] = None
    sale_amount:     Optional[float] = None

    if isinstance(price_data, dict):
        currency = price_data.get("currency") or "INR"

        # Regular (list) price
        raw_reg = price_data.get("price")
        if raw_reg is not None:
            try:
                regular_amount = float(raw_reg)
            except (TypeError, ValueError):
                pass

        # Discounted / sale price — Wix sets this even when there's no discount
        # (in that case it equals the regular price). Only treat it as a sale
        # price when it is strictly LESS THAN the regular price.
        raw_disc = price_data.get("discountedPrice")
        if raw_disc is not None:
            try:
                disc_val = float(raw_disc)
                if regular_amount is not None and disc_val < regular_amount:
                    sale_amount = disc_val
                elif regular_amount is None:
                    # No regular price found — use discounted as regular
                    regular_amount = disc_val
            except (TypeError, ValueError):
                pass

        # Prefer formatted strings from Wix when available (already locale-formatted)
        formatted = price_data.get("formatted") or {}
        fmt_reg  = formatted.get("price") or ""
        fmt_disc = formatted.get("discountedPrice") or ""

    elif isinstance(price_data, (int, float)):
        regular_amount = float(price_data)
        fmt_reg = fmt_disc = ""
    else:
        fmt_reg = fmt_disc = ""

    def _fmt(amount: Optional[float], fmt_hint: str = "") -> Optional[str]:
        """Return a display string for an amount, using Wix formatted hint when available."""
        if fmt_hint:
            return fmt_hint
        if amount is None:
            return None
        return f"₹{amount:,.0f}" if currency == "INR" else f"{currency} {amount:,.2f}"

    on_sale           = sale_amount is not None
    regular_display   = _fmt(regular_amount, fmt_reg)
    sale_display      = _fmt(sale_amount, fmt_disc) if on_sale else None

    # Effective price shown to customers = sale price if available, else regular
    effective_display = sale_display if on_sale else regular_display

    # ── Stock ─────────────────────────────────────────────────────────────────
    stock_info = raw.get("stock") or {}
    in_stock   = stock_info.get("inStock") if isinstance(stock_info, dict) else None

    # ── Description — strip HTML tags ─────────────────────────────────────────
    desc_raw    = raw.get("description") or ""
    description = re.sub(r"<[^>]+>", " ", desc_raw).strip()
    description = re.sub(r"\s+", " ", description)

    # ── Product page link ─────────────────────────────────────────────────────
    link = ""
    if slug and _WIX_STORE_URL:
        link = f"{_WIX_STORE_URL}/product-page/{slug}"
    elif name and _WIX_STORE_URL:
        link = f"{_WIX_STORE_URL}/search?q={quote_plus(name)}"

    # ── Main image URL ────────────────────────────────────────────────────────
    media      = raw.get("media") or {}
    main_media = media.get("mainMedia") or {}
    image_url  = (main_media.get("image") or {}).get("url") or ""

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
        "image_url":          image_url,
    }

async def get_product_images_by_sku(sku: str, product_name: str = "") -> list[str]:
    """
    Fetch product image URLs from DB.
    Lookup order:
      1. DB via sku_id exact match
      2. DB via product name LIKE match (if sku misses)
      3. In-memory catalogue image_url
    Returns max 2 absolute URLs.
    """
    if not sku and not product_name:
        logger.warning("get_product_images_by_sku: both sku and product_name are empty")
        return []

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
                    ORDER BY pi.image_id ASC
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
                    ORDER BY pi.image_id ASC
                    LIMIT 2
                """),
                {"name": f"%{product_name.lower()[:40]}%"},
            ).fetchall()
            logger.debug("Name DB lookup: name=%r → %d rows", product_name[:40], len(rows))
            urls = _to_absolute_urls([r.image_url for r in rows])

        if urls:
            logger.info("Returning %d DB image(s) for sku=%r / name=%r", len(urls), sku, product_name)
            return urls

        catalogue_urls = _catalogue_image_fallback(sku, product_name)
        if catalogue_urls:
            return catalogue_urls

        logger.warning("No images found at all for sku=%r / name=%r", sku, product_name)
        return []

    except Exception as exc:
        logger.error("get_product_images_by_sku error sku=%r: %s", sku, exc)
        return _catalogue_image_fallback(sku, product_name)
    finally:
        if db is not None:
            db.close()


def _catalogue_image_fallback(sku: str, product_name: str = "") -> list[str]:
    for p in _catalogue:
        p_sku  = (p.get("sku") or "").lower()
        p_name = (p.get("name") or "").lower()
        if (sku and p_sku == sku.lower()) or (product_name and product_name.lower()[:20] in p_name):
            img = _normalise_product_image_url(p.get("image_url") or "")
            if img:
                logger.info("Catalogue fallback image for sku=%r: %s", sku, img[:80])
                return [img]
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

    if path.startswith("media/"):
        return media_public_url(path)
    if path.startswith("product_images/"):
        return media_public_url(path)

    if parsed.scheme in ("http", "https"):
        return url

    store = (_WIX_STORE_URL or "").rstrip("/")
    return f"{store}/{url.lstrip('/')}" if store else url
