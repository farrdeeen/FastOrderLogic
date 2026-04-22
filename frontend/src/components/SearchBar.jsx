import { useState, useEffect, useCallback } from "react";

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
    --red: #f04438;
    --red-bg: #fef3f2;
    --radius: 8px;
    font-family: 'DM Sans', sans-serif;
  }

  .sb-toolbar {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 16px;
    font-family: 'DM Sans', sans-serif;
  }

  .sb-search-wrap {
    position: relative;
    flex: 0 1 280px;
    min-width: 200px;
    max-width: 320px;
  }
  .sb-search-wrap svg {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    color: var(--text3); pointer-events: none;
  }
  .sb-search {
    width: 100%; padding: 9px 12px 9px 38px;
    border: 1px solid var(--border2); border-radius: var(--radius);
    font-family: inherit; font-size: 14px; color: var(--text);
    background: var(--surface); outline: none; transition: border .15s;
    box-sizing: border-box;
  }
  .sb-search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  .sb-filter-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 14px; border: 1px solid var(--border2);
    border-radius: var(--radius); background: var(--surface);
    font-family: inherit; font-size: 13px; font-weight: 500; color: var(--text2);
    cursor: pointer; transition: all .15s; white-space: nowrap;
  }
  .sb-filter-btn:hover { background: var(--bg); border-color: var(--border2); }
  .sb-filter-btn.active { background: var(--accent-light); border-color: var(--accent); color: var(--accent); }
  .sb-filter-btn .dot {
    width: 7px; height: 7px; border-radius: 50%; background: currentColor;
  }

  select.sb-filter-btn {
    appearance: none;
    padding-right: 28px;
    cursor: pointer;
  }

  .sb-date-group {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--border2);
    border-radius: var(--radius);
    background: var(--surface);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--text2);
    white-space: nowrap;
  }
  .sb-date-group label {
    font-size: 11px;
    color: var(--text3);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .3px;
  }
  .sb-date-input {
    padding: 0;
    border: none;
    background: transparent;
    font-family: inherit;
    font-size: 12.5px;
    color: var(--text2);
    outline: none;
    cursor: pointer;
    width: 120px;
  }
  .sb-date-input::-webkit-calendar-picker-indicator {
    opacity: 0.5;
    cursor: pointer;
  }
`;

function injectSearchBarStyles() {
  if (document.getElementById("sb-styles")) return;
  const s = document.createElement("style");
  s.id = "sb-styles";
  s.textContent = STYLES;
  document.head.appendChild(s);
}

export default function SearchBar({ filters, setFilters }) {
  injectSearchBarStyles();

  const [localSearch, setLocalSearch] = useState(filters.search || "");

  // Debounce search input → push to filters
  useEffect(() => {
    const q = localSearch.trim();
    const delay = q.length > 0 && q.length < 3 ? 0 : 200;
    const timeout = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: q }));
    }, delay);
    return () => clearTimeout(timeout);
  }, [localSearch, setFilters]);

  // Keep local search in sync if parent resets filters externally
  useEffect(() => {
    if (filters.search === "") setLocalSearch("");
  }, [filters.search]);

  const togglePay = useCallback(
    (v) =>
      setFilters((prev) => ({
        ...prev,
        payment_status: prev.payment_status === v ? "" : v,
      })),
    [setFilters],
  );

  const toggleDel = useCallback(
    (v) =>
      setFilters((prev) => ({
        ...prev,
        delivery_status: prev.delivery_status === v ? "" : v,
      })),
    [setFilters],
  );

  const togglePendingInvoice = useCallback(
    () =>
      setFilters((prev) => ({
        ...prev,
        pending_invoice: !prev.pending_invoice,
      })),
    [setFilters],
  );

  const handleFilterChange = useCallback(
    (e) => {
      const { name, value } = e.target;
      setFilters((prev) => ({ ...prev, [name]: value }));
    },
    [setFilters],
  );

  const handleReset = useCallback(() => {
    setLocalSearch("");
    setFilters({
      search: "",
      payment_status: "",
      delivery_status: "",
      channel: "",
      date_from: "",
      date_to: "",
      pending_invoice: false,
    });
  }, [setFilters]);

  const hasActiveFilter =
    localSearch ||
    filters.payment_status ||
    filters.delivery_status ||
    filters.channel ||
    filters.date_from ||
    filters.date_to ||
    filters.pending_invoice;

  return (
    <div className="sb-toolbar">
      {/* Search Input */}
      <div className="sb-search-wrap">
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
          className="sb-search"
          placeholder="Search order ID, customer, mobile…"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
      </div>

      {/* Payment Filters */}
      <button
        className={`sb-filter-btn ${filters.payment_status === "pending" ? "active" : ""}`}
        onClick={() => togglePay("pending")}
      >
        <span className="dot" /> Pending Payment
      </button>
      <button
        className={`sb-filter-btn ${filters.payment_status === "paid" ? "active" : ""}`}
        onClick={() => togglePay("paid")}
      >
        <span className="dot" /> Paid
      </button>

      {/* Delivery Filters */}
      <button
        className={`sb-filter-btn ${filters.delivery_status === "NOT_SHIPPED" ? "active" : ""}`}
        onClick={() => toggleDel("NOT_SHIPPED")}
      >
        Not Shipped
      </button>
      <button
        className={`sb-filter-btn ${filters.delivery_status === "SHIPPED" ? "active" : ""}`}
        onClick={() => toggleDel("SHIPPED")}
      >
        Shipped
      </button>

      {/* Pending Invoice Filter */}
      <button
        className={`sb-filter-btn ${filters.pending_invoice ? "active" : ""}`}
        onClick={togglePendingInvoice}
      >
        🧾 Pending Invoice
      </button>

      {/* Channel Dropdown */}
      <select
        name="channel"
        value={filters.channel || ""}
        onChange={handleFilterChange}
        className="sb-filter-btn"
      >
        <option value="">All Channels</option>
        <option value="offline">Offline</option>
        <option value="online">Online</option>
        <option value="wix">Wix</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="website">Website</option>
      </select>

      {/* Date Range */}
      <div className="sb-date-group">
        <label>From</label>
        <input
          type="date"
          name="date_from"
          value={filters.date_from || ""}
          onChange={handleFilterChange}
          className="sb-date-input"
        />
      </div>
      <div className="sb-date-group">
        <label>To</label>
        <input
          type="date"
          name="date_to"
          value={filters.date_to || ""}
          onChange={handleFilterChange}
          className="sb-date-input"
        />
      </div>

      {/* Clear All */}
      {hasActiveFilter && (
        <button
          className="sb-filter-btn"
          onClick={handleReset}
          style={{ color: "var(--red)" }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
}
