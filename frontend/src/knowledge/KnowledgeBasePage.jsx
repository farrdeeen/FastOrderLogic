// src/knowledge/KnowledgeBasePage.jsx
// Admin panel for the sales agent's RAG knowledge base (ChromaDB):
// inspect, search, edit and prune what the bot knows + has learned, and reseed
// product/FAQ knowledge from the live catalogue + docs.

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Chip,
  IconButton,
  Stack,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import {
  Search as SearchIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Close as CloseIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import {
  fetchKnowledgeStats,
  fetchKnowledgeEntries,
  updateKnowledgeEntry,
  deleteKnowledgeEntry,
  reseedKnowledge,
} from "./knowledgeApi";

const COLLECTIONS = [
  { id: "sales_learning", label: "Sales Learning", hint: "Answers taught by operators" },
  { id: "product_knowledge", label: "Products", hint: "From the live catalogue" },
  { id: "faq_policy", label: "FAQ & Policies", hint: "From the training doc" },
];

function Banner({ msg }) {
  if (!msg) return null;
  const ok = msg.type !== "error";
  return (
    <Box
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: 2,
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${ok ? "#bbf7d0" : "#fecaca"}`,
        background: ok ? "#ecfdf3" : "#fef2f2",
        color: ok ? "#166534" : "#991b1b",
      }}
    >
      {msg.text}
    </Box>
  );
}

function EntryCard({ collection, entry, onDelete, onSave }) {
  const meta = entry.metadata || {};
  const isSale = collection === "sales_learning";
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(meta.question || entry.document || "");
  const [answer, setAnswer] = useState(meta.answer || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(entry.id, {
        document: isSale ? question : entry.document,
        metadata: isSale ? { question, answer } : meta,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, borderRadius: 2, borderColor: "#e5e7eb" }}
    >
      {isSale ? (
        editing ? (
          <Stack spacing={1}>
            <TextField
              size="small"
              label="Customer question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              fullWidth
            />
            <TextField
              size="small"
              label="Best reply (taught answer)"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button size="small" startIcon={<CloseIcon />} onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={busy}>
                Save
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={0.5}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
              Q: {meta.question || entry.document}
            </Typography>
            <Typography sx={{ fontSize: 13, color: "#475569", whiteSpace: "pre-wrap" }}>
              A: {meta.answer || <em>(no answer stored)</em>}
            </Typography>
            <Stack direction="row" spacing={0.5} justifyContent="flex-end">
              {typeof entry.distance === "number" && (
                <Chip size="small" label={`match ${(1 - entry.distance).toFixed(2)}`} sx={{ mr: "auto" }} />
              )}
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => setEditing(true)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" color="error" onClick={() => onDelete(entry.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
        )
      ) : (
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            {meta.name && <Chip size="small" color="primary" label={meta.name} />}
            {meta.category && <Chip size="small" variant="outlined" label={meta.category} />}
            {meta.price && <Chip size="small" variant="outlined" label={meta.price} />}
            {meta.source && <Chip size="small" variant="outlined" label={meta.source} />}
            {typeof entry.distance === "number" && (
              <Chip size="small" label={`match ${(1 - entry.distance).toFixed(2)}`} />
            )}
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: "#475569", whiteSpace: "pre-wrap" }}>
            {entry.document}
          </Typography>
          <Box sx={{ textAlign: "right" }}>
            <Tooltip title="Delete">
              <IconButton size="small" color="error" onClick={() => onDelete(entry.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Stack>
      )}
    </Paper>
  );
}

export default function KnowledgeBasePage() {
  const [stats, setStats] = useState(null);
  const [collection, setCollection] = useState("sales_learning");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reseeding, setReseeding] = useState(false);
  const [banner, setBanner] = useState(null);

  const flash = (text, type = "success") => {
    setBanner({ text, type });
    setTimeout(() => setBanner(null), 3500);
  };

  const loadStats = useCallback(async () => {
    try {
      setStats(await fetchKnowledgeStats());
    } catch {
      setStats({ available: false });
    }
  }, []);

  const loadItems = useCallback(async (col, q) => {
    setLoading(true);
    try {
      const data = await fetchKnowledgeEntries(col, { q, limit: 100 });
      setItems(data.items || []);
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to load entries.";
      flash(detail, "error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadItems(collection, "");
    setQuery("");
  }, [collection, loadItems]);

  const handleDelete = async (id) => {
    if (!window.confirm("Remove this entry from the knowledge base?")) return;
    try {
      await deleteKnowledgeEntry(collection, id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      loadStats();
      flash("Entry removed.");
    } catch {
      flash("Delete failed.", "error");
    }
  };

  const handleSave = async (id, payload) => {
    try {
      const res = await updateKnowledgeEntry(collection, id, payload);
      setItems((prev) => prev.map((x) => (x.id === id ? res.entry || x : x)));
      flash("Saved.");
    } catch {
      flash("Save failed.", "error");
    }
  };

  const handleReseed = async () => {
    if (!window.confirm("Rebuild product + FAQ knowledge from the live catalogue and docs?")) return;
    setReseeding(true);
    try {
      const res = await reseedKnowledge();
      flash(`Reseeded: ${res.products || 0} products, ${res.faq || 0} FAQ chunks.`);
      loadStats();
      loadItems(collection, query);
    } catch (err) {
      const detail = err?.response?.data?.detail || "Reseed failed.";
      flash(detail, "error");
    } finally {
      setReseeding(false);
    }
  };

  const counts = stats?.collections || {};
  const unavailable = stats && stats.available === false;

  return (
    <Box sx={{ maxWidth: 920, width: "100%" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1.5}>
        <Box>
          <Typography sx={{ fontSize: 14, color: "#64748b" }}>
            What the AI sales agent knows and has learned. Search, edit taught answers, or prune mistakes.
          </Typography>
          {stats && (
            <Typography sx={{ fontSize: 12, color: "#94a3b8", mt: 0.5 }}>
              Embedder: {stats.embedder || "—"} · {stats.embed_model || ""}
            </Typography>
          )}
        </Box>
        <Button
          variant="outlined"
          startIcon={reseeding ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={handleReseed}
          disabled={reseeding || unavailable}
        >
          {reseeding ? "Reseeding…" : "Reseed products + FAQ"}
        </Button>
      </Stack>

      {banner && <Box mb={1.5}><Banner msg={banner} /></Box>}

      {unavailable && (
        <Banner
          msg={{
            type: "error",
            text:
              "Knowledge base is unavailable on the server (chromadb/fastembed not installed). The bot is using keyword fallback.",
          }}
        />
      )}

      {/* Collection tabs */}
      <Stack direction="row" spacing={1} mb={1.5} flexWrap="wrap">
        {COLLECTIONS.map((c) => (
          <Button
            key={c.id}
            size="small"
            variant={collection === c.id ? "contained" : "outlined"}
            onClick={() => setCollection(c.id)}
            sx={{ borderRadius: 2, textTransform: "none" }}
          >
            {c.label}
            <Chip
              size="small"
              label={counts[c.id] ?? 0}
              sx={{ ml: 1, height: 18, bgcolor: collection === c.id ? "rgba(255,255,255,0.3)" : "#e2e8f0" }}
            />
          </Button>
        ))}
      </Stack>

      {/* Search */}
      <Stack direction="row" spacing={1} mb={2}>
        <TextField
          size="small"
          fullWidth
          placeholder={`Search ${COLLECTIONS.find((c) => c.id === collection)?.label} (Hinglish ok)…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadItems(collection, query)}
          disabled={unavailable}
        />
        <Button variant="contained" startIcon={<SearchIcon />} onClick={() => loadItems(collection, query)} disabled={unavailable}>
          Search
        </Button>
        {query && (
          <Button onClick={() => { setQuery(""); loadItems(collection, ""); }}>Clear</Button>
        )}
      </Stack>

      {/* List */}
      {loading ? (
        <Box sx={{ textAlign: "center", py: 4 }}><CircularProgress size={24} /></Box>
      ) : items.length === 0 ? (
        <Typography sx={{ color: "#94a3b8", fontSize: 14, py: 3, textAlign: "center" }}>
          {unavailable ? "—" : "No entries yet."}
        </Typography>
      ) : (
        <Stack spacing={1.25}>
          {items.map((entry) => (
            <EntryCard
              key={entry.id}
              collection={collection}
              entry={entry}
              onDelete={handleDelete}
              onSave={handleSave}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}
