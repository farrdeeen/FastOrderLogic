// src/chat/styles.js
// WhatsApp-inspired design system — clean, functional, mobile-first.
// Two-column on desktop (sidebar + chat), info panel as slide-over overlay.
// Single pane stack on mobile with animated transitions.

// ── Colour tokens ─────────────────────────────────────────────────────────────
export const WA = {
  greenDark: "#075E54",
  greenMid: "#128C7E",
  greenAccent: "#25D366",
  greenLight: "#D9FDD3",
  teal: "#00BCD4",
  bgChat: "#EBE5DC", // WhatsApp canvas tan
  bgSidebar: "#FFFFFF",
  bgHeader: "#F0F2F5",
  bgInput: "#F0F2F5",
  bubbleOut: "#D9FDD3",
  bubbleIn: "#FFFFFF",
  textPrimary: "#111B21",
  textSub: "#667781",
  textTick: "#53BDEB",
  border: "#E9EDEF",
  borderMid: "#D1D7DB",
  unread: "#25D366",
  system: "#FFF3CD",
};

// ── Flag / status colour maps ─────────────────────────────────────────────────
export const FLAG_COLORS = {
  flagged: { bg: "#FFF8E1", border: "#FFB300", text: "#7B5800" },
  urgent: { bg: "#FFEBEE", border: "#E53935", text: "#891313" },
  resolved: { bg: "#E8F5E9", border: "#43A047", text: "#1B5E20" },
  new: { bg: "#E3F2FD", border: "#1E88E5", text: "#0D47A1" },
  order: { bg: "#E8F5E9", border: "#43A047", text: "#1B5E20" },
  default: { bg: "#F5F5F5", border: "#BDBDBD", text: "#424242" },
};

// ── Avatar palette ────────────────────────────────────────────────────────────
export const AVATAR_PALETTE = [
  { bg: "#E8EAF6", text: "#3949AB" },
  { bg: "#FCE4EC", text: "#C62828" },
  { bg: "#E8F5E9", text: "#2E7D32" },
  { bg: "#FFF3E0", text: "#E65100" },
  { bg: "#EDE7F6", text: "#4527A0" },
  { bg: "#E0F7FA", text: "#00695C" },
  { bg: "#F3E5F5", text: "#6A1B9A" },
  { bg: "#FBE9E7", text: "#BF360C" },
];

export function avatarColor(name = "") {
  const idx = (name.charCodeAt(0) || 0) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx];
}

// ── Main style object ─────────────────────────────────────────────────────────
export const chatStyles = {
  // Root: two-column on desktop, single column on mobile
  layout: {
    display: "flex",
    flexDirection: "row",
    width: "100%",
    maxWidth: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    borderRadius: "12px",
    boxShadow: "0 2px 24px rgba(0,0,0,0.10)",
    border: `1px solid ${WA.border}`,
    background: WA.bgSidebar,
    "@media (max-width: 768px)": {
      borderRadius: 0,
      border: "none",
      boxShadow: "none",
      width: "100vw",
      maxWidth: "100vw",
      height: "100dvh",
      minHeight: "100dvh",
      position: "fixed",
      inset: 0,
    },
  },

  // ── Sidebar ───────────────────────────────────────────────────────────────
  sidebar: {
    width: "360px",
    minWidth: "360px",
    maxWidth: "360px",
    display: "flex",
    flexDirection: "column",
    background: WA.bgSidebar,
    borderRight: `1px solid ${WA.border}`,
    overflow: "hidden",
    flexShrink: 0,
    boxSizing: "border-box",
    "@media (min-width: 769px) and (max-width: 900px)": {
      width: "300px",
      minWidth: "300px",
      maxWidth: "300px",
    },
    "@media (max-width: 768px)": {
      width: "100vw",
      minWidth: "100vw",
      maxWidth: "100vw",
      height: "100dvh",
      minHeight: "100dvh",
      border: "none",
    },
  },

  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px 10px",
    background: WA.bgHeader,
    borderBottom: `1px solid ${WA.border}`,
    flexShrink: 0,
    width: "100%",
    boxSizing: "border-box",
    "@media (max-width: 768px)": {
      padding: "10px",
      paddingTop: "max(10px, env(safe-area-inset-top, 10px))",
    },
  },

  sidebarTitle: {
    fontSize: "19px",
    fontWeight: 600,
    color: WA.greenDark,
    fontFamily: "'IBM Plex Sans', sans-serif",
    flex: 1,
    minWidth: 0,
  },

  sidebarActions: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },

  iconCircleBtn: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: WA.textSub,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background 0.15s",
    padding: 0,
    "&:hover": { background: WA.border },
  },

  searchBox: {
    padding: "8px 12px",
    background: WA.bgHeader,
    flexShrink: 0,
    width: "100%",
    boxSizing: "border-box",
    "@media (max-width: 768px)": {
      padding: "8px 10px",
    },
  },

  searchInput: {
    width: "100%",
    padding: "8px 12px 8px 36px",
    border: "none",
    borderRadius: "8px",
    fontSize: "14px",
    background: WA.bgSidebar,
    color: WA.textPrimary,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    boxShadow: `inset 0 0 0 1px ${WA.border}`,
    "@media (max-width: 768px)": {
      fontSize: "16px",
    },
  },

  searchWrap: {
    position: "relative",
    display: "flex",
    width: "100%",
    minWidth: 0,
  },

  searchIcon: {
    position: "absolute",
    left: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    color: WA.textSub,
    pointerEvents: "none",
  },

  filterRow: {
    display: "flex",
    gap: "6px",
    padding: "6px 12px 8px",
    overflowX: "auto",
    flexShrink: 0,
    borderBottom: `1px solid ${WA.border}`,
    width: "100%",
    boxSizing: "border-box",
    scrollbarWidth: "none",
    "&::-webkit-scrollbar": { display: "none" },
    "@media (max-width: 768px)": {
      padding: "6px 10px 8px",
    },
  },

  pill: {
    fontSize: "12px",
    padding: "4px 12px",
    borderRadius: "16px",
    border: `1px solid ${WA.borderMid}`,
    cursor: "pointer",
    color: WA.textSub,
    background: "transparent",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    fontWeight: 500,
    transition: "all 0.15s",
    flexShrink: 0,
  },

  pillActive: {
    all: { background: WA.greenDark, borderColor: WA.greenDark, color: "#fff" },
    flagged: {
      background: "#FFF8E1",
      borderColor: "#FFB300",
      color: "#7B5800",
    },
    urgent: { background: "#FFEBEE", borderColor: "#E53935", color: "#891313" },
    resolved: {
      background: "#E8F5E9",
      borderColor: "#43A047",
      color: "#1B5E20",
    },
    orders: {
      background: WA.greenLight,
      borderColor: WA.greenAccent,
      color: WA.greenDark,
    },
  },

  convList: {
    overflowY: "auto",
    flex: 1,
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    "&::-webkit-scrollbar": { width: "4px" },
    "&::-webkit-scrollbar-track": { background: "transparent" },
    "&::-webkit-scrollbar-thumb": {
      background: WA.borderMid,
      borderRadius: "4px",
    },
  },

  convItem: (isActive) => ({
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    cursor: "pointer",
    background: isActive ? WA.bgHeader : "transparent",
    borderBottom: `1px solid ${WA.border}`,
    transition: "background 0.1s",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    width: "100%",
    boxSizing: "border-box",
    "&:hover": { background: WA.bgHeader },
    "&:active": { background: WA.border },
    "@media (max-width: 768px)": {
      gap: "10px",
      padding: "10px",
    },
  }),

  unreadDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: WA.unread,
    flexShrink: 0,
    marginLeft: "auto",
  },

  avatar: (bg, color, size = 40) => ({
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    background: bg,
    color: color,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size <= 32 ? "12px" : size <= 40 ? "14px" : "16px",
    fontWeight: 600,
    flexShrink: 0,
    userSelect: "none",
  }),

  convName: {
    fontSize: "15px",
    fontWeight: 500,
    color: WA.textPrimary,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
    minWidth: 0,
  },

  convTime: {
    fontSize: "11px",
    color: WA.textSub,
    flexShrink: 0,
    whiteSpace: "nowrap",
    marginBottom: "auto",
  },

  convPreview: {
    fontSize: "13px",
    color: WA.textSub,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1,
    minWidth: 0,
  },

  convMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "2px",
  },

  convBadges: {
    display: "flex",
    gap: "4px",
    mt: "3px",
    flexWrap: "wrap",
  },

  badge: (type = "default") => {
    const c = FLAG_COLORS[type] || FLAG_COLORS.default;
    return {
      fontSize: "10px",
      padding: "1px 7px",
      borderRadius: "10px",
      fontWeight: 600,
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.border}`,
      display: "inline-block",
      lineHeight: "1.6",
    };
  },

  unreadBadge: {
    minWidth: "18px",
    height: "18px",
    borderRadius: "9px",
    background: WA.unread,
    color: "#fff",
    fontSize: "11px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 5px",
    flexShrink: 0,
  },

  // ── Chat main area ────────────────────────────────────────────────────────
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: WA.bgChat,
    overflow: "hidden",
    position: "relative",
    minWidth: 0,
    "@media (max-width: 768px)": {
      width: "100%",
      minWidth: "100%",
      maxWidth: "100%",
      height: "100dvh",
      minHeight: "100dvh",
      flex: "0 0 100vw",
    },
  },

  // Subtle WhatsApp-style wallpaper pattern via CSS
  chatWallpaper: {
    position: "absolute",
    inset: 0,
    opacity: 0.04,
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23075E54' fill-opacity='1'%3E%3Cpath d='M30 0C13.4 0 0 13.4 0 30s13.4 30 30 30 30-13.4 30-30S46.6 0 30 0zm0 54C16.8 54 6 43.2 6 30S16.8 6 30 6s24 10.8 24 24-10.8 24-24 24z'/%3E%3C/g%3E%3C/svg%3E")`,
    backgroundSize: "60px 60px",
    pointerEvents: "none",
    zIndex: 0,
  },

  chatHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 16px",
    background: WA.bgHeader,
    borderBottom: `1px solid ${WA.border}`,
    flexShrink: 0,
    zIndex: 2,
    "@media (max-width: 768px)": {
      padding: "8px 12px",
      paddingTop: "max(8px, env(safe-area-inset-top, 8px))",
    },
  },

  chatHeaderAvatar: {
    cursor: "pointer",
    borderRadius: "50%",
    transition: "opacity 0.15s",
    "&:hover": { opacity: 0.85 },
    "&:active": { opacity: 0.7 },
  },

  chatHeaderInfo: {
    flex: 1,
    minWidth: 0,
    cursor: "pointer",
    "& p": {
      fontSize: "15px",
      fontWeight: 500,
      color: WA.textPrimary,
      margin: 0,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    "& span": {
      fontSize: "12px",
      color: WA.textSub,
      display: "block",
      whiteSpace: "nowrap",
    },
  },

  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
  },

  mobileBackButton: {
    display: "none",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: WA.textSub,
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    transition: "background 0.15s",
    "&:hover": { background: WA.border },
    "@media (max-width: 768px)": { display: "flex" },
  },

  mobileMenuButton: {
    display: "none",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: WA.textSub,
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    transition: "background 0.15s",
    "&:hover": { background: WA.border },
    "@media (max-width: 768px)": { display: "flex" },
  },

  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    position: "relative",
    zIndex: 1,
    WebkitOverflowScrolling: "touch",
    scrollbarWidth: "thin",
    scrollbarColor: `${WA.borderMid} transparent`,
    "&::-webkit-scrollbar": { width: "4px" },
    "&::-webkit-scrollbar-thumb": {
      background: WA.borderMid,
      borderRadius: "4px",
    },
    "@media (max-width: 768px)": {
      padding: "8px 10px",
    },
  },

  msgWrapper: (sender) => ({
    display: "flex",
    flexDirection: "column",
    alignItems:
      sender === "user"
        ? "flex-start"
        : sender === "ai"
          ? "flex-end"
          : "center",
    maxWidth: sender === "system" ? "100%" : "70%",
    alignSelf:
      sender === "user"
        ? "flex-start"
        : sender === "ai"
          ? "flex-end"
          : "center",
    marginBottom: "2px",
    "@media (max-width: 768px)": {
      maxWidth: sender === "system" ? "100%" : "82%",
    },
  }),

  bubble: (sender) => {
    const base = {
      display: "inline-block",
      padding: "7px 12px 6px",
      borderRadius: "8px",
      fontSize: "14px",
      lineHeight: "1.45",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      boxShadow: "0 1px 2px rgba(0,0,0,0.10)",
      position: "relative",
      maxWidth: "100%",
    };
    if (sender === "user")
      return {
        ...base,
        background: WA.bubbleIn,
        color: WA.textPrimary,
        borderRadius: "0px 8px 8px 8px",
      };
    if (sender === "ai")
      return {
        ...base,
        background: WA.bubbleOut,
        color: WA.textPrimary,
        borderRadius: "8px 0px 8px 8px",
      };
    // system
    return {
      display: "inline-block",
      padding: "5px 14px",
      borderRadius: "16px",
      fontSize: "12px",
      background: "rgba(255,243,205,0.95)",
      color: "#7B5800",
      border: "1px solid #FFE082",
      boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
      maxWidth: "75%",
      textAlign: "center",
      lineHeight: 1.5,
    };
  },

  msgMeta: (sender) => ({
    fontSize: "11px",
    color: WA.textSub,
    marginTop: "2px",
    padding: "0 2px",
    display: "flex",
    alignItems: "center",
    gap: "3px",
    justifyContent: sender === "user" ? "flex-start" : "flex-end",
  }),

  dateDivider: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "12px 0 8px",
  },

  datePill: {
    fontSize: "12px",
    padding: "4px 12px",
    borderRadius: "12px",
    background: "rgba(255,255,255,0.85)",
    color: WA.textSub,
    boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
    fontWeight: 500,
  },

  inputArea: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    padding: "10px 12px",
    paddingBottom: "max(10px, env(safe-area-inset-bottom, 10px))",
    background: WA.bgInput,
    borderTop: `1px solid ${WA.border}`,
    flexShrink: 0,
    zIndex: 2,
    "@media (max-width: 768px)": {
      padding: "8px 10px",
      paddingBottom: "max(8px, env(safe-area-inset-bottom, 8px))",
    },
  },

  textareaWrap: {
    flex: 1,
    background: "#fff",
    borderRadius: "24px",
    border: `1px solid ${WA.border}`,
    display: "flex",
    alignItems: "flex-end",
    padding: "6px 12px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },

  textarea: {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: "14px",
    lineHeight: "1.4",
    resize: "none",
    background: "transparent",
    color: WA.textPrimary,
    fontFamily: "inherit",
    minHeight: "22px",
    maxHeight: "120px",
    overflowY: "auto",
    padding: 0,
    "@media (max-width: 768px)": {
      fontSize: "16px",
    },
  },

  sendBtn: {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: "none",
    background: WA.greenMid,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background 0.15s, transform 0.1s",
    padding: 0,
    "&:hover": { background: WA.greenDark },
    "&:active": { transform: "scale(0.93)" },
    "&:disabled": { background: WA.borderMid, cursor: "not-allowed" },
  },

  // ── Info panel (slide-over overlay) ──────────────────────────────────────
  infoPanelOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.25)",
    zIndex: 100,
    transition: "opacity 0.2s",
  },

  infoPanel: (open) => ({
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "340px",
    maxWidth: "100%",
    background: WA.bgSidebar,
    boxShadow: "-4px 0 24px rgba(0,0,0,0.14)",
    display: "flex",
    flexDirection: "column",
    zIndex: 101,
    transform: open ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
    overflowY: "auto",
    overflowX: "hidden",
    "@media (max-width: 768px)": {
      width: "100%",
    },
  }),

  infoPanelHeader: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px",
    background: WA.greenDark,
    color: "#fff",
    flexShrink: 0,
    paddingTop: "max(16px, env(safe-area-inset-top, 16px))",
  },

  infoPanelCloseBtn: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    border: "none",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    transition: "background 0.15s",
    "&:hover": { background: "rgba(255,255,255,0.22)" },
  },

  infoPanelSection: {
    padding: "14px 16px",
    borderBottom: `1px solid ${WA.border}`,
  },

  infoPanelLabel: {
    fontSize: "13px",
    fontWeight: 600,
    color: WA.greenMid,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    marginBottom: "10px",
    display: "block",
  },

  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
    fontSize: "13px",
    "& span:first-of-type": { color: WA.textSub },
    "& span:last-child": { fontWeight: 500, color: WA.textPrimary },
  },

  flagBtn: (type, isActive) => {
    const c = FLAG_COLORS[type] || FLAG_COLORS.default;
    return {
      width: "100%",
      padding: "9px 12px",
      borderRadius: "8px",
      border: `1px solid ${isActive ? c.border : WA.border}`,
      fontSize: "13px",
      cursor: "pointer",
      marginBottom: "6px",
      background: isActive ? c.bg : "transparent",
      color: isActive ? c.text : WA.textSub,
      fontFamily: "inherit",
      textAlign: "left",
      fontWeight: isActive ? 600 : 400,
      display: "flex",
      alignItems: "center",
      gap: "8px",
      transition: "all 0.15s",
      "&:hover": {
        background: isActive ? c.bg : WA.bgHeader,
        borderColor: c.border,
      },
    };
  },

  orderCard: {
    background: WA.bgHeader,
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "13px",
    border: `1px solid ${WA.border}`,
    "& p": { margin: "0 0 4px", color: WA.textSub },
    "& strong": { fontWeight: 600, color: WA.textPrimary },
  },

  quickActions: { display: "flex", flexDirection: "column", gap: "4px" },

  quickActionBtn: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: "8px",
    border: `1px solid ${WA.border}`,
    fontSize: "13px",
    textAlign: "left",
    cursor: "pointer",
    background: "transparent",
    color: WA.textPrimary,
    fontFamily: "inherit",
    transition: "background 0.12s",
    "&:hover": { background: WA.bgHeader },
  },

  actionBtn: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: "8px",
    border: `1px solid ${WA.border}`,
    fontSize: "13px",
    textAlign: "left",
    cursor: "pointer",
    background: "transparent",
    color: WA.textPrimary,
    fontFamily: "inherit",
    marginBottom: "6px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "background 0.12s",
    "&:hover": { background: WA.bgHeader },
  },

  // Mobile pane visibility helper
  mobilePane: (isVisible) => ({
    "@media (max-width: 768px)": {
      display: isVisible ? "flex" : "none",
      width: "100vw",
      minWidth: "100vw",
      maxWidth: "100vw",
      flex: "0 0 100vw",
    },
  }),

  // Panel label (legacy compat)
  panelLabel: {
    fontSize: "11px",
    fontWeight: 600,
    color: WA.textSub,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    marginBottom: "8px",
    display: "block",
  },

  panelSection: {
    padding: "12px 14px",
    borderBottom: `1px solid ${WA.border}`,
  },
};

// ── Filter config ─────────────────────────────────────────────────────────────
export const CHAT_FILTERS = [
  { id: "all", label: "All", activeVariant: "all" },
  { id: "active", label: "Active", activeVariant: "all" },
  { id: "flagged", label: "Flagged", activeVariant: "flagged" },
  { id: "urgent", label: "Urgent", activeVariant: "urgent" },
  { id: "orders", label: "Has Order", activeVariant: "orders" },
  { id: "resolved", label: "Resolved", activeVariant: "resolved" },
];

// ── Flag action config ────────────────────────────────────────────────────────
export const FLAG_ACTIONS = [
  { id: "flagged", label: "⚑  Flag for follow-up", type: "flagged" },
  { id: "urgent", label: "!  Mark as urgent", type: "urgent" },
  { id: "resolved", label: "✓  Mark as resolved", type: "resolved" },
];

// ── Quick reply templates ─────────────────────────────────────────────────────
export const QUICK_REPLIES = [
  {
    id: "address_confirm",
    label: "📦 Address confirmation",
    template: (ctx) =>
      `Hi ${ctx.customerName || "there"}, please confirm your delivery address for order ${ctx.orderId}: ${ctx.address}. Reply YES to confirm or send your corrected address.`,
  },
  {
    id: "shipping_update",
    label: "🚚 Shipping update",
    template: (ctx) =>
      `Your order ${ctx.orderId} has been shipped! Tracking AWB: ${ctx.awb}. You can track it using this number.`,
  },
  {
    id: "gst_invoice",
    label: "🧾 GST invoice",
    template: (ctx) =>
      `Your GST invoice for order ${ctx.orderId} is ready. Invoice number: ${ctx.invoiceNumber}. Please let us know if you need any changes.`,
  },
  {
    id: "payment_pending",
    label: "💳 Payment reminder",
    template: (ctx) =>
      `Hi ${ctx.customerName || "there"}, your order ${ctx.orderId} is awaiting payment of ₹${ctx.amount}. Please complete payment to proceed.`,
  },
  {
    id: "escalate",
    label: "🔼 Escalate to manager",
    template: () =>
      `I'm escalating your query to our senior team. Someone will get back to you within 2 hours. Thank you for your patience.`,
  },
];
