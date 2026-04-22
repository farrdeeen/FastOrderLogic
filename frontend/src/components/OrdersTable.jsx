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

  /* ── INVOICE NUMBER mono ── */
  .invoice-num {
    font-family: 'DM Mono', monospace; font-size: 11.5px;
    color: #027a48; font-weight: 500;
  }

  /* ── LOAD MORE ── */
  .ot-load-more {
    padding: 14px; text-align: center; color: var(--text3);
    font-size: 13px;
  }

  /* ══════════════════════════════════════
     LIGHTBOX / MODAL - HORIZONTAL LAYOUT
  ══════════════════════════════════════ */
  .lb-overlay {
    position: fixed; inset: 0; background: rgba(16,24,40,.6);
    backdrop-filter: blur(3px); display: flex; justify-content: center;
    align-items: flex-start; padding: 20px 16px;
    z-index: 1000; overflow-y: auto;
    animation: fadeIn .15s ease;
  }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }

  .lb-panel {
    background: var(--surface); border-radius: var(--radius-xl);
    width: 100%; max-width: 1200px; box-shadow: var(--shadow-xl);
    animation: slideUp .2s ease;
    overflow: hidden; flex-shrink: 0;
    display: flex; flex-direction: column;
    max-height: calc(100vh - 40px);
  }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: none; opacity: 1 } }

  .lb-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
    flex-shrink: 0;
  }
  .lb-title { font-size: 15px; font-weight: 600; color: var(--text); }
  .lb-subtitle { font-size: 12px; color: var(--text3); margin-top: 2px; font-family: 'DM Mono', monospace; }

  .lb-close {
    width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--border2);
    background: transparent; cursor: pointer; display: flex;
    align-items: center; justify-content: center; color: var(--text2);
    transition: all .15s;
  }
  .lb-close:hover { background: var(--red-bg); color: var(--red); border-color: var(--red); }

  .lb-body {
    padding: 20px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .lb-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .lb-section-title {
    font-size: 10.5px; font-weight: 600; color: var(--text3);
    letter-spacing: .7px; text-transform: uppercase; margin-bottom: 8px;
  }

  .lb-info-grid {
    display: grid; grid-template-columns: repeat(2,1fr); gap: 10px;
  }
  .lb-info-card {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 9px 12px;
  }
  .lb-info-label { font-size: 10.5px; color: var(--text3); font-weight: 500; margin-bottom: 2px; }
  .lb-info-value {
    font-size: 13px; color: var(--text); font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .edit-icon {
    cursor: pointer;
    color: var(--text3);
    transition: color 0.15s;
    font-size: 13px;
  }
  .edit-icon:hover { color: var(--accent); }

  .inline-edit-input {
    padding: 5px 9px;
    border: 1px solid var(--accent);
    border-radius: 5px;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    width: 100%;
    box-shadow: 0 0 0 3px rgba(21,112,239,.12);
  }

  .lb-items-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .lb-items-table th {
    padding: 7px 9px; background: var(--surface2); text-align: left;
    font-size: 11px; color: var(--text3); font-weight: 600;
    border-bottom: 1px solid var(--border);
  }
  .lb-items-table td {
    padding: 9px; border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  .lb-items-table tr:last-child td { border-bottom: none; }

  /* ── ACTIONS BAR ── */
  .lb-actions {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    padding: 14px 20px; border-top: 1px solid var(--border);
    background: var(--surface2);
    flex-shrink: 0;
  }
  .lb-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 7px 14px; border-radius: var(--radius);
    font-family: inherit; font-size: 12.5px; font-weight: 500;
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
  .lb-btn-teal { background: #f0fdfa; color: #0d9488; border-color: #99f6e4; }
  .lb-btn-teal:hover { background: #ccfbf1; }
  .lb-btn:disabled { opacity: .5; pointer-events: none; }

  /* ── UTR MODAL ── */
  .utr-box {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px; margin-top: 6px;
  }
  .utr-box label { font-size: 11.5px; font-weight: 600; color: var(--text2); display: block; margin-bottom: 5px; }
  .utr-input-row { display: flex; gap: 7px; }
  .utr-input {
    flex: 1; padding: 8px 11px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: 'DM Mono', monospace;
    font-size: 12.5px; outline: none; transition: border .15s;
  }
  .utr-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── SERIAL MODAL ── */
  .serial-item {
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 12px; margin-bottom: 10px; background: var(--surface2);
  }
  .serial-item h4 { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--text); }
  .serial-input {
    width: 100%; padding: 7px 10px; margin: 3px 0;
    border: 1px solid var(--border2); border-radius: 5px;
    font-family: 'DM Mono', monospace; font-size: 12.5px; outline: none;
    transition: border .15s; box-sizing: border-box;
  }
  .serial-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── REMARKS ── */
  .remarks-input {
    width: 100%; padding: 8px 11px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: inherit; font-size: 12.5px;
    resize: vertical; min-height: 58px; outline: none; transition: border .15s;
    box-sizing: border-box;
  }
  .remarks-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── EMPTY ── */
  .ot-empty {
    text-align: center; padding: 60px 20px; color: var(--text3); font-size: 14px;
  }

  /* ── RESPONSIVE ── */
  @media (max-width: 1100px) {
    .lb-body { grid-template-columns: 1fr; }
    .lb-panel { max-width: 800px; }
  }
  @media (max-width: 700px) {
    .lb-info-grid { grid-template-columns: 1fr; }
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

/* Invoice cell — shows invoice number or a muted "Pending" badge */
function InvoiceCell({ invoiceNumber }) {
  if (invoiceNumber) {
    return <span className="invoice-num">🧾 {invoiceNumber}</span>;
  }
  return <span className="badge badge-gray">Pending</span>;
}

/* ─────────────────────────────────────────────
   INVOICE BUTTON — smart: print vs generate
   • invoiceNumber  = existing invoice_number on the order (from table row)
   • detailsInvoice = invoice_number returned by /details (after generation)
   Priority: detailsInvoice > invoiceNumber (details is always fresher)
───────────────────────────────────────────── */
function InvoiceButton({
  orderId,
  invoiceNumber,
  detailsInvoice,
  onGenerate,
  loading,
}) {
  // Use the freshest invoice number available
  const existingInvoice = detailsInvoice || invoiceNumber;

  if (existingInvoice) {
    // Invoice already exists → open the download/print URL in a new tab
    const printUrl = `${import.meta.env.VITE_API_URL}/zoho/orders/${encodeURIComponent(orderId)}/invoice/print`;
    return (
      <a
        href={printUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="lb-btn lb-btn-teal"
        style={{ textDecoration: "none" }}
      >
        🖨️ Print Invoice
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10.5,
            opacity: 0.75,
            marginLeft: 4,
          }}
        >
          {existingInvoice}
        </span>
      </a>
    );
  }

  // No invoice yet → generate
  return (
    <button
      className="lb-btn lb-btn-primary"
      onClick={onGenerate}
      disabled={loading}
    >
      {loading ? "Generating…" : "🧾 Invoice"}
    </button>
  );
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
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [mobileValue, setMobileValue] = useState("");
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingPrice, setEditingPrice] = useState("");

  useEffect(() => {
    if (details?.remarks != null) setRemarksVal(details.remarks);
  }, [details]);

  useEffect(() => {
    const cust = order.customer;
    if (cust) {
      setEmailValue(cust.email || "");
      setMobileValue(cust.mobile || "");
    }
  }, [order]);

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

  const submitUTR = async () => {
    if (!utrValue.trim()) return alert("Enter UTR number");
    await onAction(order.order_id, "mark-paid-utr", utrValue.trim());
    setLocalPayStatus("paid");
    setUtrOpen(false);
    setUtrValue("");
    onAction && onAction(order.order_id, "refresh");
  };

  const cycleDelivery = async (status) => {
    await onAction(order.order_id, "update-delivery", status);
    setDeliveryStatus(status);
  };

  const handleInvoice = () =>
    onAction && onAction(order.order_id, "create-invoice");

  const saveRemarks = async () => {
    await onAction(order.order_id, "update-remarks", remarksVal);
    setRemarksEditing(false);
  };

  const saveEmail = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-email`,
        { email: emailValue.trim() },
      );
      setEmailEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch (error) {
      console.error("Failed to update email:", error);
      alert("Failed to update email");
    }
  };

  const saveMobile = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-mobile`,
        { mobile: mobileValue.trim() },
      );
      setMobileEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch (error) {
      console.error("Failed to update mobile:", error);
      alert("Failed to update mobile");
    }
  };

  const saveItemPrice = async (itemId) => {
    try {
      const newPrice = parseFloat(editingPrice);
      if (isNaN(newPrice) || newPrice < 0) return alert("Invalid price");
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-item-price`,
        { item_id: itemId, unit_price: newPrice },
      );
      setEditingItemId(null);
      setEditingPrice("");
      onAction && onAction(order.order_id, "refresh");
    } catch (error) {
      console.error("Failed to update item price:", error);
      alert("Failed to update item price");
    }
  };

  const handleDelete = async () => {
    await onAction(order.order_id, "delete");
    onClose();
  };

  const cust = details?.customer || order.customer;

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
          {/* LEFT COLUMN */}
          <div className="lb-section">
            <div>
              <div className="lb-section-title">Customer & Order</div>
              <div className="lb-info-grid">
                <div className="lb-info-card">
                  <div className="lb-info-label">Customer</div>
                  <div className="lb-info-value">{cust?.name || "—"}</div>
                </div>
                <div className="lb-info-card">
                  <div className="lb-info-label">Mobile</div>
                  <div className="lb-info-value">
                    {mobileEditing ? (
                      <input
                        className="inline-edit-input"
                        value={mobileValue}
                        onChange={(e) => setMobileValue(e.target.value)}
                        onBlur={saveMobile}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveMobile();
                          if (e.key === "Escape") {
                            setMobileEditing(false);
                            setMobileValue(cust?.mobile || "");
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <>
                        <span style={{ fontFamily: "'DM Mono',monospace" }}>
                          {cust?.mobile || "—"}
                        </span>
                        <span
                          className="edit-icon"
                          onClick={() => setMobileEditing(true)}
                          title="Edit mobile"
                        >
                          ✏️
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="lb-info-card">
                  <div className="lb-info-label">Email</div>
                  <div className="lb-info-value">
                    {emailEditing ? (
                      <input
                        className="inline-edit-input"
                        type="email"
                        value={emailValue}
                        onChange={(e) => setEmailValue(e.target.value)}
                        onBlur={saveEmail}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEmail();
                          if (e.key === "Escape") {
                            setEmailEditing(false);
                            setEmailValue(cust?.email || "");
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <>
                        <span>{cust?.email || "—"}</span>
                        <span
                          className="edit-icon"
                          onClick={() => setEmailEditing(true)}
                          title="Edit email"
                        >
                          ✏️
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="lb-info-card">
                  <div className="lb-info-label">Channel</div>
                  <div className="lb-info-value">{order.channel || "—"}</div>
                </div>
                <div className="lb-info-card">
                  <div className="lb-info-label">Created</div>
                  <div className="lb-info-value">
                    {fmtDate(order.created_at)}
                  </div>
                </div>
                <div className="lb-info-card">
                  <div className="lb-info-label">Amount</div>
                  <div className="lb-info-value">
                    {fmtCurrency(order.total_amount)}
                  </div>
                </div>
                <div className="lb-info-card">
                  <div className="lb-info-label">Payment Type</div>
                  <div className="lb-info-value">
                    {order.payment_type || "—"}
                  </div>
                </div>
                {details?.utr_number && (
                  <div
                    className="lb-info-card"
                    style={{ gridColumn: "span 2" }}
                  >
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

            {loading && (
              <div style={{ color: "var(--text3)", fontSize: 12.5 }}>
                Loading details…
              </div>
            )}

            {details?.address && (
              <div>
                <div className="lb-section-title">Delivery Address</div>
                <div
                  className="lb-info-card"
                  style={{ lineHeight: 1.6, fontSize: 13 }}
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
                  <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
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
                    padding: "9px 11px",
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    fontSize: 13,
                    cursor: "pointer",
                    color: remarksVal ? "var(--text)" : "var(--text3)",
                    minHeight: 36,
                  }}
                >
                  {remarksVal || "Click to add a remark…"}
                </div>
              )}
            </div>

            {localPayStatus !== "paid" && utrOpen && (
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
                  <button className="lb-btn lb-btn-success" onClick={submitUTR}>
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
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div className="lb-section">
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
                          <td>
                            {editingItemId === it.item_id ? (
                              <input
                                className="inline-edit-input"
                                type="number"
                                step="0.01"
                                value={editingPrice}
                                onChange={(e) =>
                                  setEditingPrice(e.target.value)
                                }
                                onBlur={() => saveItemPrice(it.item_id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    saveItemPrice(it.item_id);
                                  if (e.key === "Escape") {
                                    setEditingItemId(null);
                                    setEditingPrice("");
                                  }
                                }}
                                autoFocus
                                style={{ width: "110px" }}
                              />
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <span>{fmtCurrency(it.unit_price)}</span>
                                <span
                                  className="edit-icon"
                                  onClick={() => {
                                    setEditingItemId(it.item_id);
                                    setEditingPrice(it.unit_price);
                                  }}
                                  title="Edit price"
                                >
                                  ✏️
                                </span>
                              </div>
                            )}
                          </td>
                          <td>{fmtCurrency(it.total_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {details?.serial_status && (
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div className="lb-section-title" style={{ marginBottom: 0 }}>
                  Serial Status:
                </div>
                <SerialBadge status={details.serial_status} />
              </div>
            )}

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
                    padding: "11px 14px",
                    background: "var(--surface2)",
                    borderBottom: "1px solid var(--border)",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  Assign Serial Numbers
                </div>
                <div style={{ padding: 14 }}>
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
                      gap: 7,
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
        </div>

        {/* ACTION BAR */}
        <div className="lb-actions">
          {localPayStatus !== "paid" ? (
            <button
              className="lb-btn lb-btn-success"
              onClick={() => setUtrOpen((v) => !v)}
            >
              💳 Mark as Paid
            </button>
          ) : (
            <span className="badge badge-green" style={{ fontSize: 11.5 }}>
              ✓ Payment Received
            </span>
          )}

          <select
            value={deliveryStatus}
            onChange={(e) => cycleDelivery(e.target.value)}
            style={{
              padding: "7px 11px",
              border: "1px solid var(--border2)",
              borderRadius: "var(--radius)",
              fontFamily: "inherit",
              fontSize: 12.5,
              background: "var(--surface)",
              cursor: "pointer",
            }}
          >
            <option value="NOT_SHIPPED">Not Shipped</option>
            <option value="SHIPPED">Shipped</option>
            <option value="READY">Ready</option>
            <option value="COMPLETED">Completed</option>
          </select>

          <button
            className="lb-btn lb-btn-secondary"
            onClick={serialOpen ? () => setSerialOpen(false) : openSerials}
            disabled={serialLoading}
          >
            {serialLoading ? "…" : "🔢 Serials"}
          </button>

          {/* ── SMART INVOICE BUTTON ── */}
          <InvoiceButton
            orderId={order.order_id}
            invoiceNumber={order.invoice_number}
            detailsInvoice={details?.invoice_number}
            onGenerate={handleInvoice}
            loading={invoiceLoading}
          />

          <div style={{ flex: 1 }} />

          {confirmDelete ? (
            <>
              <span style={{ fontSize: 12, color: "var(--red)" }}>Sure?</span>
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
  filters = {},
  onAction,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
  invoiceLoading = {},
}) {
  injectStyles();

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
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingDetails((p) => ({ ...p, [id]: false }));
      }
    },
    [detailsCache],
  );

  /* ── CLIENT-SIDE FILTER ── */
  const filtered = useMemo(() => {
    const {
      search = "",
      payment_status = "",
      delivery_status = "",
      channel = "",
      date_from = "",
      date_to = "",
      pending_invoice = false,
    } = filters;

    return orders.filter((o) => {
      const cust = o.customer || {};

      // Search
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

      // Payment status
      if (
        payment_status &&
        o.payment_status?.toLowerCase() !== payment_status.toLowerCase()
      )
        return false;

      // Delivery status
      if (
        delivery_status &&
        o.delivery_status?.toUpperCase() !== delivery_status.toUpperCase()
      )
        return false;

      // Channel
      if (channel) {
        const ch = (o.channel || "").trim().toLowerCase();
        const target = channel.toLowerCase();
        if (target === "online") {
          if (!["online", "wix", "website"].includes(ch)) return false;
        } else {
          if (ch !== target) return false;
        }
      }

      // Date range
      if (date_from || date_to) {
        const orderDate = new Date(o.created_at);
        if (date_from && orderDate < new Date(date_from)) return false;
        if (date_to) {
          const end = new Date(date_to);
          end.setHours(23, 59, 59, 999);
          if (orderDate > end) return false;
        }
      }

      // Pending invoice — keep only orders WITHOUT an invoice number
      if (pending_invoice && o.invoice_number) return false;

      return true;
    });
  }, [orders, filters]);

  return (
    <div className="ot-wrap">
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
                <th>Invoice</th>
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
                      <InvoiceCell invoiceNumber={order.invoice_number} />
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
              try {
                const res = await api.get(
                  `/orders/${encodeURIComponent(id)}/details`,
                );
                setDetailsCache((p) => ({ ...p, [id]: res.data }));
              } catch (error) {
                console.error(error);
              }
            }
          }}
        />
      )}
    </div>
  );
}
