import { useState } from "react";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export default function OrdersTable({ orders = [], onAction }) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  // Serial modal
  const [serialModalOpen, setSerialModalOpen] = useState(false);
  const [serialItems, setSerialItems] = useState([]);
  const [activeOrderId, setActiveOrderId] = useState(null);

  // Remarks editing
  const [editingRemarksFor, setEditingRemarksFor] = useState(null);
  const [remarksValue, setRemarksValue] = useState("");

  const rowsPerPage = 8;
  const totalPages = Math.max(1, Math.ceil((orders.length || 0) / rowsPerPage));
  const paginated = orders.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const toggleExpand = (id) => setExpanded(expanded === id ? null : id);

  const safeAction = (id, action, payload) => {
    if (!action) return console.warn("Undefined action:", action);
    onAction(id, action, payload);
  };

  // Load serials
  const openSerialModal = async (o) => {
    try {
      const res = await axios.get(
        `${API_URL}/orders/${encodeURIComponent(o.order_id)}/serial_numbers`
      );
      const formatted = res.data.map((item) => ({
        ...item,
        serials:
          item.serials?.length > 0
            ? item.serials
            : Array(item.quantity).fill(""),
      }));
      setActiveOrderId(o.order_id);
      setSerialItems(formatted);
      setSerialModalOpen(true);
    } catch (err) {
      console.error(err);
      alert("Unable to load serial numbers");
    }
  };

  // SAVE SERIAL NUMBERS + UPDATE FRONTEND ICON IMMEDIATELY
  const saveSerialNumbers = async () => {
    try {
      const res = await axios.post(
        `${API_URL}/orders/${encodeURIComponent(activeOrderId)}/serial_numbers/save`,
        { entries: serialItems }
      );

      // Backend returns: complete | partial | none
      const newStatus = res.data.serial_status;

      // 🔥 Notify parent that serial status has changed
      // This updates the dot instantly without reloading the page
      safeAction(activeOrderId, "serial-status-updated", newStatus);

      alert("Serial numbers saved!");
      setSerialModalOpen(false);

    } catch (err) {
      console.error(err);
      alert("Failed to save serials");
    }
  };

  // Remarks
  const startEditRemarks = (o) => {
    setEditingRemarksFor(o.order_id);
    setRemarksValue(o.remarks || "");
  };

  const submitRemarks = async (id) => {
    await safeAction(id, "update-remarks", remarksValue);
    setEditingRemarksFor(null);
    setRemarksValue("");
  };

  if (!orders.length)
    return (
      <p style={{ textAlign: "center", color: "#6b7280" }}>No orders found.</p>
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
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              {[
                "",
                "Customer Name",
                "Created",
                "Items",
                "Amount (₹)",
                "Channel",
                "Payment",
                "Serials",
                "Delivery",
                "Invoice",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px",
                    borderBottom: "2px solid #d1d5db",
                    fontWeight: 600,
                    textAlign: "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {paginated.map((o, i) => {
              const exp = expanded === o.order_id;

              const serialDot =
                o.serial_status === "complete"
                  ? "🟢"
                  : o.serial_status === "partial"
                    ? "🟡"
                    : "🔴";

              return (
                <>
                  {/* MAIN ROW */}
                  <tr
                    key={o.order_id}
                    style={{
                      background: i % 2 === 0 ? "#f3f4f6" : "white",
                    }}
                  >
                    {/* Expand */}
                    <td style={{ padding: 10 }}>
                      <button
                        onClick={() => toggleExpand(o.order_id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {exp ? <FaChevronUp /> : <FaChevronDown />}
                      </button>
                    </td>

                    <td style={{ padding: 10 }}>{o.customer?.name || "—"}</td>

                    <td style={{ padding: 10 }}>
                      {o.created_at
                        ? new Date(o.created_at).toLocaleString()
                        : "—"}
                    </td>

                    <td style={{ padding: 10 }}>{o.total_items}</td>

                    <td style={{ padding: 10 }}>
                      {(o.total_amount || 0).toFixed(2)}
                    </td>

                    <td style={{ padding: 10 }}>{o.channel}</td>

                    {/* PAYMENT */}
                    <td style={{ padding: 10 }}>
                      <span
                        style={{
                          background:
                            o.payment_status === "paid"
                              ? "#16a34a"
                              : "#dc2626",
                          color: "white",
                          padding: "3px 8px",
                          borderRadius: 6,
                          marginRight: 6,
                        }}
                      >
                        {o.payment_status === "paid" ? "Paid" : "Pending"}
                      </span>

                      <button
                        onClick={() =>
                          safeAction(o.order_id, "toggle-payment")
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        {o.payment_status === "paid" ? "✓" : "✕"}
                      </button>
                    </td>

                    {/* SERIALS */}
                    <td style={{ padding: 10 }}>
                      <span style={{ marginRight: 6 }}>{serialDot}</span>

                      {o.payment_status === "paid" ? (
                        <button
                          onClick={() => openSerialModal(o)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 18,
                          }}
                        >
                          🔑
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* DELIVERY */}
                    <td style={{ padding: 10 }}>
                      <select
                        value={o.delivery_status}
                        onChange={(e) =>
                          safeAction(
                            o.order_id,
                            "update-delivery",
                            e.target.value
                          )
                        }
                        style={{
                          padding: "4px 6px",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
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

                    {/* INVOICE */}
                    <td style={{ padding: 10 }}>
                      {!o.invoice_number ? (
                        <button
                          onClick={() =>
                            safeAction(o.order_id, "create-invoice")
                          }
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 20,
                          }}
                        >
                          🧾
                        </button>
                      ) : (
                        <>
                          <span style={{ fontSize: 20, color: "#16a34a" }}>
                            ✔️
                          </span>
                          <button
                            onClick={() =>
                              safeAction(o.order_id, "download-invoice")
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              fontSize: 20,
                            }}
                          >
                            🖨️
                          </button>
                        </>
                      )}
                    </td>
                    {/* DELETE ORDER */}
                    <td style={{ padding: 10 }}>
                      <button
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this order?")) {
                            safeAction(o.order_id, "delete-order");
                          }
                        }}
                        style={{
                          background: "#ef4444",
                          color: "white",
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "none",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        🗑️
                      </button>
                    </td>

                  </tr>

                  {/* EXPANDED SECTION */}
                  {exp && (
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
                          {/* CUSTOMER */}
                          <div>
                            <h4>Customer</h4>
                            <p>
                              <strong>Name:</strong> {o.customer?.name}
                            </p>
                            <p>
                              <strong>Mobile:</strong> {o.customer?.mobile}
                            </p>
                            <p>
                              <strong>Email:</strong> {o.customer?.email}
                            </p>

                            <p style={{ marginTop: 10 }}>
                              <strong>Order ID:</strong> {o.order_id}
                            </p>
                          </div>

                          {/* ADDRESS */}
                          <div>
                            <h4>Address</h4>
                            {o.address ? (
                              <>
                                <p>{o.address.address_line}</p>
                                <p>
                                  {o.address.city} - {o.address.pincode}
                                </p>
                                <p>
                                  State:{" "}
                                  {o.address.state_name || o.address.state_id}
                                </p>
                              </>
                            ) : (
                              <p>No address</p>
                            )}
                          </div>

                          {/* REMARKS */}
                          <div style={{ gridColumn: "1 / -1" }}>
                            <h4>Remarks</h4>

                            {editingRemarksFor === o.order_id ? (
                              <>
                                <textarea
                                  value={remarksValue}
                                  onChange={(e) =>
                                    setRemarksValue(e.target.value)
                                  }
                                  style={{
                                    width: "100%",
                                    minHeight: 80,
                                    padding: 8,
                                    borderRadius: 6,
                                    border: "1px solid #ccc",
                                  }}
                                />

                                <div
                                  style={{
                                    marginTop: 8,
                                    display: "flex",
                                    gap: 8,
                                  }}
                                >
                                  <button
                                    onClick={() =>
                                      submitRemarks(o.order_id)
                                    }
                                    style={{
                                      padding: "8px 12px",
                                      background: "#2563eb",
                                      color: "white",
                                      borderRadius: 6,
                                      border: "none",
                                    }}
                                  >
                                    Save
                                  </button>

                                  <button
                                    onClick={() => {
                                      setEditingRemarksFor(null);
                                      setRemarksValue("");
                                    }}
                                    style={{
                                      padding: "8px 12px",
                                      background: "#e5e7eb",
                                      borderRadius: 6,
                                      border: "none",
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <p>{o.remarks || "—"}</p>

                                <button
                                  onClick={() => startEditRemarks(o)}
                                  style={{
                                    padding: "6px 12px",
                                    background: "#2563eb",
                                    color: "white",
                                    borderRadius: 6,
                                    border: "none",
                                  }}
                                >
                                  Edit Remarks
                                </button>
                              </>
                            )}
                          </div>

                          {/* ITEMS */}
                          <div style={{ gridColumn: "1 / -1" }}>
                            <h4>Items</h4>

                            {o.items.map((it) => (
                              <div
                                key={it.item_id}
                                style={{
                                  padding: "0.6rem",
                                  background: "white",
                                  marginBottom: "0.5rem",
                                  borderRadius: 6,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
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
            style={{ padding: "6px 12px", borderRadius: 5, border: "none" }}
          >
            ◀ Prev
          </button>

          <span>
            Page {page} / {totalPages}
          </span>

          <button
            disabled={page === totalPages}
            onClick={() => setPage(page + 1)}
            style={{ padding: "6px 12px", borderRadius: 5, border: "none" }}
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
              borderRadius: 10,
              width: 600,
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
                  borderRadius: 8,
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
                      padding: 8,
                      margin: "6px 0",
                      borderRadius: 6,
                      border: "1px solid #ddd",
                    }}
                  />
                ))}
              </div>
            ))}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setSerialModalOpen(false)}
                style={{
                  padding: "8px 12px",
                  background: "#e5e7eb",
                  border: "none",
                  borderRadius: 6,
                }}
              >
                Cancel
              </button>

              <button
                onClick={saveSerialNumbers}
                style={{
                  padding: "8px 12px",
                  background: "#4f46e5",
                  color: "white",
                  borderRadius: 6,
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
