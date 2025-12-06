import { useState } from "react";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export default function OrdersTable({ orders, onAction }) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  // SERIAL NUMBER MODAL
  const [serialModalOpen, setSerialModalOpen] = useState(false);
  const [serialItems, setSerialItems] = useState([]);
  const [activeOrderId, setActiveOrderId] = useState(null);

  const rowsPerPage = 8;
  const totalPages = Math.ceil((orders?.length || 0) / rowsPerPage);
  const paginated = (orders || []).slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  const toggleExpand = (id) => {
    setExpanded(expanded === id ? null : id);
  };

  const badge = (text, color) => (
    <span
      style={{
        background: color,
        color: "white",
        padding: "3px 8px",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: "500",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );

  // ---------------------------------------------------------
  // OPEN SERIAL NUMBER MODAL
  // ---------------------------------------------------------
  const openSerialModal = async (order) => {
    setActiveOrderId(order.order_id);

    try {
      const res = await axios.get(
        `${API_URL}/orders/${order.order_id}/serial_numbers`
      );

      const formatted = res.data.map((item) => ({
        ...item,
        serials:
          item.serials?.length > 0
            ? item.serials
            : Array(item.quantity).fill(""),
      }));

      setSerialItems(formatted);
      setSerialModalOpen(true);
    } catch (err) {
      alert("Unable to fetch serial numbers.");
      console.error(err);
    }
  };

  // ---------------------------------------------------------
  // SAVE SERIAL NUMBERS
  // ---------------------------------------------------------
  const saveSerialNumbers = async () => {
    try {
      await axios.post(
        `${API_URL}/orders/${activeOrderId}/serial_numbers/save`,
        { entries: serialItems }
      );

      alert("Serial numbers saved!");
      setSerialModalOpen(false);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to save serials");
      console.error(err);
    }
  };

  // ---------------------------------------------------------
  // MAIN TABLE
  // ---------------------------------------------------------
  if (!orders?.length)
    return (
      <p style={{ textAlign: "center", color: "#6b7280", marginTop: "1rem" }}>
        No orders found.
      </p>
    );

  return (
    <>
      <div
        style={{
          background: "#f9fafb",
          borderRadius: "12px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.9rem",
            background: "white",
          }}
        >
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              {[
                "",
                "Order ID",
                "Created",
                "Items",
                "Amount (₹)",
                "Channel",
                "Payment",
                "Serials",
                "Delivery",
                "Invoice",
              ].map((heading) => (
                <th
                  key={heading}
                  style={{
                    padding: "10px",
                    borderBottom: "2px solid #d1d5db",
                    fontWeight: "600",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {paginated.map((o, i) => {
              const isExpanded = expanded === o.order_id;

              // SERIAL STATUS indicator (backend flag)
              const serialDot =
                o.serial_status === "complete"
                  ? "🟢"
                  : o.serial_status === "partial"
                  ? "🟡"
                  : "🔴";

              return (
                <>
                  <tr
                    key={o.order_id}
                    style={{
                      background: i % 2 === 0 ? "#f3f4f6" : "#ffffff",
                    }}
                  >
                    {/* Expand */}
                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      <button
                        onClick={() => toggleExpand(o.order_id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                      </button>
                    </td>

                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      {o.order_id}
                    </td>

                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      {o.created_at
                        ? new Date(o.created_at).toLocaleString()
                        : "—"}
                    </td>

                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      {o.total_items}
                    </td>

                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      {o.total_amount?.toFixed(2)}
                    </td>

                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      {o.channel}
                    </td>

                    {/* ------------ PAYMENT ------------ */}
                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          height: "20px",
                          lineHeight: "1",
                        }}
                      >
                        {o.payment_status === "paid"
                          ? badge("Paid", "#16a34a")
                          : badge("Pending", "#dc2626")}

                        <button
                          onClick={() =>
                            onAction(o.order_id, "toggle-payment")
                          }
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "16px",
                            padding: 0,
                            lineHeight: "1",
                          }}
                        >
                          {o.payment_status === "paid" ? "✓" : "✕"}
                        </button>
                      </div>
                    </td>

                    {/* ------------ SERIALS ------------ */}
                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          height: "20px",
                          lineHeight: "1",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {/* Status dot */}
                        <span style={{ fontSize: "14px" }}>{serialDot}</span>

                        {/* Only allow assigning serials when payment done */}
                        {o.payment_status === "paid" ? (
                          <button
                            onClick={() => openSerialModal(o)}
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              fontSize: "18px",
                              padding: 0,
                            }}
                          >
                            🔑
                          </button>
                        ) : (
                          "—"
                        )}
                      </div>
                    </td>

                    {/* ------------ DELIVERY ------------ */}
                    <td style={{ padding: "10px", verticalAlign: "middle" }}>
                      <select
                        value={o.delivery_status}
                        onChange={(e) =>
                          onAction(
                            o.order_id,
                            "update-delivery",
                            e.target.value
                          )
                        }
                        style={{
                          padding: "4px 6px",
                          borderRadius: "6px",
                          border: "1px solid #d1d5db",
                          whiteSpace: "nowrap",
                          background:
                            o.delivery_status === "NOT_SHIPPED"
                              ? "#fee2e2"
                              : o.delivery_status === "SHIPPED"
                              ? "#fef9c3"
                              : "#dcfce7",
                        }}
                      >
                        <option value="NOT_SHIPPED">Not Shipped</option>
                        <option value="SHIPPED">Shipped</option>
                        <option value="COMPLETED">Delivered</option>
                      </select>
                    </td>

                    {/* ------------ INVOICE ------------ */}
                    {/* ------------ INVOICE ------------ */}
<td style={{ padding: "10px", verticalAlign: "middle" }}>
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      height: "20px",
      lineHeight: "1",
    }}
  >
    {!o.invoice_number ? (
      // CREATE INVOICE BUTTON
      <button
        onClick={() => onAction(o.order_id, "create-invoice")}
        style={{
          fontSize: "20px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        🧾
      </button>
    ) : (
      <>
        {/* GREEN CHECK ICON */}
        <span
          style={{
            fontSize: "20px",
            color: "#16a34a",
            fontWeight: "bold",
          }}
          title={`Invoice Created (${o.invoice_number})`}
        >
          ✔️
        </span>

        {/* PRINT / DOWNLOAD BUTTON */}
        <button
          onClick={() => onAction(o.order_id, "download-invoice")}
          style={{
            fontSize: "20px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
          title="Download Invoice"
        >
          🖨️
        </button>
      </>
    )}
  </div>
</td>

                  </tr>

                  {/* EXPANDED ROW */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <div
                          style={{
                            padding: "1rem",
                            background: "#eef2ff",
                            borderTop: "1px solid #c7d2fe",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "1rem",
                          }}
                        >
                          {/* Customer */}
                          <div>
                            <h4>Customer</h4>
                            <p>Name: {o.customer?.name}</p>
                            <p>Mobile: {o.customer?.mobile}</p>
                            <p>Email: {o.customer?.email}</p>
                          </div>

                          {/* Address */}
                          <div>
                            <h4>Address</h4>
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

                          {/* Items */}
                          <div style={{ gridColumn: "1 / -1" }}>
                            <h4>Items</h4>
                            {o.items.map((it) => (
                              <div
                                key={it.item_id}
                                style={{
                                  padding: "0.6rem",
                                  marginBottom: "0.5rem",
                                  background: "white",
                                  borderRadius: "6px",
                                  display: "flex",
                                  justifyContent: "space-between",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                                }}
                              >
                                <div>
                                  <strong>{it.product_name}</strong>
                                  <p>
                                    Qty: {it.quantity} × {it.unit_price}
                                  </p>
                                </div>
                                <strong>₹{it.total_price}</strong>
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

        {/* PAGINATION */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "0.75rem",
            background: "#f4f4f4",
            gap: "0.5rem",
          }}
        >
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            style={{
              padding: "6px 12px",
              borderRadius: "5px",
              background: "#e5e7eb",
              border: "none",
            }}
          >
            ◀ Prev
          </button>

          <span>
            Page {page} / {totalPages}
          </span>

          <button
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
            style={{
              padding: "6px 12px",
              borderRadius: "5px",
              background: "#e5e7eb",
              border: "none",
            }}
          >
            Next ▶
          </button>
        </div>
      </div>

      {/* SERIAL MODAL */}
      {serialModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "white",
              padding: "1rem",
              borderRadius: "10px",
              width: "600px",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <h3>Assign Serial Numbers</h3>

            {serialItems.map((item, idx) => (
              <div
                key={idx}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: "8px",
                  padding: "1rem",
                  marginBottom: "1rem",
                }}
              >
                <h4>
                  {item.product_name} — Qty: {item.quantity}
                </h4>

                {item.serials.map((sn, i) => (
                  <input
                    key={i}
                    type="text"
                    placeholder={`Serial ${i + 1}`}
                    value={sn}
                    onChange={(e) => {
                      const updated = [...serialItems];
                      updated[idx].serials[i] = e.target.value;
                      setSerialItems(updated);
                    }}
                    style={{
                      width: "100%",
                      padding: "8px",
                      margin: "6px 0",
                      borderRadius: "6px",
                      border: "1px solid #ddd",
                    }}
                  />
                ))}
              </div>
            ))}

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}
            >
              <button
                onClick={() => setSerialModalOpen(false)}
                style={{
                  padding: "8px 14px",
                  background: "#e5e7eb",
                  borderRadius: "6px",
                  border: "none",
                }}
              >
                Cancel
              </button>

              <button
                onClick={saveSerialNumbers}
                style={{
                  padding: "8px 14px",
                  background: "#4f46e5",
                  color: "white",
                  borderRadius: "6px",
                  border: "none",
                }}
              >
                Save Serials
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
