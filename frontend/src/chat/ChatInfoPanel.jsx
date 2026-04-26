// src/chat/ChatInfoPanel.jsx
import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { resolveSession } from "./chatApi";
import { chatStyles, FLAG_ACTIONS, QUICK_REPLIES, avatarColor } from "./styles";

// ── Small helper row ──────────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  return (
    <Box sx={chatStyles.infoRow}>
      <span>{label}</span>
      <span>{value}</span>
    </Box>
  );
}

// ── Panel label ───────────────────────────────────────────────────────────────
function PanelLabel({ children }) {
  return (
    <Typography component="span" sx={chatStyles.panelLabel}>
      {children}
    </Typography>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChatInfoPanel({
  chat,
  onResolved,
  onQuickReply,
  onFlagChange,
}) {
  const [resolving, setResolving] = useState(false);
  const [activeFlag, setActiveFlag] = useState(null);

  // Keep local flag state in sync when chat changes
  const currentFlag = activeFlag ?? chat?.flag ?? null;
  const isResolved = currentFlag === "resolved" || chat?.status === "resolved";

  if (!chat) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-tertiary)",
          fontSize: 12,
        }}
      >
        No user selected
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

  const handleResolve = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      await resolveSession(chat.id);
      setActiveFlag("resolved");
      if (onResolved) onResolved(chat.id);
    } catch {
      // silent — let user retry
    } finally {
      setResolving(false);
    }
  };

  const handleFlag = (flagId) => {
    const next = currentFlag === flagId ? null : flagId;
    setActiveFlag(next);
    if (onFlagChange) onFlagChange(chat.id, next);
    if (flagId === "resolved" && next === "resolved") handleResolve();
  };

  const handleQuickReply = (reply) => {
    const text = reply.template({
      customerName: chat.name,
      orderId: chat.linked_order_id || "—",
      address: chat.lastMsg || "—",
      awb: "—",
      invoiceNumber: "—",
      amount: "—",
    });
    if (onQuickReply) {
      onQuickReply(text);
    }
  };

  return (
    <Box sx={{ ...chatStyles.panel, height: "100%" }}>
      {/* ── Customer info ── */}
      <Box sx={chatStyles.panelSection}>
        {/* Avatar + name */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            mb: "12px",
          }}
        >
          <Box
            sx={{
              ...chatStyles.avatar(bg, textColor, 44),
              mb: "8px",
              fontSize: 15,
            }}
          >
            {initials}
          </Box>
          <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
            {chat.name}
          </Typography>
          <Typography
            sx={{ fontSize: 11, color: "var(--color-text-tertiary)" }}
          >
            {chat.phone}
          </Typography>
        </Box>

        <PanelLabel>Details</PanelLabel>
        <InfoRow
          label="Status"
          value={
            <span
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 20,
                fontWeight: 500,
                background:
                  chat.status === "active"
                    ? "#EAF3DE"
                    : chat.status === "waiting"
                      ? "#FAEEDA"
                      : "var(--color-background-secondary)",
                color:
                  chat.status === "active"
                    ? "#27500A"
                    : chat.status === "waiting"
                      ? "#633806"
                      : "var(--color-text-tertiary)",
              }}
            >
              {chat.status || "active"}
            </span>
          }
        />
        <InfoRow
          label="Last message"
          value={
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              {chat.lastTime
                ? new Date(chat.lastTime).toLocaleString([], {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
          }
        />
        {chat.unread > 0 && (
          <InfoRow
            label="Unread"
            value={
              <span style={{ ...chatStyles.badge("new") }}>{chat.unread}</span>
            }
          />
        )}
      </Box>

      {/* ── Linked order ── */}
      {chat.linked_order_id && (
        <Box sx={chatStyles.panelSection}>
          <PanelLabel>Linked order</PanelLabel>
          <Box sx={chatStyles.orderCard}>
            <p>
              <strong>#{chat.linked_order_id}</strong>
            </p>
            <p>{chat.order_status || "pending"}</p>
          </Box>
        </Box>
      )}

      {/* ── Last message preview ── */}
      {chat.lastMsg && (
        <Box sx={chatStyles.panelSection}>
          <PanelLabel>Last message</PanelLabel>
          <Typography
            sx={{
              fontSize: 11,
              color: "var(--color-text-secondary)",
              background: "var(--color-background-secondary)",
              borderRadius: "var(--border-radius-md)",
              p: "8px",
              border: "0.5px solid var(--color-border-tertiary)",
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {chat.lastMsg}
          </Typography>
        </Box>
      )}

      {/* ── Flag this chat ── */}
      <Box sx={chatStyles.panelSection}>
        <PanelLabel>Flag this chat</PanelLabel>
        {FLAG_ACTIONS.map((action) => {
          const isActive = currentFlag === action.id;
          return (
            <button
              key={action.id}
              onClick={() => handleFlag(action.id)}
              style={chatStyles.flagBtn(action.type, isActive)}
              disabled={action.id === "resolved" && isResolved && resolving}
            >
              {action.id === "resolved" && resolving
                ? "Resolving…"
                : action.label}
            </button>
          );
        })}
      </Box>

      {/* ── Quick replies ── */}
      <Box sx={chatStyles.panelSection}>
        <PanelLabel>Quick replies</PanelLabel>
        <Box sx={chatStyles.quickActions}>
          {QUICK_REPLIES.map((reply) => (
            <button
              key={reply.id}
              onClick={() => handleQuickReply(reply)}
              style={chatStyles.quickActionBtn}
            >
              {reply.label}
            </button>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
