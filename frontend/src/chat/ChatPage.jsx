// src/chat/ChatPage.jsx
import { useState, useRef } from "react";
import { Box, Typography } from "@mui/material";
import ConversationsList from "./ConversationsList";
import ChatWindow from "./ChatWindow";
import ChatInfoPanel from "./ChatInfoPanel";
import { chatStyles } from "./styles";

export default function ChatPage() {
  const [activeChat, setActiveChat] = useState(null);
  // Ref lets ChatPage push a prefilled message into ChatWindow without
  // prop-drilling a controlled input — ChatWindow exposes a fill() handle.
  const fillInputRef = useRef(null);

  const handleResolved = (sessionId) => {
    if (activeChat?.id === sessionId) {
      setActiveChat((prev) => (prev ? { ...prev, status: "resolved" } : null));
    }
  };

  const handleFlagChange = (sessionId, flag) => {
    if (activeChat?.id === sessionId) {
      setActiveChat((prev) => (prev ? { ...prev, flag } : null));
    }
  };

  // Quick reply from panel → prefill the input in ChatWindow
  const handleQuickReply = (text) => {
    if (fillInputRef.current) fillInputRef.current(text);
  };

  return (
    <Box sx={chatStyles.layout}>
      {/* ── Left sidebar ── */}
      <Box sx={chatStyles.sidebar}>
        <Box
          sx={{
            px: "16px",
            py: "12px",
            borderBottom:
              "0.5px solid var(--color-border-tertiary, rgba(0,0,0,0.15))",
            background: "var(--color-background-secondary, #f8fafc)",
            flexShrink: 0,
          }}
        >
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            WhatsApp Chats
          </Typography>
        </Box>
        <ConversationsList
          onSelectChat={setActiveChat}
          activeId={activeChat?.id}
        />
      </Box>

      {/* ── Main message area ── */}
      <Box sx={{ ...chatStyles.main, minWidth: 0 }}>
        <ChatWindow chat={activeChat} fillInputRef={fillInputRef} />
      </Box>

      {/* ── Right info panel ── */}
      <Box sx={chatStyles.panel}>
        <ChatInfoPanel
          chat={activeChat}
          onResolved={handleResolved}
          onFlagChange={handleFlagChange}
          onQuickReply={handleQuickReply}
        />
      </Box>
    </Box>
  );
}
