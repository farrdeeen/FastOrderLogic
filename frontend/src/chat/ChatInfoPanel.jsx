// src/chat/ChatInfoPanel.jsx
// Renders as a slide-over panel (inside the chat column) triggered by
// clicking the avatar / name in ChatWindow header.
// Business logic (sendOrderConfirmation, resolveSession, HumanTogglePanel) unchanged.

import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { X, ChevronRight, Package, Flag, Zap, Truck } from "lucide-react";
import { resolveSession, sendDispatchSlip, sendOrderConfirmation } from "./chatApi";
import {
  chatStyles,
  FLAG_ACTIONS,
  QUICK_REPLIES,
  avatarColor,
  WA,
} from "./styles";
import HumanTogglePanel from "./HumanTogglePanel";

// ── Small helpers ─────────────────────────────────────────────────────────────
function InfoRow({ label, value }) {
  return (
    <Box sx={chatStyles.infoRow}>
      <span>{label}</span>
      <span>{value}</span>
    </Box>
  );
}

function SectionLabel({ children }) {
  return (
    <Typography component="span" sx={chatStyles.infoPanelLabel}>
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

  const inputStyle = {
    width: "100%",
    fontSize: "14px",
    padding: "9px 12px",
    borderRadius: "8px",
    border: `1px solid ${WA.borderMid}`,
    background: WA.bgHeader,
    color: WA.textPrimary,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

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
      setError(err?.response?.data?.detail || "Failed to send template.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Box
      onClick={onClose}
      sx={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          background: "#fff",
          borderRadius: "12px",
          padding: "20px",
          width: "100%",
          maxWidth: "340px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography
            sx={{ fontSize: 15, fontWeight: 600, color: WA.textPrimary }}
          >
            Send Order Confirmation
          </Typography>
          <Box
            component="button"
            type="button"
            onClick={onClose}
            sx={{ ...chatStyles.iconCircleBtn, color: WA.textSub }}
          >
            <X size={16} />
          </Box>
        </Box>

        <Typography sx={{ fontSize: 13, color: WA.textSub }}>
          Sending <strong>order_confirmation</strong> template to{" "}
          <strong>{chat.name}</strong>
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: 12, color: WA.textSub, fontWeight: 500 }}>
            Order ID
          </label>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="e.g. ORD-1001"
            style={inputStyle}
          />
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label style={{ fontSize: 12, color: WA.textSub, fontWeight: 500 }}>
            Amount
          </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. ₹999"
            style={inputStyle}
          />
        </Box>

        {error && (
          <Typography sx={{ fontSize: 12, color: "#E53935" }}>
            {error}
          </Typography>
        )}

        <Box sx={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              fontSize: 13,
              padding: "8px 18px",
              borderRadius: "8px",
              border: `1px solid ${WA.borderMid}`,
              background: "transparent",
              color: WA.textSub,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            style={{
              fontSize: 13,
              padding: "8px 18px",
              borderRadius: "8px",
              border: "none",
              background: sending ? WA.borderMid : WA.greenMid,
              color: "#fff",
              cursor: sending ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              fontWeight: 600,
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
  onClose,
  onResolved,
  onQuickReply,
  onFlagChange,
  onModeChange,
}) {
  const [resolving, setResolving] = useState(false);
  const [activeFlag, setActiveFlag] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderSentFor, setOrderSentFor] = useState(null);
  const [dispatchOrderId, setDispatchOrderId] = useState(chat?.linked_order_id || "");
  const [dispatchSending, setDispatchSending] = useState(false);
  const [dispatchSent, setDispatchSent] = useState(null);
  const [dispatchError, setDispatchError] = useState(null);

  const currentFlag = activeFlag ?? chat?.flag ?? null;
  const isResolved = currentFlag === "resolved" || chat?.status === "resolved";

  useEffect(() => {
    setDispatchOrderId(chat?.linked_order_id || "");
    setDispatchSent(null);
    setDispatchError(null);
  }, [chat?.id, chat?.linked_order_id]);

  if (!chat) {
    return (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: WA.textSub,
          fontSize: 13,
          padding: "24px",
          textAlign: "center",
        }}
      >
        Select a conversation to view details
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
      /* silent */
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
    if (onQuickReply) onQuickReply(text);
  };

  const handleDispatchSlip = async () => {
    const orderId = dispatchOrderId.trim();
    if (!orderId) {
      setDispatchError("Order ID is required.");
      return;
    }
    if (dispatchSending) return;

    setDispatchSending(true);
    setDispatchError(null);
    setDispatchSent(null);
    try {
      const result = await sendDispatchSlip({ sessionId: chat.id, orderId });
      setDispatchSent(result);
    } catch (err) {
      setDispatchError(err?.response?.data?.detail || "Failed to send dispatch update.");
    } finally {
      setDispatchSending(false);
    }
  };

  const alreadySent = orderSentFor === chat.id;
  const dispatchInputStyle = {
    width: "100%",
    fontSize: "13px",
    padding: "9px 12px",
    borderRadius: "8px",
    border: `1px solid ${WA.borderMid}`,
    background: WA.bgHeader,
    color: WA.textPrimary,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
    marginBottom: "6px",
  };

  const statusPillStyle = {
    display: "inline-block",
    fontSize: "11px",
    padding: "2px 10px",
    borderRadius: "12px",
    fontWeight: 600,
    background:
      chat.status === "active"
        ? "#E8F5E9"
        : chat.status === "waiting"
          ? "#FFF8E1"
          : WA.bgHeader,
    color:
      chat.status === "active"
        ? "#2E7D32"
        : chat.status === "waiting"
          ? "#E65100"
          : WA.textSub,
  };

  return (
    <>
      {showOrderModal && (
        <OrderConfirmModal
          chat={chat}
          onClose={() => setShowOrderModal(false)}
          onSent={() => setOrderSentFor(chat.id)}
        />
      )}

      {/* ── Panel header (green bar) ── */}
      <Box sx={chatStyles.infoPanelHeader}>
        <Box
          component="button"
          type="button"
          onClick={onClose}
          aria-label="Close"
          sx={chatStyles.infoPanelCloseBtn}
        >
          <X size={18} strokeWidth={2} />
        </Box>
        <Typography
          sx={{ fontSize: 16, fontWeight: 600, color: "#fff", flex: 1 }}
        >
          Contact Info
        </Typography>
      </Box>

      {/* ── Avatar + name block ── */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "24px 16px 20px",
          borderBottom: `1px solid ${WA.border}`,
          background: WA.bgHeader,
          gap: "8px",
        }}
      >
        <Box
          sx={{
            ...chatStyles.avatar(bg, textColor, 72),
            fontSize: "26px",
            mb: "4px",
          }}
        >
          {initials}
        </Box>
        <Typography
          sx={{ fontSize: 18, fontWeight: 600, color: WA.textPrimary }}
        >
          {chat.name}
        </Typography>
        <Typography sx={{ fontSize: 13, color: WA.textSub }}>
          {chat.phone}
        </Typography>
        <span style={statusPillStyle}>{chat.status || "active"}</span>
      </Box>

      {/* ── Details ── */}
      <Box sx={chatStyles.infoPanelSection}>
        <SectionLabel>Details</SectionLabel>
        <InfoRow
          label="Last message"
          value={
            chat.lastTime
              ? new Date(chat.lastTime).toLocaleString([], {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"
          }
        />
        {chat.unread > 0 && (
          <InfoRow
            label="Unread messages"
            value={
              <span style={{ ...chatStyles.badge("new"), fontSize: 11 }}>
                {chat.unread}
              </span>
            }
          />
        )}
      </Box>

      {/* ── Linked order ── */}
      {chat.linked_order_id && (
        <Box sx={chatStyles.infoPanelSection}>
          <SectionLabel>Linked Order</SectionLabel>
          <Box sx={chatStyles.orderCard}>
            <p
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginBottom: "4px",
              }}
            >
              <Package size={13} />
              <strong>#{chat.linked_order_id}</strong>
            </p>
            <p style={{ margin: 0 }}>{chat.order_status || "pending"}</p>
          </Box>
        </Box>
      )}

      {/* ── WhatsApp actions ── */}
      <Box sx={chatStyles.infoPanelSection}>
        <SectionLabel>WhatsApp Actions</SectionLabel>
        <button
          onClick={() => setShowOrderModal(true)}
          disabled={alreadySent}
          style={{
            ...chatStyles.actionBtn,
            opacity: alreadySent ? 0.6 : 1,
            cursor: alreadySent ? "default" : "pointer",
          }}
        >
          <Package size={15} />
          {alreadySent
            ? "✓ Order confirmation sent"
            : "Send order confirmation"}
          {!alreadySent && (
            <ChevronRight
              size={14}
              style={{ marginLeft: "auto", color: WA.textSub }}
            />
          )}
        </button>
        <input
          value={dispatchOrderId}
          onChange={(e) => {
            setDispatchOrderId(e.target.value);
            setDispatchError(null);
            setDispatchSent(null);
          }}
          placeholder="Order ID for dispatch slip"
          style={dispatchInputStyle}
        />
        <button
          onClick={handleDispatchSlip}
          disabled={dispatchSending || !dispatchOrderId.trim()}
          style={{
            ...chatStyles.actionBtn,
            opacity: dispatchSending || !dispatchOrderId.trim() ? 0.6 : 1,
            cursor: dispatchSending || !dispatchOrderId.trim() ? "not-allowed" : "pointer",
          }}
        >
          <Truck size={15} />
          {dispatchSending ? "Sending tracking + slip…" : "Send tracking + dispatch slip"}
          {!dispatchSending && (
            <ChevronRight
              size={14}
              style={{ marginLeft: "auto", color: WA.textSub }}
            />
          )}
        </button>
        {dispatchSent && (
          <Typography sx={{ fontSize: 12, color: "#2E7D32", mt: "2px" }}>
            Tracking link and PDF added to chat.
          </Typography>
        )}
        {dispatchError && (
          <Typography sx={{ fontSize: 12, color: "#E53935", mt: "2px" }}>
            {dispatchError}
          </Typography>
        )}
      </Box>

      {/* ── AI / Human toggle ── */}
      <Box sx={chatStyles.infoPanelSection}>
        <HumanTogglePanel
          chat={chat}
          onModeChange={(sessionId, isHuman) => {
            if (onModeChange) onModeChange(sessionId, isHuman);
          }}
        />
      </Box>

      {/* ── Flag ── */}
      <Box sx={chatStyles.infoPanelSection}>
        <SectionLabel>
          <Flag
            size={10}
            style={{
              display: "inline",
              marginRight: "4px",
              verticalAlign: "middle",
            }}
          />
          Flag Conversation
        </SectionLabel>
        {FLAG_ACTIONS.map((action) => {
          const isActive = currentFlag === action.id;
          return (
            <button
              key={action.id}
              onClick={() => handleFlag(action.id)}
              disabled={action.id === "resolved" && isResolved && resolving}
              style={chatStyles.flagBtn(action.type, isActive)}
            >
              {action.id === "resolved" && resolving
                ? "Resolving…"
                : action.label}
              {isActive && (
                <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>
              )}
            </button>
          );
        })}
      </Box>

      {/* ── Quick replies ── */}
      <Box sx={chatStyles.infoPanelSection}>
        <SectionLabel>
          <Zap
            size={10}
            style={{
              display: "inline",
              marginRight: "4px",
              verticalAlign: "middle",
            }}
          />
          Quick Replies
        </SectionLabel>
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

      {/* ── Last message preview ── */}
      {chat.lastMsg && (
        <Box sx={{ ...chatStyles.infoPanelSection, borderBottom: "none" }}>
          <SectionLabel>Last Message</SectionLabel>
          <Typography
            sx={{
              fontSize: 13,
              color: WA.textSub,
              background: WA.bgHeader,
              borderRadius: "8px",
              padding: "10px 12px",
              lineHeight: 1.55,
              border: `1px solid ${WA.border}`,
              display: "-webkit-box",
              WebkitLineClamp: 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {chat.lastMsg}
          </Typography>
        </Box>
      )}
    </>
  );
}
