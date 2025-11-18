import { Box, Typography, Avatar } from "@mui/material";
import { useState } from "react";

const sampleChats = [
  { id: 1, name: "Chauhan", lastMsg: "Sir ye kya problem...", time: "now" },
  { id: 2, name: "Sk Arshed Ali", lastMsg: "Pls connect", time: "7 min" },
  { id: 3, name: "Parmeshwar Singh", lastMsg: "Sir I am parmes...", time: "21 min" },
];

export default function ConversationsList({ onSelectChat }) {
  const [selected, setSelected] = useState(null);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
        All Conversations
      </Typography>

      {sampleChats.map((chat) => (
        <Box
          key={chat.id}
          onClick={() => {
            setSelected(chat.id);
            onSelectChat(chat);
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            p: 1.2,
            mb: 1,
            borderRadius: 2,
            cursor: "pointer",
            background: selected === chat.id ? "#e8f1ff" : "transparent",
            "&:hover": { background: "#f4f4f4" },
          }}
        >
          <Avatar>{chat.name.charAt(0)}</Avatar>

          <Box sx={{ flexGrow: 1 }}>
            <Typography sx={{ fontWeight: 600 }}>{chat.name}</Typography>
            <Typography sx={{ fontSize: "0.85rem", color: "#555" }}>
              {chat.lastMsg}
            </Typography>
          </Box>

          <Typography sx={{ fontSize: "0.8rem", color: "#777" }}>
            {chat.time}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
