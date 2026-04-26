// src/chat/styles.js
// ─────────────────────────────────────────────────────────────────────────────
// Centralised style object for the WhatsApp chat system.
// All values use MUI sx-compatible objects so they can be spread directly:
//   <Box sx={chatStyles.layout} />
//
// Colour tokens that map to MUI theme equivalents are left as CSS variables
// so they auto-adapt to light/dark mode without any extra config.
// ─────────────────────────────────────────────────────────────────────────────

// ── Flag / status colour maps ─────────────────────────────────────────────────
// Used for badges, pills, flag buttons, and avatar tints.
export const FLAG_COLORS = {
  flagged: {
    bg: "#FAEEDA",
    border: "#854F0B",
    text: "#633806",
  },
  urgent: {
    bg: "#FCEBEB",
    border: "#A32D2D",
    text: "#791F1F",
  },
  resolved: {
    bg: "#EAF3DE",
    border: "#3B6D11",
    text: "#27500A",
  },
  new: {
    bg: "#E6F1FB",
    border: "#185FA5",
    text: "#0C447C",
  },
  order: {
    bg: "#EAF3DE",
    border: "#3B6D11",
    text: "#27500A",
  },
  default: {
    bg: "var(--color-background-secondary, #f1f5f9)",
    border: "var(--color-border-tertiary, rgba(0,0,0,0.15))",
    text: "var(--color-text-secondary, #64748b)",
  },
};

// ── Avatar colour cycling (by initials index) ─────────────────────────────────
export const AVATAR_PALETTE = [
  { bg: "#E6F1FB", text: "#0C447C" },
  { bg: "#FCEBEB", text: "#791F1F" },
  { bg: "#EAF3DE", text: "#27500A" },
  { bg: "#FAEEDA", text: "#633806" },
  { bg: "#EEEDFE", text: "#3C3489" },
  { bg: "#E1F5EE", text: "#085041" },
];

/** Returns a stable avatar colour for a given name string. */
export function avatarColor(name = "") {
  const idx = name.charCodeAt(0) % AVATAR_PALETTE.length || 0;
  return AVATAR_PALETTE[idx];
}

// ── Layout ────────────────────────────────────────────────────────────────────
export const chatStyles = {
  // Root three-column grid
  layout: {
    display: "grid",
    gridTemplateColumns: "260px 1fr 220px",
    height: "calc(100vh - 140px)",
    borderRadius: "var(--border-radius-lg, 12px)",
    overflow: "hidden",
    border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    background: "var(--color-background-secondary, #f8fafc)",
  },

  // ── Left sidebar ────────────────────────────────────────────────────────────
  sidebar: {
    borderRight: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    display: "flex",
    flexDirection: "column",
    background: "var(--color-background-primary, #fff)",
    overflow: "hidden",
  },

  sidebarHeader: {
    padding: "12px",
    borderBottom: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
  },

  searchInput: {
    width: "100%",
    padding: "6px 10px",
    border: "0.5px solid var(--color-border-secondary, rgba(0,0,0,0.3))",
    borderRadius: "var(--border-radius-md, 8px)",
    fontSize: "12px",
    background: "var(--color-background-secondary, #f8fafc)",
    color: "var(--color-text-primary, #111)",
    fontFamily: "inherit",
    outline: "none",
  },

  // Filter pill row
  filterRow: {
    display: "flex",
    gap: "4px",
    padding: "8px 12px",
    borderBottom: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    flexWrap: "wrap",
  },

  // Base pill (inactive)
  pill: {
    fontSize: "11px",
    padding: "3px 8px",
    borderRadius: "20px",
    border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    cursor: "pointer",
    color: "var(--color-text-secondary, #64748b)",
    background: "transparent",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    lineHeight: "1.4",
  },

  // Pill variants (active state) — spread over pillBase
  pillActive: {
    all: { background: "#E6F1FB", borderColor: "#185FA5", color: "#0C447C" },
    flagged: {
      background: "#FAEEDA",
      borderColor: "#854F0B",
      color: "#633806",
    },
    urgent: { background: "#FCEBEB", borderColor: "#A32D2D", color: "#791F1F" },
    resolved: {
      background: "#EAF3DE",
      borderColor: "#3B6D11",
      color: "#27500A",
    },
    orders: { background: "#EAF3DE", borderColor: "#3B6D11", color: "#27500A" },
  },

  // Conversation list scroll area
  convList: {
    overflowY: "auto",
    flex: 1,
  },

  // Single conversation row
  convItem: (isActive) => ({
    padding: "10px 12px",
    borderBottom: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    cursor: "pointer",
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    background: isActive
      ? "var(--color-background-secondary, #f8fafc)"
      : "var(--color-background-primary, #fff)",
    borderLeft: isActive ? "2px solid #185FA5" : "2px solid transparent",
    transition: "background 0.1s",
    "&:hover": {
      background: "var(--color-background-secondary, #f8fafc)",
    },
  }),

  // Unread indicator dot
  unreadDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: "#185FA5",
    flexShrink: 0,
    mt: "4px",
  },

  // Avatar circle
  avatar: (bg, color, size = 34) => ({
    width: size,
    height: size,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size <= 30 ? "11px" : "12px",
    fontWeight: 500,
    flexShrink: 0,
    background: bg,
    color: color,
  }),

  convName: {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--color-text-primary, #111)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "120px",
  },

  convTime: {
    fontSize: "10px",
    color: "var(--color-text-tertiary, #94a3b8)",
    flexShrink: 0,
  },

  convPreview: {
    fontSize: "11px",
    color: "var(--color-text-secondary, #64748b)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  convBadges: {
    display: "flex",
    gap: "3px",
    mt: "4px",
    flexWrap: "wrap",
  },

  // ── Badge ────────────────────────────────────────────────────────────────────
  badge: (type = "default") => {
    const c = FLAG_COLORS[type] || FLAG_COLORS.default;
    return {
      fontSize: "10px",
      padding: "1px 6px",
      borderRadius: "20px",
      fontWeight: 500,
      background: c.bg,
      color: c.text,
      border: `0.5px solid ${c.border}`,
      display: "inline-block",
      lineHeight: "1.6",
    };
  },

  // ── Main chat column ─────────────────────────────────────────────────────────
  main: {
    display: "flex",
    flexDirection: "column",
    background: "var(--color-background-secondary, #f8fafc)",
    overflow: "hidden",
  },

  chatHeader: {
    padding: "10px 14px",
    borderBottom: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    background: "var(--color-background-primary, #fff)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexShrink: 0,
  },

  chatHeaderInfo: {
    flex: 1,
    minWidth: 0,
    "& p": { fontSize: "13px", fontWeight: 500, lineHeight: 1.2, margin: 0 },
    "& span": {
      fontSize: "11px",
      color: "var(--color-text-tertiary, #94a3b8)",
    },
  },

  headerActions: {
    display: "flex",
    gap: "6px",
  },

  // Header icon button — pass flagType to tint it
  iconBtn: (flagType) => {
    const base = {
      width: "28px",
      height: "28px",
      borderRadius: "var(--border-radius-md, 8px)",
      border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
      background: "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      fontSize: "13px",
      color: "var(--color-text-secondary, #64748b)",
      "&:hover": { background: "var(--color-background-secondary, #f8fafc)" },
      minWidth: 0,
      padding: 0,
    };
    if (!flagType) return base;
    const c = FLAG_COLORS[flagType] || {};
    return {
      ...base,
      background: c.bg,
      borderColor: c.border,
      color: c.text,
    };
  },

  // Message scroll area
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },

  // Message wrapper
  msgWrapper: (sender) => ({
    display: "flex",
    flexDirection: "column",
    maxWidth: "70%",
    alignSelf: sender === "user" ? "flex-start" : "flex-end",
  }),

  // Bubble
  bubble: (sender) => {
    if (sender === "user") {
      return {
        padding: "8px 12px",
        borderRadius: "12px 12px 12px 2px",
        fontSize: "12px",
        lineHeight: 1.5,
        background: "var(--color-background-primary, #fff)",
        border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
        color: "var(--color-text-primary, #111)",
      };
    }
    if (sender === "system") {
      return {
        alignSelf: "center",
        fontSize: "11px",
        background: "#FAEEDA",
        color: "#633806",
        padding: "4px 12px",
        borderRadius: "20px",
        border: "0.5px solid #854F0B",
      };
    }
    return {
      padding: "8px 12px",
      borderRadius: "12px 12px 2px 12px",
      fontSize: "12px",
      lineHeight: 1.5,
      background: "#185FA5",
      color: "#E6F1FB",
    };
  },

  msgMeta: (sender) => ({
    fontSize: "10px",
    color: "var(--color-text-tertiary, #94a3b8)",
    mt: "2px",
    px: "2px",
    textAlign: sender === "user" ? "left" : "right",
  }),

  // Message input row
  inputArea: {
    padding: "10px 12px",
    borderTop: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    background: "var(--color-background-primary, #fff)",
    display: "flex",
    gap: "8px",
    alignItems: "flex-end",
    flexShrink: 0,
  },

  textarea: {
    flex: 1,
    padding: "7px 10px",
    border: "0.5px solid var(--color-border-secondary, rgba(0,0,0,0.3))",
    borderRadius: "var(--border-radius-md, 8px)",
    fontSize: "12px",
    resize: "none",
    background: "var(--color-background-secondary, #f8fafc)",
    color: "var(--color-text-primary, #111)",
    fontFamily: "inherit",
    minHeight: "34px",
    maxHeight: "80px",
    outline: "none",
    "&:focus": {
      borderColor: "#185FA5",
      boxShadow: "0 0 0 2px rgba(24,95,165,0.15)",
    },
  },

  sendBtn: {
    padding: "7px 14px",
    background: "#185FA5",
    color: "#E6F1FB",
    border: "none",
    borderRadius: "var(--border-radius-md, 8px)",
    fontSize: "12px",
    cursor: "pointer",
    fontWeight: 500,
    flexShrink: 0,
    fontFamily: "inherit",
    "&:hover": { background: "#0C447C" },
    "&:disabled": { opacity: 0.5, cursor: "not-allowed" },
  },

  // ── Right info panel ──────────────────────────────────────────────────────────
  panel: {
    borderLeft: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    background: "var(--color-background-primary, #fff)",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
  },

  panelSection: {
    padding: "12px",
    borderBottom: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
  },

  panelLabel: {
    fontSize: "10px",
    fontWeight: 500,
    color: "var(--color-text-tertiary, #94a3b8)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    mb: "8px",
    display: "block",
  },

  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    mb: "6px",
    fontSize: "11px",
    "& span:first-of-type": { color: "var(--color-text-secondary, #64748b)" },
    "& span:last-child": { fontWeight: 500 },
  },

  // Flag buttons in the panel
  flagBtn: (type, isActive) => {
    const base = {
      width: "100%",
      padding: "7px 10px",
      borderRadius: "var(--border-radius-md, 8px)",
      border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
      fontSize: "11px",
      cursor: "pointer",
      mb: "6px",
      background: "transparent",
      color: "var(--color-text-secondary, #64748b)",
      fontFamily: "inherit",
      textAlign: "left",
      "&:hover": { background: "var(--color-background-secondary, #f8fafc)" },
    };
    if (!isActive) return base;
    const c = FLAG_COLORS[type] || FLAG_COLORS.flagged;
    return {
      ...base,
      background: c.bg,
      borderColor: c.border,
      color: c.text,
      fontWeight: 500,
    };
  },

  // Linked order card
  orderCard: {
    background: "var(--color-background-secondary, #f8fafc)",
    borderRadius: "var(--border-radius-md, 8px)",
    padding: "8px",
    fontSize: "11px",
    border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    "& p": { mb: "3px", color: "var(--color-text-secondary, #64748b)" },
    "& strong": { fontWeight: 500, color: "var(--color-text-primary, #111)" },
  },

  // Quick reply buttons
  quickActions: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },

  quickActionBtn: {
    width: "100%",
    padding: "6px 8px",
    borderRadius: "var(--border-radius-md, 8px)",
    border: "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
    fontSize: "11px",
    textAlign: "left",
    cursor: "pointer",
    background: "transparent",
    color: "var(--color-text-primary, #111)",
    fontFamily: "inherit",
    "&:hover": { background: "var(--color-background-secondary, #f8fafc)" },
  },
};

// ── Filter config — drives the filter pill row ────────────────────────────────
// Each entry defines the label, the key it filters on, and which active style to use.
export const CHAT_FILTERS = [
  { id: "all", label: "All", filterKey: null, activeVariant: "all" },
  {
    id: "flagged",
    label: "Flagged",
    filterKey: "flag",
    activeVariant: "flagged",
  },
  {
    id: "urgent",
    label: "Urgent",
    filterKey: "urgent",
    activeVariant: "urgent",
  },
  {
    id: "active",
    label: "Active",
    filterKey: "status:active",
    activeVariant: "all",
  },
  {
    id: "orders",
    label: "Has order",
    filterKey: "has_order",
    activeVariant: "orders",
  },
  {
    id: "resolved",
    label: "Resolved",
    filterKey: "status:resolved",
    activeVariant: "resolved",
  },
];

// ── Flag action config — drives the panel flag buttons ────────────────────────
export const FLAG_ACTIONS = [
  { id: "flagged", label: "⚑  Flag for follow-up", type: "flagged" },
  { id: "urgent", label: "!  Mark as urgent", type: "urgent" },
  { id: "resolved", label: "✓  Mark as resolved", type: "resolved" },
];

// ── Quick reply templates ──────────────────────────────────────────────────────
// Pass `orderId` and `awb` as substitution tokens where needed.
export const QUICK_REPLIES = [
  {
    id: "address_confirm",
    label: "Send address confirmation",
    template: (ctx) =>
      `Hi ${ctx.customerName || "there"}, please confirm your delivery address for order ${ctx.orderId}: ${ctx.address}. Reply YES to confirm or send your corrected address.`,
  },
  {
    id: "shipping_update",
    label: "Send shipping update",
    template: (ctx) =>
      `Your order ${ctx.orderId} has been shipped! Tracking AWB: ${ctx.awb}. You can track it using this number.`,
  },
  {
    id: "gst_invoice",
    label: "Send GST invoice",
    template: (ctx) =>
      `Your GST invoice for order ${ctx.orderId} is ready. Invoice number: ${ctx.invoiceNumber}. Please let us know if you need any changes.`,
  },
  {
    id: "payment_pending",
    label: "Payment reminder",
    template: (ctx) =>
      `Hi ${ctx.customerName || "there"}, your order ${ctx.orderId} is awaiting payment of ₹${ctx.amount}. Please complete payment to proceed.`,
  },
  {
    id: "escalate",
    label: "Escalate to manager",
    template: () =>
      `I'm escalating your query to our senior team. Someone will get back to you within 2 hours. Thank you for your patience.`,
  },
];
