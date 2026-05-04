// src/chat/HumanTogglePanel.jsx
import { useState, useCallback } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "";

async function apiToggleHuman(phone, isHuman) {
  const resp = await axios.post(`${API_BASE}/chat/toggle-human`, {
    phone,
    is_human: isHuman,
  });
  return resp.data;
}

// ── Mode badge ────────────────────────────────────────────────────────────────
function ModeBadge({ isHuman }) {
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        px: "8px",
        py: "2px",
        borderRadius: "20px",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.3px",
        background: isHuman ? "#FFF3CD" : "#E8F5E9",
        color: isHuman ? "#856404" : "#1B5E20",
        border: `1px solid ${isHuman ? "#FFEAA7" : "#A5D6A7"}`,
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: 12 }}>{isHuman ? "👨" : "🤖"}</span>
      {isHuman ? "HUMAN MODE" : "AI MODE"}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HumanTogglePanel({ chat, onModeChange }) {
  const [isHuman, setIsHuman] = useState(chat?.is_human ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastToggled, setLastToggled] = useState(null);

  const handleToggle = useCallback(async () => {
    if (!chat?.phone || loading) return;
    const next = !isHuman;
    setLoading(true);
    setError(null);
    try {
      await apiToggleHuman(chat.phone, next);
      setIsHuman(next);
      setLastToggled(new Date());
      if (onModeChange) onModeChange(chat.id, next);
    } catch (err) {
      setError(
        err?.response?.data?.detail || "Failed to toggle mode. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [chat, isHuman, loading, onModeChange]);

  if (!chat) return null;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "12px",
        borderRadius: "10px",
        border: "0.5px solid var(--color-border-secondary)",
        background: isHuman
          ? "rgba(255,243,205,0.3)"
          : "var(--color-background-primary)",
        transition: "background 0.3s ease",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--color-text-secondary)",
            letterSpacing: "0.5px",
          }}
        >
          RESPONSE MODE
        </Typography>
        <ModeBadge isHuman={isHuman} />
      </Box>

      {/* Description */}
      <Typography
        sx={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          lineHeight: 1.5,
        }}
      >
        {isHuman
          ? "🔕 AI is paused. Messages are stored but not auto-replied. You are responding manually."
          : "🤖 AI is active and auto-replying to this customer."}
      </Typography>

      {/* Toggle button */}
      <button
        onClick={handleToggle}
        disabled={loading}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "9px 14px",
          borderRadius: "8px",
          border: `1.5px solid ${isHuman ? "#FFEAA7" : "var(--color-border-secondary)"}`,
          background: isHuman ? "#FFF3CD" : "var(--color-background-secondary)",
          color: isHuman ? "#856404" : "var(--color-text-primary)",
          fontSize: 12,
          fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
          transition: "all 0.2s ease",
          width: "100%",
        }}
      >
        {loading ? (
          <>
            <CircularProgress size={12} thickness={4} />
            Switching…
          </>
        ) : isHuman ? (
          "↩ Switch to AI Mode"
        ) : (
          "👨 Take Over (Human Mode)"
        )}
      </button>

      {/* Human mode active indicator */}
      {isHuman && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "7px 10px",
            borderRadius: "6px",
            background: "#FFF8E1",
            border: "1px solid #FFE082",
          }}
        >
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#F59E0B",
              animation: "pulse 1.5s infinite",
              "@keyframes pulse": {
                "0%, 100%": { opacity: 1 },
                "50%": { opacity: 0.4 },
              },
            }}
          />
          <Typography sx={{ fontSize: 10, color: "#92400E", fontWeight: 500 }}>
            Human is responding…
          </Typography>
        </Box>
      )}

      {/* Last toggled */}
      {lastToggled && (
        <Typography sx={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>
          Mode changed at{" "}
          {lastToggled.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Typography>
      )}

      {/* Error */}
      {error && (
        <Typography sx={{ fontSize: 11, color: "#c0392b", mt: "2px" }}>
          ⚠ {error}
        </Typography>
      )}
    </Box>
  );
}
