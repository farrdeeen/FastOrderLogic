// src/chat/ChatInfoPanel.jsx
// Renders as a slide-over panel (inside the chat column) triggered by
// clicking the avatar / name in ChatWindow header.
// Business logic (sendOrderConfirmation, resolveSession, HumanTogglePanel) unchanged.

import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { X, ChevronRight, Package, Flag, Truck, Save, ReceiptText } from "lucide-react";
import {
  fetchChatLastOrder,
  resolveSession,
  saveChatContact,
  sendDispatchSlip,
  sendOrderConfirmation,
  updateSessionFlag,
} from "./chatApi";
import { chatStyles, FLAG_ACTIONS, avatarColor, WA } from "./styles";
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

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function formatOrderDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cleanLabel(value) {
  if (!value) return "—";
  return String(value)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("reject") || text.includes("fail") || text.includes("cancel")) {
    return { bg: "#FEECEC", color: "#B42318", border: "#F3B8B8" };
  }
  if (text.includes("pending") || text.includes("not") || text.includes("unpaid")) {
    return { bg: "#FFF7E6", color: "#A84A00", border: "#F2D69A" };
  }
  if (text.includes("paid") || text.includes("success") || text.includes("shipped")) {
    return { bg: "#EAF7EF", color: "#087A3E", border: "#BFE7CE" };
  }
  return { bg: "#EEF4FF", color: "#2456A6", border: "#C8D9FF" };
}

function StatusPill({ label, value }) {
  const tone = statusTone(value);
  return (
    <Box
      sx={{
        minWidth: 0,
        padding: "7px 8px",
        borderRadius: "8px",
        border: `1px solid ${tone.border}`,
        background: tone.bg,
      }}
    >
      <Typography
        sx={{
          fontSize: 9.5,
          lineHeight: 1,
          color: "rgba(71,84,103,.78)",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: ".35px",
          marginBottom: "4px",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 12,
          lineHeight: 1.15,
          color: tone.color,
          fontWeight: 800,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={cleanLabel(value)}
      >
        {cleanLabel(value)}
      </Typography>
    </Box>
  );
}

function MiniDetail({ label, value }) {
  if (!value) return null;
  return (
    <Box
      sx={{
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "6px 0",
        borderTop: `1px solid ${WA.border}`,
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          color: WA.textSub,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: ".35px",
          flex: "0 0 auto",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          minWidth: 0,
          fontSize: 12.5,
          color: WA.textPrimary,
          fontWeight: 700,
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={String(value)}
      >
        {value}
      </Typography>
    </Box>
  );
}

function LastOrderCard({ order, loading, error }) {
  if (loading) {
    return (
      <Box sx={chatStyles.orderCard}>
        <Typography sx={{ fontSize: 13, color: WA.textSub }}>
          Loading latest order…
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={chatStyles.orderCard}>
        <Typography sx={{ fontSize: 12, color: "#E53935" }}>{error}</Typography>
      </Box>
    );
  }

  if (!order) {
    return (
      <Box sx={chatStyles.orderCard}>
        <Typography sx={{ fontSize: 13, color: WA.textSub }}>
          No order found for this mobile number.
        </Typography>
      </Box>
    );
  }

  const items = order.items || [];
  const totalQty =
    Number(order.total_items) ||
    items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return (
    <Box
      sx={{
        ...chatStyles.orderCard,
        background: "linear-gradient(180deg, #ffffff 0%, #F8FBFA 100%)",
        border: "1px solid #DCE7E3",
        boxShadow: "0 1px 4px rgba(16, 24, 40, 0.06)",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "9px",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "10px",
          alignItems: "start",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 15,
              lineHeight: 1.1,
              fontWeight: 900,
              color: WA.textPrimary,
              overflowWrap: "anywhere",
            }}
          >
            {order.order_id}
          </Typography>
          <Typography
            sx={{
              fontSize: 11.5,
              color: WA.textSub,
              marginTop: "4px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={order.customer_name || ""}
          >
            {order.customer_name || order.customer_mobile || "Latest customer order"}
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right", minWidth: 78 }}>
          <Typography
            sx={{
              fontSize: 16,
              lineHeight: 1.05,
              color: WA.greenDark,
              fontWeight: 900,
              whiteSpace: "nowrap",
            }}
          >
            {formatMoney(order.total_amount)}
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: WA.textSub, marginTop: "4px" }}>
            {formatOrderDate(order.created_at)}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "6px",
          "@media (max-width: 390px)": { gridTemplateColumns: "1fr" },
        }}
      >
        <StatusPill label="Payment" value={order.payment_status} />
        <StatusPill label="Delivery" value={order.delivery_status} />
        <StatusPill label="Status" value={order.order_status} />
      </Box>

      <Box sx={{ borderTop: `1px solid ${WA.border}`, paddingTop: "2px" }}>
        <MiniDetail label="Mobile" value={order.customer_mobile} />
        <MiniDetail
          label="Qty"
          value={totalQty ? `${totalQty} item${totalQty === 1 ? "" : "s"}` : null}
        />
        <MiniDetail label="Channel" value={cleanLabel(order.channel)} />
        <MiniDetail label="AWB" value={order.awb_number} />
        <MiniDetail label="Invoice" value={order.invoice_number} />
      </Box>

      {items.length > 0 && (
        <Box
          sx={{
            border: `1px solid ${WA.border}`,
            borderRadius: "8px",
            overflow: "hidden",
            background: "#fff",
          }}
        >
          {items.slice(0, 3).map((item, index) => (
            <Box
              key={`${item.sku_id || item.product_name || index}-${index}`}
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: "8px",
                padding: "8px 10px",
                borderTop: index ? `1px solid ${WA.border}` : "none",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: WA.textPrimary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.product_name || "Product"}
                </Typography>
                {item.sku_id && (
                  <Typography sx={{ fontSize: 11, color: WA.textSub }}>
                    {item.sku_id}
                  </Typography>
                )}
              </Box>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: WA.textPrimary }}>
                x{item.quantity || 1}
              </Typography>
            </Box>
          ))}
          {items.length > 3 && (
            <Typography
              sx={{
                fontSize: 12,
                color: WA.textSub,
                padding: "8px 10px",
                borderTop: `1px solid ${WA.border}`,
              }}
            >
              +{items.length - 3} more items
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Order Confirmation Modal ──────────────────────────────────────────────────
function OrderConfirmModal({ chat, onClose, onSent }) {
  const [orderId, setOrderId] = useState(chat.linked_order_id || "");
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
    if (!orderId.trim()) {
      setError("Order ID is required.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendOrderConfirmation({
        phone: chat.phone,
        customerName: chat.name,
        orderId: orderId.trim(),
        amount: "",
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
          Confirms the order and sends the delivery address (from the order) to{" "}
          <strong>{chat.name}</strong> for confirmation. Amount &amp; address are
          taken from the order automatically.
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
  onFlagChange,
  onModeChange,
  onContactSaved,
}) {
  const [resolving, setResolving] = useState(false);
  const [activeFlag, setActiveFlag] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderSentFor, setOrderSentFor] = useState(null);
  const [dispatchOrderId, setDispatchOrderId] = useState(chat?.linked_order_id || "");
  const [dispatchSending, setDispatchSending] = useState(false);
  const [dispatchSent, setDispatchSent] = useState(null);
  const [dispatchError, setDispatchError] = useState(null);
  const [contactName, setContactName] = useState(chat?.name || "");
  const [contactPhone, setContactPhone] = useState(chat?.phone || "");
  const [savingContact, setSavingContact] = useState(false);
  const [contactStatus, setContactStatus] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [lastOrderLoading, setLastOrderLoading] = useState(false);
  const [lastOrderError, setLastOrderError] = useState(null);

  const currentFlag = activeFlag ?? chat?.flag ?? null;
  const isResolved = currentFlag === "resolved" || chat?.status === "resolved";

  useEffect(() => {
    setActiveFlag(null);
    setDispatchOrderId(chat?.linked_order_id || "");
    setDispatchSent(null);
    setDispatchError(null);
    setContactName(chat?.name || "");
    setContactPhone(chat?.phone || "");
    setContactStatus(null);
    setLastOrder(null);
    setLastOrderError(null);
  }, [chat?.id, chat?.flag, chat?.linked_order_id]);

  useEffect(() => {
    if (!chat?.id) return undefined;
    let cancelled = false;
    setLastOrderLoading(true);
    setLastOrderError(null);
    fetchChatLastOrder(chat.id)
      .then((order) => {
        if (!cancelled) setLastOrder(order);
      })
      .catch((err) => {
        if (!cancelled) {
          setLastOrder(null);
          setLastOrderError(
            err?.response?.data?.detail || "Could not load latest order.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLastOrderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chat?.id]);

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
      window.dispatchEvent(
        new CustomEvent("chat:session-updated", {
          detail: { session_id: chat.id, status: "resolved" },
        }),
      );
    } catch {
      /* silent */
    } finally {
      setResolving(false);
    }
  };

  const handleFlag = async (flagId) => {
    const next = currentFlag === flagId ? null : flagId;
    if (flagId === "resolved") {
      setActiveFlag(next);
      if (next === "resolved") handleResolve();
      return;
    }

    setActiveFlag(next);
    if (onFlagChange) onFlagChange(chat.id, next);
    window.dispatchEvent(
      new CustomEvent("chat:session-updated", {
        detail: { session_id: chat.id, flag: next },
      }),
    );
    try {
      const result = await updateSessionFlag(chat.id, next);
      const savedFlag = result?.flag ?? null;
      setActiveFlag(savedFlag);
      if (onFlagChange) onFlagChange(chat.id, savedFlag);
      window.dispatchEvent(
        new CustomEvent("chat:session-updated", {
          detail: { session_id: chat.id, flag: savedFlag },
        }),
      );
    } catch {
      setActiveFlag(chat?.flag ?? null);
      if (onFlagChange) onFlagChange(chat.id, chat?.flag ?? null);
      window.dispatchEvent(
        new CustomEvent("chat:session-updated", {
          detail: { session_id: chat.id, flag: chat?.flag ?? null },
        }),
      );
    }
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

  const handleSaveContact = async () => {
    if (!chat?.id || savingContact) return;
    const name = contactName.trim();
    const phone = contactPhone.trim();
    if (!name || !phone) {
      setContactStatus({ type: "error", message: "Name and number are required." });
      return;
    }

    setSavingContact(true);
    setContactStatus(null);
    try {
      const result = await saveChatContact(chat.id, { name, phone });
      setContactStatus({ type: "success", message: "Saved to customer table." });
      if (onContactSaved) {
        onContactSaved(chat.id, {
          name: result?.name || name,
          phone: chat.phone,
          customer_id: result?.customer_id,
        });
      }
      window.dispatchEvent(
        new CustomEvent("chat:session-updated", {
          detail: {
            session_id: chat.id,
            wa_contact_name: result?.name || name,
          },
        }),
      );
    } catch (err) {
      setContactStatus({
        type: "error",
        message: err?.response?.data?.detail || "Failed to save contact.",
      });
    } finally {
      setSavingContact(false);
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
  const contactInputStyle = {
    width: "100%",
    fontSize: "15px",
    padding: "9px 12px",
    borderRadius: "8px",
    border: `1px solid ${WA.borderMid}`,
    background: "#fff",
    color: WA.textPrimary,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
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
        <Box sx={{ display: "grid", gap: "8px", mb: "10px" }}>
          <input
            value={contactName}
            onChange={(e) => {
              setContactName(e.target.value);
              setContactStatus(null);
            }}
            placeholder="Customer name"
            spellCheck
            lang="en-IN"
            style={contactInputStyle}
          />
          <input
            value={contactPhone}
            onChange={(e) => {
              setContactPhone(e.target.value);
              setContactStatus(null);
            }}
            placeholder="WhatsApp number"
            inputMode="tel"
            style={contactInputStyle}
          />
          <button
            onClick={handleSaveContact}
            disabled={savingContact}
            style={{
              ...chatStyles.actionBtn,
              justifyContent: "center",
              opacity: savingContact ? 0.65 : 1,
              cursor: savingContact ? "wait" : "pointer",
            }}
          >
            <Save size={15} />
            {savingContact ? "Saving contact…" : "Save to customer"}
          </button>
          {contactStatus && (
            <Typography
              sx={{
                fontSize: 12,
                color: contactStatus.type === "success" ? "#2E7D32" : "#E53935",
              }}
            >
              {contactStatus.message}
            </Typography>
          )}
        </Box>
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

      {/* ── Last order ── */}
      <Box sx={chatStyles.infoPanelSection}>
        <SectionLabel>
          <ReceiptText
            size={10}
            style={{
              display: "inline",
              marginRight: "4px",
              verticalAlign: "middle",
            }}
          />
          Last Order
        </SectionLabel>
        <LastOrderCard
          order={lastOrder}
          loading={lastOrderLoading}
          error={lastOrderError}
        />
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
