import os
import re
import logging
import base64
from typing import Any, Optional
from urllib.parse import quote, urlparse

import httpx

RAZORPAY_KEY    = os.getenv("RAZORPAY_API_KEY")
RAZORPAY_SECRET = os.getenv("RAZORPAY_API_SECRET")
RAZORPAY_API_BASE = os.getenv("RAZORPAY_API_BASE", "https://api.razorpay.com/v1")
PAYMENT_QR_IMAGE_TEMPLATE = os.getenv(
    "PAYMENT_QR_IMAGE_TEMPLATE",
    "https://quickchart.io/qr?size=500&margin=2&text={data}",
)
PAYMENT_TEMPLATE_BUTTON_MODE = os.getenv(
    "PAYMENT_TEMPLATE_BUTTON_MODE",
    "order_token",
).strip().lower()
PAYMENT_TEMPLATE_BUTTON_URL_BASE = os.getenv("PAYMENT_TEMPLATE_BUTTON_URL_BASE", "").strip()

logger = logging.getLogger(__name__)

_ACTIVE_PAYMENT_LINK_STATUSES = {"created", "partially_paid"}


class PaymentLinkError(RuntimeError):
    """Raised when Razorpay does not return a usable payment link."""


def _normalise_razorpay_contact(phone: str) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    if digits.startswith("91") and len(digits) > 10:
        digits = digits[-10:]
    elif len(digits) > 10:
        digits = digits[-10:]
    if len(digits) == 10:
        return f"+91{digits}"
    return phone or ""


def _amount_to_paise(amount: float) -> int:
    try:
        paise = int(round(float(amount) * 100))
    except (TypeError, ValueError) as exc:
        raise PaymentLinkError(f"Invalid Razorpay amount: {amount!r}") from exc
    if paise <= 0:
        raise PaymentLinkError(f"Razorpay amount must be greater than 0: {amount!r}")
    return paise


def _extract_error(resp: httpx.Response) -> str:
    try:
        data: Any = resp.json()
    except ValueError:
        return resp.text[:1000]
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        parts = [
            str(error.get("code") or "").strip(),
            str(error.get("description") or error.get("reason") or "").strip(),
        ]
        return " | ".join(part for part in parts if part) or str(error)
    return str(data)[:1000]


def build_payment_qr_url(payment_url: str) -> str:
    if not payment_url:
        return ""
    return PAYMENT_QR_IMAGE_TEMPLATE.format(data=quote(payment_url, safe=""))


def encode_payment_order_token(order_id: str) -> str:
    """Base64url-encode an order ID for use in WhatsApp payment button URLs."""
    raw = str(order_id or "").encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_payment_order_token(token: str) -> str:
    """
    Base64url-decode a token back to an order ID.

    Raises PaymentLinkError if the token is not valid base64.
    Note: valid base64 does NOT guarantee the result is a real order ID —
    callers must validate the decoded value themselves (see _try_decode_token
    in payment_webhook.py).
    """
    value = str(token or "").strip()
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode((value + padding).encode("ascii")).decode("utf-8")
    except Exception as exc:
        raise PaymentLinkError("Invalid payment order token") from exc


def build_payment_template_button_value(order_id: str, payment_url: str) -> str:
    """
    Return the dynamic URL button value for the WhatsApp payment template.

    PAYMENT_TEMPLATE_BUTTON_MODE controls what is sent as {{1}}:

    order_token   (default) — base64url-encoded order ID.
                  Template button URL: https://mtmdash.com/pay/{{1}}
                  The /pay/<token> route decodes it and redirects to Razorpay.

    order_id      — raw order ID.
                  Template button URL: https://mtmdash.com/pay/order/{{1}}

    full_url      — complete Razorpay short URL.
                  Template button URL must be a variable-only button.

    razorpay_suffix — path segment after PAYMENT_TEMPLATE_BUTTON_URL_BASE.
                  e.g. PAYMENT_TEMPLATE_BUTTON_URL_BASE=https://rzp.io/i
                  Template button URL: https://rzp.io/i/{{1}}

    razorpay_path — path after the host, e.g. 'i/abc123' for https://rzp.io/i/abc123.
                  Template button URL: https://rzp.io/{{1}}
    """
    if PAYMENT_TEMPLATE_BUTTON_MODE in {"order_token", "encoded_order_token", "token"}:
        return encode_payment_order_token(order_id)

    if PAYMENT_TEMPLATE_BUTTON_MODE in {"order_id", "backend_redirect"}:
        return quote(str(order_id or ""), safe="")

    pay_url = str(payment_url or "").strip()
    if not pay_url:
        return str(order_id or "")

    configured_base = PAYMENT_TEMPLATE_BUTTON_URL_BASE.rstrip("/")
    if configured_base and pay_url.startswith(configured_base):
        return pay_url[len(configured_base):].lstrip("/")

    parsed = urlparse(pay_url)
    path   = parsed.path.strip("/")

    if PAYMENT_TEMPLATE_BUTTON_MODE in {"razorpay_suffix", "suffix"}:
        return path.split("/")[-1] if path else pay_url

    if PAYMENT_TEMPLATE_BUTTON_MODE in {"razorpay_path", "path"}:
        return path or pay_url

    return pay_url


async def _razorpay_request(method: str, path: str, **kwargs) -> dict:
    if not RAZORPAY_KEY or not RAZORPAY_SECRET:
        raise PaymentLinkError("Razorpay API key/secret missing in environment")

    url = f"{RAZORPAY_API_BASE.rstrip('/')}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.request(
            method,
            url,
            auth=(RAZORPAY_KEY, RAZORPAY_SECRET),
            **kwargs,
        )

    if resp.status_code >= 400:
        detail = _extract_error(resp)
        logger.error("Razorpay %s %s failed: HTTP %s | %s", method, path, resp.status_code, detail)
        raise PaymentLinkError(detail)

    try:
        return resp.json()
    except ValueError as exc:
        logger.error("Razorpay %s %s returned non-JSON body: %s", method, path, resp.text[:500])
        raise PaymentLinkError("Razorpay returned a non-JSON response") from exc


async def get_active_payment_link_by_reference(reference_id: str) -> Optional[dict]:
    if not reference_id:
        return None

    data  = await _razorpay_request(
        "GET",
        "/payment_links/",
        params={"reference_id": reference_id},
    )
    links = data.get("payment_links") or data.get("items") or []
    for link in links:
        if (
            link.get("reference_id") == reference_id
            and link.get("status") in _ACTIVE_PAYMENT_LINK_STATUSES
            and link.get("short_url")
        ):
            return link
    return None


async def create_payment_link_details(order_id: str, amount: float, name: str, phone: str) -> dict:
    amount_paise = _amount_to_paise(amount)

    try:
        existing = await get_active_payment_link_by_reference(order_id)
        if existing:
            logger.info(
                "Reusing active Razorpay payment link %s for order %s",
                existing.get("id"),
                order_id,
            )
            return existing
    except PaymentLinkError as exc:
        logger.warning("Could not check existing Razorpay payment link for %s: %s", order_id, exc)

    payload = {
        "amount":       amount_paise,
        "currency":     "INR",
        "description":  f"Payment for Order {order_id}",
        "reference_id": order_id,
        "customer": {
            "name":    name,
            "contact": _normalise_razorpay_contact(phone),
        },
        "notify": {
            "sms":   True,
            "email": False,
        },
        "notes": {"order_id": order_id},
    }

    try:
        data = await _razorpay_request("POST", "/payment_links/", json=payload)
    except PaymentLinkError as exc:
        if "reference" in str(exc).lower() and "already" in str(exc).lower():
            existing = await get_active_payment_link_by_reference(order_id)
            if existing:
                logger.info("Razorpay duplicate reference recovered for order %s", order_id)
                return existing
        raise

    if not data.get("short_url"):
        logger.error(
            "Razorpay payment link missing short_url for order %s: %s",
            order_id,
            data,
        )
        raise PaymentLinkError("Razorpay did not return short_url")

    return data


async def create_payment_qr_details(order_id: str, amount: float, name: str = "") -> dict:
    amount_paise = _amount_to_paise(amount)
    payload = {
        "type":           "upi_qr",
        "name":           (f"{name or 'Customer'} {order_id}")[:64],
        "usage":          "single_use",
        "fixed_amount":   True,
        "payment_amount": amount_paise,
        "description":    f"Payment for Order {order_id}",
        "notes":          {"order_id": order_id},
    }

    data = await _razorpay_request("POST", "/payments/qr_codes", json=payload)
    if not data.get("image_url"):
        logger.error("Razorpay QR missing image_url for order %s: %s", order_id, data)
        raise PaymentLinkError("Razorpay QR did not return image_url")
    return data


async def create_payment_link(order_id: str, amount: float, name: str, phone: str):
    data = await create_payment_link_details(
        order_id=order_id,
        amount=amount,
        name=name,
        phone=phone,
    )
    return data.get("short_url")