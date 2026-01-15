import { useEffect, useRef, useState } from "react";
import api from "../api/axiosInstance";
import OrderRow from "./OrderRow";

export default function OrdersTable({
  orders = [],
  onAction,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
  invoiceLoading = {},
}) {
  const [expanded, setExpanded] = useState(null);

  const [detailsCache, setDetailsCache] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});

  // SERIAL MODAL STATE
  const [serialModalOpen, setSerialModalOpen] = useState(false);
  const [serialItems, setSerialItems] = useState([]);
  const [activeOrderId, setActiveOrderId] = useState(null);

  // Remarks
  const [editingRemarksFor, setEditingRemarksFor] = useState(null);
  const [remarksValue, setRemarksValue] = useState("");

  const loadMoreRef = useRef(null);

  // ================= INFINITE SCROLL =================
  useEffect(() => {
    if (!hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: "300px" }
    );

    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const safeAction = (id, action, payload) => {
    if (!action) return;
    onAction(id, action, payload);
  };

  // ================= LAZY EXPAND =================
  const toggleExpand = async (orderId) => {
    if (expanded === orderId) {
      setExpanded(null);
      return;
    }

    setExpanded(orderId);

    if (detailsCache[orderId]) return;

    setLoadingDetails((p) => ({ ...p, [orderId]: true }));
    try {
      const res = await api.get(
        `/orders/${encodeURIComponent(orderId)}/details`
      );
      setDetailsCache((p) => ({ ...p, [orderId]: res.data }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetails((p) => ({ ...p, [orderId]: false }));
    }
  };

  // ================= SERIAL MODAL =================
  const openSerialModal = async (order) => {
    try {
      const res = await api.get(
        `/orders/${encodeURIComponent(order.order_id)}/serial_numbers`
      );

      const normalized = (res.data || []).map((it) => ({
        ...it,
        serials:
          it.serials && it.serials.length
            ? it.serials
            : Array(it.quantity).fill(""),
      }));

      setActiveOrderId(order.order_id);
      setSerialItems(normalized);
      setSerialModalOpen(true);
    } catch (err) {
      console.error(err);
      alert("Failed to load serial numbers");
    }
  };

  if (!orders.length) return <p>No orders found.</p>;

  return (
    <>
      {/* ================= TABLE ================= */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#e5e7eb" }}>
            {[
              "",
              "Customer",
              "Created",
              "Items",
              "Amount",
              "Channel",
              "Payment",
              "Serial",
              "Delivery",
              "Invoice",
              "",
            ].map((h, i) => (
              <th key={`${h}-${i}`} style={{ padding: 10 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {orders.map((order, index) => (
            <OrderRow
              key={order.order_id}
              order={order}
              index={index}
              isExpanded={expanded === order.order_id}
              onToggle={toggleExpand}
              details={detailsCache[order.order_id]}
              isLoading={loadingDetails[order.order_id]}
              safeAction={safeAction}
              openSerialModal={openSerialModal}
              editingRemarksFor={editingRemarksFor}
              remarksValue={remarksValue}
              setRemarksValue={setRemarksValue}
              invoiceLoading={invoiceLoading[order.order_id]}
              startEditRemarks={(o) => {
                setEditingRemarksFor(o.order_id);
                setRemarksValue(
                  detailsCache[o.order_id]?.remarks || ""
                );
              }}
              submitRemarks={async (id) => {
                await safeAction(id, "update-remarks", remarksValue);
                setEditingRemarksFor(null);
                setRemarksValue("");
              }}
            />
          ))}
        </tbody>
      </table>

      {/* 🔽 Infinite Scroll Loader */}
      {hasMore && (
        <div
          ref={loadMoreRef}
          style={{
            height: 40,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            opacity: 0.6,
          }}
        >
          {isLoadingMore ? "Loading more orders..." : " "}
        </div>
      )}

      {/* ================= SERIAL MODAL ================= */}
      {serialModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
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

            {serialItems.map((item) => (
              <div
                key={item.item_id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: "1rem",
                  marginBottom: "1rem",
                }}
              >
                <h4>
                  {item.product_name} — Qty {item.quantity}
                </h4>

                {item.serials.map((sn, i) => (
                  <input
                    key={`${item.item_id}-${i}`}
                    type="text"
                    value={sn}
                    placeholder={`Serial ${i + 1}`}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSerialItems((prev) =>
                        prev.map((it) =>
                          it.item_id === item.item_id
                            ? {
                                ...it,
                                serials: it.serials.map((s, idx) =>
                                  idx === i ? value : s
                                ),
                              }
                            : it
                        )
                      );
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
              <button onClick={() => setSerialModalOpen(false)}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  await api.post(
                    `/orders/${encodeURIComponent(
                      activeOrderId
                    )}/serial_numbers/save`,
                    { entries: serialItems }
                  );
                  setSerialModalOpen(false);
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
