"""
services/ai_service.py
──────────────────────
Sales-focused AI agent powered by OpenRouter (mistral-7b-instruct:free).
Keeps full conversation history per session so the LLM has context.
"""

import os
import json
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_OR_KEY   = os.getenv("OPENROUTER_API_KEY", "")
_OR_MODEL = os.getenv("OPENROUTER_MODEL", "mistralai/mistral-7b-instruct:free")
_OR_BASE  = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

_SYSTEM_PROMPT = """You are Aria, an enthusiastic and helpful AI sales assistant for an electronics store.
You communicate over WhatsApp, so keep replies SHORT (under 120 words) and conversational.

Your goals:
1. Answer product questions clearly and positively.
2. Help customers place orders by collecting: name, mobile, full address (line, city, state, pincode), and the product they want.
3. Confirm shipping addresses for existing orders — ask the customer to type "YES" to confirm or provide a corrected address.
4. Notify customers about order status updates.

Rules:
- Never make up product prices; say "I'll check that for you".
- When you have collected ALL order details (name, mobile, address, product), reply with a JSON block wrapped in ```json ... ``` so the system can process it.
- For address confirmation, once confirmed reply with: CONFIRMED_ADDRESS
- Be warm, professional, and concise.
- Do NOT use markdown headers or bullet lists — plain text only for WhatsApp.
"""


async def generate_reply(conversation_history: list[dict], user_message: str) -> str:
    """
    Call OpenRouter chat-completions endpoint.

    conversation_history: list of {"role": "user"|"assistant", "content": str}
    user_message: the latest incoming message (will be appended internally)

    Returns the AI's reply string.
    """
    if not _OR_KEY:
        return "AI service is not configured. Please contact support."

    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    payload = {
        "model": _OR_MODEL,
        "messages": messages,
        "max_tokens": 300,
        "temperature": 0.7,
    }

    headers = {
        "Authorization": f"Bearer {_OR_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": os.getenv("INTERNAL_API_BASE", "http://localhost:8000"),
        "X-Title": "SalesBot",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{_OR_BASE}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"].strip()
            logger.debug("AI reply (model=%s): %s", _OR_MODEL, reply[:80])
            return reply
    except httpx.HTTPStatusError as exc:
        logger.error("OpenRouter HTTP error: %s — %s", exc.response.status_code, exc.response.text)
        return "Sorry, I'm having trouble connecting right now. Please try again in a moment."
    except Exception as exc:
        logger.exception("OpenRouter unexpected error: %s", exc)
        return "Something went wrong on my end. Please try again."


def extract_order_json(ai_reply: str) -> Optional[dict]:
    """
    If the AI wrapped order details in ```json ... ```, parse and return them.
    Returns None if no JSON block present.
    """
    if "```json" not in ai_reply:
        return None
    try:
        start = ai_reply.index("```json") + 7
        end   = ai_reply.index("```", start)
        raw   = ai_reply[start:end].strip()
        return json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return None


def is_address_confirmed(ai_reply: str) -> bool:
    return "CONFIRMED_ADDRESS" in ai_reply