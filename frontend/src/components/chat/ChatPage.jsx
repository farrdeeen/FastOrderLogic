import { Box } from "@mui/material";
import ConversationsList from "./ConversationsList";
import ChatWindow from "./ChatWindow";
import ChatInfoPanel from "./ChatInfoPanel";
import { useState } from "react";

export default function ChatPage() {
  const [activeChat, setActiveChat] = useState(null);

  return (
    <Box
      sx={{
        display: "flex",
        height: "80vh",
        background: "#f0f2f5",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* LEFT – chat list */}
      <Box
        sx={{
          width: "25%",
          borderRight: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <ConversationsList onSelectChat={setActiveChat} />
      </Box>

      {/* MIDDLE – chat window */}
      <Box sx={{ width: "50%", background: "#fafafa" }}>
        <ChatWindow chat={activeChat} />
      </Box>

      {/* RIGHT – info panel */}
      <Box
        sx={{
          width: "25%",
          borderLeft: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <ChatInfoPanel chat={activeChat} />
      </Box>
    </Box>
  );
}
