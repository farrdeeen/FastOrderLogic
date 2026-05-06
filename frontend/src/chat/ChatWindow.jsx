// src/chat/ChatWindow.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import { ArrowLeft, MoreVertical, Send } from "lucide-react";
import { fetchMessages, sendChatMessage } from "./chatApi";
import { chatStyles, avatarColor, WA } from "./styles";

// ── Date grouping helper ──────────────────────────────────────────────────────
function getDateLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - msgDay) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function groupByDate(messages) {
  const groups = [];
  let lastLabel = null;
  for (const msg of messages) {
    const label = msg.timestamp ? getDateLabel(msg.timestamp) : null;
    if (label && label !== lastLabel) {
      groups.push({ type: "divider", label, id: `div-${label}` });
      lastLabel = label;
    }
    groups.push({ type: "msg", msg });
  }
  return groups;
}

// ── Tick icon ─────────────────────────────────────────────────────────────────
function Ticks({ status }) {
  if (!status) return null;
  const color = status === "read" ? WA.textTick : WA.textSub;
  if (status === "sent") {
    return <span style={{ color: WA.textSub, fontSize: 12 }}>✓</span>;
  }
  return <span style={{ color, fontSize: 12 }}>✓✓</span>;
}

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === "object") return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  const { sender } = msg;
  const meta = parseMeta(msg.meta);

  if (sender === "system") {
    const isPaymentQr = meta.flow === "payment_qr" && meta.qr_url;
    const paymentUrl = meta.payment_url || "";

    return (
      <Box sx={{ ...chatStyles.msgWrapper("system"), my: "6px" }}>
        <Box
          sx={{
            ...chatStyles.bubble("system"),
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            gap: isPaymentQr ? "8px" : 0,
            maxWidth: isPaymentQr ? "280px" : chatStyles.bubble("system").maxWidth,
          }}
        >
          <span>{isPaymentQr ? `Payment QR for ${meta.order_id || "order"}` : msg.message}</span>
          {isPaymentQr && (
            <Box
              component="img"
              src={meta.qr_url}
              alt="Payment QR"
              sx={{
                width: "190px",
                maxWidth: "100%",
                borderRadius: "8px",
                border: `1px solid ${WA.borderMid}`,
                background: "#fff",
              }}
            />
          )}
          {isPaymentQr && paymentUrl && (
            <Box
              component="a"
              href={paymentUrl}
              target="_blank"
              rel="noreferrer"
              sx={{
                color: WA.greenDark,
                fontWeight: 700,
                textDecoration: "none",
                overflowWrap: "anywhere",
              }}
            >
              Open Razorpay link
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  const time = msg.timestamp
    ? new Date(msg.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <Box sx={chatStyles.msgWrapper(sender)}>
      <span style={chatStyles.bubble(sender)}>{msg.message}</span>
      <Box sx={chatStyles.msgMeta(sender)}>
        <span>{time}</span>
        {sender === "ai" && <Ticks status={msg.status} />}
      </Box>
    </Box>
  );
}

// ── Empty state (no chat selected) ───────────────────────────────────────────
function EmptyState() {
  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: WA.bgChat,
        gap: "16px",
        userSelect: "none",
      }}
    >
      <Box
        sx={{
          width: "100px",
          height: "100px",
          borderRadius: "50%",
          background: `${WA.greenDark}14`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "44px",
        }}
      >
        💬
      </Box>
      <Box sx={{ textAlign: "center" }}>
        <Typography
          sx={{
            fontSize: "22px",
            fontWeight: 500,
            color: WA.textPrimary,
            mb: "8px",
          }}
        >
          DāSh Chat
        </Typography>
        <Typography
          sx={{ fontSize: "14px", color: WA.textSub, maxWidth: "280px" }}
        >
          Select a conversation to start chatting with your customers.
        </Typography>
      </Box>
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChatWindow({
  chat,
  fillInputRef,
  onBackToList,
  onOpenInfo,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  // Expose fill handle for quick replies
  useEffect(() => {
    if (fillInputRef) {
      fillInputRef.current = (text) => {
        setInput(text);
        textareaRef.current?.focus();
      };
    }
    return () => {
      if (fillInputRef) fillInputRef.current = null;
    };
  }, [fillInputRef]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        if (reset) setTimeout(scrollToBottom, 60);
      } catch {
        setError("Failed to load messages.");
      } finally {
        setLoading(false);
      }
    },
    [scrollToBottom],
  );

  useEffect(() => {
    if (!chat?.id) return;
    setMessages([]);
    setError("");
    setInput("");
    loadMessages(chat.id, true);
  }, [chat?.id, loadMessages]);

  // Poll every 5 s
  useEffect(() => {
    if (!chat?.id) return;
    const t = setInterval(() => loadMessages(chat.id, false), 5000);
    return () => clearInterval(t);
  }, [chat?.id, loadMessages]);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Auto-grow textarea
  const handleInput = (e) => {
    setInput(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "22px";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }
  };

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
    if (textareaRef.current) textareaRef.current.style.height = "22px";
    setSending(true);
    try {
      await sendChatMessage(chat.id, msg);
      await loadMessages(chat.id, false);
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setError("Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  if (!chat) return <EmptyState />;

  const { bg, text: textColor } = avatarColor(chat.name);
  const initials = (chat.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const grouped = groupByDate(messages);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <Box sx={chatStyles.chatHeader}>
        {/* Mobile back */}
        {onBackToList && (
          <Box
            component="button"
            type="button"
            onClick={onBackToList}
            aria-label="Back"
            sx={chatStyles.mobileBackButton}
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </Box>
        )}

        {/* Avatar — opens info panel */}
        <Box onClick={onOpenInfo} sx={chatStyles.chatHeaderAvatar}>
          <Box sx={chatStyles.avatar(bg, textColor, 40)}>{initials}</Box>
        </Box>

        {/* Name + phone — also opens info panel */}
        <Box sx={chatStyles.chatHeaderInfo} onClick={onOpenInfo}>
          <p>{chat.name}</p>
          <span>{chat.phone}</span>
        </Box>

        {/* Actions */}
        <Box sx={chatStyles.headerActions}>
          <Box
            component="button"
            type="button"
            onClick={onOpenInfo}
            aria-label="Contact info"
            sx={chatStyles.iconCircleBtn}
          >
            <MoreVertical size={18} strokeWidth={2} />
          </Box>
        </Box>
      </Box>

      {/* ── Messages ── */}
      <Box ref={scrollRef} sx={chatStyles.messages}>
        {/* Wallpaper texture */}
        <Box sx={chatStyles.chatWallpaper} />

        {loading && (
          <Typography
            sx={{ textAlign: "center", fontSize: 13, color: WA.textSub, py: 4 }}
          >
            Loading messages…
          </Typography>
        )}
        {!loading && messages.length === 0 && (
          <Typography
            sx={{ textAlign: "center", fontSize: 13, color: WA.textSub, py: 6 }}
          >
            No messages yet. Say hello! 👋
          </Typography>
        )}

        {grouped.map((item) =>
          item.type === "divider" ? (
            <Box key={item.id} sx={chatStyles.dateDivider}>
              <Box sx={chatStyles.datePill}>{item.label}</Box>
            </Box>
          ) : (
            <MessageBubble key={item.msg.id} msg={item.msg} />
          ),
        )}

        {error && (
          <Typography
            sx={{ textAlign: "center", fontSize: 12, color: "#E53935", py: 1 }}
          >
            {error}
          </Typography>
        )}
      </Box>

      {/* ── Input ── */}
      <Box sx={chatStyles.inputArea}>
        <Box sx={chatStyles.textareaWrap}>
          <Box
            ref={textareaRef}
            component="textarea"
            value={input}
            onChange={handleInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message"
            rows={1}
            sx={chatStyles.textarea}
          />
        </Box>
        <Box
          component="button"
          type="button"
          onClick={handleSend}
          disabled={sending || !input.trim()}
          aria-label="Send"
          sx={{
            ...chatStyles.sendBtn,
            opacity: sending || !input.trim() ? 0.55 : 1,
          }}
        >
          <Send size={18} strokeWidth={2.5} />
        </Box>
      </Box>
    </Box>
  );
}
