// src/chat/ChatPage.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import ConversationsList from "./ConversationsList";
import ChatWindow from "./ChatWindow";
import ChatInfoPanel from "./ChatInfoPanel";
import { chatStyles } from "./styles";
import { fetchConversation } from "./chatApi";

function toChat(conversation) {
  if (!conversation) return null;
  return {
    id: conversation.id,
    name: conversation.wa_contact_name || conversation.phone_number,
    phone: conversation.phone_number,
    lastMsg: conversation.last_message,
    lastTime: conversation.last_message_at,
    status: conversation.status,
    flag: conversation.flag,
    unread: conversation.unread_count,
    linked_order_id: conversation.linked_order_id,
    is_human:
      conversation.is_human === true ||
      conversation.is_human === 1 ||
      conversation.is_human === "1",
  };
}

export default function ChatPage({ onOpenNav }) {
  const [activeChat, setActiveChat] = useState(null);
  const [mobilePane, setMobilePane] = useState("list"); // "list" | "chat"
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const fillInputRef = useRef(null);

  const handleSelectChat = useCallback((chat) => {
    setActiveChat(chat);
    setInfoPanelOpen(false);
    setMobilePane("chat");
  }, []);

  const openChatById = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const conversation = await fetchConversation(sessionId);
      handleSelectChat(toChat(conversation));
      window.__folPendingChatSessionId = null;
      const url = new URL(window.location.href);
      if (url.searchParams.has("chat_session")) {
        url.searchParams.delete("chat_session");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      // The conversation list will still refresh normally; keep notification click quiet.
    }
  }, [handleSelectChat]);

  useEffect(() => {
    const pending = window.__folPendingChatSessionId;
    if (pending) openChatById(pending);

    const params = new URLSearchParams(window.location.search);
    const sessionFromUrl = params.get("chat_session");
    if (sessionFromUrl) openChatById(sessionFromUrl);

    const onOpenById = (event) => {
      openChatById(event.detail?.session_id || event.detail?.sessionId);
    };
    const onOpenSession = (event) => {
      const chat = toChat(event.detail);
      if (chat) handleSelectChat(chat);
    };
    window.addEventListener("chat:open-session-by-id", onOpenById);
    window.addEventListener("chat:open-session", onOpenSession);
    return () => {
      window.removeEventListener("chat:open-session-by-id", onOpenById);
      window.removeEventListener("chat:open-session", onOpenSession);
    };
  }, [handleSelectChat, openChatById]);

  const handleResolved = (sessionId) => {
    if (activeChat?.id === sessionId)
      setActiveChat((p) => (p ? { ...p, status: "resolved" } : null));
  };

  const handleFlagChange = (sessionId, flag) => {
    if (activeChat?.id === sessionId)
      setActiveChat((p) => (p ? { ...p, flag } : null));
  };

  const handleModeChange = (sessionId, isHuman) => {
    if (activeChat?.id === sessionId)
      setActiveChat((p) => (p ? { ...p, is_human: isHuman } : null));
  };

  const handleContactSaved = (sessionId, contact) => {
    if (activeChat?.id === sessionId)
      setActiveChat((p) =>
        p
          ? {
              ...p,
              name: contact?.name || p.name,
              phone: contact?.phone || p.phone,
            }
          : null,
      );
  };

  const handleQuickReply = (text) => {
    if (fillInputRef.current) fillInputRef.current(text);
    setInfoPanelOpen(false);
  };

  const openInfoPanel = () => setInfoPanelOpen(true);
  const closeInfoPanel = () => setInfoPanelOpen(false);

  return (
    <Box sx={chatStyles.layout}>
      {/* ── Left sidebar / conversation list ─────────────────────────────── */}
      <Box
        sx={{
          ...chatStyles.sidebar,
          ...chatStyles.mobilePane(mobilePane === "list"),
        }}
      >
        <ConversationsList
          onSelectChat={handleSelectChat}
          activeId={activeChat?.id}
          onOpenNav={onOpenNav}
        />
      </Box>

      {/* ── Main chat column ──────────────────────────────────────────────── */}
      <Box
        sx={{
          ...chatStyles.main,
          ...chatStyles.mobilePane(mobilePane === "chat"),
          position: "relative",
        }}
      >
        <ChatWindow
          chat={activeChat}
          fillInputRef={fillInputRef}
          onBackToList={() => {
            setMobilePane("list");
            setInfoPanelOpen(false);
          }}
          onOpenInfo={openInfoPanel}
        />

        {/* Info panel overlay — rendered inside the main column so it doesn't
            cover the sidebar on desktop */}
        {infoPanelOpen && (
          <Box
            onClick={closeInfoPanel}
            sx={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.22)",
              zIndex: 100,
            }}
          />
        )}
        <Box sx={chatStyles.infoPanel(infoPanelOpen)}>
          <ChatInfoPanel
            chat={activeChat}
            onClose={closeInfoPanel}
            onResolved={handleResolved}
            onFlagChange={handleFlagChange}
            onModeChange={handleModeChange}
            onContactSaved={handleContactSaved}
            onQuickReply={handleQuickReply}
          />
        </Box>
      </Box>
    </Box>
  );
}
