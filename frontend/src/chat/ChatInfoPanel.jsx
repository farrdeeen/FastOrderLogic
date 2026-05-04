// src/chat/ChatInfoPanel.jsx
import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { resolveSession, sendOrderConfirmation } from "./chatApi";
import { chatStyles, FLAG_ACTIONS, QUICK_REPLIES, avatarColor } from "./styles";
import HumanTogglePanel from "./HumanTogglePanel";

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

// ── Order Confirmation Modal ──────────────────────────────────────────────────
function OrderConfirmModal({ chat, onClose, onSent }) {
  const [orderId, setOrderId] = useState(chat.linked_order_id || "");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const handleSend = async () => {
    if (!orderId.trim() || !amount.trim()) {
      setError("Order ID and amount are required.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendOrderConfirmation({
        phone: chat.phone,
        customerName: chat.name,
        orderId: orderId.trim(),
        amount: amount.trim(),
        sessionId: chat.id,
      });
      onSent();
      onClose();
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          "Failed to send. Check phone number and template approval.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 1300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <Box
        sx={{
          background: "var(--color-background-primary)",
          borderRadius: "var(--border-radius-lg)",
          border: "0.5px solid var(--color-border-secondary)",
          padding: "20px",
          width: 300,
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
          Send order confirmation
        </Typography>

        <Typography sx={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
          Sends the approved <strong>order_confirmation</strong> WhatsApp
          template to <strong>{chat.name}</strong> ({chat.phone}).
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
            Order ID
          </label>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="e.g. ORD-1001"
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 6,
              border: "0.5px solid var(--color-border-secondary)",
              background: "var(--color-background-secondary)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
            Amount
          </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. ₹999"
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 6,
              border: "0.5px solid var(--color-border-secondary)",
              background: "var(--color-background-secondary)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
        </Box>

        {error && (
          <Typography
            sx={{ fontSize: 11, color: "var(--color-text-danger, #c0392b)" }}
          >
            {error}
          </Typography>
        )}

        <Box sx={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 6,
              border: "0.5px solid var(--color-border-secondary)",
              background: "transparent",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            style={{
              fontSize: 12,
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              background: sending
                ? "var(--color-border-secondary)"
                : "var(--color-text-info, #1a73e8)",
              color: "#fff",
              cursor: sending ? "not-allowed" : "pointer",
              opacity: sending ? 0.7 : 1,
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </Box>
      </Box>
    </Box>
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
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderSentFor, setOrderSentFor] = useState(null); // session id of last sent

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

  const alreadySentThisSession = orderSentFor === chat.id;

  return (
    <Box sx={{ ...chatStyles.panel, height: "100%" }}>
      {/* ── Order Confirmation Modal ── */}
      {showOrderModal && (
        <OrderConfirmModal
          chat={chat}
          onClose={() => setShowOrderModal(false)}
          onSent={() => setOrderSentFor(chat.id)}
        />
      )}

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

      {/* ── WhatsApp actions ── */}
      <Box sx={chatStyles.panelSection}>
        <PanelLabel>WhatsApp actions</PanelLabel>
        <button
          onClick={() => setShowOrderModal(true)}
          disabled={alreadySentThisSession}
          style={{
            width: "100%",
            fontSize: 12,
            padding: "7px 12px",
            borderRadius: 6,
            border: "0.5px solid var(--color-border-secondary)",
            background: alreadySentThisSession
              ? "var(--color-background-secondary)"
              : "var(--color-background-primary)",
            color: alreadySentThisSession
              ? "var(--color-text-tertiary)"
              : "var(--color-text-primary)",
            cursor: alreadySentThisSession ? "default" : "pointer",
            textAlign: "left",
            marginBottom: "6px",
          }}
        >
          {alreadySentThisSession
            ? "✓ Order confirmation sent"
            : "📦 Send order confirmation"}
        </button>
      </Box>
      {/* ── Human / AI Mode Toggle ── */}
      <Box sx={chatStyles.panelSection}>
        <HumanTogglePanel
          chat={chat}
          onModeChange={(sessionId, isHuman) => {
            // Optionally propagate up for list badge updates
            if (onFlagChange) onFlagChange(sessionId, isHuman ? "human" : null);
          }}
        />
      </Box>

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
