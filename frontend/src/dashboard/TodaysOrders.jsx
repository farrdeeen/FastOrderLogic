// src/dashboard/TodaysOrders.jsx
// Live table of today's orders (item, qty, amount, AWB, invoice). Polls every 15s
// + refetches on focus / chat events — no page reload. Table on desktop, cards on
// mobile.

import { useEffect, useState, useCallback } from "react";
import { fetchTodaysOrders } from "./dashboardApi";

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const PAID = ["paid", "success", "accepted"];

function useIsMobile(bp = 720) {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= bp : false));
  useEffect(() => {
    const q = window.matchMedia(`(max-width:${bp}px)`);
    const f = (e) => setM(e.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [bp]);
  return m;
}

const card = { background: "#fff", border: "1px solid #e8eaf0", borderRadius: 16, minWidth: 0, boxShadow: "0 1px 3px rgba(16,24,40,0.04)" };

function payChip(o) {
  const paid = PAID.includes((o.payment_status || "").toLowerCase());
  const c = paid ? { bg: "#dcfce7", fg: "#15803d", t: "Paid" } : { bg: "#fef3c7", fg: "#b45309", t: "Pending" };
  return <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: c.bg, color: c.fg }}>{c.t}</span>;
}
const itemsText = (o) => (o.items || []).map((i) => `${i.name} ×${i.qty}`).join(", ") || "—";
const qtyTotal = (o) => (o.items || []).reduce((s, i) => s + (i.qty || 0), 0) || "—";

export default function TodaysOrders() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    try { setData(await fetchTodaysOrders()); } catch { /* keep last */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    const onFocus = () => document.visibilityState === "visible" && load();
    const onChange = () => load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    window.addEventListener("chat:changed", onChange);
    window.addEventListener("order:changed", onChange);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("chat:changed", onChange);
      window.removeEventListener("order:changed", onChange);
    };
  }, [load]);

  const orders = data?.orders || [];
  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>
        Today’s Orders <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 13 }}>({orders.length})</span>
      </h3>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#10b981", fontWeight: 700 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", display: "inline-block" }} /> Live
      </span>
    </div>
  );

  if (loading && !data) return <div>{header}<div style={{ ...card, padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading…</div></div>;
  if (!orders.length) return <div>{header}<div style={{ ...card, padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No orders yet today.</div></div>;

  if (isMobile) {
    return (
      <div>{header}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orders.map((o) => (
            <div key={o.order_id} style={{ ...card, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, fontWeight: 800, color: "#1e293b" }}>{o.order_id}</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{inr(o.amount)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "#475569", marginTop: 4 }}>{o.customer}</div>
              <div style={{ fontSize: 12.5, color: "#334155", marginTop: 6, lineHeight: 1.4 }}>{itemsText(o)}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8, fontSize: 11.5, color: "#64748b" }}>
                <span>Qty: <b style={{ color: "#334155" }}>{qtyTotal(o)}</b></span>
                <span>AWB: <b style={{ color: o.awb ? "#334155" : "#cbd5e1" }}>{o.awb || "—"}</b></span>
                <span>Inv: <b style={{ color: o.invoice ? "#334155" : "#cbd5e1" }}>{o.invoice || "—"}</b></span>
                <span style={{ marginLeft: "auto" }}>{payChip(o)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const th = { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#94a3b8", borderBottom: "1px solid #eef1f6" };
  const td = { padding: "10px 12px", fontSize: 12.5, color: "#334155", borderBottom: "1px solid #f4f6f9", verticalAlign: "top" };
  return (
    <div>{header}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr>
              <th style={th}>Order ID</th><th style={th}>Customer</th><th style={th}>Item(s)</th>
              <th style={{ ...th, textAlign: "center" }}>Qty</th><th style={{ ...th, textAlign: "right" }}>Amount</th>
              <th style={th}>AWB</th><th style={th}>Invoice</th><th style={th}>Payment</th>
            </tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id}>
                  <td style={{ ...td, fontFamily: "ui-monospace,monospace", fontWeight: 700 }}>{o.order_id}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{o.customer}</td>
                  <td style={{ ...td, maxWidth: 240 }}>{itemsText(o)}</td>
                  <td style={{ ...td, textAlign: "center" }}>{qtyTotal(o)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, color: "#0f172a" }}>{inr(o.amount)}</td>
                  <td style={{ ...td, fontFamily: "ui-monospace,monospace", color: o.awb ? "#334155" : "#cbd5e1" }}>{o.awb || "—"}</td>
                  <td style={{ ...td, color: o.invoice ? "#334155" : "#cbd5e1" }}>{o.invoice || "—"}</td>
                  <td style={td}>{payChip(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
