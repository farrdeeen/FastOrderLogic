"""
services/ai_service.py
──────────────────────
Sales-focused AI agent powered by NVIDIA Nemotron 3 Nano Omni (free).
Supports dynamic system-prompt injection from uploaded training documents.
"""

import os
import json
import httpx
import logging
from typing import Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# ── NVIDIA NIM / Nemotron config ──────────────────────────────────────────────
_OR_KEY   = os.getenv("OPENROUTER_API_KEY", "")
_OR_MODEL = os.getenv(
    "OPENROUTER_MODEL",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
)
_OR_BASE  = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
# Training docs are stored as plain text in this path (written by the dashboard upload endpoint)
_TRAINING_DOC_PATH = Path(os.getenv("TRAINING_DOC_PATH", "data/training_doc.txt"))

_BASE_SYSTEM_PROMPT = """You are Aria, an enthusiastic and helpful AI sales assistant for an electronics store.
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


def _build_system_prompt() -> str:
    """
    Builds the full system prompt.
    If a training document has been uploaded via the dashboard, its content
    is appended so the AI has product/policy knowledge.
    """
    prompt = _BASE_SYSTEM_PROMPT

    if _TRAINING_DOC_PATH.exists():
        try:
            doc_text = _TRAINING_DOC_PATH.read_text(encoding="utf-8").strip()
            if doc_text:
                prompt += f"\n\n--- PRODUCT & POLICY KNOWLEDGE (from training document) ---\n{doc_text}\n---"
                logger.debug("Training doc injected (%d chars)", len(doc_text))
        except Exception as exc:
            logger.warning("Could not read training doc: %s", exc)

    return prompt


async def generate_reply(conversation_history: list[dict], user_message: str) -> str:
    """
    Call NVIDIA NIM chat-completions endpoint (OpenAI-compatible).

    conversation_history: list of {"role": "user"|"assistant", "content": str}
    user_message: the latest incoming message (appended internally)

    Returns the AI's reply string.
    """
    if not _OR_KEY:

        logger.error("OPENROUTER_API_KEY is not set.")

        return "AI service is not configured. Please contact support."

    system_prompt = _build_system_prompt()

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    payload = {
        "model": _OR_MODEL,   # ✅ FIXED
        "messages": messages,
        "max_tokens": 300,
        "temperature": 0.5,   # ✅ better for Nemotron
        "top_p": 0.95,
        "stream": False,
        "response_format": {"type": "text"}
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                f"{_OR_BASE}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {_OR_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:5173",
                    "X-Title": "FastOrderLogic AI",
                },

            )

            if resp.status_code != 200:
                logger.error(
                    "OpenRouter API error %s: %s", resp.status_code, resp.text
                )
                resp.raise_for_status()

            data = resp.json()
            message = data["choices"][0]["message"]

            reply = message.get("content")      # Fallback for reasoning models
            if not reply:
                reply = message.get("reasoning") or ""
            if not reply:
                logger.error("Empty AI response: %s", data)
                return "Sorry, I couldn't generate a reply. Please try again."

            reply = reply.strip()
            logger.debug("AI reply (model=%s): %s", _OR_MODEL, reply[:80])
            return reply

    except httpx.HTTPStatusError as exc:
        logger.error(
            "NVIDIA HTTP error: %s — %s",
            exc.response.status_code,
            exc.response.text,
        )
        return "Sorry, I'm having trouble connecting right now. Please try again in a moment."
    except Exception as exc:
        logger.exception("NVIDIA unexpected error: %s", exc)
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