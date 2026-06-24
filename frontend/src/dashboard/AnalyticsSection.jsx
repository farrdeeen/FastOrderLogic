// src/dashboard/AnalyticsSection.jsx
// Self-contained AI + sales analytics: channel revenue donut, query/reply line,
// conversion funnel, disqualified leads, AI cost + OpenRouter balance.
// Pure inline-SVG charts — no chart dependency.

import { useEffect, useState } from "react";
import { fetchAnalytics, fetchAiBalance } from "./dashboardApi";

const CH_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];
const inr = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const card = {
  background: "#fff",
  border: "1px solid #e8eaf0",
  borderRadius: 16,
  padding: 18,
  minWidth: 0,
  boxShadow: "0 1px 3px rgba(16,24,40,0.04)",
};
const label = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#94a3b8" };

function StatTile({ title, value, sub, accent = "#6366f1" }) {
  return (
    <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>{title}</span>
      <span style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>{value}</span>
      {sub != null && (
        <span style={{ fontSize: 12, color: accent, fontWeight: 700 }}>{sub}</span>
      )}
    </div>
  );
}

/* ── Donut (channel revenue share) ── */
function Donut({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let acc = 0;
  const R = 54, C = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <g transform="translate(70,70) rotate(-90)">
          <circle r={R} fill="none" stroke="#eef1f6" strokeWidth="18" />
          {data.map((d, i) => {
            const frac = d.value / total;
            const dash = frac * C;
            const seg = (
              <circle key={i} r={R} fill="none" stroke={CH_COLORS[i % CH_COLORS.length]}
                strokeWidth="18" strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acc} strokeLinecap="butt" />
            );
            acc += dash;
            return seg;
          })}
        </g>
        <text x="70" y="66" textAnchor="middle" style={{ fontSize: 11, fill: "#94a3b8", fontWeight: 700 }}>Revenue</text>
        <text x="70" y="84" textAnchor="middle" style={{ fontSize: 15, fill: "#0f172a", fontWeight: 800 }}>{inr(total)}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1, minWidth: 130 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: CH_COLORS[i % CH_COLORS.length] }} />
            <span style={{ fontWeight: 700, color: "#334155", flex: 1 }}>{d.name}</span>
            <span style={{ color: "#64748b" }}>{inr(d.value)}</span>
            <span style={{ color: "#94a3b8", width: 38, textAlign: "right" }}>
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Dual line (customer queries vs AI replies) ── */
function DualLine({ series }) {
  const W = 520, H = 150, P = 8;
  if (!series.length) return <Empty />;
  const max = Math.max(1, ...series.flatMap((d) => [d.user_msgs, d.ai_msgs]));
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, series.length - 1);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const path = (key) => series.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = (key) => `${path(key)} L${x(series.length - 1)},${H - P} L${x(0)},${H - P} Z`;
  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 6, fontSize: 12, fontWeight: 700 }}>
        <Legend color="#6366f1" text="Customer queries" />
        <Legend color="#10b981" text="AI replies" />
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 150 }}>
        <defs>
          <linearGradient id="gu" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area("user_msgs")} fill="url(#gu)" />
        <path d={path("user_msgs")} fill="none" stroke="#6366f1" strokeWidth="2.5" />
        <path d={path("ai_msgs")} fill="none" stroke="#10b981" strokeWidth="2.5" strokeDasharray="0" />
      </svg>
    </div>
  );
}

/* ── Funnel (sessions → orders) ── */
function Funnel({ sessions, ordered, rate }) {
  const w2 = sessions ? Math.max(8, (ordered / sessions) * 100) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Bar text={`Chats started`} val={sessions} pct={100} color="#6366f1" />
      <Bar text={`Orders placed`} val={ordered} pct={w2} color="#10b981" />
      <div style={{ fontSize: 13, fontWeight: 800, color: "#10b981" }}>
        {rate}% conversion
      </div>
    </div>
  );
}

const Bar = ({ text, val, pct, color }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
      <span>{text}</span><span>{Number(val || 0).toLocaleString()}</span>
    </div>
    <div style={{ height: 12, background: "#eef1f6", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 6, transition: "width .5s" }} />
    </div>
  </div>
);
const Legend = ({ color, text }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#475569" }}>
    <span style={{ width: 12, height: 3, borderRadius: 2, background: color }} /> {text}
  </span>
);
const Empty = () => <div style={{ color: "#94a3b8", fontSize: 13, padding: 20, textAlign: "center" }}>No data yet.</div>;

export default function AnalyticsSection() {
  const [a, setA] = useState(null);
  const [bal, setBal] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchAnalytics(days).then((d) => live && setA(d)).catch(() => live && setA(null)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [days]);

  useEffect(() => {
    let live = true;
    fetchAiBalance().then((d) => live && setBal(d)).catch(() => {});
    return () => { live = false; };
  }, []);

  const sales = a?.sales_by_channel || [];
  const donut = sales.map((s) => ({ name: s.channel, value: s.revenue }));
  const totalOrders = sales.reduce((s, c) => s + c.orders, 0);
  const cost = a?.ai_cost || {};
  const conv = a?.conversion || {};
  const leads = a?.leads || {};

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>📈 AI & Sales Analytics</h3>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              style={{
                fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                border: "1px solid " + (days === d ? "#6366f1" : "#e2e8f0"),
                background: days === d ? "#6366f1" : "#fff", color: days === d ? "#fff" : "#475569",
              }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Top stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,150px),1fr))", gap: 12, marginBottom: 14 }}>
        <StatTile title="AI Cost" value={`$${Number(cost.cost_usd || 0).toFixed(2)}`}
          sub={`${((cost.prompt_tokens || 0) + (cost.completion_tokens || 0)).toLocaleString()} tokens`} accent="#6366f1" />
        <StatTile title="AI Balance" accent={bal?.balance_usd < 5 ? "#ef4444" : "#10b981"}
          value={bal?.available ? `$${Number(bal.balance_usd).toFixed(2)}` : "—"}
          sub={bal?.available ? (bal.balance_usd < 5 ? "Low — top up" : "OpenRouter credits") : "set key"} />
        <StatTile title="Conversion" value={`${conv.rate ?? 0}%`} sub={`${conv.ordered || 0}/${conv.sessions || 0} chats`} accent="#10b981" />
        <StatTile title="Orders" value={totalOrders.toLocaleString()} sub={`last ${a?.days || days} days`} accent="#f59e0b" />
        <StatTile title="Leads Disqualified" value={(leads.escalations || 0) + (leads.failures || 0)}
          sub={`${leads.escalations || 0} escalated · ${leads.failures || 0} AI-fail`} accent="#ef4444" />
      </div>

      {loading ? (
        <div style={{ ...card, textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 28 }}>Loading analytics…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 14 }}>
          <div style={card}>
            <div style={{ ...label, marginBottom: 12 }}>Revenue by Channel (paid)</div>
            {donut.length ? <Donut data={donut} /> : <Empty />}
          </div>
          <div style={card}>
            <div style={{ ...label, marginBottom: 12 }}>Customer Queries vs AI Replies (14d)</div>
            <DualLine series={a?.timeseries || []} />
          </div>
          <div style={card}>
            <div style={{ ...label, marginBottom: 12 }}>Conversion Funnel</div>
            <Funnel sessions={conv.sessions} ordered={conv.ordered} rate={conv.rate} />
          </div>
          <div style={card}>
            <div style={{ ...label, marginBottom: 12 }}>Sales by Channel</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sales.map((s, i) => (
                <div key={s.channel}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 3 }}>
                    <span>{s.channel}</span>
                    <span>{s.orders} orders · {inr(s.revenue)}</span>
                  </div>
                  <div style={{ height: 10, background: "#eef1f6", borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ width: `${totalOrders ? (s.orders / totalOrders) * 100 : 0}%`, height: "100%", background: CH_COLORS[i % CH_COLORS.length] }} />
                  </div>
                </div>
              ))}
              {!sales.length && <Empty />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
