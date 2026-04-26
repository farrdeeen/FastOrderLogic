// src/chat/ConversationsList.jsx
import { useState, useEffect, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import { fetchConversations } from "./chatApi";
import { chatStyles, CHAT_FILTERS, FLAG_COLORS, avatarColor } from "./styles";

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

// Derive badge types from a conversation object
function getBadges(conv) {
  const badges = [];
  if (conv.unread_count > 0) badges.push("new");
  if (conv.flag === "flagged") badges.push("flagged");
  if (conv.flag === "urgent") badges.push("urgent");
  if (conv.linked_order_id) badges.push("order");
  if (conv.status === "resolved") badges.push("resolved");
  return badges;
}

// Match a conversation against an active filter id
function matchesFilter(conv, filterId) {
  if (filterId === "all") return true;
  if (filterId === "flagged") return conv.flag === "flagged";
  if (filterId === "urgent") return conv.flag === "urgent";
  if (filterId === "active") return conv.status === "active";
  if (filterId === "orders") return !!conv.linked_order_id;
  if (filterId === "resolved") return conv.status === "resolved";
  return true;
}

export default function ConversationsList({ onSelectChat, activeId }) {
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchConversations({ search, limit: 100 });
      setConversations(data);
      setError(null);
    } catch {
      setError("Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Initial load + poll every 20 s
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const visible = conversations.filter((c) => matchesFilter(c, activeFilter));

  return (
    <Box sx={chatStyles.convList}>
      {/* Search */}
      <Box sx={chatStyles.sidebarHeader}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations..."
          style={chatStyles.searchInput}
        />
      </Box>

      {/* Filter pills */}
      <Box sx={chatStyles.filterRow}>
        {CHAT_FILTERS.map((f) => {
          const isActive = activeFilter === f.id;
          const activeStyle = isActive
            ? chatStyles.pillActive[f.activeVariant] ||
              chatStyles.pillActive.all
            : {};
          return (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              style={{ ...chatStyles.pill, ...activeStyle }}
            >
              {f.label}
            </button>
          );
        })}
      </Box>

      {/* List */}
      <Box sx={{ overflowY: "auto", flex: 1 }}>
        {loading && (
          <Typography
            sx={{
              p: 2,
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-tertiary)",
            }}
          >
            Loading…
          </Typography>
        )}
        {error && (
          <Typography
            sx={{
              p: 2,
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-danger, #c0392b)",
            }}
          >
            {error}
          </Typography>
        )}
        {!loading && visible.length === 0 && (
          <Typography
            sx={{
              p: 2,
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-tertiary)",
            }}
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
          const hasUnread = conv.unread_count > 0;

          return (
            <Box
              key={conv.id}
              onClick={() =>
                onSelectChat({
                  id: conv.id,
                  name: conv.wa_contact_name || conv.phone_number,
                  phone: conv.phone_number,
                  lastMsg: conv.last_message,
                  lastTime: conv.last_message_at,
                  status: conv.status,
                  flag: conv.flag,
                  unread: conv.unread_count,
                  linked_order_id: conv.linked_order_id,
                })
              }
              sx={{
                ...chatStyles.convItem(isActive),
                cursor: "pointer",
              }}
            >
              {/* Unread dot */}
              {hasUnread ? (
                <Box sx={chatStyles.unreadDot} />
              ) : (
                <Box sx={{ width: "7px", flexShrink: 0 }} />
              )}

              {/* Avatar */}
              <Box sx={chatStyles.avatar(bg, text, 34)}>{initials}</Box>

              {/* Text content */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: "2px",
                  }}
                >
                  <Typography sx={chatStyles.convName}>
                    {conv.wa_contact_name || conv.phone_number}
                  </Typography>
                  <Typography sx={chatStyles.convTime}>
                    {formatTime(conv.last_message_at)}
                  </Typography>
                </Box>

                <Typography sx={chatStyles.convPreview}>
                  {conv.last_message || "No messages yet"}
                </Typography>

                {/* Badges */}
                {badges.length > 0 && (
                  <Box sx={chatStyles.convBadges}>
                    {badges.map((b) => (
                      <span key={b} style={chatStyles.badge(b)}>
                        {b === "order" && conv.linked_order_id
                          ? `order #${conv.linked_order_id}`
                          : b}
                      </span>
                    ))}
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
