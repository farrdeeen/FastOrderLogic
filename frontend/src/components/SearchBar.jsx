import { useState, useEffect } from "react";

export default function SearchBar({ filters, setFilters }) {
  const [searchType, setSearchType] = useState("search");
  const [query, setQuery] = useState("");

  // 🔁 Dynamic live search (instant + smart debounce)
  useEffect(() => {
    if (query.trim() === "") {
      setFilters((prev) => ({ ...prev, search: "" }));
      return;
    }

    // Update instantly for short input (<3 chars)
    if (query.length < 3) {
      setFilters((prev) => ({
        ...prev,
        search: `${searchType}:${query.trim()}`,
      }));
      return;
    }

    // Debounce longer queries (for smoother performance)
    const timeout = setTimeout(() => {
      setFilters((prev) => ({
        ...prev,
        search: `${searchType}:${query.trim()}`,
      }));
    }, 200);

    return () => clearTimeout(timeout);
  }, [query, searchType]);

  // 🔄 Handle filter dropdowns and dates
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // 🔁 Reset filters
  const handleReset = () => {
    setQuery("");
    setFilters({
      search: "",
      payment_status: "",
      delivery_status: "",
      channel: "",
      date_from: "",
      date_to: "",
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.6rem",
        background: "#1f2937",
        padding: "1rem",
        borderRadius: "10px",
        marginBottom: "1.5rem",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
    >
      {/* 🔽 Search type dropdown */}
      <select
        value={searchType}
        onChange={(e) => setSearchType(e.target.value)}
        style={{
          padding: "0.6rem",
          background: "#111827",
          color: "#f9fafb",
          border: "1px solid #4b5563",
          borderRadius: "6px",
          fontWeight: "500",
          minWidth: "150px",
        }}
      >
        <option value="search">General Search</option>
        <option value="order_id">Order ID</option>
        <option value="awb_number">AWB</option>
        <option value="total_amount">Amount</option>
      </select>

      {/* 🔍 Search input */}
      <input
        type={searchType === "total_amount" ? "number" : "text"}
        placeholder={`Search by ${searchType.replace("_", " ")}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          flex: "1",
          padding: "0.6rem",
          border: "1px solid #4b5563",
          borderRadius: "6px",
          color: "#f9fafb",
          backgroundColor: "#111827",
          minWidth: "220px",
        }}
      />

      {/* 💳 Payment filter */}
      <select
        name="payment_status"
        value={filters.payment_status}
        onChange={handleFilterChange}
        style={{
          padding: "0.6rem",
          border: "1px solid #4b5563",
          borderRadius: "6px",
          background: "#111827",
          color: "#f9fafb",
          minWidth: "130px",
        }}
      >
        <option value="">Payment</option>
        <option value="paid">Paid</option>
        <option value="pending">Pending</option>
      </select>

      {/* 📦 Delivery filter */}
      <select
        name="delivery_status"
        value={filters.delivery_status}
        onChange={handleFilterChange}
        style={{
          padding: "0.6rem",
          border: "1px solid #4b5563",
          borderRadius: "6px",
          background: "#111827",
          color: "#f9fafb",
          minWidth: "150px",
        }}
      >
        <option value="">Delivery</option>
        <option value="NOT_SHIPPED">Not Shipped</option>
        <option value="READY">Ready</option>
        <option value="SHIPPED">Shipped</option>
        <option value="COMPLETED">Completed</option>
      </select>

      {/* 🌐 Channel filter */}
      <select
        name="channel"
        value={filters.channel}
        onChange={handleFilterChange}
        style={{
          padding: "0.6rem",
          border: "1px solid #4b5563",
          borderRadius: "6px",
          background: "#111827",
          color: "#f9fafb",
          minWidth: "130px",
        }}
      >
        <option value="">Channel</option>
        <option value="offline">Offline</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="wix">Wix</option>
        <option value="website">Website</option>
      </select>

      {/* 📅 Date range filters */}
      <input
        type="date"
        name="date_from"
        value={filters.date_from}
        onChange={handleFilterChange}
        style={{
          padding: "0.6rem",
          border: "1px solid #4b5563",
          borderRadius: "6px",
          background: "#111827",
          color: "#f9fafb",
        }}
      />
      <input
        type="date"
        name="date_to"
        value={filters.date_to}
        onChange={handleFilterChange}
        style={{
          padding: "0.6rem",
          border: "1px solid #4b5563",
          borderRadius: "6px",
          background: "#111827",
          color: "#f9fafb",
        }}
      />

      {/* 🔁 Reset */}
      <button
        type="button"
        onClick={handleReset}
        style={{
          padding: "0.6rem 1rem",
          background: "#dc2626",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          fontWeight: "600",
          minWidth: "100px",
        }}
      >
        Reset
      </button>
    </div>
  );
}
