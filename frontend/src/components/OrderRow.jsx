import { memo } from "react";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";

const OrderRow = memo(function OrderRow({
  order,
  index,
  isExpanded,
  onToggle,
  details,
  isLoading,
  safeAction,
  openSerialModal,
  editingRemarksFor,
  remarksValue,
  setRemarksValue,
  startEditRemarks,
  submitRemarks,
  invoiceLoading, // ✅ ADD THIS
}) {

  if (!order) return null; // 🛡️ hard safety guard

  const serialStatus = details?.serial_status ?? "none";
  const serialDot =
    serialStatus === "complete"
      ? "🟢"
      : serialStatus === "partial"
      ? "🟡"
      : "🔴";

  return (
    <>
      {/* ================= MAIN ROW ================= */}
      <tr style={{ background: index % 2 === 0 ? "#f3f4f6" : "white" }}>
        <td style={{ padding: 10 }}>
          <button
            onClick={() => onToggle(order.order_id)}
            style={{ background: "transparent", border: "none", cursor: "pointer" }}
          >
            {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
          </button>
        </td>

        <td style={{ padding: 10 }}>{order.customer?.name || "—"}</td>

        <td style={{ padding: 10, whiteSpace: "nowrap" }}>
          {order.created_at
            ? new Date(order.created_at).toLocaleString()
            : "—"}
        </td>

        <td style={{ padding: 10 }}>{order.total_items}</td>

        <td style={{ padding: 10 }}>
          ₹{(order.total_amount || 0).toFixed(2)}
        </td>

        <td style={{ padding: 10 }}>{order.channel}</td>

        {/* PAYMENT (badge only — no tick) */}
        <td style={{ padding: 10 }}>
  <button
    disabled={!!order.invoice_number}
    onClick={() => safeAction(order.order_id, "toggle-payment")}
    style={{
      background: order.payment_status === "paid" ? "#16a34a" : "#dc2626",
      color: "white",
      padding: "4px 10px",
      borderRadius: 6,
      border: "none",
      cursor: order.invoice_number ? "not-allowed" : "pointer",
      opacity: order.invoice_number ? 0.6 : 1,
      fontWeight: 500,
    }}
    title={
      order.invoice_number
        ? "Payment status locked after invoice generation"
        : "Click to toggle payment status"
    }
  >
    {order.payment_status === "paid" ? "Paid" : "Pending"}
  </button>
</td>


        {/* SERIALS */}
        <td style={{ padding: 10 }}>
          <span style={{ marginRight: 6 }}>{serialDot}</span>
          {order.payment_status === "paid" ? (
            <button
              onClick={() => openSerialModal(order)}
              style={{ background: "transparent", border: "none", cursor: "pointer" }}
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
            value={order.delivery_status}
            onChange={(e) =>
              safeAction(order.order_id, "update-delivery", e.target.value)
            }
          >
            <option value="NOT_SHIPPED">Not Shipped</option>
            <option value="SHIPPED">Shipped</option>
            <option value="COMPLETED">Delivered</option>
          </select>
        </td>

        {/* INVOICE */}
        <td style={{ padding: 10 }}>
          {!order.invoice_number ? (
            <button
              disabled={invoiceLoading}
              onClick={() => safeAction(order.order_id, "create-invoice")}
              style={{
                background: "transparent",
                border: "none",
                cursor: invoiceLoading ? "not-allowed" : "pointer",
                opacity: invoiceLoading ? 0.5 : 1,
              }}
            >
              {invoiceLoading ? "⏳" : "🧾"}
            </button>
          ) : (
            <>
              <span style={{ marginRight: 6 }}>✔️</span>
              <button
                onClick={() => safeAction(order.order_id, "download-invoice")}
                style={{ background: "transparent", border: "none", cursor: "pointer" }}
              >
                🖨️
              </button>
            </>
          )}
        </td>


        {/* DELETE */}
        <td style={{ padding: 10 }}>
          <button
            onClick={() =>
              window.confirm("Delete this order?") &&
              safeAction(order.order_id, "delete-order")
            }
            style={{
              background: "#ef4444",
              color: "white",
              padding: "6px 10px",
              borderRadius: 6,
              border: "none",
            }}
          >
            🗑️
          </button>
        </td>
      </tr>

      {/* ================= EXPANDED ================= */}
      {isExpanded && (
        <tr>
          <td colSpan={11} style={{ padding: "1rem", background: "#eef2ff" }}>
            {isLoading ? (
              <p>Loading details…</p>
            ) : (
              <>
                {/* ✅ ORDER ID (added as requested) */}
                <h4>Order ID</h4>
                <p
                  style={{
                    fontFamily: "monospace",
                    fontSize: 14,
                    marginBottom: 12,
                  }}
                >
                  {order.order_id}
                </p>

                <h4>Address</h4>
                {details?.address ? (
                  <>
                    <p>{details.address.address_line}</p>
                    <p>
                      {details.address.city} – {details.address.pincode}
                    </p>
                    <p>{details.address.state_name}</p>
                  </>
                ) : (
                  <p>No address</p>
                )}

                <h4 style={{ marginTop: 16 }}>Items</h4>
                {details?.items?.length ? (
                  details.items.map((it) => (
                    <div key={it.item_id}>
                      {it.product_name} — Qty {it.quantity} × ₹{it.unit_price}
                    </div>
                  ))
                ) : (
                  <p>No items</p>
                )}

                <h4 style={{ marginTop: 16 }}>Remarks</h4>
                {editingRemarksFor === order.order_id ? (
                  <>
                    <textarea
                      value={remarksValue}
                      onChange={(e) => setRemarksValue(e.target.value)}
                      style={{ width: "100%", minHeight: 80 }}
                    />
                    <button onClick={() => submitRemarks(order.order_id)}>
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    <p>{details?.remarks || "—"}</p>
                    <button onClick={() => startEditRemarks(order)}>
                      Edit Remarks
                    </button>
                  </>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
});

export default OrderRow;
