/**
 * components/SerialSearchPage.jsx
 *
 * Search by:
 *   • Serial / IMEI number (partial match)
 *   • Order ID (exact)
 *
 * Displays a rich timeline of device transactions and order details.
 * Uses the same CSS variable system as CreateOrderForm (injectFormStyles).
 */

import { useState, useRef, useCallback } from "react";
import api from "../api/axiosInstance";

// ─── Colour / status helpers ──────────────────────────────────────────────────
const STATUS_COLORS = {
  paid: { bg: "#dcfce7", color: "#166534", border: "#bbf7d0" },
  pending: { bg: "#fef9c3", color: "#854d0e", border: "#fde68a" },
  SHIPPED: { bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" },
  NOT_SHIPPED: { bg: "#f3f4f6", color: "#374151", border: "#e5e7eb" },
  COMPLETED: { bg: "#dcfce7", color: "#166534", border: "#bbf7d0" },
  READY: { bg: "#ede9fe", color: "#5b21b6", border: "#ddd6fe" },
};

const IN_OUT_STYLES = {
  IN: { bg: "#dcfce7", color: "#166534", border: "#86efac", icon: "▼" },
  OUT: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", icon: "▲" },
  RETURN: { bg: "#fef3c7", color: "#92400e", border: "#fcd34d", icon: "↩" },
};

function Badge({ label, type }) {
  const s = STATUS_COLORS[label] ||
    STATUS_COLORS[type] || {
      bg: "#f3f4f6",
      color: "#374151",
      border: "#e5e7eb",
    };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "2px 7px",
        borderRadius: 99,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function InOutBadge({ label }) {
  const s = IN_OUT_STYLES[label] || {
    bg: "#f3f4f6",
    color: "#374151",
    border: "#e5e7eb",
    icon: "•",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: "3px 10px",
        borderRadius: 99,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      <span style={{ fontSize: 9 }}>{s.icon}</span>
      {label}
    </span>
  );
}

const fmt = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
};

// ─── Inline styles (scoped, no global leakage) ────────────────────────────────
const css = {
  wrap: {
    fontFamily: "'DM Sans', 'IBM Plex Sans', system-ui, sans-serif",
    color: "#1a1a2e",
    minHeight: "100%",
  },
  searchBox: {
    background: "#fff",
    border: "1.5px solid #e5e7eb",
    borderRadius: 14,
    padding: "20px 24px",
    marginBottom: 24,
    boxShadow: "0 1px 4px rgba(0,0,0,.06)",
  },
  modeBtn: (active) => ({
    padding: "7px 18px",
    borderRadius: 99,
    border: "1.5px solid",
    borderColor: active ? "#6366f1" : "#e5e7eb",
    background: active ? "#6366f1" : "#fff",
    color: active ? "#fff" : "#6b7280",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    transition: "all .15s",
  }),
  input: {
    flex: 1,
    border: "1.5px solid #e5e7eb",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    transition: "border-color .15s",
    minWidth: 0,
  },
  searchBtn: {
    padding: "10px 22px",
    borderRadius: 10,
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "background .15s",
    flexShrink: 0,
  },
  card: {
    background: "#fff",
    border: "1.5px solid #e5e7eb",
    borderRadius: 14,
    marginBottom: 20,
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(0,0,0,.06)",
  },
  cardHead: {
    background: "linear-gradient(135deg, #f8f7ff 0%, #eef2ff 100%)",
    borderBottom: "1.5px solid #e5e7eb",
    padding: "14px 20px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  cardBody: {
    padding: "16px 20px",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 12,
    marginBottom: 14,
  },
  label: {
    fontSize: 10,
    fontWeight: 700,
    color: "#9ca3af",
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  value: {
    fontSize: 13,
    fontWeight: 500,
    color: "#1f2937",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  // Timeline
  timeline: {
    position: "relative",
    paddingLeft: 28,
  },
  tlLine: {
    position: "absolute",
    left: 9,
    top: 0,
    bottom: 0,
    width: 2,
    background: "linear-gradient(to bottom, #6366f1, #c7d2fe)",
    borderRadius: 2,
  },
  tlDot: (color) => ({
    position: "absolute",
    left: 0,
    top: 14,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: color,
    border: "3px solid #fff",
    boxShadow: `0 0 0 2px ${color}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 8,
    color: "#fff",
    fontWeight: 900,
  }),
  tlItem: {
    position: "relative",
    marginBottom: 16,
    paddingLeft: 10,
  },
  tlCard: {
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "12px 14px",
  },
  emptyState: {
    textAlign: "center",
    padding: "48px 24px",
    color: "#9ca3af",
  },
  spinner: {
    width: 22,
    height: 22,
    border: "3px solid #e5e7eb",
    borderTop: "3px solid #6366f1",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};

// ─── Inject keyframes once ────────────────────────────────────────────────────
let _injected = false;
function injectSpinner() {
  if (_injected || typeof document === "undefined") return;
  _injected = true;
  const style = document.createElement("style");
  style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(style);
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function Field({ label, value, mono }) {
  return (
    <div>
      <div style={css.label}>{label}</div>
      <div
        style={{
          ...css.value,
          fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit",
        }}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function OrderMiniCard({ order }) {
  if (!order) return null;
  return (
    <div
      style={{
        background: "#eef2ff",
        border: "1px solid #c7d2fe",
        borderRadius: 8,
        padding: "10px 12px",
        marginTop: 8,
        fontSize: 12,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: "#4338ca",
          marginBottom: 6,
          fontFamily: "monospace",
        }}
      >
        🔖 {order.order_id}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 16px",
          marginBottom: 6,
        }}
      >
        <Badge label={order.payment_status} />
        <Badge label={order.delivery_status} />
        {order.channel && <Badge label={order.channel.toUpperCase()} />}
      </div>
      {order.customer && (
        <div style={{ color: "#374151", marginBottom: 4 }}>
          👤 <strong>{order.customer.name}</strong>
          {order.customer.mobile ? ` · ${order.customer.mobile}` : ""}
        </div>
      )}
      {order.ship_to?.city && (
        <div style={{ color: "#6b7280" }}>
          📍{" "}
          {[
            order.ship_to.address_line,
            order.ship_to.city,
            order.ship_to.state,
            order.ship_to.pincode,
          ]
            .filter(Boolean)
            .join(", ")}
        </div>
      )}
      <div style={{ marginTop: 6, color: "#6b7280" }}>
        {order.total_amount != null ? fmt(order.total_amount) : ""}
        {order.order_created_at ? ` · ${fmtDate(order.order_created_at)}` : ""}
      </div>
    </div>
  );
}

function SerialTimeline({ transactions }) {
  const dotColors = { IN: "#22c55e", OUT: "#ef4444", RETURN: "#f59e0b" };
  return (
    <div style={css.timeline}>
      <div style={css.tlLine} />
      {transactions.map((tx, i) => (
        <div key={tx.auto_id} style={css.tlItem}>
          <div style={css.tlDot(dotColors[tx.in_out_label] || "#6366f1")}>
            {tx.in_out_label === "IN"
              ? "↓"
              : tx.in_out_label === "OUT"
                ? "↑"
                : "↩"}
          </div>
          <div style={css.tlCard}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                flexWrap: "wrap",
              }}
            >
              <InOutBadge label={tx.in_out_label} />
              <span style={{ fontSize: 11, color: "#6b7280" }}>
                {fmtDate(tx.create_date)}
              </span>
              {tx.price != null && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#374151",
                    marginLeft: "auto",
                  }}
                >
                  {fmt(tx.price)}
                </span>
              )}
            </div>
            {tx.remarks && (
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                📝 {tx.remarks}
              </div>
            )}
            {tx.in_out_label !== "IN" && tx.order && (
              <OrderMiniCard order={tx.order} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── RESULT: Serial Search ─────────────────────────────────────────────────────
function SerialResults({ data }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (srno) => setExpanded((p) => ({ ...p, [srno]: !p[srno] }));

  if (!data?.serials?.length) {
    return (
      <div style={css.emptyState}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>
          No results found
        </div>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          Try a different serial number or partial IMEI
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 14 }}>
        Found <strong>{data.serials.length}</strong> serial
        {data.serials.length !== 1 ? "s" : ""}
      </div>
      {data.serials.map((sr) => {
        const isOpen = expanded[sr.device_srno] !== false; // default open
        const latestTx = sr.transactions[sr.transactions.length - 1];
        const lastLabel = latestTx?.in_out_label;
        return (
          <div key={sr.device_srno} style={css.card}>
            <div style={css.cardHead}>
              <InOutBadge label={lastLabel || "IN"} />
              <span
                style={{
                  fontFamily: "monospace",
                  fontWeight: 700,
                  fontSize: 15,
                  flex: 1,
                }}
              >
                {sr.device_srno}
              </span>
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {sr.model_name}
              </span>
              {sr.sku_id && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#9ca3af",
                    fontFamily: "monospace",
                  }}
                >
                  SKU: {sr.sku_id}
                </span>
              )}
              <button
                onClick={() => toggle(sr.device_srno)}
                style={{
                  background: "none",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontSize: 11,
                  color: "#6b7280",
                }}
              >
                {isOpen ? "Collapse" : `${sr.transactions.length} events`}
              </button>
            </div>
            {isOpen && (
              <div style={css.cardBody}>
                <SerialTimeline transactions={sr.transactions} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── RESULT: Order Search ──────────────────────────────────────────────────────
function OrderResults({ data }) {
  if (!data?.order)
    return (
      <div style={css.emptyState}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>
          Order not found
        </div>
      </div>
    );

  const { order, items } = data;
  const totalAssigned = items.reduce((s, it) => s + it.serial_count, 0);
  const totalRequired = items.reduce((s, it) => s + it.quantity, 0);

  return (
    <div>
      {/* Order Header */}
      <div style={css.card}>
        <div
          style={{
            ...css.cardHead,
            background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
          }}
        >
          <span style={{ fontSize: 20 }}>📦</span>
          <span
            style={{
              fontFamily: "monospace",
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: 1,
            }}
          >
            {order.order_id}
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Badge label={order.payment_status} />
            <Badge label={order.delivery_status} />
            {order.channel && <Badge label={order.channel.toUpperCase()} />}
            {order.order_status && <Badge label={order.order_status} />}
          </div>
          <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 15 }}>
            {fmt(order.total_amount)}
          </span>
        </div>
        <div style={css.cardBody}>
          <div style={css.grid2}>
            <Field
              label="Payment Method"
              value={order.payment_type?.toUpperCase()}
            />
            <Field label="Date" value={fmtDate(order.created_at)} />
            <Field label="AWB Number" value={order.awb_number} mono />
            <Field label="UTR Number" value={order.utr_number} mono />
            <Field label="Invoice" value={order.invoice_number} mono />
            <Field
              label="Serials"
              value={`${totalAssigned} / ${totalRequired} assigned`}
            />
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
          >
            {/* Customer */}
            {order.customer && (
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <div style={css.label}>Customer</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {order.customer.name}
                </div>
                {order.customer.mobile && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      fontFamily: "monospace",
                      marginTop: 2,
                    }}
                  >
                    📞 {order.customer.mobile}
                  </div>
                )}
                {order.customer.email && (
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    ✉ {order.customer.email}
                  </div>
                )}
              </div>
            )}

            {/* Ship To */}
            {order.ship_to && (
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <div style={css.label}>Ship To</div>
                <div
                  style={{ fontSize: 13, lineHeight: 1.6, color: "#374151" }}
                >
                  {order.ship_to.address_line}
                  {order.ship_to.locality ? `, ${order.ship_to.locality}` : ""}
                  <br />
                  {[
                    order.ship_to.city,
                    order.ship_to.state,
                    order.ship_to.pincode,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {order.ship_to.landmark && (
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>
                      🏠 {order.ship_to.landmark}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Items */}
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
        {items.length} product{items.length !== 1 ? "s" : ""} in this order
      </div>

      {items.map((it) => {
        const statusColors = {
          complete: { bg: "#dcfce7", color: "#166534", border: "#86efac" },
          partial: { bg: "#fef9c3", color: "#854d0e", border: "#fde68a" },
          none: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
        }[it.serial_status];

        return (
          <div key={it.item_id} style={css.card}>
            <div style={css.cardHead}>
              <span style={{ fontSize: 16 }}>📱</span>
              <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>
                {it.product_name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "#9ca3af",
                  fontFamily: "monospace",
                }}
              >
                {it.sku_id}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 99,
                  border: `1px solid ${statusColors.border}`,
                  background: statusColors.bg,
                  color: statusColors.color,
                }}
              >
                {it.serial_count}/{it.quantity} serials
              </span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {fmt(it.total_price)}
              </span>
            </div>
            <div style={css.cardBody}>
              <div
                style={{
                  display: "flex",
                  gap: 24,
                  marginBottom: 10,
                  fontSize: 12,
                }}
              >
                <span>
                  Qty: <strong>{it.quantity}</strong>
                </span>
                <span>
                  Unit: <strong>{fmt(it.unit_price)}</strong>
                </span>
              </div>

              {it.serials.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "16px",
                    color: "#ef4444",
                    fontSize: 12,
                    fontWeight: 500,
                    background: "#fef2f2",
                    borderRadius: 8,
                    border: "1px dashed #fca5a5",
                  }}
                >
                  ⚠ No serial numbers assigned yet
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {it.serials.map((s) => (
                    <div
                      key={s.auto_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "#f0fdf4",
                        border: "1px solid #86efac",
                        borderRadius: 8,
                        padding: "8px 12px",
                      }}
                    >
                      <InOutBadge label={s.in_out_label} />
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontWeight: 700,
                          fontSize: 13,
                          flex: 1,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {s.device_srno}
                      </span>
                      <span style={{ fontSize: 11, color: "#6b7280" }}>
                        {fmtDate(s.create_date)}
                      </span>
                      {s.price != null && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#374151",
                          }}
                        >
                          {fmt(s.price)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SerialSearchPage() {
  injectSpinner();

  const [mode, setMode] = useState("serial"); // "serial" | "order"
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const endpoint =
        mode === "serial"
          ? `/serial-search/by-serial?q=${encodeURIComponent(q)}`
          : `/serial-search/by-order?order_id=${encodeURIComponent(q)}`;
      const res = await api.get(endpoint);
      setResult(res.data);
    } catch (err) {
      const msg =
        err?.response?.status === 404
          ? "Not found. Check the ID and try again."
          : err?.response?.data?.detail || "Search failed. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [mode, query]);

  const handleKey = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const switchMode = (m) => {
    setMode(m);
    setQuery("");
    setResult(null);
    setError("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div style={css.wrap}>
      {/* Search Box */}
      <div style={css.searchBox}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 18 }}>🔎</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>
            Serial &amp; Order Search
          </span>
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button
              style={css.modeBtn(mode === "serial")}
              onClick={() => switchMode("serial")}
            >
              📟 Serial / IMEI
            </button>
            <button
              style={css.modeBtn(mode === "order")}
              onClick={() => switchMode("order")}
            >
              📦 Order ID
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <input
            ref={inputRef}
            style={css.input}
            placeholder={
              mode === "serial"
                ? "Enter serial number or partial IMEI…"
                : "Enter Order ID (e.g. 00012#00045)…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            autoFocus
          />
          <button
            style={{
              ...css.searchBtn,
              opacity: loading || !query.trim() ? 0.6 : 1,
              cursor: loading || !query.trim() ? "not-allowed" : "pointer",
            }}
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={css.spinner} />
                Searching…
              </div>
            ) : (
              "Search"
            )}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              borderRadius: 8,
              fontSize: 13,
              color: "#991b1b",
            }}
          >
            ✕ {error}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af" }}>
          {mode === "serial"
            ? "Partial match supported — enter a few characters of the serial/IMEI"
            : "Enter the exact Order ID (e.g. 00012#00045)"}
        </div>
      </div>

      {/* Results */}
      {!loading && !result && !error && (
        <div style={css.emptyState}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📟</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>
            {mode === "serial"
              ? "Search for a serial number"
              : "Search for an order"}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {mode === "serial"
              ? "Enter any partial serial or IMEI to see full transaction history"
              : "Enter an Order ID to see all items and their assigned serials"}
          </div>
        </div>
      )}

      {result && mode === "serial" && <SerialResults data={result} />}
      {result && mode === "order" && <OrderResults data={result} />}
    </div>
  );
}
