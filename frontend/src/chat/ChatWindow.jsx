// src/chat/ChatWindow.jsx
// Fully wired to styles.js.
// fillInputRef: optional ref — ChatPage sets fillInputRef.current = (text) => setInput(text)
// so the info panel can prefill a quick-reply without prop-drilling a controlled input.

import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import { fetchMessages, sendChatMessage } from "./chatApi";
import { chatStyles, avatarColor, FLAG_COLORS } from "./styles";

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const { sender } = msg;

  if (sender === "system") {
    return (
      <Box sx={{ alignSelf: "center", my: "6px" }}>
        <span style={chatStyles.bubble("system")}>{msg.message}</span>
      </Box>
    );
  }

  return (
    <Box sx={chatStyles.msgWrapper(sender)}>
      <span style={chatStyles.bubble(sender)}>{msg.message}</span>
      <Typography sx={chatStyles.msgMeta(sender)}>
        {sender === "user" ? "Customer" : "Aria (AI)"} ·{" "}
        {new Date(msg.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {sender !== "user" && msg.status && (
          <span style={{ marginLeft: 4 }}>
            {msg.status === "read" || msg.status === "delivered" ? "✓✓" : "✓"}
          </span>
        )}
      </Typography>
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChatWindow({ chat, fillInputRef }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  // Expose a fill handle so ChatPage can inject quick-reply text
  useEffect(() => {
    if (fillInputRef) {
      fillInputRef.current = (text) => setInput(text);
    }
    return () => {
      if (fillInputRef) fillInputRef.current = null;
    };
  }, [fillInputRef]);

  // Null-guard + rAF so MUI Fade never catches a null ref mid-mount
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  const loadMessages = useCallback(
    async (sessionId, reset = false) => {
      if (!sessionId) return;
      if (reset) setLoading(true);
      try {
        const data = await fetchMessages(sessionId, { limit: 100 });
        setMessages(data);
        setError(null);
        if (reset) scrollToBottom();
      } catch {
        setError("Failed to load messages");
      } finally {
        setLoading(false);
      }
    },
    [scrollToBottom],
  );

  useEffect(() => {
    if (!chat?.id) return;
    setMessages([]);
    setError(null);
    setInput("");
    loadMessages(chat.id, true);
  }, [chat?.id, loadMessages]);

  useEffect(() => {
    if (!chat?.id) return;
    const t = setInterval(() => loadMessages(chat.id, false), 5000);
    return () => clearInterval(t);
  }, [chat?.id, loadMessages]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sending || !chat) return;

    const tempId = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        session_id: chat.id,
        sender: "ai",
        message: msg,
        timestamp: new Date().toISOString(),
        status: "sent",
      },
    ]);
    setInput("");
    setSending(true);

    try {
      await sendChatMessage(chat.id, msg);
      await loadMessages(chat.id, false);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setError("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!chat) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-tertiary)",
          fontSize: 13,
        }}
      >
        Select a conversation
      </Box>
    );
  }

  const { bg, text: textColor } = avatarColor(chat.name);
  const initials = (chat.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const statusPill = {
    active: { bg: "#EAF3DE", color: "#27500A" },
    waiting: { bg: "#FAEEDA", color: "#633806" },
    resolved: {
      bg: "var(--color-background-secondary)",
      color: "var(--color-text-tertiary)",
    },
  }[chat.status] || {
    bg: "var(--color-background-secondary)",
    color: "var(--color-text-tertiary)",
  };

  const flagStyle = chat.flag ? FLAG_COLORS[chat.flag] : null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── Header ── */}
      <Box sx={chatStyles.chatHeader}>
        <Box sx={chatStyles.avatar(bg, textColor, 30)}>{initials}</Box>

        <Box sx={chatStyles.chatHeaderInfo}>
          <p>{chat.name}</p>
          <span>{chat.phone}</span>
        </Box>

        {flagStyle && (
          <span
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 20,
              background: flagStyle.bg,
              color: flagStyle.text,
              border: `0.5px solid ${flagStyle.border}`,
              fontWeight: 500,
            }}
          >
            {chat.flag}
          </span>
        )}

        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 20,
            fontWeight: 500,
            background: statusPill.bg,
            color: statusPill.color,
          }}
        >
          {chat.status || "active"}
        </span>
      </Box>

      {/* ── Messages ── */}
      <Box ref={scrollRef} sx={chatStyles.messages}>
        {loading && (
          <Typography
            sx={{
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-tertiary)",
              py: 4,
            }}
          >
            Loading messages…
          </Typography>
        )}
        {!loading && messages.length === 0 && (
          <Typography
            sx={{
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-tertiary)",
              py: 4,
            }}
          >
            No messages yet
          </Typography>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {error && (
          <Typography
            sx={{
              textAlign: "center",
              fontSize: 11,
              color: "var(--color-text-danger, #c0392b)",
              py: 1,
            }}
          >
            {error}
          </Typography>
        )}
      </Box>

      {/* ── Input ── */}
      <Box sx={chatStyles.inputArea}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          rows={1}
          style={chatStyles.textarea}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          style={{
            ...chatStyles.sendBtn,
            opacity: sending || !input.trim() ? 0.5 : 1,
            cursor: sending || !input.trim() ? "not-allowed" : "pointer",
          }}
        >
          {sending ? "…" : "Send"}
        </button>
      </Box>
    </Box>
  );
}
