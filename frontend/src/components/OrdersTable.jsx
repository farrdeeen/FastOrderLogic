import { useState } from "react";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";

export default function OrdersTable({ orders, onAction }) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  const rowsPerPage = 8;
  const totalPages = Math.ceil((orders?.length || 0) / rowsPerPage);
  const paginated = (orders || []).slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  const toggleExpand = (id) => {
    setExpanded(expanded === id ? null : id);
  };

  const badge = (value, color) => (
    <span
      style={{
        background: color,
        color: "white",
        padding: "3px 8px",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: "500",
      }}
    >
      {value}
    </span>
  );

  if (!orders?.length)
    return (
      <p style={{ textAlign: "center", color: "#6b7280", marginTop: "1rem" }}>
        No orders found.
      </p>
    );

  return (
    <div
      style={{
        background: "#f9fafb",
        borderRadius: "12px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
        overflow: "hidden",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.9rem",
          color: "#1f2937",
          backgroundColor: "white",
        }}
      >
        <thead>
          <tr style={{ background: "#e5e7eb", color: "#111827" }}>
            {[
              "",
              "Order ID",
              "Created",
              "Items",
              "Amount (₹)",
              "Channel",
              "Payment",
              "Delivery",
              "AWB",
              "Actions",
            ].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px",
                  borderBottom: "2px solid #d1d5db",
                  fontWeight: "600",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {paginated.map((o, i) => {
            const isExpanded = expanded === o.order_id;

            return (
              <>
                {/* Main Row */}
                <tr
                  key={o.order_id}
                  style={{
                    background: i % 2 === 0 ? "#f3f4f6" : "#ffffff",
                    transition: "background 0.2s ease",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#e0e7ff")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      i % 2 === 0 ? "#f3f4f6" : "#ffffff")
                  }
                >
                  {/* Expand Button */}
                  <td style={{ padding: "10px" }}>
                    <button
                      onClick={() => toggleExpand(o.order_id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                    </button>
                  </td>

                  <td style={{ padding: "10px" }}>{o.order_id}</td>
                  <td style={{ padding: "10px" }}>
                    {o.created_at
                      ? new Date(o.created_at).toLocaleString()
                      : "—"}
                  </td>
                  <td style={{ padding: "10px" }}>{o.total_items || 0}</td>
                  <td style={{ padding: "10px" }}>
                    {o.total_amount?.toFixed(2)}
                  </td>
                  <td style={{ padding: "10px", textTransform: "capitalize" }}>
                    {o.channel || "-"}
                  </td>

                  <td style={{ padding: "10px" }}>
                    {o.payment_status === "paid"
                      ? badge("Paid", "#16a34a")
                      : badge("Pending", "#dc2626")}
                  </td>

                  <td style={{ padding: "10px" }}>
                    {o.delivery_status === "NOT_SHIPPED"
                      ? badge("Not Shipped", "#facc15")
                      : o.delivery_status === "READY"
                      ? badge("Ready", "#3b82f6")
                      : o.delivery_status === "SHIPPED"
                      ? badge("Shipped", "#2563eb")
                      : badge("Completed", "#16a34a")}
                  </td>

                  <td style={{ padding: "10px" }}>{o.awb_number || "-"}</td>

                  {/* Actions */}
                  <td
                    style={{
                      padding: "10px",
                      display: "flex",
                      gap: "0.4rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {o.payment_status === "pending" && (
                      <button
                        onClick={() => onAction(o.order_id, "mark-paid")}
                        style={{
                          background: "#d1fae5",
                          border: "none",
                          borderRadius: "5px",
                          padding: "6px",
                          cursor: "pointer",
                        }}
                      >
                        ✓
                      </button>
                    )}
                  </td>
                </tr>

                {/* Expandable Row */}
                {isExpanded && (
                  <tr>
                    <td colSpan={10} style={{ padding: "0", background: "#eef2ff" }}>
                      <div
                        style={{
                          padding: "1rem",
                          borderTop: "1px solid #c7d2fe",
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "1rem",
                        }}
                      >
                        {/* Customer */}
                        <div>
                          <h4 style={{ margin: 0, marginBottom: "0.5rem" }}>
                            👤 Customer Details
                          </h4>
                          <p>Name: {o.customer?.name || "-"}</p>
                          <p>Mobile: {o.customer?.mobile || "-"}</p>
                          <p>Email: {o.customer?.email || "-"}</p>
                        </div>

                        {/* Address */}
                        <div>
                          <h4 style={{ margin: 0, marginBottom: "0.5rem" }}>
                            📍 Address
                          </h4>
                          {o.address ? (
                            <>
                              <p>{o.address.address_line}</p>
                              <p>
                                {o.address.city} - {o.address.pincode}
                              </p>
                              <p>State: {o.address.state_id}</p>
                            </>
                          ) : (
                            <p>No address</p>
                          )}
                        </div>

                        {/* Items Full Width */}
                        <div style={{ gridColumn: "1 / -1" }}>
                          <h4 style={{ marginBottom: "0.5rem" }}>🛒 Items</h4>

                          {o.items?.map((it) => (
                            <div
                              key={it.item_id}
                              style={{
                                padding: "0.6rem",
                                marginBottom: "0.5rem",
                                background: "white",
                                borderRadius: "6px",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                                display: "flex",
                                justifyContent: "space-between",
                              }}
                            >
                              <div>
                                <strong>{it.product_name || "Unknown"}</strong>
                                <p>
                                  Qty: {it.quantity} × {it.unit_price}
                                </p>
                              </div>
                              <div>
                                <strong>₹{it.total_price}</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>

      {/* Pagination */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.75rem",
          background: "#f4f4f4",
        }}
      >
        <button
          onClick={() => setPage((p) => Math.max(p - 1, 1))}
          disabled={page === 1}
          style={{
            padding: "6px 12px",
            background: "#e5e7eb",
            border: "none",
            borderRadius: "5px",
            cursor: page === 1 ? "not-allowed" : "pointer",
          }}
        >
          ◀ Prev
        </button>

        <span style={{ fontWeight: "500" }}>
          Page {page} / {totalPages || 1}
        </span>

        <button
          onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
          disabled={page === totalPages}
          style={{
            padding: "6px 12px",
            background: "#e5e7eb",
            border: "none",
            borderRadius: "5px",
            cursor: page === totalPages ? "not-allowed" : "pointer",
          }}
        >
          Next ▶
        </button>
      </div>
    </div>
  );
}
