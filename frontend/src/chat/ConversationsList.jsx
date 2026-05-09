// src/chat/ConversationsList.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { Bell, Menu, Search, MessageCirclePlus } from "lucide-react";
import { fetchConversations, getChatWsUrl } from "./chatApi";
import {
  chatStyles,
  CHAT_FILTERS,
  FLAG_COLORS,
  avatarColor,
  WA,
} from "./styles";

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function getBadges(conv) {
  const badges = [];
  if (conv.flag === "flagged") badges.push("flagged");
  if (conv.flag === "urgent") badges.push("urgent");
  if (conv.linked_order_id) badges.push("order");
  if (conv.status === "resolved") badges.push("resolved");
  return badges;
}

function matchesFilter(conv, filterId) {
  if (filterId === "all") return true;
  if (filterId === "flagged") return conv.flag === "flagged";
  if (filterId === "urgent") return conv.flag === "urgent";
  if (filterId === "active") return conv.status === "active";
  if (filterId === "orders") return !!conv.linked_order_id;
  if (filterId === "resolved") return conv.status === "resolved";
  return true;
}

function toChat(conv) {
  return {
    id: conv.id,
    name: conv.wa_contact_name || conv.phone_number,
    phone: conv.phone_number,
    lastMsg: conv.last_message,
    lastTime: conv.last_message_at,
    status: conv.status,
    flag: conv.flag,
    unread: conv.unread_count,
    linked_order_id: conv.linked_order_id,
    is_human: Boolean(conv.is_human),
  };
}

export default function ConversationsList({ onSelectChat, activeId, onOpenNav }) {
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof window === "undefined" || !("Notification" in window))
      return "unsupported";
    return Notification.permission;
  });

  const latestRef = useRef(new Map());
  const loadedOnce = useRef(false);
  const activeIdRef = useRef(activeId);
  const wsRef = useRef(null);
  const wsReconnectRef = useRef(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const requestNotifications = useCallback(async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const p = await Notification.requestPermission();
    setNotificationPermission(p);
  }, []);

  const notifyConv = useCallback(
    (conv) => {
      if (!("Notification" in window) || Notification.permission !== "granted")
        return;
      if (
        document.visibilityState === "visible" &&
        activeIdRef.current === conv.id
      )
        return;
      const name = conv.wa_contact_name || conv.phone_number || "Customer";
      let n;
      try {
        n = new Notification(`New message from ${name}`, {
          body: conv.last_message || "New message",
          tag: `chat-${conv.id}`,
          renotify: true,
        });
      } catch {
        return;
      }
      n.onclick = () => {
        window.focus();
        onSelectChat(toChat(conv));
        n.close();
      };
    },
    [onSelectChat],
  );

  const load = useCallback(async () => {
    try {
      const data = await fetchConversations({ search, limit: 100 });
      data.forEach((conv) => {
        const key = [
          conv.last_message_at || "",
          conv.last_message || "",
          conv.unread_count || 0,
        ].join("|");
        const prev = latestRef.current.get(conv.id);
        if (
          loadedOnce.current &&
          prev !== key &&
          Number(conv.unread_count || 0) > 0
        )
          notifyConv(conv);
        latestRef.current.set(conv.id, key);
      });
      loadedOnce.current = true;
      setConversations(data);
      setError(null);
    } catch {
      setError("Failed to load conversations.");
    } finally {
      setLoading(false);
    }
  }, [notifyConv, search]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    let stopped = false;

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
        load();
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
  }, [load]);

  const visible = conversations.filter((c) => matchesFilter(c, activeFilter));

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <Box sx={chatStyles.sidebarHeader}>
        {onOpenNav && (
          <Box
            component="button"
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation"
            sx={chatStyles.mobileMenuButton}
          >
            <Menu size={20} strokeWidth={2} />
          </Box>
        )}
        <Box component="span" sx={chatStyles.sidebarTitle}>
          Chats
        </Box>
        <Box sx={chatStyles.sidebarActions}>
          {notificationPermission !== "granted" &&
            notificationPermission !== "unsupported" && (
              <Box
                component="button"
                type="button"
                onClick={requestNotifications}
                title="Enable notifications"
                aria-label="Enable notifications"
                sx={chatStyles.iconCircleBtn}
              >
                <Bell size={17} strokeWidth={2} />
              </Box>
            )}
          <Box
            component="button"
            type="button"
            title="New chat"
            aria-label="New chat"
            sx={chatStyles.iconCircleBtn}
          >
            <MessageCirclePlus size={17} strokeWidth={2} />
          </Box>
        </Box>
      </Box>

      {/* ── Search ── */}
      <Box sx={chatStyles.searchBox}>
        <Box sx={chatStyles.searchWrap}>
          <Box sx={chatStyles.searchIcon}>
            <Search size={14} strokeWidth={2} />
          </Box>
          <Box
            component="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or start new chat"
            sx={chatStyles.searchInput}
          />
        </Box>
      </Box>

      {/* ── Filter pills ── */}
      <Box sx={chatStyles.filterRow}>
        {CHAT_FILTERS.map((f) => {
          const isActive = activeFilter === f.id;
          const active = isActive
            ? chatStyles.pillActive[f.activeVariant] ||
              chatStyles.pillActive.all
            : {};
          return (
            <Box
              component="button"
              type="button"
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              sx={{ ...chatStyles.pill, ...active }}
            >
              {f.label}
            </Box>
          );
        })}
      </Box>

      {/* ── List ── */}
      <Box sx={chatStyles.convList}>
        {loading && (
          <Typography
            sx={{ p: 3, textAlign: "center", fontSize: 13, color: WA.textSub }}
          >
            Loading…
          </Typography>
        )}
        {error && (
          <Typography
            sx={{ p: 3, textAlign: "center", fontSize: 13, color: "#E53935" }}
          >
            {error}
          </Typography>
        )}
        {!loading && visible.length === 0 && (
          <Typography
            sx={{ p: 3, textAlign: "center", fontSize: 13, color: WA.textSub }}
          >
            No conversations found
          </Typography>
        )}

        {visible.map((conv) => {
          const isActive = activeId === conv.id;
          const { bg, text } = avatarColor(
            conv.wa_contact_name || conv.phone_number,
          );
          const initials = (conv.wa_contact_name || conv.phone_number || "?")
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();
          const badges = getBadges(conv);
          const unread = Number(conv.unread_count || 0);
          const hasUnread = unread > 0;

          return (
            <Box
              key={conv.id}
              onClick={() => onSelectChat(toChat(conv))}
              sx={chatStyles.convItem(isActive)}
            >
              {/* Avatar */}
              <Box sx={chatStyles.avatar(bg, text, 46)}>{initials}</Box>

              {/* Content */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {/* Row 1: name + time */}
                <Box sx={chatStyles.convMeta}>
                  <Typography
                    sx={{
                      ...chatStyles.convName,
                      fontWeight: hasUnread ? 600 : 500,
                    }}
                  >
                    {conv.wa_contact_name || conv.phone_number}
                  </Typography>
                  <Typography
                    sx={{
                      ...chatStyles.convTime,
                      color: hasUnread ? WA.greenAccent : WA.textSub,
                      fontWeight: hasUnread ? 600 : 400,
                    }}
                  >
                    {formatTime(conv.last_message_at)}
                  </Typography>
                </Box>

                {/* Row 2: preview + unread badge */}
                <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Typography
                    sx={{
                      ...chatStyles.convPreview,
                      fontWeight: hasUnread ? 500 : 400,
                      color: hasUnread ? WA.textPrimary : WA.textSub,
                    }}
                  >
                    {conv.last_message || "No messages yet"}
                  </Typography>
                  {hasUnread && (
                    <Box sx={chatStyles.unreadBadge}>
                      {unread > 99 ? "99+" : unread}
                    </Box>
                  )}
                </Box>

                {/* Badges row */}
                {badges.length > 0 && (
                  <Box sx={chatStyles.convBadges}>
                    {badges.map((b) => (
                      <span key={b} style={chatStyles.badge(b)}>
                        {b === "order" && conv.linked_order_id
                          ? `#${conv.linked_order_id}`
                          : b}
                      </span>
                    ))}
                    {conv.is_human && (
                      <span style={chatStyles.badge("flagged")}>👨 human</span>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
