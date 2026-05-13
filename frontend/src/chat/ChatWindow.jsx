// src/chat/ChatWindow.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import {
  ArrowLeft,
  Download,
  FileText,
  Film,
  Music,
  MoreVertical,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import {
  fetchMessages,
  sendChatMessage,
  uploadChatMedia,
} from "./chatApi";
import { chatStyles, avatarColor, WA } from "./styles";

// The backend's own origin — used to resolve root-relative /media/... paths.
// VITE_API_URL must point to your FastAPI server, e.g. https://api.example.com
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

// ── URL resolver ──────────────────────────────────────────────────────────────
/**
 * Turn any URL variant into something the browser can actually fetch.
 *
 * Variants we receive from the backend:
 *   1. Already absolute:  https://api.example.com/media/chat/42/abc.jpg
 *   2. Root-relative:     /media/chat/42/abc.jpg   (PUBLIC_BASE_URL not set)
 *   3. Old relative_url:  media/chat/42/abc.jpg    (no leading slash — legacy)
 *   4. External CDN:      https://... (WhatsApp temp URLs that are already full)
 *   5. Blob / data URLs:  blob:... / data:...
 */
function resolveMediaUrl(url) {
  if (!url) return "";
  if (/^(blob:|data:)/i.test(url)) return url; // local blob/data
  if (/^https?:\/\//i.test(url)) return url; // already absolute
  // Root-relative or legacy relative — prepend the API origin
  const base = API_BASE || window.location.origin;
  const slash = url.startsWith("/") ? "" : "/";
  return `${base}${slash}${url}`;
}

// ── Date grouping helpers ─────────────────────────────────────────────────────
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
  if (status === "sent")
    return <span style={{ color: WA.textSub, fontSize: 12 }}>✓</span>;
  return <span style={{ color, fontSize: 12 }}>✓✓</span>;
}

// ── Meta parser ───────────────────────────────────────────────────────────────
function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === "object") return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMediaPlaceholder(message) {
  return /^\[(image|file|media:|video:|audio:)/i.test((message || "").trim());
}

// ── Media extraction from meta ────────────────────────────────────────────────
/**
 * Pull all media-related fields out of a message's meta blob.
 * Handles every field name variant produced by the backend.
 */
function mediaFromMeta(meta = {}) {
  // Prefer the most specific URL fields first
  const rawUrl =
    meta.media_url ||
    meta.public_url ||
    meta.url ||
    meta.link ||
    meta.file_url ||
    meta.image_url ||
    meta.qr_url ||
    "";

  // download_url may have ?dl=1 already, or fall back to rawUrl
  const rawDownload = meta.download_url || rawUrl;

  const mime = meta.mime_type || meta.content_type || "";
  const mediaType = meta.media_type || meta.type || "";
  const fileName = meta.file_name || meta.filename || meta.name || "";

  // Determine rendering type
  const isImage =
    mediaType === "image" ||
    mediaType === "photo" ||
    mime.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(fileName || rawUrl);

  const isVideo =
    mediaType === "video" ||
    mime.startsWith("video/") ||
    /\.(mp4|webm|mov|avi|mkv)$/i.test(fileName || rawUrl);

  const isAudio =
    mediaType === "audio" ||
    mime.startsWith("audio/") ||
    /\.(mp3|ogg|wav|m4a|aac|opus)$/i.test(fileName || rawUrl);

  const isPdf =
    mime === "application/pdf" || /\.pdf$/i.test(fileName || rawUrl);

  const displayName =
    fileName ||
    (isImage
      ? "Photo"
      : isVideo
        ? "Video"
        : isAudio
          ? "Voice message"
          : "Attachment");

  return {
    url: resolveMediaUrl(rawUrl),
    downloadUrl: resolveMediaUrl(rawDownload),
    mime,
    mediaType,
    fileName: displayName,
    fileSize: meta.file_size || meta.size,
    isImage,
    isVideo,
    isAudio,
    isPdf,
  };
}

// ── Media components ──────────────────────────────────────────────────────────

function ImageAttachment({ url, downloadUrl, fileName, onPreview }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <Box
        component="a"
        href={downloadUrl || url}
        target="_blank"
        rel="noreferrer"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          color: WA.greenDark,
          fontSize: "13px",
          textDecoration: "none",
          padding: "6px 10px",
          borderRadius: "8px",
          border: `1px solid ${WA.borderMid}`,
          background: "rgba(255,255,255,0.7)",
        }}
      >
        <Download size={15} />
        {fileName}
      </Box>
    );
  }

  return (
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
        onError={() => setErrored(true)}
        sx={{
          display: "block",
          width: "min(280px, 100%)",
          maxHeight: "320px",
          objectFit: "cover",
          borderRadius: "7px",
          border: `1px solid ${WA.borderMid}`,
          background: "#f0f0f0",
        }}
      />
    </Box>
  );
}

function VideoAttachment({ url, downloadUrl, fileName, fileSize }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <Box
        component="video"
        src={url}
        controls
        preload="metadata"
        sx={{
          display: "block",
          width: "min(300px, 100%)",
          maxHeight: "240px",
          borderRadius: "8px",
          border: `1px solid ${WA.borderMid}`,
          background: "#000",
          outline: "none",
        }}
      >
        <Box
          component="a"
          href={downloadUrl || url}
          target="_blank"
          rel="noreferrer"
        >
          Download video
        </Box>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Film size={13} color={WA.textSub} />
        <Typography sx={{ fontSize: "11px", color: WA.textSub }}>
          {fileName}
          {fileSize ? ` · ${formatBytes(fileSize)}` : ""}
        </Typography>
        <Box
          component="a"
          href={downloadUrl || url}
          download={fileName}
          target="_blank"
          rel="noreferrer"
          sx={{ color: WA.greenDark, display: "flex", alignItems: "center" }}
        >
          <Download size={13} />
        </Box>
      </Box>
    </Box>
  );
}

function AudioAttachment({ url, fileName, fileSize }) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        minWidth: "200px",
      }}
    >
      <Box
        component="audio"
        src={url}
        controls
        preload="metadata"
        sx={{
          width: "100%",
          height: "36px",
          outline: "none",
          borderRadius: "18px",
        }}
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <Music size={12} color={WA.textSub} />
        <Typography sx={{ fontSize: "11px", color: WA.textSub }}>
          {fileName}
          {fileSize ? ` · ${formatBytes(fileSize)}` : ""}
        </Typography>
      </Box>
    </Box>
  );
}

function DocumentAttachment({ url, downloadUrl, mime, fileName, fileSize }) {
  const sizeLabel = formatBytes(fileSize);
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(fileName);

  return (
    <Box
      sx={{
        width: "min(300px, 100%)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px",
        borderRadius: "8px",
        border: `1px solid ${WA.borderMid}`,
        background: "rgba(255,255,255,0.75)",
      }}
    >
      <FileText size={26} color={isPdf ? "#E53935" : WA.greenDark} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Clicking the name opens inline (PDF in new tab, etc.) */}
        <Box
          component="a"
          href={url}
          target="_blank"
          rel="noreferrer"
          sx={{
            display: "block",
            color: WA.textPrimary,
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          {fileName}
        </Box>
        <Typography sx={{ fontSize: "11px", color: WA.textSub }}>
          {mime || "file"}
          {sizeLabel ? ` · ${sizeLabel}` : ""}
        </Typography>
      </Box>
      {/* Download button always triggers save-as */}
      <Box
        component="a"
        href={downloadUrl}
        download={fileName}
        target="_blank"
        rel="noreferrer"
        aria-label={`Download ${fileName}`}
        sx={{
          width: "34px",
          height: "34px",
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

/**
 * Top-level media dispatcher — picks the right component for the mime/type.
 */
function MediaAttachment({ meta, onPreview }) {
  const media = mediaFromMeta(meta);

  // Nothing to show
  if (!media.url) {
    if (!media.fileName || media.fileName === "Attachment") return null;
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "7px 10px",
          borderRadius: "8px",
          background: "rgba(255,255,255,0.68)",
          border: `1px solid ${WA.borderMid}`,
          color: WA.textSub,
          fontSize: "12px",
        }}
      >
        <FileText size={16} />
        <span>{media.fileName}</span>
      </Box>
    );
  }

  if (media.isImage) {
    return (
      <ImageAttachment
        url={media.url}
        downloadUrl={media.downloadUrl}
        fileName={media.fileName}
        onPreview={onPreview}
      />
    );
  }

  if (media.isVideo) {
    return (
      <VideoAttachment
        url={media.url}
        downloadUrl={media.downloadUrl}
        fileName={media.fileName}
        fileSize={media.fileSize}
      />
    );
  }

  if (media.isAudio) {
    return (
      <AudioAttachment
        url={media.url}
        fileName={media.fileName}
        fileSize={media.fileSize}
      />
    );
  }

  return (
    <DocumentAttachment
      url={media.url}
      downloadUrl={media.downloadUrl}
      mime={media.mime}
      fileName={media.fileName}
      fileSize={media.fileSize}
    />
  );
}

// ── Full-screen image preview ─────────────────────────────────────────────────
function ImagePreview({ media, onClose }) {
  if (!media) return null;
  return (
    <Box
      onClick={onClose}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1800,
        background: "rgba(17,27,33,0.94)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      {/* Close */}
      <Box
        component="button"
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        sx={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 40,
          height: 40,
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

      {/* Download */}
      <Box
        component="a"
        href={media.downloadUrl || media.url}
        download={media.fileName}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: "absolute",
          top: 16,
          right: 64,
          width: 40,
          height: 40,
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
          maxHeight: "90vh",
          objectFit: "contain",
          borderRadius: "8px",
          boxShadow: "0 20px 80px rgba(0,0,0,0.4)",
        }}
      />
    </Box>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, onPreview }) {
  const { sender } = msg;
  const meta = parseMeta(msg.meta);
  const hasMedia = Boolean(
    meta.media_url ||
    meta.public_url ||
    meta.url ||
    meta.link ||
    meta.file_url ||
    meta.image_url ||
    meta.qr_url,
  );
  // Only show the text if it's NOT a pure media placeholder string
  const showText =
    msg.message && (!hasMedia || !isMediaPlaceholder(msg.message));

  // ── System messages ────────────────────────────────────────────────────────
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
            gap: hasMedia || isPaymentQr ? "8px" : 0,
            maxWidth:
              hasMedia || isPaymentQr
                ? "320px"
                : chatStyles.bubble("system").maxWidth,
            textAlign: hasMedia
              ? "left"
              : chatStyles.bubble("system").textAlign,
          }}
        >
          {(isPaymentQr || showText) && (
            <span>
              {isPaymentQr
                ? `Payment QR for ${meta.order_id || "order"}`
                : msg.message}
            </span>
          )}

          {isPaymentQr && (
            <Box
              component="img"
              src={resolveMediaUrl(meta.qr_url)}
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
              }}
            >
              Open Razorpay link
            </Box>
          )}

          {hasMedia && !isPaymentQr && (
            <MediaAttachment meta={meta} onPreview={onPreview} />
          )}
        </Box>
      </Box>
    );
  }

  // ── User / AI messages ─────────────────────────────────────────────────────
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
        {showText && (
          <span style={{ padding: hasMedia ? "2px 4px" : 0 }}>
            {msg.message}
          </span>
        )}
        {hasMedia && <MediaAttachment meta={meta} onPreview={onPreview} />}
      </Box>
      <Box sx={chatStyles.msgMeta(sender)}>
        <span>{time}</span>
        {sender === "ai" && <Ticks status={msg.status} />}
      </Box>
    </Box>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
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

  // Expose fill handle for quick replies
  useEffect(() => {
    if (fillInputRef)
      fillInputRef.current = (text) => {
        setInput(text);
        textareaRef.current?.focus();
      };
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
    window.__folActiveChatId = chat.id;
    setMessages([]);
    setError("");
    setInput("");
    loadMessages(chat.id, true);
    return () => {
      if (Number(window.__folActiveChatId) === Number(chat.id)) {
        window.__folActiveChatId = null;
      }
    };
  }, [chat?.id, loadMessages]);

  // Light fallback. Realtime updates come from the single app-level chat listener.
  useEffect(() => {
    if (!chat?.id) return;
    const t = setInterval(() => loadMessages(chat.id, false), 60000);
    return () => clearInterval(t);
  }, [chat?.id, loadMessages]);

  // App-level realtime fanout.
  useEffect(() => {
    if (!chat?.id) return undefined;
    const onChatChanged = (event) => {
      if (Number(event.detail?.session_id) === Number(chat.id))
        loadMessages(chat.id, false);
    };
    window.addEventListener("chat:changed", onChatChanged);
    return () => window.removeEventListener("chat:changed", onChatChanged);
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
      if (!result?.success)
        setError("File saved in chat, but WhatsApp send may have failed.");
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
      <ImagePreview
        media={mediaPreview}
        onClose={() => setMediaPreview(null)}
      />

      {/* ── Header ── */}
      <Box sx={chatStyles.chatHeader}>
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
        <Box onClick={onOpenInfo} sx={chatStyles.chatHeaderAvatar}>
          <Box sx={chatStyles.avatar(bg, textColor, 40)}>{initials}</Box>
        </Box>
        <Box sx={chatStyles.chatHeaderInfo} onClick={onOpenInfo}>
          <p>{chat.name}</p>
          <span>{chat.phone}</span>
        </Box>
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

      {/* ── Input bar ── */}
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
