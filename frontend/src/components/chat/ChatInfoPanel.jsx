import { Box, Typography } from "@mui/material";

export default function ChatInfoPanel({ chat }) {
  if (!chat)
    return (
      <Box sx={{ p: 2 }}>
        <Typography sx={{ color: "#777" }}>No user selected</Typography>
      </Box>
    );

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        User Info
      </Typography>

      <Typography>Name: {chat.name}</Typography>
      <Typography>Last message: {chat.lastMsg}</Typography>
    </Box>
  );
}
