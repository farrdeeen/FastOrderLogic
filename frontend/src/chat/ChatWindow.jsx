// src/chat/ChatWindow.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import {
  ArrowLeft,
  Bookmark,
  Download,
  FileText,
  Film,
  FolderOpen,
  ImagePlus,
  IndianRupee,
  Music,
  MoreVertical,
  Paperclip,
  Package,
  QrCode,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  createSavedReply,
  deleteSavedReply,
  fetchSavedReplies,
  fetchMessages,
  refineChatMessage,
  searchChatProducts,
  sendChatMessage,
  sendChatPaymentRequest,
  sendChatProduct,
  sendSavedReply,
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

function hostFromUrl(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "Product link";
  }
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

function ProductLinkPreview({ meta }) {
  const link = meta.product_link || meta.link || "";
  if (!link) return null;
  const title = meta.product_name || "Product";
  const price = meta.product_price || "";
  const sku = meta.sku || "";
  const stock = meta.product_in_stock;

  return (
    <Box
      component="a"
      href={link}
      target="_blank"
      rel="noreferrer"
      sx={{
        display: "grid",
        gridTemplateColumns: "42px 1fr",
        gap: "9px",
        width: "min(320px, 100%)",
        padding: "9px",
        marginTop: "6px",
        borderRadius: "8px",
        background: "rgba(255,255,255,0.72)",
        border: `1px solid ${WA.borderMid}`,
        color: WA.textPrimary,
        textDecoration: "none",
        boxSizing: "border-box",
      }}
    >
      <Box
        sx={{
          width: 42,
          height: 42,
          borderRadius: "8px",
          background: `${WA.greenDark}12`,
          border: `1px solid ${WA.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: WA.greenDark,
        }}
      >
        <Package size={19} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 700,
            color: WA.textPrimary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            fontSize: 12,
            color: WA.textSub,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {[sku, price, stock === true ? "In stock" : stock === false ? "Out of stock" : ""]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
        <Typography
          sx={{
            fontSize: 11,
            color: WA.greenDark,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            mt: "2px",
          }}
        >
          {hostFromUrl(link)}
        </Typography>
      </Box>
    </Box>
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

// ── Saved replies ────────────────────────────────────────────────────────────
function SavedRepliesPanel({
  replies,
  title,
  message,
  file,
  saving,
  sendingReplyId,
  onTitleChange,
  onMessageChange,
  onPickFile,
  onClearFile,
  onSave,
  onInsert,
  onSend,
  onDelete,
  onClose,
}) {
  const canSave = Boolean(title.trim() && (message.trim() || file));

  return (
    <Box
      sx={{
        background: "#fff",
        borderTop: `1px solid ${WA.border}`,
        boxShadow: "0 -8px 24px rgba(17,27,33,0.08)",
        zIndex: 3,
        flexShrink: 0,
        "@media (max-width: 768px)": {
          borderRadius: "16px 16px 0 0",
          overflow: "hidden",
          maxHeight: "58dvh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: `1px solid ${WA.border}`,
        }}
      >
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: WA.textPrimary }}>
          Saved replies
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={onClose}
          aria-label="Close saved replies"
          sx={{ ...chatStyles.iconCircleBtn, width: 32, height: 32 }}
        >
          <X size={17} />
        </Box>
      </Box>

      <Box
        sx={{
          maxHeight: "230px",
          overflowY: "auto",
          padding: replies.length ? "6px 8px" : "12px",
          borderBottom: `1px solid ${WA.border}`,
          "@media (max-width: 768px)": {
            maxHeight: "30dvh",
            flex: "1 1 auto",
            padding: replies.length ? "6px" : "12px",
          },
        }}
      >
        {replies.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: WA.textSub }}>
            No saved replies yet.
          </Typography>
        ) : (
          replies.map((reply) => {
            const mediaUrl = resolveMediaUrl(reply.media_url);
            const isSending = Number(sendingReplyId) === Number(reply.id);
            return (
              <Box
                key={reply.id}
                sx={{
                  display: "grid",
                  gridTemplateColumns: mediaUrl ? "44px 1fr auto" : "1fr auto",
                  gap: "10px",
                  alignItems: "center",
                  padding: "8px",
                  borderRadius: "8px",
                  "&:hover": { background: WA.bgHeader },
                  "@media (max-width: 520px)": {
                    gridTemplateColumns: mediaUrl ? "40px minmax(0, 1fr) auto" : "minmax(0, 1fr) auto",
                    gap: "8px",
                  },
                }}
              >
                {mediaUrl && (
                  <Box
                    component="img"
                    src={mediaUrl}
                    alt={reply.title}
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: "6px",
                      objectFit: "cover",
                      border: `1px solid ${WA.border}`,
                    }}
                  />
                )}
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: WA.textPrimary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {reply.title}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 12,
                      color: WA.textSub,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {reply.message || (mediaUrl ? "Photo reply" : "")}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    justifyContent: "flex-end",
                    "@media (max-width: 520px)": {
                      gridColumn: "auto",
                      justifyContent: "flex-end",
                    },
                  }}
                >
                  <Box
                    component="button"
                    type="button"
                    onClick={() => (mediaUrl ? onSend(reply) : onInsert(reply))}
                    disabled={mediaUrl ? isSending : !reply.message}
                    sx={{
                      border: `1px solid ${WA.borderMid}`,
                      background: "#fff",
                      color: WA.textPrimary,
                      borderRadius: "16px",
                      height: 30,
                      padding: "0 11px",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: mediaUrl || reply.message ? "pointer" : "not-allowed",
                      opacity: mediaUrl || reply.message ? 1 : 0.45,
                    }}
                  >
                    {mediaUrl ? "Send" : "Use"}
                  </Box>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => onSend(reply)}
                    disabled={isSending}
                    title="Send saved reply"
                    aria-label="Send saved reply"
                    sx={{
                      ...chatStyles.iconCircleBtn,
                      width: 32,
                      height: 32,
                      color: WA.greenDark,
                      opacity: isSending ? 0.55 : 1,
                    }}
                  >
                    <Send size={15} />
                  </Box>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => onDelete(reply)}
                    title="Delete saved reply"
                    aria-label="Delete saved reply"
                    sx={{
                      ...chatStyles.iconCircleBtn,
                      width: 32,
                      height: 32,
                      color: "#C62828",
                    }}
                  >
                    <Trash2 size={15} />
                  </Box>
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "180px 1fr auto",
          gap: "8px",
          alignItems: "end",
          padding: "10px 12px",
          background: WA.bgHeader,
          "@media (max-width: 768px)": {
            gridTemplateColumns: "1fr",
            gap: "7px",
            padding: "9px 10px max(9px, env(safe-area-inset-bottom, 9px))",
          },
        }}
      >
        <Box
          component="input"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Reply title"
          spellCheck
          lang="en-IN"
          sx={{
            width: "100%",
            border: `1px solid ${WA.borderMid}`,
            borderRadius: "8px",
            padding: "9px 10px",
            font: "inherit",
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <Box
          component="textarea"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Saved message"
          rows={1}
          spellCheck
          lang="en-IN"
          autoCorrect="on"
          autoCapitalize="sentences"
          sx={{
            width: "100%",
            minHeight: 38,
            maxHeight: 84,
            border: `1px solid ${WA.borderMid}`,
            borderRadius: "8px",
            padding: "8px 10px",
            font: "inherit",
            fontSize: 13,
            lineHeight: 1.35,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
            "@media (max-width: 768px)": {
              justifyContent: "space-between",
            },
          }}
        >
          {file && (
            <Typography
              sx={{
                maxWidth: 150,
                fontSize: 11,
                color: WA.textSub,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                "@media (max-width: 768px)": {
                  maxWidth: "calc(100vw - 170px)",
                },
              }}
              title={file.name}
            >
              {file.name}
            </Typography>
          )}
          {file && (
            <Box
              component="button"
              type="button"
              onClick={onClearFile}
              aria-label="Remove saved reply photo"
              sx={{ ...chatStyles.iconCircleBtn, width: 32, height: 32 }}
            >
              <X size={15} />
            </Box>
          )}
          <Box
            component="button"
            type="button"
            onClick={onPickFile}
            aria-label="Attach saved reply photo"
            title="Attach saved reply photo"
            sx={{ ...chatStyles.iconCircleBtn, width: 36, height: 36 }}
          >
            <ImagePlus size={17} />
          </Box>
          <Box
            component="button"
            type="button"
            onClick={onSave}
            disabled={saving || !canSave}
            aria-label="Save reply"
            title="Save reply"
            sx={{
              ...chatStyles.sendBtn,
              width: 38,
              height: 38,
              opacity: saving || !canSave ? 0.55 : 1,
            }}
          >
            <Save size={16} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function ChatToast({ toast, onClose }) {
  if (!toast) return null;
  const colors =
    toast.type === "error"
      ? { bg: "#FCEBEB", border: "#F2B8B5", text: "#8A1C1C" }
      : { bg: "#E8F5E9", border: "#B8E0C1", text: "#1B5E20" };
  return (
    <Box
      sx={{
        position: "absolute",
        left: "50%",
        bottom: "86px",
        transform: "translateX(-50%)",
        zIndex: 20,
        maxWidth: "min(420px, calc(100% - 28px))",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 12px",
        borderRadius: "8px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
        boxShadow: "0 10px 30px rgba(17,27,33,0.16)",
        fontSize: 13,
        fontWeight: 700,
        "@media (max-width: 768px)": {
          bottom: "132px",
        },
      }}
    >
      <span style={{ flex: 1 }}>{toast.message}</span>
      <Box
        component="button"
        type="button"
        onClick={onClose}
        aria-label="Close notification"
        sx={{
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          padding: 0,
          display: "flex",
        }}
      >
        <X size={15} />
      </Box>
    </Box>
  );
}

function SlashSavedReplyPanel({ query, replies, sendingReplyId, onSend }) {
  const needle = (query || "").trim().toLowerCase();
  const filtered = replies
    .filter((reply) => {
      if (!needle) return true;
      return String(reply.title || "").toLowerCase().includes(needle);
    })
    .slice(0, 6);

  return (
    <Box
      sx={{
        margin: "0 12px 8px",
        background: "#fff",
        border: `1px solid ${WA.border}`,
        borderRadius: "10px",
        boxShadow: "0 12px 32px rgba(17,27,33,0.12)",
        overflow: "hidden",
        zIndex: 4,
        flexShrink: 0,
        "@media (max-width: 768px)": {
          margin: "0 10px 7px",
          borderRadius: "14px",
          maxHeight: "34dvh",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 10px",
          color: WA.textSub,
          fontSize: 12,
          borderBottom: `1px solid ${WA.border}`,
          background: WA.bgHeader,
        }}
      >
        <Search size={14} />
        <span>{needle ? `Saved replies matching "${query}"` : "Saved replies"}</span>
      </Box>
      {filtered.length === 0 ? (
        <Typography sx={{ p: "10px 12px", fontSize: 13, color: WA.textSub }}>
          No saved reply found.
        </Typography>
      ) : (
        filtered.map((reply) => {
          const mediaUrl = resolveMediaUrl(reply.media_url);
          const isSending = Number(sendingReplyId) === Number(reply.id);
          return (
            <Box
              key={reply.id}
              component="button"
              type="button"
              onClick={() => onSend(reply)}
              disabled={isSending}
              sx={{
                width: "100%",
                border: "none",
                borderBottom: `1px solid ${WA.border}`,
                background: "#fff",
                padding: "9px 10px",
                display: "grid",
                gridTemplateColumns: mediaUrl ? "36px 1fr auto" : "1fr auto",
                gap: "9px",
                alignItems: "center",
                textAlign: "left",
                cursor: isSending ? "wait" : "pointer",
                "&:hover": { background: WA.bgHeader },
                "&:last-of-type": { borderBottom: "none" },
              }}
            >
              {mediaUrl && (
                <Box
                  component="img"
                  src={mediaUrl}
                  alt={reply.title}
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: "6px",
                    objectFit: "cover",
                    border: `1px solid ${WA.border}`,
                  }}
                />
              )}
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: WA.textPrimary,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {reply.title}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 12,
                    color: WA.textSub,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {reply.message || (mediaUrl ? "Photo reply" : "")}
                </Typography>
              </Box>
              <Send size={15} color={WA.greenDark} />
            </Box>
          );
        })
      )}
    </Box>
  );
}

function AttachMenu({ onProduct, onPayment, onFile, onClose }) {
  const itemSx = {
    border: `1px solid ${WA.borderMid}`,
    background: WA.bgHeader,
    borderRadius: "10px",
    padding: "12px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    cursor: "pointer",
    color: WA.textPrimary,
    fontWeight: 700,
    fontSize: 13,
    minWidth: 0,
    "@media (max-width: 620px)": {
      flexDirection: "column",
      justifyContent: "center",
      gap: "5px",
      minHeight: 68,
      padding: "9px 6px",
      fontSize: 12,
      lineHeight: 1.15,
    },
  };

  return (
    <Box
      sx={{
        margin: "0 12px 8px",
        background: "#fff",
        border: `1px solid ${WA.border}`,
        borderRadius: "12px",
        boxShadow: "0 12px 32px rgba(17,27,33,0.14)",
        padding: "8px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "8px",
        zIndex: 4,
        flexShrink: 0,
        position: "relative",
        "@media (max-width: 620px)": {
          margin: "0 10px 7px",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "7px",
          padding: "9px 34px 9px 9px",
          borderRadius: "14px",
        },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onProduct}
        sx={itemSx}
      >
        <Package size={18} color={WA.greenDark} />
        Product
      </Box>
      <Box component="button" type="button" onClick={onPayment} sx={itemSx}>
        <QrCode size={18} color={WA.greenDark} />
        Payment
      </Box>
      <Box
        component="button"
        type="button"
        onClick={onFile}
        sx={itemSx}
      >
        <FolderOpen size={18} color={WA.greenDark} />
        File
      </Box>
      <Box
        component="button"
        type="button"
        onClick={onClose}
        aria-label="Close attach menu"
        sx={{
          position: "absolute",
          right: 16,
          top: 10,
          border: "none",
          background: "transparent",
          color: WA.textSub,
          cursor: "pointer",
          display: "flex",
          "@media (max-width: 620px)": {
            right: 8,
            top: 8,
            width: 24,
            height: 24,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            background: WA.bgHeader,
          },
        }}
      >
        <X size={15} />
      </Box>
    </Box>
  );
}

function PaymentRequestPanel({
  amount,
  sending,
  onAmountChange,
  onSend,
  onClose,
}) {
  return (
    <Box
      sx={{
        margin: "0 12px 8px",
        background: "#fff",
        border: `1px solid ${WA.border}`,
        borderRadius: "12px",
        boxShadow: "0 12px 32px rgba(17,27,33,0.14)",
        overflow: "hidden",
        zIndex: 4,
        flexShrink: 0,
        "@media (max-width: 768px)": {
          margin: "0 10px 7px",
          borderRadius: "14px",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 12px",
          borderBottom: `1px solid ${WA.border}`,
          background: WA.bgHeader,
        }}
      >
        <QrCode size={17} color={WA.greenDark} />
        <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 700, color: WA.textPrimary }}>
          Razorpay payment
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={onClose}
          aria-label="Close payment request"
          sx={{ ...chatStyles.iconCircleBtn, width: 32, height: 32 }}
        >
          <X size={16} />
        </Box>
      </Box>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "8px",
          padding: "12px",
          alignItems: "center",
          "@media (max-width: 520px)": { gridTemplateColumns: "1fr" },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: `1px solid ${WA.borderMid}`,
            borderRadius: "10px",
            padding: "0 10px",
            background: "#fff",
            minHeight: 42,
          }}
        >
          <IndianRupee size={16} color={WA.textSub} />
          <Box
            component="input"
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder="Enter amount"
            sx={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              font: "inherit",
              fontSize: 15,
              color: WA.textPrimary,
            }}
          />
        </Box>
        <Box
          component="button"
          type="button"
          onClick={onSend}
          disabled={sending || !Number(amount)}
          sx={{
            ...chatStyles.sendBtn,
            borderRadius: "10px",
            width: "auto",
            minWidth: 104,
            height: 42,
            gap: "7px",
            padding: "0 14px",
            opacity: sending || !Number(amount) ? 0.55 : 1,
          }}
        >
          <Send size={16} />
          Send
        </Box>
      </Box>
    </Box>
  );
}

function ProductPickerPanel({
  query,
  products,
  loading,
  sendingProductKey,
  onQueryChange,
  onSendProduct,
  onClose,
}) {
  return (
    <Box
      sx={{
        margin: "0 12px 8px",
        background: "#fff",
        border: `1px solid ${WA.border}`,
        borderRadius: "12px",
        boxShadow: "0 12px 32px rgba(17,27,33,0.14)",
        overflow: "hidden",
        zIndex: 4,
        flexShrink: 0,
        "@media (max-width: 768px)": {
          margin: "0 10px 7px",
          borderRadius: "14px",
          maxHeight: "46dvh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "9px 10px",
          borderBottom: `1px solid ${WA.border}`,
          background: WA.bgHeader,
        }}
      >
        <Search size={16} color={WA.textSub} />
        <Box
          component="input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus
          placeholder="Search product or SKU"
          sx={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            font: "inherit",
            fontSize: 14,
            color: WA.textPrimary,
            minWidth: 0,
          }}
        />
        <Box
          component="button"
          type="button"
          onClick={onClose}
          aria-label="Close product picker"
          sx={{ ...chatStyles.iconCircleBtn, width: 32, height: 32 }}
        >
          <X size={16} />
        </Box>
      </Box>
      <Box
        sx={{
          maxHeight: "280px",
          overflowY: "auto",
          "@media (max-width: 768px)": {
            maxHeight: "36dvh",
            flex: "1 1 auto",
          },
        }}
      >
        {loading ? (
          <Typography sx={{ p: "12px", fontSize: 13, color: WA.textSub }}>
            Loading products…
          </Typography>
        ) : products.length === 0 ? (
          <Typography sx={{ p: "12px", fontSize: 13, color: WA.textSub }}>
            No products found.
          </Typography>
        ) : (
          products.map((product) => {
            const key = product.sku || product.id || product.name;
            const imageUrl = resolveMediaUrl(product.image_url);
            const isSending = String(sendingProductKey) === String(key);
            return (
              <Box
                key={key}
                component="button"
                type="button"
                onClick={() => onSendProduct(product)}
                disabled={isSending}
                sx={{
                  width: "100%",
                  border: "none",
                  borderBottom: `1px solid ${WA.border}`,
                  background: "#fff",
                  padding: "9px 10px",
                  display: "grid",
                  gridTemplateColumns: imageUrl ? "42px 1fr auto" : "1fr auto",
                  gap: "10px",
                  alignItems: "center",
                  textAlign: "left",
                  cursor: isSending ? "wait" : "pointer",
                  "&:hover": { background: WA.bgHeader },
                }}
              >
                {imageUrl && (
                  <Box
                    component="img"
                    src={imageUrl}
                    alt={product.name}
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: "7px",
                      objectFit: "cover",
                      border: `1px solid ${WA.border}`,
                    }}
                  />
                )}
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: WA.textPrimary,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {product.name}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 12,
                      color: WA.textSub,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {product.sku || "No SKU"} · {product.price_display || "Price unavailable"}
                  </Typography>
                </Box>
                <Send size={15} color={WA.greenDark} />
              </Box>
            );
          })
        )}
      </Box>
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
  const hasProductLinkPreview =
    meta.flow === "operator_product_share" &&
    meta.product_link &&
    !hasMedia;
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
          gap: hasMedia || hasProductLinkPreview ? "8px" : 0,
          padding:
            hasMedia || hasProductLinkPreview
              ? "6px"
              : chatStyles.bubble(sender).padding,
        }}
      >
        {showText && (
          <span style={{ padding: hasMedia || hasProductLinkPreview ? "2px 4px" : 0 }}>
            {msg.message}
          </span>
        )}
        {hasMedia && <MediaAttachment meta={meta} onPreview={onPreview} />}
        {hasProductLinkPreview && <ProductLinkPreview meta={meta} />}
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
  const [savedReplies, setSavedReplies] = useState([]);
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false);
  const [savedRepliesLoaded, setSavedRepliesLoaded] = useState(false);
  const [savedReplyTitle, setSavedReplyTitle] = useState("");
  const [savedReplyMessage, setSavedReplyMessage] = useState("");
  const [savedReplyFile, setSavedReplyFile] = useState(null);
  const [savingReply, setSavingReply] = useState(false);
  const [sendingSavedReplyId, setSendingSavedReplyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState([]);
  const [productLoading, setProductLoading] = useState(false);
  const [sendingProductKey, setSendingProductKey] = useState(null);
  const [paymentPanelOpen, setPaymentPanelOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [sendingPayment, setSendingPayment] = useState(false);
  const [refiningInput, setRefiningInput] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const savedReplyFileInputRef = useRef(null);
  const toastTimerRef = useRef(null);

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

  const showToast = useCallback((message, type = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
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

  const loadSavedReplies = useCallback(async () => {
    try {
      const data = await fetchSavedReplies();
      setSavedReplies(data);
      setSavedRepliesLoaded(true);
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load saved replies.");
    }
  }, []);

  useEffect(() => {
    if (savedRepliesOpen && !savedRepliesLoaded) loadSavedReplies();
  }, [savedRepliesOpen, savedRepliesLoaded, loadSavedReplies]);

  const slashActive = input.startsWith("/");
  const slashQuery = slashActive ? input.slice(1).trim() : "";

  useEffect(() => {
    if (slashActive && !savedRepliesLoaded) loadSavedReplies();
  }, [slashActive, savedRepliesLoaded, loadSavedReplies]);

  useEffect(() => {
    if (!productPickerOpen) return undefined;
    let cancelled = false;
    setProductLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await searchChatProducts(productQuery.trim());
        if (!cancelled) setProductResults(data);
      } catch (err) {
        if (!cancelled) {
          setProductResults([]);
          setError(err?.response?.data?.detail || "Failed to load products.");
        }
      } finally {
        if (!cancelled) setProductLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productPickerOpen, productQuery]);

  useEffect(() => {
    if (!chat?.id) return;
    window.__folActiveChatId = chat.id;
    setMessages([]);
    setError("");
    setInput("");
    setAttachMenuOpen(false);
    setProductPickerOpen(false);
    setPaymentPanelOpen(false);
    setSavedRepliesOpen(false);
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
    if (msg.startsWith("/")) {
      const needle = msg.slice(1).trim().toLowerCase();
      const match = savedReplies
        .filter((reply) => {
          if (!needle) return true;
          return String(reply.title || "").toLowerCase().includes(needle);
        })
        .slice(0, 1)[0];
      if (match) {
        await handleSendSavedReply(match, { clearInput: true });
      } else {
        showToast("No saved reply found for that title.", "error");
      }
      return;
    }
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
      showToast("Failed to send message.", "error");
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
        setError("File saved in chat, but WhatsApp send may have failed.");
        showToast("File saved, but WhatsApp send may have failed.", "error");
      } else {
        showToast("File sent.");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to upload file.";
      setError(detail);
      showToast(detail, "error");
    } finally {
      setUploading(false);
    }
  };

  const openProductPicker = () => {
    setAttachMenuOpen(false);
    setPaymentPanelOpen(false);
    setProductPickerOpen(true);
    setSavedRepliesOpen(false);
    setProductQuery("");
  };

  const openPaymentPanel = () => {
    setAttachMenuOpen(false);
    setProductPickerOpen(false);
    setSavedRepliesOpen(false);
    setPaymentPanelOpen(true);
  };

  const handleToggleSavedReplies = () => {
    setAttachMenuOpen(false);
    setProductPickerOpen(false);
    setPaymentPanelOpen(false);
    setSavedRepliesOpen((open) => {
      const next = !open;
      if (next && input.trim() && !savedReplyMessage.trim()) {
        setSavedReplyMessage(input.trim());
      }
      return next;
    });
  };

  const handleSavedReplyFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Saved reply media must be a photo.");
      return;
    }
    setSavedReplyFile(file);
  };

  const handleSaveSavedReply = async () => {
    const title = savedReplyTitle.trim();
    const message = savedReplyMessage.trim();
    if (!title) {
      setError("Saved reply title is required.");
      return;
    }
    if (!message && !savedReplyFile) {
      setError("Add a saved message or photo.");
      return;
    }
    setSavingReply(true);
    setError(null);
    try {
      const created = await createSavedReply({
        title,
        message,
        file: savedReplyFile,
      });
      setSavedReplies((prev) =>
        [...prev, created].sort((a, b) =>
          String(a.title || "").localeCompare(String(b.title || "")),
        ),
      );
      setSavedRepliesLoaded(true);
      setSavedReplyTitle("");
      setSavedReplyMessage("");
      setSavedReplyFile(null);
      showToast("Saved reply created.");
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to save reply.";
      setError(detail);
      showToast(detail, "error");
    } finally {
      setSavingReply(false);
    }
  };

  const handleInsertSavedReply = (reply) => {
    if (!reply?.message) return;
    setInput(reply.message);
    setSavedRepliesOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = "22px";
        textareaRef.current.style.height =
          Math.min(textareaRef.current.scrollHeight, 120) + "px";
      }
    });
  };

  const handleSendSavedReply = async (reply, options = {}) => {
    if (!reply?.id || !chat?.id || sendingSavedReplyId) return;
    setSendingSavedReplyId(reply.id);
    setError(null);
    try {
      const result = await sendSavedReply(chat.id, reply.id);
      await loadMessages(chat.id, false);
      setSavedRepliesOpen(false);
      if (options.clearInput) setInput("");
      if (textareaRef.current && options.clearInput) textareaRef.current.style.height = "22px";
      if (!result?.success) {
        setError("Saved reply logged, but WhatsApp send failed.");
        showToast("Saved reply logged, but WhatsApp send failed.", "error");
      } else {
        showToast("Saved reply sent.");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to send saved reply.";
      setError(detail);
      showToast(detail, "error");
    } finally {
      setSendingSavedReplyId(null);
    }
  };

  const handleDeleteSavedReply = async (reply) => {
    if (!reply?.id) return;
    const ok = window.confirm(`Delete saved reply "${reply.title}"?`);
    if (!ok) return;
    try {
      await deleteSavedReply(reply.id);
      setSavedReplies((prev) => prev.filter((item) => item.id !== reply.id));
      showToast("Saved reply deleted.");
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to delete saved reply.";
      setError(detail);
      showToast(detail, "error");
    }
  };

  const handleSendProduct = async (product) => {
    if (!chat?.id || !product || sendingProductKey) return;
    const key = product.sku || product.id || product.name;
    setSendingProductKey(key);
    setError(null);
    try {
      const result = await sendChatProduct(chat.id, product);
      await loadMessages(chat.id, false);
      setProductPickerOpen(false);
      if (!result?.success) {
        setError("Product saved in chat, but WhatsApp send failed.");
        showToast("Product saved in chat, but WhatsApp send failed.", "error");
      } else {
        showToast("Product shared.");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to share product.";
      setError(detail);
      showToast(detail, "error");
    } finally {
      setSendingProductKey(null);
    }
  };

  const handleSendPaymentRequest = async () => {
    const amount = Number(paymentAmount);
    if (!chat?.id || sendingPayment || !amount || amount <= 0) return;
    setSendingPayment(true);
    setError(null);
    try {
      const result = await sendChatPaymentRequest(chat.id, amount);
      await loadMessages(chat.id, false);
      setPaymentPanelOpen(false);
      setPaymentAmount("");
      if (!result?.success) {
        const detail = result?.errors?.join(", ") || "Payment request saved, but WhatsApp send failed.";
        setError(detail);
        showToast(detail, "error");
      } else {
        showToast("Payment link and QR sent.");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to send payment request.";
      setError(detail);
      showToast(detail, "error");
    } finally {
      setSendingPayment(false);
    }
  };

  const handleRefineInput = async () => {
    const draft = input.trim();
    if (!draft || refiningInput) return;
    setRefiningInput(true);
    setError(null);
    try {
      const result = await refineChatMessage(draft);
      const refined = (result?.message || "").trim();
      if (refined) {
        setInput(refined);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = "22px";
            textareaRef.current.style.height =
              Math.min(textareaRef.current.scrollHeight, 120) + "px";
            textareaRef.current.focus();
          }
        });
        showToast("Message refined.");
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || "AI refine failed.";
      setError(detail);
      showToast(detail, "error");
    } finally {
      setRefiningInput(false);
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
        position: "relative",
      }}
    >
      <ImagePreview
        media={mediaPreview}
        onClose={() => setMediaPreview(null)}
      />
      <ChatToast toast={toast} onClose={() => setToast(null)} />

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

      {savedRepliesOpen && (
        <SavedRepliesPanel
          replies={savedReplies}
          title={savedReplyTitle}
          message={savedReplyMessage}
          file={savedReplyFile}
          saving={savingReply}
          sendingReplyId={sendingSavedReplyId}
          onTitleChange={setSavedReplyTitle}
          onMessageChange={setSavedReplyMessage}
          onPickFile={() => savedReplyFileInputRef.current?.click()}
          onClearFile={() => setSavedReplyFile(null)}
          onSave={handleSaveSavedReply}
          onInsert={handleInsertSavedReply}
          onSend={handleSendSavedReply}
          onDelete={handleDeleteSavedReply}
          onClose={() => setSavedRepliesOpen(false)}
        />
      )}

      {slashActive && (
        <SlashSavedReplyPanel
          query={slashQuery}
          replies={savedReplies}
          sendingReplyId={sendingSavedReplyId}
          onSend={(reply) => handleSendSavedReply(reply, { clearInput: true })}
        />
      )}

      {productPickerOpen && (
        <ProductPickerPanel
          query={productQuery}
          products={productResults}
          loading={productLoading}
          sendingProductKey={sendingProductKey}
          onQueryChange={setProductQuery}
          onSendProduct={handleSendProduct}
          onClose={() => setProductPickerOpen(false)}
        />
      )}

      {paymentPanelOpen && (
        <PaymentRequestPanel
          amount={paymentAmount}
          sending={sendingPayment}
          onAmountChange={setPaymentAmount}
          onSend={handleSendPaymentRequest}
          onClose={() => setPaymentPanelOpen(false)}
        />
      )}

      {attachMenuOpen && (
        <AttachMenu
          onProduct={openProductPicker}
          onPayment={openPaymentPanel}
          onFile={() => {
            setAttachMenuOpen(false);
            fileInputRef.current?.click();
          }}
          onClose={() => setAttachMenuOpen(false)}
        />
      )}

      {/* ── Input bar ── */}
      <Box sx={chatStyles.inputArea}>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <input
          ref={savedReplyFileInputRef}
          type="file"
          accept="image/*"
          onChange={handleSavedReplyFileChange}
          style={{ display: "none" }}
        />
        <Box sx={chatStyles.composerTools}>
          <Box
            component="button"
            type="button"
            onClick={handleToggleSavedReplies}
            disabled={uploading || sending}
            aria-label="Saved replies"
            title="Saved replies"
            sx={{
              ...chatStyles.iconCircleBtn,
              ...chatStyles.composerToolBtn,
              background: savedRepliesOpen ? WA.border : "transparent",
            }}
          >
            <Bookmark size={18} strokeWidth={2.2} />
          </Box>
          <Box
            component="button"
            type="button"
            onClick={() => {
              setAttachMenuOpen((open) => !open);
              setProductPickerOpen(false);
              setPaymentPanelOpen(false);
            }}
            disabled={uploading || sending}
            aria-label="Attach"
            title="Attach"
            sx={{
              ...chatStyles.iconCircleBtn,
              ...chatStyles.composerToolBtn,
              background: attachMenuOpen ? WA.border : "transparent",
              opacity: uploading ? 0.55 : 1,
              cursor: uploading ? "not-allowed" : "pointer",
            }}
          >
            <Paperclip size={19} strokeWidth={2.2} />
          </Box>
        </Box>
        <Box sx={chatStyles.composerMain}>
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
              spellCheck
              lang="en-IN"
              autoCorrect="on"
              autoCapitalize="sentences"
              inputMode="text"
              sx={chatStyles.textarea}
            />
            <Box
              component="button"
              type="button"
              onClick={handleRefineInput}
              disabled={refiningInput || sending || uploading || !input.trim()}
              aria-label="Refine with AI"
              title="Refine with AI"
              sx={chatStyles.refineBtn(
                refiningInput,
                sending || uploading || !input.trim(),
              )}
            >
              <Sparkles size={17} />
            </Box>
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
    </Box>
  );
}
