import { Box, Typography, TextField, IconButton } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useState } from "react";

export default function ChatWindow({ chat }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { from: "user", text: input }]);
    setInput("");
  };

  if (!chat) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          color: "#777",
        }}
      >
        <Typography>Select a conversation</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: "1px solid #ddd", background: "#fff" }}>
        <Typography variant="h6">{chat.name}</Typography>
      </Box>

      {/* Messages */}
      <Box
        sx={{
          flexGrow: 1,
          p: 2,
          overflowY: "auto",
          background: "#f7f7f7",
        }}
      >
        {messages.map((msg, i) => (
          <Box
            key={i}
            sx={{
              textAlign: msg.from === "user" ? "right" : "left",
              mb: 1,
            }}
          >
            <Box
              sx={{
                display: "inline-block",
                p: 1.2,
                px: 2,
                borderRadius: 2,
                background: msg.from === "user" ? "#d1f1ff" : "#e8e8e8",
              }}
            >
              {msg.text}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Input */}
      <Box sx={{ display: "flex", p: 2, background: "#fff" }}>
        <TextField
          placeholder="Type a message…"
          fullWidth
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <IconButton onClick={sendMessage}>
          <SendIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
