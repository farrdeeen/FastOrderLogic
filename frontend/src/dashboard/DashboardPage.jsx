// src/dashboard/DashboardPage.jsx
import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchDashboardStats,
  fetchAiFailures,
  fetchRecentConversations,
  fetchInvoicePending,
  fetchStockReconStatus,
  fetchStockReconLogs,
  startStockRecon,
  stopStockRecon,
  completeStockRecon,
  fetchTrainingDocInfo,
  uploadTrainingDoc,
  deleteTrainingDoc,
} from "./dashboardApi";

const STOCK_RECON_STORAGE_KEY = "fol_stock_recon_in_progress";

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

function formatAmount(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function useIsMobile(maxWidth = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(`(max-width: ${maxWidth}px)`).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [maxWidth]);

  return isMobile;
}

function publishStockReconBanner(run) {
  if (typeof window === "undefined") return;
  const payload = run
    ? {
        active: true,
        run_id: run.run_id,
        week_start: run.week_start,
        week_end: run.week_end,
      }
    : { active: false };

  if (run) {
    window.localStorage.setItem(STOCK_RECON_STORAGE_KEY, JSON.stringify(payload));
  } else {
    window.localStorage.removeItem(STOCK_RECON_STORAGE_KEY);
  }

  window.dispatchEvent(
    new CustomEvent("stock-recon:status", { detail: payload }),
  );
}

function InvoicePendingSection({ items, loading, isMobile = false }) {
  const customers = items || [];
  const pendingOrders = customers.reduce(
    (sum, customer) => sum + Number(customer.order_count || 0),
    0,
  );

  return (
    <div style={isMobile ? { ...styles.card, ...styles.cardMobile } : styles.card}>
      <SectionHeader
        title="Invoice Pending"
        action={
          !loading && customers.length > 0 ? (
            <span style={styles.sectionMeta}>
              {customers.length} customers · {pendingOrders} orders
            </span>
          ) : null
        }
      />
      {loading ? (
        <div style={styles.emptyState}>Loading…</div>
      ) : customers.length === 0 ? (
        <div style={styles.emptyState}>
          No customers with multiple pending-invoice orders.
        </div>
      ) : (
        <div style={styles.invoiceList}>
          {customers.map((customer) => {
            const devices = customer.devices || [];
            return (
              <div key={customer.customer_key} style={styles.invoiceRow}>
                <div style={styles.invoiceHeaderRow}>
                  <div style={styles.invoiceCustomer}>
                    <strong
                      style={
                        isMobile
                          ? { ...styles.invoiceName, ...styles.invoiceNameMobile }
                          : styles.invoiceName
                      }
                    >
                      {customer.customer_name || "Unknown Customer"}
                    </strong>
                    <div style={styles.invoiceSub}>
                      {customer.customer_mobile || "No mobile"} ·{" "}
                      {customer.order_count} orders
                    </div>
                  </div>

                  <div
                    style={
                      isMobile
                        ? { ...styles.invoiceTotals, ...styles.invoiceTotalsMobile }
                        : styles.invoiceTotals
                    }
                  >
                    <span style={styles.totalQtyLabel}>Invoice pending</span>
                    <strong style={styles.totalQtyValue}>
                      {customer.total_quantity} items
                    </strong>
                    <span style={styles.totalAmount}>
                      {formatAmount(customer.total_amount)}
                    </span>
                  </div>
                </div>

                <div style={styles.orderPills}>
                  {(customer.order_ids || []).map((orderId) => (
                    <span key={orderId} style={styles.orderPill}>
                      {orderId}
                    </span>
                  ))}
                </div>

                {devices.length === 0 ? (
                  <div style={styles.emptyInline}>No item details found</div>
                ) : (
                  <div style={styles.deviceBreakdown}>
                    <div
                      style={
                        isMobile
                          ? {
                              ...styles.deviceBreakdownHeader,
                              ...styles.deviceBreakdownHeaderMobile,
                            }
                          : styles.deviceBreakdownHeader
                      }
                    >
                      <span>Qty</span>
                      <span>Item / SKU</span>
                      <span>Orders</span>
                    </div>
                    {devices.map((device) => (
                      <div
                        key={`${device.sku_id || "sku"}-${device.product_name}`}
                        style={
                          isMobile
                            ? { ...styles.deviceLine, ...styles.deviceLineMobile }
                            : styles.deviceLine
                        }
                      >
                        <strong style={styles.deviceQty}>
                          {device.quantity}x
                        </strong>
                        <div style={styles.deviceNameWrap}>
                          <span style={styles.deviceName}>
                            {device.product_name}
                          </span>
                          {device.sku_id ? (
                            <span style={styles.deviceSku}>{device.sku_id}</span>
                          ) : null}
                        </div>
                        <span
                          style={
                            isMobile
                              ? { ...styles.deviceOrders, ...styles.deviceOrdersMobile }
                              : styles.deviceOrders
                          }
                        >
                          {(device.order_ids || []).join(", ") ||
                            `${device.order_count || 0} orders`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDateLabel(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}

function StockReconSection({
  status,
  logs,
  items,
  counts,
  loading,
  submitting,
  message,
  onStart,
  onCountChange,
  onStop,
  onComplete,
  isMobile = false,
}) {
  const activeRun = status?.in_progress;
  const currentWeek =
    status?.current_week_start && status?.current_week_end
      ? `${formatDateLabel(status.current_week_start)} - ${formatDateLabel(
          status.current_week_end,
        )}`
      : "Current week";
  const enteredCount = items.filter((item) => counts[item.model_name] !== undefined && counts[item.model_name] !== "").length;

  return (
    <div>
      <div style={isMobile ? { ...styles.card, ...styles.cardMobile } : styles.card}>
        <SectionHeader
          title="Stock Recon"
          action={
            activeRun ? (
              <Badge label="In Progress" variant="warning" />
            ) : (
              <span style={styles.sectionMeta}>{currentWeek}</span>
            )
          }
        />

        {message && (
          <div
            style={{
              ...styles.reconMsg,
              ...(message.type === "error" ? styles.reconMsgError : styles.reconMsgSuccess),
            }}
          >
            {message.text}
          </div>
        )}

        {!activeRun ? (
          <div style={styles.reconStartPanel}>
            <div style={styles.reconStartText}>
              <strong>Weekly physical count</strong>
              <span>
                Start recon to load device model names. DB stock counts stay hidden
                during counting.
              </span>
            </div>
            <button
              type="button"
              style={styles.reconPrimaryBtn}
              onClick={onStart}
              disabled={loading || submitting}
            >
              {submitting ? "Starting..." : "Start Recon"}
            </button>
          </div>
        ) : (
          <div>
            <div style={styles.reconLivePanel}>
              <div>
                <strong>Recon in progress</strong>
                <span>
                  Week {formatDateLabel(activeRun.week_start)} -{" "}
                  {formatDateLabel(activeRun.week_end)}
                </span>
              </div>
              <span style={styles.reconProgressText}>
                {enteredCount}/{items.length} counted
              </span>
            </div>

            {items.length === 0 ? (
              <div style={styles.reconEmptyWarning}>
                No model names returned from stock. Refresh once; if it stays empty,
                check that `vw_mtm_stock` has rows.
              </div>
            ) : (
              <div style={styles.reconInputGrid}>
                {items.map((item) => (
                  <label
                    key={item.model_name}
                    style={
                      isMobile
                        ? { ...styles.reconInputRow, ...styles.reconInputRowMobile }
                        : styles.reconInputRow
                    }
                  >
                    <span style={styles.reconModelName}>{item.model_name}</span>
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={counts[item.model_name] ?? ""}
                      onChange={(event) =>
                        onCountChange(item.model_name, event.target.value)
                      }
                      style={styles.reconCountInput}
                      placeholder="Count"
                    />
                  </label>
                ))}
              </div>
            )}

            <div style={styles.reconFooter}>
              <button
                type="button"
                style={styles.reconStopBtn}
                onClick={onStop}
                disabled={submitting}
              >
                Stop Recon
              </button>
              <button
                type="button"
                style={styles.reconPrimaryBtn}
                onClick={onComplete}
                disabled={submitting || items.length === 0}
              >
                {submitting ? "Saving..." : "Complete Recon"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={isMobile ? { ...styles.card, ...styles.cardMobile } : styles.card}>
        <SectionHeader
          title="Stock Recon Logs"
          action={<span style={styles.sectionMeta}>{logs.length} weeks</span>}
        />
        {loading ? (
          <div style={styles.emptyState}>Loading...</div>
        ) : logs.length === 0 ? (
          <div style={styles.emptyState}>No recon logs yet.</div>
        ) : (
          <div style={styles.reconLogList}>
            {logs.map((run) => {
              const runLogs = run.logs || [];
              return (
                <div key={run.run_id} style={styles.reconLogCard}>
                  <div style={styles.reconLogHeader}>
                    <div>
                      <strong style={styles.reconWeekTitle}>
                        Week {formatDateLabel(run.week_start)} -{" "}
                        {formatDateLabel(run.week_end)}
                      </strong>
                      <div style={styles.reconLogSub}>
                        {run.completed_at
                          ? `Completed ${new Date(run.completed_at).toLocaleString([], {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          : run.status === "missed"
                            ? "Not completed"
                            : "In progress"}
                      </div>
                    </div>
                    <Badge
                      label={run.status === "missed" ? "Didn't Recon" : run.status}
                      variant={
                        run.status === "completed"
                          ? runLogs.length
                            ? "warning"
                            : "success"
                          : run.status === "missed"
                            ? "danger"
                            : "info"
                      }
                    />
                  </div>

                  {run.status === "completed" && runLogs.length === 0 ? (
                    <div style={styles.reconCleanState}>No mismatch found.</div>
                  ) : (
                    <div style={styles.reconMismatchList}>
                      {runLogs.map((log) =>
                        log.log_type === "missed" ? (
                          <div key={log.log_id || `${run.run_id}-missed`} style={styles.reconMissedLine}>
                            Didn't recon for this week.
                          </div>
                        ) : (
                          <div key={log.log_id || `${run.run_id}-${log.model_name}`} style={styles.reconMismatchLine}>
                            <span style={styles.reconMismatchModel}>
                              {log.model_name}
                            </span>
                            <strong
                              style={{
                                ...styles.reconMismatchCount,
                                color:
                                  log.log_type === "extra" ? "#0369a1" : "#b91c1c",
                              }}
                            >
                              {log.log_type === "extra" ? "Extra" : "Missing"}{" "}
                              {log.mismatch_count}
                            </strong>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const isMobile = useIsMobile();
  const [stats, setStats] = useState(null);
  const [failures, setFailures] = useState([]);
  const [recent, setRecent] = useState([]);
  const [invoicePending, setInvoicePending] = useState([]);
  const [stockReconStatus, setStockReconStatus] = useState(null);
  const [stockReconLogs, setStockReconLogs] = useState([]);
  const [stockReconItems, setStockReconItems] = useState([]);
  const [stockReconCounts, setStockReconCounts] = useState({});
  const [stockReconLoading, setStockReconLoading] = useState(false);
  const [stockReconSubmitting, setStockReconSubmitting] = useState(false);
  const [stockReconMsg, setStockReconMsg] = useState(null);
  const [docInfo, setDocInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [docUploading, setDocUploading] = useState(false);
  const [docMsg, setDocMsg] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const fileRef = useRef(null);

  const loadStockRecon = useCallback(async (silent = false) => {
    if (!silent) setStockReconLoading(true);
    try {
      const status = await fetchStockReconStatus();
      const logs = await fetchStockReconLogs(24);
      setStockReconStatus(status);
      setStockReconLogs(logs);
      setStockReconItems(status?.items || []);
      if (status?.in_progress) {
        publishStockReconBanner(status.in_progress);
      } else {
        publishStockReconBanner(null);
      }
      setStockReconMsg(null);
    } catch (err) {
      console.error("Stock recon load error:", err);
      publishStockReconBanner(null);
      const detail = err?.response?.data?.detail;
      setStockReconMsg({
        type: "error",
        text:
          (typeof detail === "string" ? detail : detail?.message) ||
          "Stock recon tables are not ready or could not be loaded.",
      });
    } finally {
      setStockReconLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, f, r, i, d] = await Promise.all([
        fetchDashboardStats(),
        fetchAiFailures(30),
        fetchRecentConversations(8),
        fetchInvoicePending(50),
        fetchTrainingDocInfo(),
      ]);
      setStats(s);
      setFailures(f);
      setRecent(r);
      setInvoicePending(i);
      setDocInfo(d);
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
    loadStockRecon(true);
  }, [loadStockRecon]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every 60s
    return () => clearInterval(t);
  }, [load]);

  const handleStartStockRecon = async () => {
    setStockReconSubmitting(true);
    setStockReconMsg(null);
    try {
      const res = await startStockRecon();
      setStockReconStatus((prev) => ({
        ...(prev || {}),
        in_progress: res.run,
        items: res.items || [],
      }));
      setStockReconItems(res.items || []);
      setStockReconCounts({});
      publishStockReconBanner(res.run);
      const freshStatus = await fetchStockReconStatus();
      setStockReconStatus(freshStatus);
      setStockReconItems(freshStatus?.items?.length ? freshStatus.items : res.items || []);
      setStockReconMsg({
        type: "success",
        text: "Stock recon started. Count the physical stock and submit once done.",
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setStockReconMsg({
        type: "error",
        text:
          (typeof detail === "string" ? detail : detail?.message) ||
          "Could not start stock recon.",
      });
    } finally {
      setStockReconSubmitting(false);
    }
  };

  const handleStockReconCountChange = (modelName, value) => {
    setStockReconCounts((prev) => ({
      ...prev,
      [modelName]: value,
    }));
  };

  const handleStopStockRecon = async () => {
    const runId = stockReconStatus?.in_progress?.run_id;
    if (!runId) return;
    if (!window.confirm("Stop this stock recon? Current entered counts will be removed.")) {
      return;
    }

    setStockReconSubmitting(true);
    setStockReconMsg(null);
    try {
      await stopStockRecon(runId);
      publishStockReconBanner(null);
      setStockReconCounts({});
      setStockReconItems([]);
      await loadStockRecon(true);
      setStockReconMsg({
        type: "success",
        text: "Stock recon stopped. You can start a fresh recon anytime.",
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setStockReconMsg({
        type: "error",
        text:
          (typeof detail === "string" ? detail : detail?.message) ||
          "Could not stop stock recon.",
      });
    } finally {
      setStockReconSubmitting(false);
    }
  };

  const handleCompleteStockRecon = async () => {
    const missingModels = stockReconItems.filter(
      (item) =>
        stockReconCounts[item.model_name] === undefined ||
        stockReconCounts[item.model_name] === "",
    );
    if (missingModels.length > 0) {
      setStockReconMsg({
        type: "error",
        text: `Please enter counts for all models. Missing: ${missingModels
          .slice(0, 3)
          .map((item) => item.model_name)
          .join(", ")}${missingModels.length > 3 ? "..." : ""}`,
      });
      return;
    }

    const runId = stockReconStatus?.in_progress?.run_id;
    if (!runId) return;

    setStockReconSubmitting(true);
    setStockReconMsg(null);
    try {
      await completeStockRecon(
        runId,
        stockReconItems.map((item) => ({
          model_name: item.model_name,
          physical_count: Number(stockReconCounts[item.model_name] || 0),
        })),
      );
      publishStockReconBanner(null);
      setStockReconCounts({});
      setStockReconItems([]);
      await loadStockRecon(true);
      setStockReconMsg({
        type: "success",
        text: "Stock recon completed and mismatch log saved.",
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setStockReconMsg({
        type: "error",
        text:
          typeof detail === "string"
            ? detail
            : detail?.message || "Could not complete stock recon.",
      });
    } finally {
      setStockReconSubmitting(false);
    }
  };

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
  const pageStyle = isMobile ? { ...styles.page, ...styles.pageMobile } : styles.page;
  const headerStyle = isMobile
    ? { ...styles.header, ...styles.headerMobile }
    : styles.header;
  const tabsStyle = isMobile ? { ...styles.tabs, ...styles.tabsMobile } : styles.tabs;
  const statGridStyle = isMobile
    ? { ...styles.statGrid, ...styles.statGridMobile }
    : styles.statGrid;
  const cardStyle = isMobile ? { ...styles.card, ...styles.cardMobile } : styles.card;
  const tableStyle = isMobile ? { ...styles.table, ...styles.tableMobile } : styles.table;

  return (
    <div style={pageStyle}>
      {/* ── Header ── */}
      <div style={headerStyle}>
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
      <div style={tabsStyle}>
        {[
          { id: "overview", label: "Overview" },
          {
            id: "failures",
            label: `AI Failures${failures.length ? ` (${failures.length})` : ""}`,
          },
          {
            id: "invoice_pending",
            label: `Invoice Pending${invoicePending.length ? ` (${invoicePending.length})` : ""}`,
          },
          {
            id: "stock_recon",
            label: `Stock Recon${stockReconStatus?.in_progress ? " (Live)" : ""}`,
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
          <div style={statGridStyle}>
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
            <StatCard
              label="Offline Channel"
              value={s.channel_offline_today?.toLocaleString()}
              sub={`${(s.channel_offline_total ?? 0).toLocaleString()} total offline orders`}
              accent="#2563eb"
              icon="🏬"
              loading={loading}
            />
            <StatCard
              label="Wix Channel"
              value={s.channel_wix_today?.toLocaleString()}
              sub={`${(s.channel_wix_total ?? 0).toLocaleString()} total Wix orders`}
              accent="#0891b2"
              icon="🌐"
              loading={loading}
            />
          </div>

          {/* Recent conversations */}
          <div style={cardStyle}>
            <SectionHeader title="Recent Conversations" />
            {loading ? (
              <div style={styles.emptyState}>Loading…</div>
            ) : recent.length === 0 ? (
              <div style={styles.emptyState}>No conversations yet.</div>
            ) : (
              <div style={styles.tableScroll}>
                <table style={tableStyle}>
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ FAILURES TAB ══════════ */}
      {activeTab === "failures" && (
        <div style={cardStyle}>
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
            <div style={styles.tableScroll}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {["Time", "Customer", "Phone", "Exact Response"].map((h) => (
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
                          maxWidth: 520,
                        }}
                      >
                        <pre style={styles.errorText}>
                          {f.error_response || f.error_detail || f.message}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════ INVOICE PENDING TAB ══════════ */}
      {activeTab === "invoice_pending" && (
        <InvoicePendingSection
          items={invoicePending}
          loading={loading}
          isMobile={isMobile}
        />
      )}

      {/* ══════════ STOCK RECON TAB ══════════ */}
      {activeTab === "stock_recon" && (
        <StockReconSection
          status={stockReconStatus}
          logs={stockReconLogs}
          items={stockReconItems}
          counts={stockReconCounts}
          loading={stockReconLoading}
          submitting={stockReconSubmitting}
          message={stockReconMsg}
          onStart={handleStartStockRecon}
          onCountChange={handleStockReconCountChange}
          onStop={handleStopStockRecon}
          onComplete={handleCompleteStockRecon}
          isMobile={isMobile}
        />
      )}

      {/* ══════════ TRAINING TAB ══════════ */}
      {activeTab === "training" && (
        <div>
          <div style={cardStyle}>
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
          <div style={cardStyle}>
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
    width: "100%",
    minWidth: 0,
  },
  pageMobile: {
    maxWidth: "none",
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
  headerMobile: {
    flexDirection: "column",
    gap: 14,
    padding: "16px",
    borderRadius: 10,
    marginBottom: 14,
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
    flexWrap: "wrap",
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
  tabsMobile: {
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 2,
    marginBottom: 14,
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
    whiteSpace: "nowrap",
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
  statGridMobile: {
    gridTemplateColumns: "1fr",
    gap: 10,
    marginBottom: 14,
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
  cardMobile: {
    padding: "14px 12px",
    borderRadius: 10,
    marginBottom: 12,
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 10,
    flexWrap: "wrap",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#0f172a",
    letterSpacing: "-0.1px",
  },
  sectionMeta: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: 500,
  },
  invoiceList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  invoiceRow: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "14px 16px",
    background: "#ffffff",
  },
  invoiceHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    flexWrap: "wrap",
  },
  invoiceCustomer: {
    minWidth: 0,
    flex: "1 1 260px",
  },
  invoiceName: {
    display: "block",
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  invoiceNameMobile: {
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  invoiceSub: {
    fontSize: 12,
    color: "#64748b",
  },
  orderPills: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  orderPill: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    fontWeight: 600,
    color: "#334155",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "3px 7px",
  },
  invoiceTotals: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    minWidth: 130,
  },
  invoiceTotalsMobile: {
    alignItems: "flex-start",
    width: "100%",
    minWidth: 0,
  },
  totalQtyLabel: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: 600,
    textTransform: "uppercase",
  },
  totalQtyValue: {
    fontSize: 22,
    color: "#0f172a",
    fontWeight: 800,
    lineHeight: 1.1,
  },
  totalAmount: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: 600,
  },
  deviceBreakdown: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    overflow: "hidden",
  },
  deviceBreakdownHeader: {
    display: "grid",
    gridTemplateColumns: "48px minmax(0, 1fr) minmax(92px, 0.65fr)",
    gap: 10,
    padding: "7px 10px",
    background: "#f8fafc",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  deviceBreakdownHeaderMobile: {
    display: "none",
  },
  deviceLine: {
    display: "grid",
    gridTemplateColumns: "48px minmax(0, 1fr) minmax(92px, 0.65fr)",
    gap: 10,
    alignItems: "center",
    padding: "9px 10px",
    borderTop: "1px solid #f1f5f9",
  },
  deviceLineMobile: {
    gridTemplateColumns: "42px minmax(0, 1fr)",
    alignItems: "start",
    gap: 8,
  },
  deviceQty: {
    fontSize: 14,
    color: "#0f172a",
  },
  deviceNameWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  deviceName: {
    fontSize: 13,
    color: "#1e293b",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deviceSku: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "#64748b",
  },
  deviceOrders: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#475569",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deviceOrdersMobile: {
    gridColumn: "1 / -1",
    whiteSpace: "normal",
    overflow: "visible",
    textOverflow: "clip",
    wordBreak: "break-word",
    paddingLeft: 50,
  },
  emptyInline: {
    fontSize: 12,
    color: "#94a3b8",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "10px 12px",
  },
  reconMsg: {
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 12,
  },
  reconMsgSuccess: {
    background: "#f0fdf4",
    color: "#166534",
    border: "1px solid #bbf7d0",
  },
  reconMsgError: {
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
  },
  reconStartPanel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "14px 16px",
  },
  reconStartText: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: "#334155",
    fontSize: 12,
    lineHeight: 1.45,
    minWidth: 0,
    flex: "1 1 260px",
  },
  reconPrimaryBtn: {
    border: "none",
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: 8,
    padding: "10px 16px",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  reconStopBtn: {
    border: "1px solid #fecaca",
    background: "#ffffff",
    color: "#b91c1c",
    borderRadius: 8,
    padding: "10px 16px",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  reconLivePanel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 12,
    fontSize: 12,
    flexWrap: "wrap",
  },
  reconProgressText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontWeight: 700,
    color: "#78350f",
  },
  reconInputGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 10,
  },
  reconInputRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 94px",
    alignItems: "center",
    gap: 10,
    border: "1px solid #e2e8f0",
    borderRadius: 9,
    padding: "10px 12px",
    background: "#ffffff",
  },
  reconInputRowMobile: {
    gridTemplateColumns: "1fr",
    alignItems: "start",
  },
  reconModelName: {
    fontSize: 13,
    fontWeight: 700,
    color: "#0f172a",
    overflowWrap: "anywhere",
  },
  reconCountInput: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 14,
    fontFamily: "inherit",
    color: "#0f172a",
    outline: "none",
  },
  reconFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 14,
  },
  reconEmptyWarning: {
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    borderRadius: 8,
    padding: "12px",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.5,
  },
  reconLogList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  reconLogCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: "12px 14px",
    background: "#ffffff",
  },
  reconLogHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  reconWeekTitle: {
    display: "block",
    color: "#0f172a",
    fontSize: 13,
  },
  reconLogSub: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 3,
  },
  reconCleanState: {
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  reconMismatchList: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
  },
  reconMismatchLine: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    border: "1px solid #f1f5f9",
    borderRadius: 8,
    padding: "8px 10px",
    background: "#f8fafc",
  },
  reconMismatchModel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#1e293b",
    overflowWrap: "anywhere",
  },
  reconMismatchCount: {
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  reconMissedLine: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#991b1b",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 12,
    fontWeight: 700,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  tableScroll: {
    width: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
  },
  tableMobile: {
    minWidth: 680,
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
  errorText: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    lineHeight: 1.5,
    color: "#b91c1c",
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
