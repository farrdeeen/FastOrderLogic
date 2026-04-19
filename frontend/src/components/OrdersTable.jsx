import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import api from "../api/axiosInstance";

/* ─────────────────────────────────────────────
   GLOBAL STYLES  (injected once)
───────────────────────────────────────────── */
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

  :root {
    --bg: #f4f5f7;
    --surface: #ffffff;
    --surface2: #f8f9fb;
    --border: #e4e7ec;
    --border2: #d0d5dd;
    --text: #101828;
    --text2: #475467;
    --text3: #98a2b3;
    --accent: #1570ef;
    --accent-light: #eff4ff;
    --accent-dark: #0e4fc7;
    --green: #12b76a;
    --green-bg: #ecfdf3;
    --red: #f04438;
    --red-bg: #fef3f2;
    --amber: #f79009;
    --amber-bg: #fffaeb;
    --purple: #7f56d9;
    --purple-bg: #f4f3ff;
    --shadow-sm: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1);
    --shadow-md: 0 4px 8px -2px rgba(16,24,40,.1), 0 2px 4px -2px rgba(16,24,40,.06);
    --shadow-xl: 0 20px 24px -4px rgba(16,24,40,.08), 0 8px 8px -4px rgba(16,24,40,.03);
    --radius: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    font-family: 'DM Sans', sans-serif;
  }

  .ot-wrap { font-family: 'DM Sans', sans-serif; color: var(--text); }

  /* ── TOOLBAR ── */
  .ot-toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 16px;
  }
  .ot-search-wrap {
    position: relative;
    flex: 0 1 280px;   /* controlled width */
    min-width: 200px;
    max-width: 320px;
  }
  .ot-search-wrap svg {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    color: var(--text3); pointer-events: none;
  }
  .ot-search {
    width: 100%; padding: 9px 12px 9px 38px;
    border: 1px solid var(--border2); border-radius: var(--radius);
    font-family: inherit; font-size: 14px; color: var(--text);
    background: var(--surface); outline: none; transition: border .15s;
  }
  .ot-search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  .ot-filter-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border: 1px solid var(--border2);
    border-radius: var(--radius); background: var(--surface);
    font-family: inherit; font-size: 13px; font-weight: 500; color: var(--text2);
    cursor: pointer; transition: all .15s; white-space: nowrap;
  }
  .ot-filter-btn select,
  select.ot-filter-btn {
    appearance: none;
  }
  .ot-filter-btn:hover { background: var(--bg); border-color: var(--border2); }
  .ot-filter-btn.active { background: var(--accent-light); border-color: var(--accent); color: var(--accent); }
  .ot-filter-btn .dot {
    width: 7px; height: 7px; border-radius: 50%; background: currentColor;
  }

  /* ── TABLE SHELL ── */
  .ot-table-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); overflow: hidden;
    box-shadow: var(--shadow-sm);
  }
  .ot-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }

  .ot-table thead tr {
    background: var(--surface2); border-bottom: 1px solid var(--border);
  }
  .ot-table th {
    padding: 11px 14px; text-align: left; font-weight: 600;
    font-size: 12px; color: var(--text2); letter-spacing: .3px;
    white-space: nowrap; user-select: none;
  }
  .ot-table td {
    padding: 12px 14px; border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .ot-table tbody tr:last-child td { border-bottom: none; }
  .ot-table tbody tr {
    transition: background .1s; cursor: pointer;
  }
  .ot-table tbody tr:hover td { background: #fafbff; }

  /* ── BADGES ── */
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 20px;
    font-size: 11.5px; font-weight: 600; letter-spacing: .2px;
    white-space: nowrap;
  }
  .badge-green  { background: var(--green-bg); color: #027a48; }
  .badge-red    { background: var(--red-bg);   color: #b42318; }
  .badge-amber  { background: var(--amber-bg); color: #b54708; }
  .badge-purple { background: var(--purple-bg);color: #6941c6; }
  .badge-gray   { background: var(--bg);       color: var(--text2); }
  .badge-blue   { background: var(--accent-light); color: var(--accent-dark); }
  .badge::before {
    content: ''; display: inline-block; width: 5px; height: 5px;
    border-radius: 50%; background: currentColor; opacity: .8;
  }

  /* ── ORDER ID mono ── */
  .order-id {
    font-family: 'DM Mono', monospace; font-size: 12.5px;
    color: var(--accent); font-weight: 500;
  }

  /* ── ACTION DOTS ── */
  .ot-open-btn {
    padding: 5px 12px; border: 1px solid var(--border2);
    border-radius: 6px; background: var(--surface);
    font-family: inherit; font-size: 12px; font-weight: 500;
    color: var(--text2); cursor: pointer; transition: all .15s;
    white-space: nowrap;
  }
  .ot-open-btn:hover {
    background: var(--accent-light); border-color: var(--accent);
    color: var(--accent);
  }

  /* ── LOAD MORE ── */
  .ot-load-more {
    padding: 14px; text-align: center; color: var(--text3);
    font-size: 13px;
  }

  /* ══════════════════════════════════════
     LIGHTBOX / MODAL
  ══════════════════════════════════════ */
  .lb-overlay {
    position: fixed; inset: 0; background: rgba(16,24,40,.6);
    backdrop-filter: blur(3px); display: flex; justify-content: center;
    align-items: flex-start; padding: 40px 20px;
    z-index: 1000; overflow-y: auto;
    animation: fadeIn .15s ease;
  }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }

  .lb-panel {
    background: var(--surface); border-radius: var(--radius-xl);
    width: 100%; max-width: 780px; box-shadow: var(--shadow-xl);
    animation: slideUp .2s ease;
    overflow: hidden; flex-shrink: 0;
  }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: none; opacity: 1 } }

  .lb-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }
  .lb-title { font-size: 16px; font-weight: 600; color: var(--text); }
  .lb-subtitle { font-size: 12.5px; color: var(--text3); margin-top: 2px; font-family: 'DM Mono', monospace; }

  .lb-close {
    width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border2);
    background: transparent; cursor: pointer; display: flex;
    align-items: center; justify-content: center; color: var(--text2);
    transition: all .15s;
  }
  .lb-close:hover { background: var(--red-bg); color: var(--red); border-color: var(--red); }

  .lb-body { padding: 24px; display: flex; flex-direction: column; gap: 20px; }

  .lb-section-title {
    font-size: 11px; font-weight: 600; color: var(--text3);
    letter-spacing: .8px; text-transform: uppercase; margin-bottom: 10px;
  }

  .lb-info-grid {
    display: grid; grid-template-columns: repeat(3,1fr); gap: 12px;
  }
  .lb-info-card {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 14px;
  }
  .lb-info-label { font-size: 11px; color: var(--text3); font-weight: 500; margin-bottom: 3px; }
  .lb-info-value { font-size: 13.5px; color: var(--text); font-weight: 500; }

  .lb-items-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .lb-items-table th {
    padding: 8px 10px; background: var(--surface2); text-align: left;
    font-size: 11.5px; color: var(--text3); font-weight: 600;
    border-bottom: 1px solid var(--border);
  }
  .lb-items-table td {
    padding: 10px; border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  .lb-items-table tr:last-child td { border-bottom: none; }

  /* ── ACTIONS BAR ── */
  .lb-actions {
    display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    padding: 16px 24px; border-top: 1px solid var(--border);
    background: var(--surface2);
  }
  .lb-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: var(--radius);
    font-family: inherit; font-size: 13px; font-weight: 500;
    cursor: pointer; border: 1px solid transparent; transition: all .15s;
  }
  .lb-btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .lb-btn-primary:hover { background: var(--accent-dark); }
  .lb-btn-secondary { background: var(--surface); color: var(--text2); border-color: var(--border2); }
  .lb-btn-secondary:hover { background: var(--bg); }
  .lb-btn-danger { background: var(--surface); color: var(--red); border-color: #fda29b; }
  .lb-btn-danger:hover { background: var(--red-bg); }
  .lb-btn-success { background: var(--green-bg); color: #027a48; border-color: #a9efc5; }
  .lb-btn-success:hover { background: #d1fadf; }
  .lb-btn:disabled { opacity: .5; pointer-events: none; }

  /* ── UTR MODAL ── */
  .utr-box {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 16px; margin-top: 8px;
  }
  .utr-box label { font-size: 12px; font-weight: 600; color: var(--text2); display: block; margin-bottom: 6px; }
  .utr-input-row { display: flex; gap: 8px; }
  .utr-input {
    flex: 1; padding: 9px 12px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: 'DM Mono', monospace;
    font-size: 13px; outline: none; transition: border .15s;
  }
  .utr-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── SERIAL MODAL ── */
  .serial-item {
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px; margin-bottom: 12px; background: var(--surface2);
  }
  .serial-item h4 { font-size: 13.5px; font-weight: 600; margin: 0 0 10px; color: var(--text); }
  .serial-input {
    width: 100%; padding: 8px 11px; margin: 4px 0;
    border: 1px solid var(--border2); border-radius: 6px;
    font-family: 'DM Mono', monospace; font-size: 13px; outline: none;
    transition: border .15s; box-sizing: border-box;
  }
  .serial-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── REMARKS ── */
  .remarks-input {
    width: 100%; padding: 9px 12px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: inherit; font-size: 13px;
    resize: vertical; min-height: 64px; outline: none; transition: border .15s;
    box-sizing: border-box;
  }
  .remarks-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── EMPTY ── */
  .ot-empty {
    text-align: center; padding: 60px 20px; color: var(--text3); font-size: 14px;
  }

  /* ── MOBILE ── */
  @media (max-width: 700px) {
    .lb-info-grid { grid-template-columns: 1fr 1fr; }
    .ot-table th:nth-child(n+5), .ot-table td:nth-child(n+5) { display: none; }
  }
`;

function injectStyles() {
  if (document.getElementById("ot-styles")) return;
  const s = document.createElement("style");
  s.id = "ot-styles";
  s.textContent = STYLES;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const fmtCurrency = (v) =>
  v != null
    ? `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : "—";

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

function PaymentBadge({ status }) {
  const map = {
    paid: ["badge-green", "Paid"],
    pending: ["badge-amber", "Pending"],
  };
  const [cls, label] = map[status?.toLowerCase()] || [
    "badge-gray",
    status || "—",
  ];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function DeliveryBadge({ status }) {
  const map = {
    not_shipped: ["badge-gray", "Not Shipped"],
    shipped: ["badge-blue", "Shipped"],
    completed: ["badge-green", "Completed"],
    ready: ["badge-purple", "Ready"],
  };
  const [cls, label] = map[status?.toLowerCase()] || [
    "badge-gray",
    status || "—",
  ];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function SerialBadge({ status }) {
  const map = {
    complete: ["badge-green", "✓ Complete"],
    partial: ["badge-amber", "Partial"],
    none: ["badge-gray", "No Serials"],
  };
  const [cls, label] = map[status] || ["badge-gray", "—"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

/* ─────────────────────────────────────────────
   ORDER DETAIL LIGHTBOX
───────────────────────────────────────────── */
function OrderLightbox({
  order,
  details,
  loading,
  onClose,
  onAction,
  invoiceLoading,
}) {
  const [utrOpen, setUtrOpen] = useState(false);
  const [utrValue, setUtrValue] = useState("");
  const [serialOpen, setSerialOpen] = useState(false);
  const [serialItems, setSerialItems] = useState([]);
  const [serialLoading, setSerialLoading] = useState(false);
  const [remarksVal, setRemarksVal] = useState(details?.remarks || "");
  const [remarksEditing, setRemarksEditing] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState(
    order.delivery_status || "NOT_SHIPPED",
  );
  const [localPayStatus, setLocalPayStatus] = useState(order.payment_status);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // sync remarks from details once loaded
  useEffect(() => {
    if (details?.remarks != null) setRemarksVal(details.remarks);
  }, [details]);

  // ── SERIAL ──
  const openSerials = async () => {
    setSerialLoading(true);
    try {
      const res = await api.get(
        `/orders/${encodeURIComponent(order.order_id)}/serial_numbers`,
      );
      const normalized = (res.data || []).map((it) => ({
        ...it,
        serials: it.serials?.length ? it.serials : Array(it.quantity).fill(""),
      }));
      setSerialItems(normalized);
      setSerialOpen(true);
    } catch {
      alert("Failed to load serial numbers");
    } finally {
      setSerialLoading(false);
    }
  };

  const saveSerials = async () => {
    await api.post(
      `/orders/${encodeURIComponent(order.order_id)}/serial_numbers/save`,
      { entries: serialItems },
    );
    setSerialOpen(false);
    onAction && onAction(order.order_id, "refresh");
  };

  // ── UTR SUBMIT ──
  const submitUTR = async () => {
    if (!utrValue.trim()) return alert("Enter UTR number");
    await onAction(order.order_id, "mark-paid-utr", utrValue.trim());
    setLocalPayStatus("paid");
    setUtrOpen(false);
    setUtrValue("");
    onAction && onAction(order.order_id, "refresh");
  };

  // ── DELIVERY ──
  const cycleDelivery = async (status) => {
    await onAction(order.order_id, "update-delivery", status);
    setDeliveryStatus(status);
  };

  // ── INVOICE ──
  const handleInvoice = () =>
    onAction && onAction(order.order_id, "create-invoice");

  // ── REMARKS ──
  const saveRemarks = async () => {
    await onAction(order.order_id, "update-remarks", remarksVal);
    setRemarksEditing(false);
  };

  // ── DELETE ──
  const handleDelete = async () => {
    await onAction(order.order_id, "delete");
    onClose();
  };

  const cust = order.customer;

  return (
    <div
      className="lb-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="lb-panel">
        {/* HEADER */}
        <div className="lb-header">
          <div>
            <div className="lb-title">Order Details</div>
            <div className="lb-subtitle">{order.order_id}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <PaymentBadge status={localPayStatus} />
            <DeliveryBadge status={deliveryStatus} />
            <button className="lb-close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="lb-body">
          {/* ── CUSTOMER & ORDER INFO ── */}
          <div>
            <div className="lb-section-title">Customer & Order</div>
            <div className="lb-info-grid">
              <div className="lb-info-card">
                <div className="lb-info-label">Customer</div>
                <div className="lb-info-value">{cust?.name || "—"}</div>
              </div>
              <div className="lb-info-card">
                <div className="lb-info-label">Mobile</div>
                <div
                  className="lb-info-value"
                  style={{ fontFamily: "'DM Mono',monospace" }}
                >
                  {cust?.mobile || "—"}
                </div>
              </div>
              <div className="lb-info-card">
                <div className="lb-info-label">Channel</div>
                <div className="lb-info-value">{order.channel || "—"}</div>
              </div>
              <div className="lb-info-card">
                <div className="lb-info-label">Created</div>
                <div className="lb-info-value">{fmtDate(order.created_at)}</div>
              </div>
              <div className="lb-info-card">
                <div className="lb-info-label">Amount</div>
                <div className="lb-info-value">
                  {fmtCurrency(order.total_amount)}
                </div>
              </div>
              <div className="lb-info-card">
                <div className="lb-info-label">Payment Type</div>
                <div className="lb-info-value">{order.payment_type || "—"}</div>
              </div>
              {details?.utr_number && (
                <div className="lb-info-card" style={{ gridColumn: "span 3" }}>
                  <div className="lb-info-label">UTR Number</div>
                  <div
                    className="lb-info-value"
                    style={{ fontFamily: "'DM Mono',monospace" }}
                  >
                    {details.utr_number}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── ADDRESS ── */}
          {loading && (
            <div style={{ color: "var(--text3)", fontSize: 13 }}>
              Loading details…
            </div>
          )}
          {details?.address && (
            <div>
              <div className="lb-section-title">Delivery Address</div>
              <div
                className="lb-info-card"
                style={{ lineHeight: 1.7, fontSize: 13.5 }}
              >
                <strong>{details.address.name}</strong> ·{" "}
                {details.address.mobile}
                <br />
                {details.address.address_line}, {details.address.city},{" "}
                {details.address.state_name} — {details.address.pincode}
                {details.address.landmark && (
                  <span> ({details.address.landmark})</span>
                )}
              </div>
            </div>
          )}

          {/* ── ITEMS ── */}
          {details?.items?.length > 0 && (
            <div>
              <div className="lb-section-title">Items</div>
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  overflow: "hidden",
                }}
              >
                <table className="lb-items-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.items.map((it) => (
                      <tr key={it.item_id}>
                        <td>{it.product_name}</td>
                        <td>{it.quantity}</td>
                        <td>{fmtCurrency(it.unit_price)}</td>
                        <td>{fmtCurrency(it.total_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── SERIAL STATUS ── */}
          {details?.serial_status && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="lb-section-title" style={{ marginBottom: 0 }}>
                Serial Status:
              </div>
              <SerialBadge status={details.serial_status} />
            </div>
          )}

          {/* ── REMARKS ── */}
          <div>
            <div className="lb-section-title">Remarks</div>
            {remarksEditing ? (
              <>
                <textarea
                  className="remarks-input"
                  value={remarksVal}
                  onChange={(e) => setRemarksVal(e.target.value)}
                  placeholder="Add a remark…"
                />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button
                    className="lb-btn lb-btn-primary"
                    onClick={saveRemarks}
                  >
                    Save
                  </button>
                  <button
                    className="lb-btn lb-btn-secondary"
                    onClick={() => setRemarksEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div
                onClick={() => setRemarksEditing(true)}
                style={{
                  padding: "10px 12px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  fontSize: 13.5,
                  cursor: "pointer",
                  color: remarksVal ? "var(--text)" : "var(--text3)",
                  minHeight: 40,
                }}
              >
                {remarksVal || "Click to add a remark…"}
              </div>
            )}
          </div>

          {/* ── UTR ENTRY ── */}
          {localPayStatus !== "paid" && (
            <div>
              {utrOpen ? (
                <div className="utr-box">
                  <label>Enter UTR / Transaction Reference Number</label>
                  <div className="utr-input-row">
                    <input
                      className="utr-input"
                      placeholder="e.g. UTR123456789012"
                      value={utrValue}
                      onChange={(e) => setUtrValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitUTR()}
                    />
                    <button
                      className="lb-btn lb-btn-success"
                      onClick={submitUTR}
                    >
                      Mark Paid
                    </button>
                    <button
                      className="lb-btn lb-btn-secondary"
                      onClick={() => setUtrOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* ── SERIAL MODAL (inline in lightbox) ── */}
          {serialOpen && (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  background: "var(--surface2)",
                  borderBottom: "1px solid var(--border)",
                  fontWeight: 600,
                  fontSize: 13.5,
                }}
              >
                Assign Serial Numbers
              </div>
              <div style={{ padding: 16 }}>
                {serialItems.map((item) => (
                  <div className="serial-item" key={item.item_id}>
                    <h4>
                      {item.product_name} — Qty {item.quantity}
                    </h4>
                    {item.serials.map((sn, i) => (
                      <input
                        key={`${item.item_id}-${i}`}
                        className="serial-input"
                        type="text"
                        value={sn}
                        placeholder={`Serial ${i + 1}`}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSerialItems((prev) =>
                            prev.map((it) =>
                              it.item_id === item.item_id
                                ? {
                                    ...it,
                                    serials: it.serials.map((s, idx) =>
                                      idx === i ? val : s,
                                    ),
                                  }
                                : it,
                            ),
                          );
                        }}
                      />
                    ))}
                  </div>
                ))}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    className="lb-btn lb-btn-secondary"
                    onClick={() => setSerialOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="lb-btn lb-btn-primary"
                    onClick={saveSerials}
                  >
                    Save Serials
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── ACTION BAR ── */}
        <div className="lb-actions">
          {/* Payment */}
          {localPayStatus !== "paid" ? (
            <button
              className="lb-btn lb-btn-success"
              onClick={() => setUtrOpen((v) => !v)}
            >
              💳 Mark as Paid
            </button>
          ) : (
            <span className="badge badge-green" style={{ fontSize: 12 }}>
              ✓ Payment Received
            </span>
          )}

          {/* Delivery cycle */}
          <select
            value={deliveryStatus}
            onChange={(e) => cycleDelivery(e.target.value)}
            style={{
              padding: "8px 12px",
              border: "1px solid var(--border2)",
              borderRadius: "var(--radius)",
              fontFamily: "inherit",
              fontSize: 13,
              background: "var(--surface)",
              cursor: "pointer",
            }}
          >
            <option value="NOT_SHIPPED">Not Shipped</option>
            <option value="SHIPPED">Shipped</option>
            <option value="READY">Ready</option>
            <option value="COMPLETED">Completed</option>
          </select>

          {/* Serial */}
          <button
            className="lb-btn lb-btn-secondary"
            onClick={serialOpen ? () => setSerialOpen(false) : openSerials}
            disabled={serialLoading}
          >
            {serialLoading ? "…" : "🔢 Serials"}
          </button>

          {/* Invoice */}
          <button
            className="lb-btn lb-btn-primary"
            onClick={handleInvoice}
            disabled={invoiceLoading}
          >
            {invoiceLoading ? "Generating…" : "🧾 Invoice"}
          </button>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Delete */}
          {confirmDelete ? (
            <>
              <span style={{ fontSize: 12.5, color: "var(--red)" }}>Sure?</span>
              <button className="lb-btn lb-btn-danger" onClick={handleDelete}>
                Yes, Delete
              </button>
              <button
                className="lb-btn lb-btn-secondary"
                onClick={() => setConfirmDelete(false)}
              >
                No
              </button>
            </>
          ) : (
            <button
              className="lb-btn lb-btn-danger"
              onClick={() => setConfirmDelete(true)}
            >
              🗑 Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN EXPORT
───────────────────────────────────────────── */
export default function OrdersTable({
  orders = [],
  onAction,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
  invoiceLoading = {},
}) {
  injectStyles();

  // SEARCH & FILTER
  const [search, setSearch] = useState("");
  const [filterPay, setFilterPay] = useState(null); // null | 'paid' | 'pending'
  const [filterDel, setFilterDel] = useState(null); // null | 'NOT_SHIPPED' | 'SHIPPED' | 'COMPLETED'
  const [filterCh, setFilterCh] = useState(null); // null | 'offline' | 'online'
  const [filterInvoice, setFilterInvoice] = useState(false); // pending invoice

  // LIGHTBOX
  const [activeOrder, setActiveOrder] = useState(null);
  const [detailsCache, setDetailsCache] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});

  const loadMoreRef = useRef(null);

  /* ── INFINITE SCROLL ── */
  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !isLoadingMore) onLoadMore();
      },
      { rootMargin: "300px" },
    );
    if (loadMoreRef.current) obs.observe(loadMoreRef.current);
    return () => obs.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  /* ── OPEN LIGHTBOX & LAZY LOAD DETAILS ── */
  const openOrder = useCallback(
    async (order) => {
      setActiveOrder(order);
      const id = order.order_id;
      if (detailsCache[id]) return;
      setLoadingDetails((p) => ({ ...p, [id]: true }));
      try {
        const res = await api.get(`/orders/${encodeURIComponent(id)}/details`);
        setDetailsCache((p) => ({ ...p, [id]: res.data }));
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingDetails((p) => ({ ...p, [id]: false }));
      }
    },
    [detailsCache],
  );

  /* ── CLIENT-SIDE FILTER (search + badges) ── */
  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const cust = o.customer || {};
      const q = search.toLowerCase().trim();

      if (q) {
        const haystack = [
          o.order_id,
          cust.name,
          cust.mobile,
          o.awb_number,
          o.channel,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      if (filterPay && o.payment_status?.toLowerCase() !== filterPay)
        return false;

      if (filterDel && o.delivery_status?.toUpperCase() !== filterDel)
        return false;

      if (filterCh) {
        const ch = (o.channel || "").trim().toLowerCase();

        if (filterCh === "online") {
          if (!["online", "wix"].includes(ch)) return false;
        } else if (filterCh === "offline") {
          if (ch !== "offline") return false;
        } else if (filterCh === "wix") {
          if (ch !== "wix") return false;
        }
      }

      if (filterInvoice && o.invoice_number) return false;

      return true;
    });
  }, [orders, search, filterPay, filterDel, filterCh, filterInvoice]);

  const togglePay = (v) => setFilterPay((p) => (p === v ? null : v));
  const toggleDel = (v) => setFilterDel((p) => (p === v ? null : v));

  return (
    <div className="ot-wrap">
      {/* ── TOOLBAR ── */}
      <div className="ot-toolbar">
        <div className="ot-search-wrap">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="ot-search"
            placeholder="Search order ID, customer, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button
          className={`ot-filter-btn ${filterPay === "pending" ? "active" : ""}`}
          onClick={() => togglePay("pending")}
        >
          <span className="dot" /> Pending Payment
        </button>
        <button
          className={`ot-filter-btn ${filterPay === "paid" ? "active" : ""}`}
          onClick={() => togglePay("paid")}
        >
          <span className="dot" /> Paid
        </button>
        <button
          className={`ot-filter-btn ${filterDel === "NOT_SHIPPED" ? "active" : ""}`}
          onClick={() => toggleDel("NOT_SHIPPED")}
        >
          Not Shipped
        </button>
        <button
          className={`ot-filter-btn ${filterDel === "SHIPPED" ? "active" : ""}`}
          onClick={() => toggleDel("SHIPPED")}
        >
          Shipped
        </button>
        <button
          className={`ot-filter-btn ${filterInvoice ? "active" : ""}`}
          onClick={() => setFilterInvoice((v) => !v)}
        >
          🧾 Pending Invoice
        </button>
        <select
          value={filterCh || ""}
          onChange={(e) => setFilterCh(e.target.value || null)}
          className="ot-filter-btn"
          style={{
            cursor: "pointer",
            paddingRight: 28,
          }}
        >
          <option value="">All Channels</option>
          <option value="offline">Offline</option>
          <option value="online">Online</option>
          <option value="wix">Wix</option>
        </select>
        {(filterPay || filterDel || filterCh || filterInvoice || search) && (
          <button
            className="ot-filter-btn"
            onClick={() => {
              setFilterPay(null);
              setFilterDel(null);
              setFilterCh(null);
              setFilterInvoice(false);
              setSearch("");
              if (onLoadMore) onLoadMore(true);
            }}
            style={{ color: "var(--red)" }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── TABLE ── */}
      <div className="ot-table-wrap">
        {filtered.length === 0 ? (
          <div className="ot-empty">
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            No orders match your filters.
          </div>
        ) : (
          <table className="ot-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Mobile</th>
                <th>Date</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Channel</th>
                <th>Payment</th>
                <th>Delivery</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const cust = order.customer || {};
                return (
                  <tr key={order.order_id} onClick={() => openOrder(order)}>
                    <td>
                      <span className="order-id">{order.order_id}</span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{cust.name || "—"}</td>
                    <td
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 12.5,
                        color: "var(--text2)",
                      }}
                    >
                      {cust.mobile || "—"}
                    </td>
                    <td style={{ color: "var(--text2)", whiteSpace: "nowrap" }}>
                      {fmtDate(order.created_at)}
                    </td>
                    <td style={{ color: "var(--text2)" }}>
                      {order.total_items ?? "—"}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {fmtCurrency(order.total_amount)}
                    </td>
                    <td>
                      <span
                        className={`badge ${order.channel?.toLowerCase() === "offline" ? "badge-purple" : "badge-blue"}`}
                      >
                        {order.channel || "—"}
                      </span>
                    </td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <PaymentBadge status={order.payment_status} />

                        {order.payment_status?.toLowerCase() === "paid" &&
                          order.utr_number && (
                            <span
                              style={{
                                fontFamily: "'DM Mono', monospace",
                                fontSize: 11.5,
                                color: "var(--green)",
                                lineHeight: 1.2,
                              }}
                            >
                              {order.utr_number}
                            </span>
                          )}
                      </div>
                    </td>
                    <td>
                      <DeliveryBadge status={order.delivery_status} />
                    </td>
                    <td>
                      <button
                        className="ot-open-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrder(order);
                        }}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {hasMore && (
          <div ref={loadMoreRef} className="ot-load-more">
            {isLoadingMore ? "Loading more orders…" : " "}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)" }}>
        Showing {filtered.length} of {orders.length} orders
      </div>

      {/* ── LIGHTBOX ── */}
      {activeOrder && (
        <OrderLightbox
          order={activeOrder}
          details={detailsCache[activeOrder.order_id]}
          loading={loadingDetails[activeOrder.order_id]}
          invoiceLoading={invoiceLoading[activeOrder.order_id]}
          onClose={() => setActiveOrder(null)}
          onAction={async (id, action, payload) => {
            if (onAction) await onAction(id, action, payload);
            // Refresh details cache after action
            if (action === "update-remarks") {
              setDetailsCache((p) => ({
                ...p,
                [id]: { ...p[id], remarks: payload },
              }));
            }
            if (action === "refresh") {
              setDetailsCache((p) => {
                const copy = { ...p };
                delete copy[id];
                return copy;
              });
              // re-fetch
              try {
                const res = await api.get(
                  `/orders/${encodeURIComponent(id)}/details`,
                );
                setDetailsCache((p) => ({ ...p, [id]: res.data }));
              } catch (err) {
                console.error(err);
              }
            }
          }}
        />
      )}
    </div>
  );
}
