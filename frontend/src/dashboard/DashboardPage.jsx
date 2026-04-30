// src/dashboard/DashboardPage.jsx
import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchDashboardStats,
  fetchAiFailures,
  fetchRecentConversations,
  fetchTrainingDocInfo,
  uploadTrainingDoc,
  deleteTrainingDoc,
} from "./dashboardApi";

// ─── Tiny sparkline SVG ───────────────────────────────────────────────────────
function Sparkline({ data, color = "#6ee7b7", height = 36 }) {
  if (!data || data.length === 0) return null;
  const vals = data.map((d) => d.count);
  const max = Math.max(...vals, 1);
  const w = 120;
  const h = height;
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * h}`)
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block" }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
      {vals.map((v, i) => (
        <circle
          key={i}
          cx={(i / (vals.length - 1)) * w}
          cy={h - (v / max) * h}
          r={i === vals.length - 1 ? 3.5 : 2}
          fill={color}
          opacity={i === vals.length - 1 ? 1 : 0.5}
        />
      ))}
    </svg>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  sparkData,
  sparkColor,
  accent,
  icon,
  loading,
}) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statCardTop}>
        <div
          style={{
            ...styles.statIcon,
            background: accent + "18",
            color: accent,
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.statLabel}>{label}</div>
          <div style={styles.statValue}>
            {loading ? <span style={styles.skeleton}>——</span> : (value ?? "—")}
          </div>
          {sub && !loading && <div style={styles.statSub}>{sub}</div>}
        </div>
        {sparkData && !loading && (
          <div style={{ flexShrink: 0 }}>
            <Sparkline data={sparkData} color={sparkColor || accent} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ title, action }) {
  return (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionTitle}>{title}</span>
      {action}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function Badge({ label, variant = "default" }) {
  const colors = {
    default: { bg: "#f1f5f9", color: "#475569" },
    success: { bg: "#dcfce7", color: "#166534" },
    danger: { bg: "#fee2e2", color: "#991b1b" },
    warning: { bg: "#fef3c7", color: "#92400e" },
    info: { bg: "#dbeafe", color: "#1e40af" },
  };
  const c = colors[variant] || colors.default;
  return (
    <span style={{ ...styles.badge, background: c.bg, color: c.color }}>
      {label}
    </span>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [failures, setFailures] = useState([]);
  const [recent, setRecent] = useState([]);
  const [docInfo, setDocInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [docUploading, setDocUploading] = useState(false);
  const [docMsg, setDocMsg] = useState(null);
  const [activeTab, setActiveTab] = useState("overview"); // overview | failures | training
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [s, f, r, d] = await Promise.all([
        fetchDashboardStats(),
        fetchAiFailures(30),
        fetchRecentConversations(8),
        fetchTrainingDocInfo(),
      ]);
      setStats(s);
      setFailures(f);
      setRecent(r);
      setDocInfo(d);
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every 60s
    return () => clearInterval(t);
  }, [load]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocUploading(true);
    setDocMsg(null);
    try {
      const res = await uploadTrainingDoc(file);
      setDocMsg({ type: "success", text: res.message });
      const d = await fetchTrainingDocInfo();
      setDocInfo(d);
    } catch (err) {
      setDocMsg({
        type: "error",
        text: err?.response?.data?.detail || "Upload failed.",
      });
    } finally {
      setDocUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDeleteDoc = async () => {
    if (!window.confirm("Remove the current training document?")) return;
    try {
      await deleteTrainingDoc();
      setDocInfo({ exists: false });
      setDocMsg({ type: "success", text: "Training document removed." });
    } catch {
      setDocMsg({ type: "error", text: "Failed to remove document." });
    }
  };

  const s = stats || {};
  const refreshedAt = s.generated_at
    ? new Date(s.generated_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div style={styles.page}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <div>
          <div style={styles.headerTitle}>Agent Dashboard</div>
          <div style={styles.headerSub}>
            Aria · NVIDIA Nemotron 3 Nano Omni
            {refreshedAt && (
              <span style={{ marginLeft: 12, opacity: 0.6, fontSize: 11 }}>
                Updated {refreshedAt}
              </span>
            )}
          </div>
        </div>
        <button onClick={load} style={styles.refreshBtn} disabled={loading}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* ── Tabs ── */}
      <div style={styles.tabs}>
        {[
          { id: "overview", label: "Overview" },
          {
            id: "failures",
            label: `AI Failures${failures.length ? ` (${failures.length})` : ""}`,
          },
          { id: "training", label: "Training Docs" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════ OVERVIEW TAB ══════════ */}
      {activeTab === "overview" && (
        <div>
          {/* KPI row */}
          <div style={styles.statGrid}>
            <StatCard
              label="Leads Received Today"
              value={s.leads_today}
              sub="Orders created today"
              sparkData={s.weekly_leads}
              sparkColor="#6ee7b7"
              accent="#10b981"
              icon="📦"
              loading={loading}
            />
            <StatCard
              label="Conversations Initiated"
              value={s.conversations_total?.toLocaleString()}
              sub={`${s.conversations_today ?? "—"} started today`}
              sparkData={s.weekly_conversations}
              sparkColor="#93c5fd"
              accent="#3b82f6"
              icon="💬"
              loading={loading}
            />
            <StatCard
              label="Customers Not Responded"
              value={s.no_response_count}
              sub="No AI reply in last 24h"
              accent="#f59e0b"
              icon="⚠️"
              loading={loading}
            />
            <StatCard
              label="Orders Converted"
              value={s.orders_converted}
              sub="Sessions with order collected"
              accent="#8b5cf6"
              icon="🛒"
              loading={loading}
            />
            <StatCard
              label="Dispatched"
              value={s.orders_dispatched}
              sub="Orders with AWB/shipped"
              accent="#06b6d4"
              icon="🚚"
              loading={loading}
            />
            <StatCard
              label="AI Failures Today"
              value={s.ai_failures_today}
              sub={
                s.avg_response_time_s
                  ? `Avg response: ${s.avg_response_time_s}s`
                  : "No errors detected"
              }
              accent={s.ai_failures_today > 0 ? "#ef4444" : "#10b981"}
              icon="🤖"
              loading={loading}
            />
          </div>

          {/* Recent conversations */}
          <div style={styles.card}>
            <SectionHeader title="Recent Conversations" />
            {loading ? (
              <div style={styles.emptyState}>Loading…</div>
            ) : recent.length === 0 ? (
              <div style={styles.emptyState}>No conversations yet.</div>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[
                      "Customer",
                      "Phone",
                      "Status",
                      "Messages",
                      "Last Message",
                      "Started",
                    ].map((h) => (
                      <th key={h} style={styles.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((conv) => (
                    <tr key={conv.id} style={styles.tr}>
                      <td style={styles.td}>
                        <strong style={{ fontSize: 13 }}>
                          {conv.wa_contact_name || "—"}
                        </strong>
                      </td>
                      <td style={styles.tdMono}>{conv.phone_number}</td>
                      <td style={styles.td}>
                        <Badge
                          label={conv.status || "active"}
                          variant={
                            conv.status === "resolved"
                              ? "success"
                              : conv.status === "active"
                                ? "info"
                                : "warning"
                          }
                        />
                      </td>
                      <td style={styles.td}>
                        <span style={styles.msgCount}>
                          {conv.user_msgs}↑ {conv.ai_msgs}↓
                        </span>
                      </td>
                      <td
                        style={{
                          ...styles.td,
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                          color: "#64748b",
                        }}
                      >
                        {conv.last_message || "—"}
                      </td>
                      <td
                        style={{ ...styles.td, fontSize: 11, color: "#94a3b8" }}
                      >
                        {conv.created_at
                          ? new Date(conv.created_at).toLocaleDateString([], {
                              day: "numeric",
                              month: "short",
                            })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════ FAILURES TAB ══════════ */}
      {activeTab === "failures" && (
        <div style={styles.card}>
          <SectionHeader
            title="AI Failure Log"
            action={
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                Messages where Aria returned an error
              </span>
            }
          />
          {loading ? (
            <div style={styles.emptyState}>Loading…</div>
          ) : failures.length === 0 ? (
            <div style={{ ...styles.emptyState, color: "#10b981" }}>
              ✅ No AI failures detected
            </div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  {["Time", "Customer", "Phone", "Error Message"].map((h) => (
                    <th key={h} style={styles.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr
                    key={f.id}
                    style={{ ...styles.tr, background: "#fff5f5" }}
                  >
                    <td
                      style={{
                        ...styles.td,
                        fontSize: 11,
                        color: "#94a3b8",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.timestamp
                        ? new Date(f.timestamp).toLocaleString([], {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td style={styles.td}>{f.wa_contact_name || "Unknown"}</td>
                    <td style={styles.tdMono}>{f.phone_number}</td>
                    <td
                      style={{
                        ...styles.td,
                        color: "#dc2626",
                        fontSize: 12,
                        maxWidth: 360,
                      }}
                    >
                      {f.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ══════════ TRAINING TAB ══════════ */}
      {activeTab === "training" && (
        <div>
          <div style={styles.card}>
            <SectionHeader title="Training Document" />

            <div style={styles.trainingInfo}>
              <div style={styles.trainingStatus}>
                {docInfo?.exists ? (
                  <>
                    <div style={styles.docIcon}>📄</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {docInfo.filename}
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
                      >
                        {docInfo.size_bytes
                          ? `${(docInfo.size_bytes / 1024).toFixed(1)} KB`
                          : ""}
                        {docInfo.updated_at && (
                          <>
                            {" "}
                            · Updated{" "}
                            {new Date(docInfo.updated_at).toLocaleString([], {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        ...styles.docIcon,
                        background: "#f1f5f9",
                        color: "#94a3b8",
                      }}
                    >
                      📭
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: 14,
                          color: "#64748b",
                        }}
                      >
                        No training document uploaded
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}
                      >
                        Aria will use only the base system prompt.
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div style={styles.trainingActions}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.docx,.doc"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                <button
                  style={styles.uploadBtn}
                  onClick={() => fileRef.current?.click()}
                  disabled={docUploading}
                >
                  {docUploading ? "Uploading…" : "⬆ Upload Document"}
                </button>
                {docInfo?.exists && (
                  <button style={styles.deleteBtn} onClick={handleDeleteDoc}>
                    🗑 Remove
                  </button>
                )}
              </div>
            </div>

            {docMsg && (
              <div
                style={{
                  ...styles.docMsg,
                  background: docMsg.type === "success" ? "#f0fdf4" : "#fef2f2",
                  color: docMsg.type === "success" ? "#166534" : "#991b1b",
                  border: `1px solid ${docMsg.type === "success" ? "#bbf7d0" : "#fecaca"}`,
                }}
              >
                {docMsg.type === "success" ? "✅ " : "❌ "}
                {docMsg.text}
              </div>
            )}
          </div>

          {/* How it works */}
          <div style={styles.card}>
            <SectionHeader title="How Training Works" />
            <div style={styles.trainingHow}>
              {[
                {
                  step: "1",
                  title: "Upload a document",
                  body: "Upload a .txt or .docx file containing product catalogue, pricing, FAQs, or return policies.",
                },
                {
                  step: "2",
                  title: "Auto-injected into every AI call",
                  body: "The document content is appended to Aria's system prompt for every new conversation and reply — no restart needed.",
                },
                {
                  step: "3",
                  title: "Replace anytime",
                  body: "Upload a new document to replace the existing one instantly. The AI picks it up on the next message.",
                },
              ].map((item) => (
                <div key={item.step} style={styles.howStep}>
                  <div style={styles.howStepNum}>{item.step}</div>
                  <div>
                    <div
                      style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#64748b",
                        lineHeight: 1.6,
                      }}
                    >
                      {item.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  page: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    maxWidth: 1200,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    background: "#0f172a",
    color: "#f8fafc",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.3px",
    marginBottom: 4,
  },
  headerSub: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "'IBM Plex Mono', monospace",
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  refreshBtn: {
    fontSize: 12,
    padding: "7px 16px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "transparent",
    color: "#94a3b8",
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 2,
  },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 20,
    borderBottom: "1.5px solid #e2e8f0",
    paddingBottom: 0,
  },
  tab: {
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 18px",
    border: "none",
    background: "transparent",
    color: "#64748b",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    marginBottom: -1.5,
    fontFamily: "inherit",
    borderRadius: "6px 6px 0 0",
    transition: "color 0.15s",
  },
  tabActive: {
    color: "#0f172a",
    borderBottom: "2.5px solid #0f172a",
    background: "#f8fafc",
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 14,
    marginBottom: 20,
  },
  statCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "16px 20px",
  },
  statCardTop: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    flexShrink: 0,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1,
    letterSpacing: "-0.5px",
  },
  statSub: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 5,
  },
  skeleton: {
    color: "#e2e8f0",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 16,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    letterSpacing: "-0.1px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1.5px solid #f1f5f9",
    background: "#f8fafc",
  },
  tr: {
    borderBottom: "1px solid #f8fafc",
  },
  td: {
    padding: "10px 12px",
    verticalAlign: "middle",
    color: "#1e293b",
  },
  tdMono: {
    padding: "10px 12px",
    verticalAlign: "middle",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#475569",
  },
  badge: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 20,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  msgCount: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#64748b",
    background: "#f8fafc",
    padding: "2px 7px",
    borderRadius: 6,
    border: "1px solid #e2e8f0",
  },
  emptyState: {
    textAlign: "center",
    padding: "32px 0",
    fontSize: 13,
    color: "#94a3b8",
  },
  trainingInfo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    background: "#f8fafc",
    borderRadius: 10,
    padding: "16px 20px",
    border: "1px solid #e2e8f0",
    marginBottom: 12,
  },
  trainingStatus: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  docIcon: {
    width: 44,
    height: 44,
    background: "#dbeafe",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
    flexShrink: 0,
  },
  trainingActions: {
    display: "flex",
    gap: 10,
    flexShrink: 0,
  },
  uploadBtn: {
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 18px",
    borderRadius: 8,
    border: "none",
    background: "#0f172a",
    color: "#f8fafc",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  deleteBtn: {
    fontSize: 13,
    padding: "9px 16px",
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "transparent",
    color: "#dc2626",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  docMsg: {
    fontSize: 13,
    padding: "10px 16px",
    borderRadius: 8,
    marginTop: 4,
  },
  trainingHow: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  howStep: {
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
  },
  howStepNum: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#0f172a",
    color: "#f8fafc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 1,
  },
};
