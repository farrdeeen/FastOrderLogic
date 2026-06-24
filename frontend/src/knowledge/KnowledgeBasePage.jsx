// src/knowledge/KnowledgeBasePage.jsx
// Admin panel for the sales agent's RAG knowledge base (ChromaDB):
// inspect, search, edit and prune what the bot knows + has learned, edit the
// training doc, upload labeled documents, and reseed from the live catalogue.

import { useCallback, useEffect, useState } from "react";
import {
  Box, Paper, Typography, Button, TextField, Chip, IconButton, Stack,
  CircularProgress, Tooltip, InputAdornment,
} from "@mui/material";
import {
  Search as SearchIcon, Delete as DeleteIcon, Edit as EditIcon, Save as SaveIcon,
  Close as CloseIcon, Refresh as RefreshIcon, Psychology as BrainIcon,
  Inventory2 as ProductIcon, MenuBook as FaqIcon, School as LearnIcon,
  UploadFile as UploadIcon, Article as DocIcon,
} from "@mui/icons-material";
import {
  fetchKnowledgeStats, fetchKnowledgeEntries, updateKnowledgeEntry, deleteKnowledgeEntry,
  reseedKnowledge, getTrainingDoc, saveTrainingDoc, listDocuments, uploadDocument, deleteDocument,
} from "./knowledgeApi";

const COLLECTIONS = [
  { id: "sales_learning", label: "Sales Learning", hint: "Answers taught by operators", icon: <LearnIcon />, color: "#7c3aed", bg: "#f3e8ff" },
  { id: "product_knowledge", label: "Products", hint: "From the live catalogue", icon: <ProductIcon />, color: "#2563eb", bg: "#dbeafe" },
  { id: "faq_policy", label: "FAQ & Policies", hint: "Training doc + uploaded docs", icon: <FaqIcon />, color: "#0d9488", bg: "#ccfbf1" },
];

const CARD = { borderRadius: 3, border: "1px solid #eceef3", boxShadow: "0 1px 3px rgba(16,24,40,0.04)" };

function Banner({ msg }) {
  if (!msg) return null;
  const ok = msg.type !== "error";
  return (
    <Box sx={{
      px: 1.75, py: 1.1, borderRadius: 2, fontSize: 13, fontWeight: 600,
      border: `1px solid ${ok ? "#a7f3d0" : "#fecaca"}`,
      background: ok ? "#ecfdf5" : "#fef2f2", color: ok ? "#047857" : "#b91c1c",
    }}>
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
  const match = typeof entry.distance === "number" ? (1 - entry.distance) : null;

  const save = async () => {
    setBusy(true);
    try {
      await onSave(entry.id, {
        document: isSale ? question : entry.document,
        metadata: isSale ? { ...meta, question, answer } : meta,
      });
      setEditing(false);
    } finally { setBusy(false); }
  };

  return (
    <Paper sx={{ ...CARD, p: 1.75, transition: "border-color .15s", "&:hover": { borderColor: "#d6d9e0" } }}>
      {isSale ? (
        editing ? (
          <Stack spacing={1}>
            <TextField size="small" label="Customer question" value={question} onChange={(e) => setQuestion(e.target.value)} fullWidth />
            <TextField size="small" label="Best reply (taught answer)" value={answer} onChange={(e) => setAnswer(e.target.value)} fullWidth multiline minRows={2} />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button size="small" startIcon={<CloseIcon />} onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
              <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={busy}>Save</Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={0.75}>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: "#7c3aed", flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: "#1e293b" }}>{meta.question || entry.document}</Typography>
                <Typography sx={{ fontSize: 13, color: "#475569", whiteSpace: "pre-wrap", mt: 0.25 }}>
                  {meta.answer || <em style={{ color: "#94a3b8" }}>(no answer stored)</em>}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center">
              {match != null && <Chip size="small" label={`${Math.round(match * 100)}% match`} sx={{ height: 20, fontSize: 11, bgcolor: "#eef2ff", color: "#4338ca" }} />}
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(true)}><EditIcon fontSize="small" /></IconButton></Tooltip>
              <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => onDelete(entry.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
            </Stack>
          </Stack>
        )
      ) : (
        <Stack spacing={0.75}>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            {meta.name && <Chip size="small" label={meta.name} sx={{ height: 22, fontWeight: 700, bgcolor: "#dbeafe", color: "#1d4ed8" }} />}
            {meta.category && <Chip size="small" variant="outlined" label={meta.category} sx={{ height: 22 }} />}
            {meta.price && <Chip size="small" label={meta.price} sx={{ height: 22, bgcolor: "#dcfce7", color: "#15803d", fontWeight: 700 }} />}
            {meta.label && <Chip size="small" label={meta.label} sx={{ height: 22, bgcolor: "#fef3c7", color: "#b45309", fontWeight: 700 }} />}
            {meta.source && !meta.label && <Chip size="small" variant="outlined" label={meta.source} sx={{ height: 22 }} />}
            {match != null && <Chip size="small" label={`${Math.round(match * 100)}%`} sx={{ height: 22, bgcolor: "#eef2ff", color: "#4338ca" }} />}
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: "#475569", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{entry.document}</Typography>
          <Box sx={{ textAlign: "right" }}>
            <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => onDelete(entry.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
          </Box>
        </Stack>
      )}
    </Paper>
  );
}

function DocsAndTrainingPanel({ onChanged }) {
  const [doc, setDoc] = useState("");
  const [docLoaded, setDocLoaded] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [docs, setDocs] = useState([]);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(false);

  const flash = (text, type = "success") => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3500); };

  useEffect(() => {
    getTrainingDoc().then((c) => { setDoc(c); setDocLoaded(true); }).catch(() => setDocLoaded(true));
    listDocuments().then(setDocs).catch(() => {});
  }, []);

  const handleSaveDoc = async () => {
    setSavingDoc(true);
    try { await saveTrainingDoc(doc); flash("Training document saved & re-indexed."); onChanged?.(); }
    catch (e) { flash(e?.response?.data?.detail || "Save failed.", "error"); }
    finally { setSavingDoc(false); }
  };
  const handleUpload = async () => {
    if (!file) return flash("Choose a file first.", "error");
    setUploading(true);
    try { await uploadDocument(file, label || "document"); flash("Document uploaded & indexed."); setFile(null); setLabel(""); setDocs(await listDocuments()); onChanged?.(); }
    catch (e) { flash(e?.response?.data?.detail || "Upload failed.", "error"); }
    finally { setUploading(false); }
  };
  const handleDeleteDoc = async (name) => {
    if (!window.confirm("Remove this document from the knowledge base?")) return;
    try { await deleteDocument(name); setDocs(await listDocuments()); onChanged?.(); flash("Document removed."); }
    catch { flash("Delete failed.", "error"); }
  };

  return (
    <Paper sx={{ ...CARD, p: 2, mb: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <DocIcon sx={{ color: "#6366f1" }} />
        <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: "#1e293b", flex: 1 }}>
          Training Document & Knowledge Files
        </Typography>
        <Chip size="small" label={`${docs.length} doc${docs.length === 1 ? "" : "s"}`} sx={{ bgcolor: "#eef2ff", color: "#4338ca", fontWeight: 700 }} />
        <Button size="small">{open ? "Hide" : "Manage"}</Button>
      </Stack>

      {open && (
        <Box sx={{ mt: 2 }}>
          {msg && <Box mb={1.5}><Banner msg={msg} /></Box>}
          <Typography sx={{ fontSize: 12.5, fontWeight: 800, mb: 1, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Core training document
          </Typography>
          <TextField value={doc} onChange={(e) => setDoc(e.target.value)} placeholder={docLoaded ? "Training document…" : "Loading…"}
            fullWidth multiline minRows={6} maxRows={16}
            InputProps={{ sx: { fontFamily: "ui-monospace, monospace", fontSize: 12.5, background: "#fafbfc" } }} />
          <Box sx={{ textAlign: "right", mt: 1 }}>
            <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handleSaveDoc} disabled={savingDoc || !docLoaded}>
              {savingDoc ? "Saving…" : "Save training document"}
            </Button>
          </Box>

          <Typography sx={{ fontSize: 12.5, fontWeight: 800, mt: 3, mb: 0.5, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Labeled documents
          </Typography>
          <Typography sx={{ fontSize: 12, color: "#64748b", mb: 1.25 }}>
            Upload a .txt / .md / .pdf with a purpose label — the bot pulls from it when relevant
            (e.g. <b>company_details</b> → questions about your address/company).
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField size="small" placeholder="label e.g. company_details" value={label} onChange={(e) => setLabel(e.target.value)} sx={{ minWidth: 220 }} />
            <Button variant="outlined" component="label" size="small" startIcon={<UploadIcon />}>
              {file ? file.name.slice(0, 20) : "Choose file"}
              <input hidden type="file" accept=".txt,.md,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </Button>
            <Button variant="contained" size="small" onClick={handleUpload} disabled={uploading || !file}>{uploading ? "Uploading…" : "Upload"}</Button>
          </Stack>
          {docs.length > 0 && (
            <Stack spacing={0.75} mt={1.75}>
              {docs.map((d) => (
                <Stack key={d.name} direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderRadius: 2, bgcolor: "#f8fafc", border: "1px solid #eef1f6" }}>
                  <Chip size="small" label={d.label} sx={{ bgcolor: "#fef3c7", color: "#b45309", fontWeight: 700 }} />
                  <Typography sx={{ fontSize: 12.5, flex: 1, color: "#475569", overflow: "hidden", textOverflow: "ellipsis" }}>{d.filename}</Typography>
                  <IconButton size="small" color="error" onClick={() => handleDeleteDoc(d.name)}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
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

  const flash = (text, type = "success") => { setBanner({ text, type }); setTimeout(() => setBanner(null), 3500); };
  const loadStats = useCallback(async () => {
    try { setStats(await fetchKnowledgeStats()); } catch { setStats({ available: false }); }
  }, []);
  const loadItems = useCallback(async (col, q) => {
    setLoading(true);
    try { const data = await fetchKnowledgeEntries(col, { q, limit: 100 }); setItems(data.items || []); }
    catch (err) { flash(err?.response?.data?.detail || "Failed to load entries.", "error"); setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadItems(collection, ""); setQuery(""); }, [collection, loadItems]);

  const handleDelete = async (id) => {
    if (!window.confirm("Remove this entry from the knowledge base?")) return;
    try { await deleteKnowledgeEntry(collection, id); setItems((p) => p.filter((x) => x.id !== id)); loadStats(); flash("Entry removed."); }
    catch { flash("Delete failed.", "error"); }
  };
  const handleSave = async (id, payload) => {
    try { const res = await updateKnowledgeEntry(collection, id, payload); setItems((p) => p.map((x) => (x.id === id ? res.entry || x : x))); flash("Saved."); }
    catch { flash("Save failed.", "error"); }
  };
  const handleReseed = async () => {
    if (!window.confirm("Rebuild product + FAQ knowledge from the live catalogue and docs?")) return;
    setReseeding(true);
    try { const res = await reseedKnowledge(); flash(`Reseeded: ${res.products || 0} products, ${res.faq || 0} FAQ chunks.`); loadStats(); loadItems(collection, query); }
    catch (err) { flash(err?.response?.data?.detail || "Reseed failed.", "error"); }
    finally { setReseeding(false); }
  };

  const counts = stats?.collections || {};
  const unavailable = stats && stats.available === false;
  const totalEntries = Object.values(counts).reduce((s, n) => s + (n || 0), 0);
  const active = COLLECTIONS.find((c) => c.id === collection);

  return (
    <Box sx={{ maxWidth: 960, width: "100%", mx: "auto" }}>
      {/* ── Hero header ── */}
      <Paper sx={{
        ...CARD, p: 2.5, mb: 2.5, color: "#fff", border: "none",
        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #0ea5e9 120%)",
      }}>
        <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
          <Box sx={{ width: 46, height: 46, borderRadius: 2.5, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.18)" }}>
            <BrainIcon />
          </Box>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography sx={{ fontSize: 19, fontWeight: 800, lineHeight: 1.1 }}>AI Knowledge Base</Typography>
            <Typography sx={{ fontSize: 12.5, opacity: 0.9 }}>
              Everything your sales agent knows and has learned · {totalEntries.toLocaleString()} entries
              {stats?.embedder ? ` · ${stats.embedder}` : ""}
            </Typography>
          </Box>
          <Button onClick={handleReseed} disabled={reseeding || unavailable}
            startIcon={reseeding ? <CircularProgress size={15} sx={{ color: "#fff" }} /> : <RefreshIcon />}
            sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.5)", textTransform: "none", fontWeight: 700, "&:hover": { borderColor: "#fff", background: "rgba(255,255,255,0.12)" } }}
            variant="outlined">
            {reseeding ? "Reseeding…" : "Reseed products + FAQ"}
          </Button>
        </Stack>
        {/* stat tiles */}
        <Stack direction="row" spacing={1.5} mt={2} flexWrap="wrap" useFlexGap>
          {COLLECTIONS.map((c) => (
            <Box key={c.id} onClick={() => setCollection(c.id)} sx={{
              cursor: "pointer", flex: "1 1 160px", borderRadius: 2.5, p: 1.5,
              background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.18)",
              transition: "background .15s", "&:hover": { background: "rgba(255,255,255,0.24)" },
              outline: collection === c.id ? "2px solid #fff" : "none",
            }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Box sx={{ "& svg": { fontSize: 20 } }}>{c.icon}</Box>
                <Box>
                  <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{(counts[c.id] ?? 0).toLocaleString()}</Typography>
                  <Typography sx={{ fontSize: 11.5, opacity: 0.9 }}>{c.label}</Typography>
                </Box>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Paper>

      {banner && <Box mb={1.5}><Banner msg={banner} /></Box>}
      {unavailable && (
        <Box mb={2}><Banner msg={{ type: "error", text: "Knowledge base is unavailable on the server (chromadb/fastembed not installed). The bot is using keyword fallback." }} /></Box>
      )}

      {!unavailable && <DocsAndTrainingPanel onChanged={() => { loadStats(); loadItems(collection, query); }} />}

      {/* ── Collection pills ── */}
      <Stack direction="row" spacing={1} mb={2} flexWrap="wrap" useFlexGap>
        {COLLECTIONS.map((c) => {
          const on = collection === c.id;
          return (
            <Box key={c.id} onClick={() => setCollection(c.id)} sx={{
              cursor: "pointer", display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.9, borderRadius: 99,
              border: `1.5px solid ${on ? c.color : "#e5e7eb"}`, background: on ? c.bg : "#fff",
              color: on ? c.color : "#64748b", fontWeight: 700, fontSize: 13, transition: "all .15s",
              "& svg": { fontSize: 18 },
            }}>
              {c.icon}{c.label}
              <Chip size="small" label={counts[c.id] ?? 0} sx={{ height: 18, fontSize: 11, bgcolor: on ? "#fff" : "#f1f5f9", color: on ? c.color : "#64748b" }} />
            </Box>
          );
        })}
      </Stack>

      {active && <Typography sx={{ fontSize: 12.5, color: "#94a3b8", mb: 1 }}>{active.hint}</Typography>}

      {/* ── Search ── */}
      <Stack direction="row" spacing={1} mb={2}>
        <TextField size="small" fullWidth placeholder={`Search ${active?.label} (Hinglish ok)…`}
          value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadItems(collection, query)} disabled={unavailable}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: "#94a3b8" }} /></InputAdornment>,
            sx: { borderRadius: 2.5 } }} />
        <Button variant="contained" onClick={() => loadItems(collection, query)} disabled={unavailable} sx={{ borderRadius: 2.5, px: 3 }}>Search</Button>
        {query && <Button onClick={() => { setQuery(""); loadItems(collection, ""); }}>Clear</Button>}
      </Stack>

      {/* ── List ── */}
      {loading ? (
        <Box sx={{ textAlign: "center", py: 5 }}><CircularProgress size={26} /></Box>
      ) : items.length === 0 ? (
        <Paper sx={{ ...CARD, py: 5, textAlign: "center" }}>
          <Typography sx={{ color: "#94a3b8", fontSize: 14 }}>{unavailable ? "—" : "No entries yet."}</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.25}>
          {items.map((entry) => (
            <EntryCard key={entry.id} collection={collection} entry={entry} onDelete={handleDelete} onSave={handleSave} />
          ))}
        </Stack>
      )}
    </Box>
  );
}
