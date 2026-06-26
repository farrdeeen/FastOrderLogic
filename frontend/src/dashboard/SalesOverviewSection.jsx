// src/dashboard/SalesOverviewSection.jsx
// Merged "Sales Overview": top KPIs + Sales-by-Channel bar chart + Total-Orders
// stacked bar chart (approved vs pending, with new/repeat trend lines), filtered
// by 15 days / 3 / 6 / 12 months. Pure inline-SVG, mobile-safe (no chart dep).

import { useEffect, useRef, useState } from "react";
import { fetchSalesOverview } from "./dashboardApi";

const CH_COLORS = { "Wix": "#10b981", "mTm Store": "#6366f1", "AI Assistant": "#8b5cf6", "Offline": "#f59e0b", "Other": "#94a3b8" };
const CH = [{ k: "Wix", c: "#10b981" }, { k: "mTm Store", c: "#6366f1" }, { k: "AI Assistant", c: "#8b5cf6" }, { k: "Offline", c: "#f59e0b" }];
const PERIODS = [{ id: "15d", label: "15 Days" }, { id: "3m", label: "3 Months" }, { id: "6m", label: "6 Months" }, { id: "12m", label: "12 Months" }];
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const num = (n) => Number(n || 0).toLocaleString("en-IN");

const card = { background: "#fff", border: "1px solid #e8eaf0", borderRadius: 16, padding: 16, minWidth: 0, boxShadow: "0 1px 3px rgba(16,24,40,0.04)" };
const lab = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#94a3b8" };

function KpiCard({ title, value, accent = "#6366f1", rows = [], children }) {
  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={lab}>{title}</span>
      {value != null && <span style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{value}</span>}
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
          <span style={{ color: "#64748b" }}>{r.k}</span>
          <span style={{ fontWeight: 800, color: r.c || accent }}>{r.v}</span>
        </div>
      ))}
      {children}
    </div>
  );
}

/* Sales by channel — grouped bars per day/month (4 colored bars), hover/touch tooltip */
function GroupedChannelChart({ series, bucket, totals }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  if (!series.length) return <Empty />;
  const W = 720, H = 230, PL = 8, PR = 8, PT = 10, PB = 24;
  const n = series.length;
  const max = Math.max(1, ...series.flatMap((s) => CH.map((ch) => s.ch?.[ch.k]?.orders || 0)));
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const colW = innerW / n;
  const groupW = Math.min(colW * 0.82, 48);
  const bw = Math.max(2, groupW / CH.length - 1);
  const x0 = (i) => PL + colW * i + (colW - groupW) / 2;
  const y = (v) => PT + innerH - (v / max) * innerH;
  const fmt = (b) => (bucket === "day" ? b.slice(5) : b.slice(2));
  const showEvery = Math.ceil(n / 9);
  const tmap = Object.fromEntries((totals || []).map((t) => [t.channel, t]));

  const onMove = (e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX ?? e.touches?.[0]?.clientX, cy = e.clientY ?? e.touches?.[0]?.clientY;
    if (cx == null) return;
    const px = cx - rect.left;
    const i = Math.max(0, Math.min(n - 1, Math.floor(((px / rect.width) * W - PL) / colW)));
    setHover({ i, x: px, y: (cy - rect.top) });
  };

  const hb = hover != null ? series[hover.i] : null;
  return (
    <div ref={wrapRef} style={{ position: "relative" }}
      onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
      <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 11.5, fontWeight: 700, flexWrap: "wrap" }}>
        {CH.map((ch) => (
          <span key={ch.k} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#475569" }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: ch.c }} />
            {ch.k}<span style={{ color: "#94a3b8" }}>({num(tmap[ch.k]?.orders || 0)})</span>
          </span>
        ))}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", touchAction: "pan-y" }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PL} x2={W - PR} y1={y(max * f)} y2={y(max * f)} stroke="#f1f5f9" strokeWidth="1" />
        ))}
        {hover != null && <rect x={PL + colW * hover.i} y={PT} width={colW} height={innerH} fill="#6366f1" opacity="0.06" />}
        {series.map((s, i) => (
          <g key={i}>
            {CH.map((ch, j) => {
              const v = s.ch?.[ch.k]?.orders || 0;
              const h = (v / max) * innerH;
              return <rect key={ch.k} x={x0(i) + j * (bw + 1)} y={PT + innerH - h} width={bw} height={h} rx="1.5" fill={ch.c} />;
            })}
            {i % showEvery === 0 && <text x={PL + colW * (i + 0.5)} y={H - 7} textAnchor="middle" style={{ fontSize: 9, fill: "#94a3b8" }}>{fmt(s.bucket)}</text>}
          </g>
        ))}
      </svg>
      {hb && (
        <div style={{
          position: "absolute", left: Math.min(Math.max(hover.x - 70, 0), (wrapRef.current?.clientWidth || 300) - 150),
          top: Math.max(hover.y - 96, 0), width: 150, pointerEvents: "none", zIndex: 5,
          background: "#0f172a", color: "#fff", borderRadius: 10, padding: "8px 10px", fontSize: 11.5,
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}>
          <div style={{ fontWeight: 800, marginBottom: 5 }}>{hb.bucket}</div>
          {CH.map((ch) => (
            <div key={ch.k} style={{ display: "flex", justifyContent: "space-between", gap: 8, opacity: (hb.ch?.[ch.k]?.orders || 0) ? 1 : 0.5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: ch.c }} />{ch.k}
              </span>
              <span style={{ fontWeight: 700 }}>{num(hb.ch?.[ch.k]?.orders || 0)} · {inr(hb.ch?.[ch.k]?.revenue || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Total orders — stacked bars (approved dark + rest light) + new/repeat trend lines */
function OrdersChart({ series, bucket }) {
  if (!series.length) return <Empty />;
  const W = 640, H = 210, PL = 6, PR = 6, PT = 10, PB = 26;
  const n = series.length;
  const maxBar = Math.max(1, ...series.map((d) => d.total));
  const maxLine = Math.max(1, ...series.flatMap((d) => [d.new_orders, d.repeat_orders]));
  const max = Math.max(maxBar, maxLine);
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const bw = Math.max(4, (innerW / n) * 0.62);
  const cx = (i) => PL + (innerW / n) * (i + 0.5);
  const y = (v) => PT + innerH - (v / max) * innerH;
  const fmtLabel = (b) => bucket === "day" ? b.slice(5) : b.slice(2); // MM-DD or YY-MM
  const line = (key) => series.map((d, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const showEvery = Math.ceil(n / 8);
  return (
    <div>
      <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 11.5, fontWeight: 700, flexWrap: "wrap" }}>
        <Lg c="#4f46e5" s text="Approved" /><Lg c="#c7d2fe" s text="Pending / rejected" />
        <Lg c="#10b981" text="New customers" /><Lg c="#f59e0b" text="Repeat customers" />
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PL} x2={W - PR} y1={y(max * f)} y2={y(max * f)} stroke="#f1f5f9" strokeWidth="1" />
        ))}
        {series.map((d, i) => {
          const x = cx(i) - bw / 2;
          const hTotal = (d.total / max) * innerH;
          const hAppr = (d.approved / max) * innerH;
          return (
            <g key={i}>
              <rect x={x} y={y(d.total)} width={bw} height={hTotal} rx="2" fill="#c7d2fe" />
              <rect x={x} y={PT + innerH - hAppr} width={bw} height={hAppr} rx="2" fill="#4f46e5" />
              {i % showEvery === 0 && (
                <text x={cx(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 9, fill: "#94a3b8" }}>{fmtLabel(d.bucket)}</text>
              )}
            </g>
          );
        })}
        <path d={line("new_orders")} fill="none" stroke="#10b981" strokeWidth="2" />
        <path d={line("repeat_orders")} fill="none" stroke="#f59e0b" strokeWidth="2" />
        {series.map((d, i) => (<g key={"p" + i}>
          <circle cx={cx(i)} cy={y(d.new_orders)} r="2.4" fill="#10b981" />
          <circle cx={cx(i)} cy={y(d.repeat_orders)} r="2.4" fill="#f59e0b" />
        </g>))}
      </svg>
    </div>
  );
}

const Lg = ({ c, text, s }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#475569" }}>
    <span style={{ width: s ? 11 : 14, height: s ? 11 : 3, borderRadius: s ? 3 : 2, background: c }} /> {text}
  </span>
);
const Empty = () => <div style={{ color: "#94a3b8", fontSize: 13, padding: 24, textAlign: "center" }}>No data in this period.</div>;
const slash = (a, b) => `${num(a)} / ${num(b)}`;

export default function SalesOverviewSection() {
  const [d, setD] = useState(null);
  const [period, setPeriod] = useState("15d");
  const [loading, setLoading] = useState(true);

  // Event-driven (no polling): refreshes on order/chat events + tab focus.
  useEffect(() => {
    let live = true;
    const get = (showLoad) => {
      if (showLoad) setLoading(true);
      fetchSalesOverview(period).then((r) => live && setD(r)).catch(() => {}).finally(() => live && setLoading(false));
    };
    get(true);
    // Debounce event-driven refreshes so chat/order bursts coalesce into ONE
    // (heavy) query instead of hammering the DB.
    let timer = null;
    const onChange = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => get(false), 3000); };
    const onFocus = () => document.visibilityState === "visible" && get(false);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("order:changed", onChange);
    window.addEventListener("chat:changed", onChange);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("order:changed", onChange);
      window.removeEventListener("chat:changed", onChange);
    };
  }, [period]);

  const o = d?.orders || {}, nc = d?.new_customers || {}, rc = d?.repeat_customers || {}, ld = d?.leads || {}, ai = d?.ai || {};

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", margin: 0 }}>Sales Overview</h3>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => setPeriod(p.id)} style={{
              fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
              border: "1px solid " + (period === p.id ? "#6366f1" : "#e2e8f0"),
              background: period === p.id ? "#6366f1" : "#fff", color: period === p.id ? "#fff" : "#475569",
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* ── Top KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,200px),1fr))", gap: 12, marginBottom: 16 }}>
        <KpiCard title="AI Wallet" accent={ai.available && ai.balance_usd < 5 ? "#ef4444" : "#10b981"}
          rows={[
            { k: "Balance", v: ai.available ? `${inr(ai.balance_inr)} ($${Number(ai.balance_usd).toFixed(2)})` : "—", c: ai.available && ai.balance_usd < 5 ? "#ef4444" : "#10b981" },
            { k: "Spent (period)", v: `${inr(ai.spent_inr)} ($${Number(ai.spent_usd || 0).toFixed(2)})`, c: "#6366f1" },
          ]} />
        <KpiCard title="Total Orders" value={num(o.total)}
          rows={[{ k: "Approved", v: num(o.approved), c: "#10b981" }, { k: "Rejected", v: num(o.rejected), c: "#ef4444" }]} />
        <KpiCard title="New Customers" value={slash(nc.placed, nc.approved)} accent="#6366f1"
          rows={[{ k: "placed / approved", v: "1 order ever", c: "#94a3b8" }]} />
        <KpiCard title="Repeat Customers" value={slash(rc.placed, rc.approved)} accent="#8b5cf6"
          rows={[{ k: "placed / approved", v: "2+ orders ever", c: "#94a3b8" }]} />
        <KpiCard title="Leads (Chats)" value={num(ld.total)}
          rows={[{ k: "No response", v: num(ld.no_response), c: "#ef4444" }, { k: "New", v: num(ld.new), c: "#6366f1" }, { k: "Repeat", v: num(ld.repeat), c: "#8b5cf6" }]} />
        <KpiCard title="Chats vs Escalation" value={`${num(ld.total)} → ${num(ld.escalated)}`} accent="#f59e0b"
          rows={[{ k: "escalated to human", v: ld.total ? `${Math.round((ld.escalated / ld.total) * 100)}%` : "0%", c: "#f59e0b" }]} />
      </div>

      {/* ── Bar charts ── */}
      {loading ? (
        <div style={{ ...card, textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 28 }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 14 }}>
          <div style={{ ...card, gridColumn: "1 / -1" }}>
            <div style={{ ...lab, marginBottom: 12 }}>Sales by Channel — {d?.bucket === "day" ? "per day" : "per month"} (hover/tap for details)</div>
            <GroupedChannelChart series={d?.channel_series || []} bucket={d?.bucket} totals={d?.channels || []} />
          </div>
          <div style={{ ...card, gridColumn: "1 / -1" }}>
            <div style={{ ...lab, marginBottom: 8 }}>
              Total Orders {d?.bucket === "day" ? "per day" : "per month"} — approved vs pending, with new/repeat trend
            </div>
            <OrdersChart series={d?.timeseries || []} bucket={d?.bucket} />
          </div>
        </div>
      )}
    </div>
  );
}
