// src/chat/ChatWindow.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import { ArrowLeft, Download, FileText, MoreVertical, Paperclip, Send, X } from "lucide-react";
import { fetchMessages, getChatWsUrl, sendChatMessage, uploadChatMedia } from "./chatApi";
import { chatStyles, avatarColor, WA } from "./styles";

const API_BASE = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

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

function resolveMediaUrl(url) {
  if (!url) return "";
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMediaPlaceholder(message) {
  return /^\[(image|file|media:)/i.test((message || "").trim());
}

function mediaFromMeta(meta = {}) {
  const mediaUrl =
    meta.media_url ||
    meta.download_url ||
    meta.url ||
    meta.link ||
    meta.file_url ||
    meta.public_url ||
    meta.image_url ||
    meta.qr_url ||
    "";
  const downloadUrl = meta.download_url || mediaUrl;
  const mime = meta.mime_type || meta.content_type || "";
  const mediaType = meta.media_type || meta.type || "";
  const fileName =
    meta.file_name ||
    meta.filename ||
    meta.name ||
    (mediaType === "image" || mime.startsWith("image/") ? "Photo" : "Attachment");
  const isImage =
    mediaType === "image" ||
    mediaType === "photo" ||
    mime.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(fileName);
  return {
    url: resolveMediaUrl(mediaUrl),
    downloadUrl: resolveMediaUrl(downloadUrl),
    mime,
    mediaType,
    fileName,
    fileSize: meta.file_size || meta.size,
    isImage,
  };
}

function MediaAttachment({ meta, onPreview }) {
  const { url, downloadUrl, mime, fileName, fileSize, isImage } = mediaFromMeta(meta);
  const sizeLabel = formatBytes(fileSize);

  if (!url) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "9px 10px",
          borderRadius: "8px",
          background: "rgba(255,255,255,0.68)",
          border: `1px solid ${WA.borderMid}`,
          color: WA.textSub,
          fontSize: "12px",
        }}
      >
        <FileText size={18} />
        <span>{fileName}</span>
      </Box>
    );
  }

  if (isImage) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
        <Box
          component="button"
          type="button"
          onClick={() => onPreview?.({ url, downloadUrl, fileName })}
          sx={{
            display: "block",
            border: "none",
            padding: 0,
            margin: 0,
            background: "transparent",
            cursor: "zoom-in",
            lineHeight: 0,
            textAlign: "left",
          }}
        >
          <Box
            component="img"
            src={url}
            alt={fileName}
            sx={{
              display: "block",
              width: "min(300px, 100%)",
              maxHeight: "340px",
              objectFit: "cover",
              borderRadius: "7px",
              border: `1px solid ${WA.borderMid}`,
              background: "#fff",
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: "min(300px, 100%)",
        maxWidth: "100%",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px",
        borderRadius: "8px",
        border: `1px solid ${WA.borderMid}`,
        background: "rgba(255,255,255,0.68)",
      }}
    >
      <FileText size={24} color={WA.greenDark} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          component="a"
          href={url}
          target="_blank"
          rel="noreferrer"
          sx={{
            display: "block",
            color: WA.textPrimary,
            fontSize: "13px",
            fontWeight: 700,
            textDecoration: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fileName}
        </Box>
        <Typography sx={{ fontSize: "11px", color: WA.textSub }}>
          {mime || "file"}{sizeLabel ? ` · ${sizeLabel}` : ""}
        </Typography>
      </Box>
      <Box
        component="a"
        href={downloadUrl}
        download={fileName}
        target="_blank"
        rel="noreferrer"
        aria-label={`Download ${fileName}`}
        sx={{
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: WA.greenDark,
          textDecoration: "none",
          flexShrink: 0,
          "&:hover": { background: WA.border },
        }}
      >
        <Download size={16} />
      </Box>
    </Box>
  );
}

function ImagePreview({ media, onClose }) {
  if (!media) return null;

  return (
    <Box
      onClick={onClose}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1800,
        background: "rgba(17,27,33,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        sx={{
          position: "absolute",
          top: "16px",
          right: "16px",
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          border: "none",
          background: "rgba(255,255,255,0.12)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <X size={22} />
      </Box>
      <Box
        component="a"
        href={media.downloadUrl || media.url}
        download={media.fileName}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: "absolute",
          top: "16px",
          right: "64px",
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          background: "rgba(255,255,255,0.12)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textDecoration: "none",
        }}
      >
        <Download size={20} />
      </Box>
      <Box
        component="img"
        src={media.url}
        alt={media.fileName || "Preview"}
        onClick={(e) => e.stopPropagation()}
        sx={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: "8px",
          boxShadow: "0 20px 80px rgba(0,0,0,0.36)",
        }}
      />
    </Box>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onPreview }) {
  const { sender } = msg;
  const meta = parseMeta(msg.meta);
  const media = mediaFromMeta(meta);
  const hasMedia = Boolean(media.url || meta.file_name || meta.filename);
  const showMessageText = msg.message && (!hasMedia || !isMediaPlaceholder(msg.message));

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
            gap: isPaymentQr || hasMedia ? "8px" : 0,
            maxWidth: isPaymentQr || hasMedia ? "320px" : chatStyles.bubble("system").maxWidth,
            textAlign: hasMedia ? "left" : chatStyles.bubble("system").textAlign,
          }}
        >
          {(isPaymentQr || showMessageText) && (
            <span>
              {isPaymentQr ? `Payment QR for ${meta.order_id || "order"}` : msg.message}
            </span>
          )}
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
          {hasMedia && <MediaAttachment meta={meta} onPreview={onPreview} />}
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
      <Box
        sx={{
          ...chatStyles.bubble(sender),
          display: "flex",
          flexDirection: "column",
          gap: hasMedia ? "8px" : 0,
          padding: hasMedia ? "6px" : chatStyles.bubble(sender).padding,
        }}
      >
        {showMessageText && <span>{msg.message}</span>}
        {hasMedia && <MediaAttachment meta={meta} onPreview={onPreview} />}
      </Box>
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
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const wsRef = useRef(null);
  const wsReconnectRef = useRef(null);

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
    const t = setInterval(() => loadMessages(chat.id, false), 30000);
    return () => clearInterval(t);
  }, [chat?.id, loadMessages]);

  useEffect(() => {
    if (!chat?.id) return undefined;
    let stopped = false;
    const sessionId = chat.id;

    const connect = () => {
      if (stopped || typeof WebSocket === "undefined") return;
      const ws = new WebSocket(getChatWsUrl());
      wsRef.current = ws;

      ws.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload.type !== "chat_changed") return;
        if (payload.session_id && Number(payload.session_id) !== Number(sessionId))
          return;
        loadMessages(sessionId, false);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onclose = () => {
        if (stopped) return;
        wsReconnectRef.current = window.setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (wsReconnectRef.current) {
        window.clearTimeout(wsReconnectRef.current);
        wsReconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
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

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !chat?.id || uploading) return;

    setUploading(true);
    setError(null);
    try {
      const caption = input.trim();
      const result = await uploadChatMedia(chat.id, file, caption);
      if (caption) {
        setInput("");
        if (textareaRef.current) textareaRef.current.style.height = "22px";
      }
      await loadMessages(chat.id, false);
      if (!result?.success) {
        setError("File saved in chat, but WhatsApp send failed.");
      }
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to upload file.");
    } finally {
      setUploading(false);
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
      <ImagePreview media={mediaPreview} onClose={() => setMediaPreview(null)} />

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
            <MessageBubble
              key={item.msg.id}
              msg={item.msg}
              onPreview={setMediaPreview}
            />
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
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <Box
          component="button"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending}
          aria-label="Attach file"
          title="Attach file"
          sx={{
            ...chatStyles.iconCircleBtn,
            width: "44px",
            height: "44px",
            flexShrink: 0,
            opacity: uploading ? 0.55 : 1,
            cursor: uploading ? "not-allowed" : "pointer",
          }}
        >
          <Paperclip size={19} strokeWidth={2.2} />
        </Box>
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
          disabled={sending || uploading || !input.trim()}
          aria-label="Send"
          sx={{
            ...chatStyles.sendBtn,
            opacity: sending || uploading || !input.trim() ? 0.55 : 1,
          }}
        >
          <Send size={18} strokeWidth={2.5} />
        </Box>
      </Box>
    </Box>
  );
}
