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

  .inline-edit-select {
    padding: 5px 9px;
    border: 1px solid var(--accent);
    border-radius: 5px;
    font-family: inherit;
    font-size: 12.5px;
    outline: none;
    width: 100%;
    box-shadow: 0 0 0 3px rgba(21,112,239,.12);
    background: var(--surface);
    cursor: pointer;
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
  .lb-btn-sm { padding: 4px 9px; font-size: 11.5px; }
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

  /* ── FORM FIELDS ── */
  .form-field {
    display: flex; flex-direction: column; gap: 4px;
  }
  .form-label {
    font-size: 11px; font-weight: 600; color: var(--text2);
    text-transform: uppercase; letter-spacing: .4px;
  }
  .form-input {
    padding: 8px 11px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: inherit; font-size: 13px;
    outline: none; transition: border .15s; background: var(--surface);
    width: 100%; box-sizing: border-box;
  }
  .form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }
  .form-select {
    padding: 8px 11px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: inherit; font-size: 13px;
    outline: none; transition: border .15s; background: var(--surface);
    width: 100%; box-sizing: border-box; cursor: pointer;
  }
  .form-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }
  .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }

  /* ── ADD PRODUCT PANEL ── */
  .add-product-panel {
    border: 1px solid var(--accent-light); border-radius: var(--radius);
    background: var(--accent-light); padding: 14px; margin-top: 8px;
  }
  .add-product-panel h4 {
    font-size: 12px; font-weight: 600; color: var(--accent-dark);
    margin: 0 0 10px; text-transform: uppercase; letter-spacing: .4px;
  }

  /* ── PRODUCT SEARCH ── */
  .product-search-wrap { position: relative; }
  .product-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: var(--radius); box-shadow: var(--shadow-md);
    z-index: 50; max-height: 200px; overflow-y: auto;
  }
  .product-option {
    padding: 8px 12px; cursor: pointer; font-size: 12.5px;
    transition: background .1s; border-bottom: 1px solid var(--border);
  }
  .product-option:last-child { border-bottom: none; }
  .product-option:hover { background: var(--accent-light); }
  .product-option-sku { font-size: 11px; color: var(--text3); font-family: 'DM Mono', monospace; }

  /* ── EMPTY ── */
  .ot-empty {
    text-align: center; padding: 60px 20px; color: var(--text3); font-size: 14px;
  }

  /* ── DELETE ROW ICON ── */
  .del-icon {
    cursor: pointer; color: var(--text3); font-size: 13px;
    transition: color .15s; padding: 2px;
  }
  .del-icon:hover { color: var(--red); }

  /* ── RESPONSIVE ── */
  @media (max-width: 1100px) {
    .lb-body { grid-template-columns: 1fr; }
    .lb-panel { max-width: 800px; }
  }
  @media (max-width: 700px) {
    .lb-info-grid { grid-template-columns: 1fr; }
    .ot-table th:nth-child(n+5), .ot-table td:nth-child(n+5) { display: none; }
    .form-grid-2, .form-grid-3 { grid-template-columns: 1fr; }
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

function InvoiceCell({ invoiceNumber }) {
  if (invoiceNumber) {
    return <span className="invoice-num">🧾 {invoiceNumber}</span>;
  }
  return <span className="badge badge-gray">Pending</span>;
}

function InvoiceButton({
  orderId,
  invoiceNumber,
  detailsInvoice,
  onGenerate,
  loading,
}) {
  const existingInvoice = detailsInvoice || invoiceNumber;

  if (existingInvoice) {
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
   ADD ADDRESS FORM
───────────────────────────────────────────── */
function AddAddressForm({ order, onSaved, onCancel }) {
  const [states, setStates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    pincode: "",
    locality: "",
    address_line: "",
    city: "",
    state_id: "",
    landmark: "",
    alternate_phone: "",
    address_type: "HOME",
    email: "",
    gst: "",
  });

  useEffect(() => {
    api
      .get("/orders/states/list")
      .then((res) => setStates(res.data || []))
      .catch(() => setStates([]));
  }, []);

  const set = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const handleSave = async () => {
    if (
      !form.name ||
      !form.mobile ||
      !form.pincode ||
      !form.address_line ||
      !form.city ||
      !form.state_id
    ) {
      alert(
        "Please fill in all required fields (Name, Mobile, Pincode, Address, City, State)",
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        state_id: parseInt(form.state_id),
        customer_id: order.customer_id || null,
        offline_customer_id: order.offline_customer_id || null,
      };
      const res = await api.post("/orders/addresses/create", payload);
      onSaved(res.data);
    } catch (err) {
      console.error(err);
      alert("Failed to create address. Please check all fields.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 16,
        background: "var(--surface2)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
        ➕ New Address
      </div>

      <div className="form-grid-2">
        <div className="form-field">
          <label className="form-label">Full Name *</label>
          <input
            className="form-input"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Recipient name"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Mobile *</label>
          <input
            className="form-input"
            value={form.mobile}
            onChange={(e) => set("mobile", e.target.value)}
            placeholder="10-digit mobile"
            maxLength={15}
          />
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">Address Line *</label>
        <input
          className="form-input"
          value={form.address_line}
          onChange={(e) => set("address_line", e.target.value)}
          placeholder="House / Flat / Street"
        />
      </div>

      <div className="form-field">
        <label className="form-label">Locality *</label>
        <input
          className="form-input"
          value={form.locality}
          onChange={(e) => set("locality", e.target.value)}
          placeholder="Area / Locality"
        />
      </div>

      <div className="form-grid-3">
        <div className="form-field">
          <label className="form-label">City *</label>
          <input
            className="form-input"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="City"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Pincode *</label>
          <input
            className="form-input"
            value={form.pincode}
            onChange={(e) => set("pincode", e.target.value)}
            placeholder="6-digit"
            maxLength={10}
          />
        </div>
        <div className="form-field">
          <label className="form-label">State *</label>
          <select
            className="form-select"
            value={form.state_id}
            onChange={(e) => set("state_id", e.target.value)}
          >
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s.state_id} value={s.state_id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-grid-2">
        <div className="form-field">
          <label className="form-label">Landmark</label>
          <input
            className="form-input"
            value={form.landmark}
            onChange={(e) => set("landmark", e.target.value)}
            placeholder="Near / Opposite…"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Alternate Phone</label>
          <input
            className="form-input"
            value={form.alternate_phone}
            onChange={(e) => set("alternate_phone", e.target.value)}
            placeholder="Optional"
            maxLength={15}
          />
        </div>
      </div>

      <div className="form-grid-2">
        <div className="form-field">
          <label className="form-label">Email</label>
          <input
            className="form-input"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Address Type</label>
          <select
            className="form-select"
            value={form.address_type}
            onChange={(e) => set("address_type", e.target.value)}
          >
            <option value="HOME">Home</option>
            <option value="WORK">Work</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">GST Number</label>
        <input
          className="form-input"
          value={form.gst}
          onChange={(e) => set("gst", e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 4,
        }}
      >
        <button
          className="lb-btn lb-btn-secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="lb-btn lb-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Address"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   PRODUCT SEARCH DROPDOWN
───────────────────────────────────────────── */
function ProductSearchInput({
  products,
  value,
  onChange,
  placeholder = "Search product…",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return products.slice(0, 50);
    const q = query.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku_id && p.sku_id.toLowerCase().includes(q)),
      )
      .slice(0, 50);
  }, [products, query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedProduct = products.find((p) => p.id === value);

  return (
    <div className="product-search-wrap" ref={wrapRef}>
      <input
        className="form-input"
        placeholder={placeholder}
        value={open ? query : selectedProduct ? selectedProduct.name : query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChange(null);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        style={{ fontSize: 12.5 }}
      />
      {open && filtered.length > 0 && (
        <div className="product-dropdown">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="product-option"
              onMouseDown={() => {
                onChange(p);
                setQuery("");
                setOpen(false);
              }}
            >
              <div>{p.name}</div>
              {p.sku_id && <div className="product-option-sku">{p.sku_id}</div>}
            </div>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && query.length > 0 && (
        <div className="product-dropdown">
          <div
            className="product-option"
            style={{ color: "var(--text3)", cursor: "default" }}
          >
            No products found
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ADD PRODUCT PANEL
───────────────────────────────────────────── */
function AddProductPanel({ orderId, products, onAdded, onCancel }) {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!selectedProduct) return alert("Please select a product");
    const unitPrice = parseFloat(price);
    if (!unitPrice || unitPrice <= 0)
      return alert("Please enter a valid price");
    if (qty < 1) return alert("Quantity must be at least 1");

    setSaving(true);
    try {
      const res = await api.post(
        `/orders/${encodeURIComponent(orderId)}/add-item`,
        {
          product_id: selectedProduct.id,
          quantity: qty,
          unit_price: unitPrice,
        },
      );
      onAdded(res.data);
    } catch (err) {
      console.error(err);
      alert("Failed to add product. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-product-panel">
      <h4>➕ Add Product to Order</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="form-field">
          <label className="form-label">Product *</label>
          <ProductSearchInput
            products={products}
            value={selectedProduct?.id}
            onChange={(p) => setSelectedProduct(p)}
            placeholder="Search by name or SKU…"
          />
        </div>
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">Quantity *</label>
            <input
              className="form-input"
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value) || 1)}
              style={{ fontSize: 12.5 }}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Unit Price (₹) *</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              style={{ fontSize: 12.5 }}
            />
          </div>
        </div>
        {selectedProduct && price > 0 && (
          <div
            style={{ fontSize: 12, color: "var(--text2)", padding: "4px 0" }}
          >
            Line total: <strong>{fmtCurrency(parseFloat(price) * qty)}</strong>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            className="lb-btn lb-btn-secondary lb-btn-sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="lb-btn lb-btn-primary lb-btn-sm"
            onClick={handleAdd}
            disabled={saving || !selectedProduct}
          >
            {saving ? "Adding…" : "Add Item"}
          </button>
        </div>
      </div>
    </div>
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
  const [confirmReject, setConfirmReject] = useState(false);
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [mobileValue, setMobileValue] = useState("");
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingPrice, setEditingPrice] = useState("");

  // Address states
  const [addressMode, setAddressMode] = useState("view"); // "view" | "select" | "add"
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [availableAddresses, setAvailableAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  // Product editing states
  const [editingProductItemId, setEditingProductItemId] = useState(null);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(null);

  // Add product panel state
  const [showAddProduct, setShowAddProduct] = useState(false);

  // Confirm delete item
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState(null);

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

  // Load products on mount — using the correct endpoint
  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await api.get("/orders/products/list");
      setAvailableProducts(res.data || []);
    } catch (error) {
      console.error("Failed to load products:", error);
      setAvailableProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  // Load available addresses when switching to select mode
  const loadAddresses = async () => {
    setLoadingAddresses(true);
    try {
      const custType = order.customer_id ? "online" : "offline";
      const custId = order.customer_id || order.offline_customer_id;
      const res = await api.get(
        `/dropdowns/customers/${custType}/${custId}/addresses`,
      );
      setAvailableAddresses(res.data || []);
      setSelectedAddressId(order.address_id);
      setAddressMode("select");
    } catch (error) {
      console.error("Failed to load addresses:", error);
      alert("Failed to load addresses");
    } finally {
      setLoadingAddresses(false);
    }
  };

  const saveAddress = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-address`,
        {
          address_id: selectedAddressId,
        },
      );
      setAddressMode("view");
      onAction && onAction(order.order_id, "refresh");
    } catch (error) {
      console.error("Failed to update address:", error);
      alert("Failed to update address");
    }
  };

  // Called when a new address is successfully created
  const handleAddressCreated = async (newAddress) => {
    // Auto-select and apply the new address to the order
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-address`,
        {
          address_id: newAddress.address_id,
        },
      );
      setAddressMode("view");
      onAction && onAction(order.order_id, "refresh");
    } catch (error) {
      console.error("Failed to set new address on order:", error);
      alert(
        "Address created but could not be applied to order. Please select it manually.",
      );
      setAddressMode("view");
      onAction && onAction(order.order_id, "refresh");
    }
  };

  const saveProduct = async (itemId) => {
    if (!selectedProductId) return;
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-item-product`,
        {
          item_id: itemId,
          product_id: selectedProductId,
        },
      );
      setEditingProductItemId(null);
      setSelectedProductId(null);
      onAction && onAction(order.order_id, "refresh");
    } catch (error) {
      console.error("Failed to update product:", error);
      alert("Failed to update product");
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      await api.delete(
        `/orders/${encodeURIComponent(order.order_id)}/items/${itemId}`,
      );
      setConfirmDeleteItemId(null);
      onAction && onAction(order.order_id, "refresh");
    } catch (err) {
      const msg = err?.response?.data?.detail || "Failed to remove item";
      alert(msg);
      setConfirmDeleteItemId(null);
    }
  };

  const handleItemAdded = (data) => {
    setShowAddProduct(false);
    onAction && onAction(order.order_id, "refresh");
  };

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
      {
        entries: serialItems,
      },
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
        {
          email: emailValue.trim(),
        },
      );
      setEmailEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      alert("Failed to update email");
    }
  };

  const saveMobile = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-mobile`,
        {
          mobile: mobileValue.trim(),
        },
      );
      setMobileEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      alert("Failed to update mobile");
    }
  };

  const saveItemPrice = async (itemId) => {
    try {
      const newPrice = parseFloat(editingPrice);
      if (isNaN(newPrice) || newPrice < 0) return alert("Invalid price");
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-item-price`,
        {
          item_id: itemId,
          unit_price: newPrice,
        },
      );
      setEditingItemId(null);
      setEditingPrice("");
      onAction && onAction(order.order_id, "refresh");
    } catch {
      alert("Failed to update item price");
    }
  };

  const handleReject = async () => {
    try {
      await api.put(`/orders/${encodeURIComponent(order.order_id)}/reject`);
      alert("Order rejected successfully");
      onClose();
    } catch {
      alert("Failed to reject order");
    }
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
          {/* ── LEFT COLUMN ── */}
          <div className="lb-section">
            {/* Customer & Order Info */}
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

            {/* ── DELIVERY ADDRESS ── */}
            {(details?.address || !loading) && (
              <div>
                <div
                  className="lb-section-title"
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  Delivery Address
                  {addressMode === "view" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <span
                        className="edit-icon"
                        onClick={loadAddresses}
                        title="Change address"
                        style={{ cursor: "pointer" }}
                      >
                        ✏️
                      </span>
                      <button
                        className="lb-btn lb-btn-secondary lb-btn-sm"
                        onClick={() => setAddressMode("add")}
                        style={{ fontSize: 11, padding: "2px 8px" }}
                      >
                        ➕ New
                      </button>
                    </div>
                  )}
                </div>

                {/* VIEW MODE */}
                {addressMode === "view" && details?.address && (
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
                )}

                {/* SELECT EXISTING ADDRESS */}
                {addressMode === "select" && (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {loadingAddresses ? (
                      <div style={{ color: "var(--text3)", fontSize: 12.5 }}>
                        Loading addresses…
                      </div>
                    ) : (
                      <>
                        <select
                          value={selectedAddressId || ""}
                          onChange={(e) =>
                            setSelectedAddressId(parseInt(e.target.value))
                          }
                          className="form-select"
                        >
                          <option value="">Select Address</option>
                          {availableAddresses.map((addr) => (
                            <option
                              key={addr.address_id}
                              value={addr.address_id}
                            >
                              {addr.label ||
                                `${addr.address_line}, ${addr.city}`}
                            </option>
                          ))}
                        </select>
                        <div style={{ display: "flex", gap: 7 }}>
                          <button
                            className="lb-btn lb-btn-primary lb-btn-sm"
                            onClick={saveAddress}
                          >
                            Save
                          </button>
                          <button
                            className="lb-btn lb-btn-secondary lb-btn-sm"
                            onClick={() => setAddressMode("add")}
                          >
                            ➕ Add New Instead
                          </button>
                          <button
                            className="lb-btn lb-btn-secondary lb-btn-sm"
                            onClick={() => setAddressMode("view")}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ADD NEW ADDRESS FORM */}
                {addressMode === "add" && (
                  <AddAddressForm
                    order={order}
                    onSaved={handleAddressCreated}
                    onCancel={() => setAddressMode("view")}
                  />
                )}
              </div>
            )}

            {/* Remarks */}
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
                      className="lb-btn lb-btn-primary lb-btn-sm"
                      onClick={saveRemarks}
                    >
                      Save
                    </button>
                    <button
                      className="lb-btn lb-btn-secondary lb-btn-sm"
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

            {/* UTR box */}
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

          {/* ── RIGHT COLUMN ── */}
          <div className="lb-section">
            {/* Items table */}
            {details?.items?.length > 0 && (
              <div>
                <div
                  className="lb-section-title"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>Items ({details.items.length})</span>
                  <button
                    className="lb-btn lb-btn-secondary lb-btn-sm"
                    onClick={() => setShowAddProduct((v) => !v)}
                    style={{ fontSize: 11 }}
                  >
                    {showAddProduct ? "✕ Cancel" : "➕ Add Product"}
                  </button>
                </div>

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
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.items.map((it) => (
                        <tr key={it.item_id}>
                          <td>
                            {editingProductItemId === it.item_id ? (
                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  alignItems: "center",
                                }}
                              >
                                <div style={{ flex: 1 }}>
                                  <ProductSearchInput
                                    products={availableProducts}
                                    value={selectedProductId}
                                    onChange={(p) =>
                                      setSelectedProductId(p?.id || null)
                                    }
                                    placeholder="Search product…"
                                  />
                                </div>
                                <button
                                  className="lb-btn lb-btn-primary lb-btn-sm"
                                  onClick={() => saveProduct(it.item_id)}
                                  disabled={!selectedProductId}
                                >
                                  ✓
                                </button>
                                <button
                                  className="lb-btn lb-btn-secondary lb-btn-sm"
                                  onClick={() => {
                                    setEditingProductItemId(null);
                                    setSelectedProductId(null);
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <span>{it.product_name}</span>
                                <span
                                  className="edit-icon"
                                  onClick={() => {
                                    setEditingProductItemId(it.item_id);
                                    setSelectedProductId(it.product_id);
                                  }}
                                  title="Edit product"
                                >
                                  ✏️
                                </span>
                              </div>
                            )}
                          </td>
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
                          <td style={{ width: 32, textAlign: "center" }}>
                            {confirmDeleteItemId === it.item_id ? (
                              <div style={{ display: "flex", gap: 4 }}>
                                <button
                                  className="lb-btn lb-btn-danger lb-btn-sm"
                                  onClick={() => handleDeleteItem(it.item_id)}
                                  style={{ padding: "2px 7px", fontSize: 11 }}
                                >
                                  Yes
                                </button>
                                <button
                                  className="lb-btn lb-btn-secondary lb-btn-sm"
                                  onClick={() => setConfirmDeleteItemId(null)}
                                  style={{ padding: "2px 7px", fontSize: 11 }}
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <span
                                className="del-icon"
                                title="Remove item"
                                onClick={() =>
                                  setConfirmDeleteItemId(it.item_id)
                                }
                              >
                                🗑
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add Product Panel */}
                {showAddProduct && (
                  <AddProductPanel
                    orderId={order.order_id}
                    products={availableProducts}
                    onAdded={handleItemAdded}
                    onCancel={() => setShowAddProduct(false)}
                  />
                )}

                {productsLoading && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--text3)",
                      marginTop: 4,
                    }}
                  >
                    Loading product list…
                  </div>
                )}
              </div>
            )}

            {/* If no items yet, still show add product */}
            {!loading &&
              details &&
              (!details.items || details.items.length === 0) && (
                <div>
                  <div
                    className="lb-section-title"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>Items</span>
                    <button
                      className="lb-btn lb-btn-secondary lb-btn-sm"
                      onClick={() => setShowAddProduct((v) => !v)}
                      style={{ fontSize: 11 }}
                    >
                      {showAddProduct ? "✕ Cancel" : "➕ Add Product"}
                    </button>
                  </div>
                  {showAddProduct && (
                    <AddProductPanel
                      orderId={order.order_id}
                      products={availableProducts}
                      onAdded={handleItemAdded}
                      onCancel={() => setShowAddProduct(false)}
                    />
                  )}
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

        {/* ── ACTION BAR ── */}
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

          <InvoiceButton
            orderId={order.order_id}
            invoiceNumber={order.invoice_number}
            detailsInvoice={details?.invoice_number}
            onGenerate={handleInvoice}
            loading={invoiceLoading}
          />

          <div style={{ flex: 1 }} />

          {confirmReject ? (
            <>
              <span style={{ fontSize: 12, color: "var(--red)" }}>
                Reject this order?
              </span>
              <button className="lb-btn lb-btn-danger" onClick={handleReject}>
                Yes, Reject
              </button>
              <button
                className="lb-btn lb-btn-secondary"
                onClick={() => setConfirmReject(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="lb-btn lb-btn-danger"
              onClick={() => setConfirmReject(true)}
            >
              ⛔ Reject
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

      if (
        payment_status &&
        o.payment_status?.toLowerCase() !== payment_status.toLowerCase()
      )
        return false;
      if (
        delivery_status &&
        o.delivery_status?.toUpperCase() !== delivery_status.toUpperCase()
      )
        return false;

      if (channel) {
        const ch = (o.channel || "").trim().toLowerCase();
        const target = channel.toLowerCase();
        if (target === "online") {
          if (!["online", "wix", "website"].includes(ch)) return false;
        } else {
          if (ch !== target) return false;
        }
      }

      if (date_from || date_to) {
        const orderDate = new Date(o.created_at);
        if (date_from && orderDate < new Date(date_from)) return false;
        if (date_to) {
          const end = new Date(date_to);
          end.setHours(23, 59, 59, 999);
          if (orderDate > end) return false;
        }
      }

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

      {/* LIGHTBOX */}
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
