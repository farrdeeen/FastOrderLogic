// src/chat/ChatPage.jsx
import { useState, useRef } from "react";
import { Box } from "@mui/material";
import ConversationsList from "./ConversationsList";
import ChatWindow from "./ChatWindow";
import ChatInfoPanel from "./ChatInfoPanel";
import { chatStyles } from "./styles";

export default function ChatPage({ onOpenNav }) {
  const [activeChat, setActiveChat] = useState(null);
  const [mobilePane, setMobilePane] = useState("list"); // "list" | "chat"
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const fillInputRef = useRef(null);

  const handleSelectChat = (chat) => {
    setActiveChat(chat);
    setInfoPanelOpen(false);
    setMobilePane("chat");
  };

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
            onQuickReply={handleQuickReply}
          />
        </Box>
      </Box>
    </Box>
  );
}
