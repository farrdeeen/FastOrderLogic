export const ALL_PAGE_IDS = [
  "dashboard",
  "orders",
  "create-order",
  "device-entry",
  "serial-search",
  "chat",
  "knowledge",
];

const PAGE_ALIASES = {
  dashboard: ["dashboard", "home"],
  orders: ["orders", "order"],
  "create-order": ["create-order", "create_order", "createOrder", "orders:create"],
  "device-entry": ["device-entry", "device_entry", "deviceEntry", "bulk-device"],
  "serial-search": ["serial-search", "serial_search", "serialSearch", "serial"],
  chat: ["chat", "support", "whatsapp"],
  knowledge: ["knowledge", "kb", "rag", "knowledge-base", "training"],
};

const ALIAS_TO_PAGE = Object.entries(PAGE_ALIASES).reduce((acc, [page, aliases]) => {
  acc[page.toLowerCase()] = page;
  aliases.forEach((alias) => {
    acc[String(alias).toLowerCase()] = page;
  });
  return acc;
}, {});

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    return ["1", "true", "yes", "on", "allow", "allowed"].includes(
      value.trim().toLowerCase(),
    );
  }
  return false;
}

function normalizePage(value) {
  if (!value) return null;
  return ALIAS_TO_PAGE[String(value).trim().toLowerCase()] || null;
}

function parseAccessValue(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["admin", "all", "full", "full_access"].includes(normalized)) {
      return [...ALL_PAGE_IDS];
    }
    return value
      .split(",")
      .map((item) => normalizePage(item))
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePage(item)).filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, allowed]) => isTruthy(allowed))
      .map(([page]) => normalizePage(page))
      .filter(Boolean);
  }

  return null;
}

export function accessFromMetadata(metadata = {}, defaultAllowed = false) {
  const meta = metadata || {};
  if (meta.active === false || isTruthy(meta.blocked) || isTruthy(meta.disabled)) {
    return { allowedPages: [], isAdmin: false };
  }

  const role = String(meta.role || meta.fol_role || "").trim().toLowerCase();
  if (["admin", "owner", "superadmin"].includes(role) || isTruthy(meta.is_admin)) {
    return { allowedPages: [...ALL_PAGE_IDS], isAdmin: true };
  }

  const raw =
    meta.fol_access ??
    meta.fastorder_access ??
    meta.allowed_pages ??
    meta.permissions ??
    meta.pages ??
    meta.access;

  const parsed = parseAccessValue(raw);
  if (parsed !== null) {
    return { allowedPages: Array.from(new Set(parsed)), isAdmin: false };
  }

  return {
    allowedPages: defaultAllowed ? [...ALL_PAGE_IDS] : [],
    isAdmin: false,
  };
}

export function accessFromServer(serverAccess, user, defaultAllowed = false) {
  if (serverAccess?.allowed_pages || serverAccess?.allowedPages) {
    const pages = serverAccess.allowed_pages || serverAccess.allowedPages || [];
    return {
      allowedPages: Array.from(new Set(pages.map((p) => normalizePage(p)).filter(Boolean))),
      isAdmin: Boolean(serverAccess.is_admin || serverAccess.isAdmin),
    };
  }
  return accessFromMetadata(user?.publicMetadata, defaultAllowed);
}

export function canAccessPage(access, pageId) {
  const page = normalizePage(pageId);
  if (!page) return false;
  return Boolean(access?.allowedPages?.includes(page));
}

export function firstAllowedPage(access) {
  return access?.allowedPages?.find((page) => ALL_PAGE_IDS.includes(page)) || null;
}
