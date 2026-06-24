import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "../../api/axiosInstance";
import { injectStyles } from "./styles";
import { ToastContainer } from "./ToastSystem";
import {
  PaymentBadge,
  DeliveryBadge,
  FulfillmentBadge,
  InvoiceCell,
} from "./Badges";
import { fmtCurrency, fmtDate } from "./helpers";
import DeliveryCell from "./DeliveryCell";
import OrderLightbox from "./OrderLightbox";

/* ─── Virtualised row window ─────────────────── */
const PAGE_SIZE = 200;

function useVirtualRows(rows) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [rows]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting)
          setLimit((l) => Math.min(l + PAGE_SIZE, rows.length));
      },
      { rootMargin: "400px" },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [rows.length]);

  return {
    visibleRows: rows.slice(0, limit),
    sentinelRef,
    hasMore: limit < rows.length,
  };
}

/* ─── Skeleton loader ────────────────────────── */
const SKEL_COLS = [110, "13%", 108, 90, 52, 88, 78, "10%", "17%", 90, 88];
const SKEL_ROW_WIDTHS = [
  [70, "80%", 80, 60, 20, 55, 48, 52, 110, 58, 52],
  [80, "65%", 80, 60, 20, 60, 56, 52, 80, 58, 62],
  [72, "75%", 80, 60, 20, 50, 48, 52, 130, 58, 40],
  [68, "70%", 80, 60, 20, 58, 56, 52, 90, 58, 52],
  [78, "60%", 80, 60, 20, 54, 48, 52, 110, 58, 62],
  [74, "72%", 80, 60, 20, 52, 56, 52, 100, 58, 48],
  [80, "68%", 80, 60, 20, 60, 48, 52, 120, 58, 56],
  [70, "78%", 80, 60, 20, 56, 56, 52, 85, 58, 44],
];

function TableSkeleton({ loadedCount = 0, totalEstimate = null }) {
  return (
    <div className="ot-skeleton-wrap">
      {/* animated top bar */}
      <div className="ot-skeleton-loading-bar" />

      {/* fake header */}
      <div className="ot-skeleton-header">
        {[
          "Order ID",
          "Customer",
          "Mobile",
          "Date",
          "Qty",
          "Amount",
          "Channel",
          "Payment",
          "Delivery",
          "Fulfillment",
          "Invoice",
        ].map((label) => (
          <div
            key={label}
            className="ot-skeleton-header-cell"
            style={{ width: 60 + label.length * 3 }}
          />
        ))}
      </div>

      {/* fake rows */}
      {SKEL_ROW_WIDTHS.map((widths, ri) => (
        <div
          key={ri}
          className="ot-skeleton-row"
          style={{ animationDelay: `${ri * 0.06}s` }}
        >
          {widths.map((w, ci) =>
            ci === 7 || ci === 8 ? (
              /* badge-shaped skeletons for payment / delivery */
              <div
                key={ci}
                className="ot-skeleton-badge"
                style={{ width: ci === 8 ? 90 : 58 }}
              />
            ) : (
              <div key={ci} className="ot-skeleton-cell" style={{ width: w }} />
            ),
          )}
        </div>
      ))}

      {/* status line */}
      <div className="ot-skeleton-status">
        <div className="ot-skeleton-spinner" />
        {loadedCount > 0
          ? `Loaded ${loadedCount.toLocaleString()} orders${totalEstimate ? ` of ~${totalEstimate.toLocaleString()}` : ""}…`
          : "Fetching orders…"}
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────── */
export default function OrdersTable({
  orders = [],
  filters = {},
  onAction,
  hasMore = true,
  isLoadingMore = false,
  isInitialLoading = false, // ← NEW: true while first fetch is in flight
  loadedCount = 0, // ← NEW: how many orders have arrived so far
  totalEstimate = null, // ← NEW: optional total hint (e.g. from a count endpoint)
  invoiceLoading = {},
}) {
  injectStyles();

  const [activeOrder, setActiveOrder] = useState(null);
  const [detailsCache, setDetailsCache] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});
  const [pushedAwbs, setPushedAwbs] = useState({});

  /* ── Client-side filter ── */
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
        const hay = [
          o.order_id,
          cust.name,
          cust.mobile,
          o.awb_number,
          o.utr_number,
          o.channel,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
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
        if (target === "mtm-store") {
          // mTm Store website orders are stored as mtm-store / online / website.
          if (!["mtm-store", "online", "website"].includes(ch)) return false;
        } else if (target === "ai_assistant") {
          if (ch !== "ai_assistant") return false;
        } else if (ch !== target) {
          return false;
        }
      }
      if (date_from || date_to) {
        const d = new Date(o.created_at);
        if (date_from && d < new Date(date_from)) return false;
        if (date_to) {
          const end = new Date(date_to);
          end.setHours(23, 59, 59, 999);
          if (d > end) return false;
        }
      }
      if (pending_invoice) {
        const inv = (o.invoice_number || "").trim();
        if (inv && inv !== "") return false;
      }
      return true;
    });
  }, [orders, filters]);

  /* Merge live-pushed AWBs */
  const enrichedOrders = useMemo(() => {
    if (Object.keys(pushedAwbs).length === 0) return filtered;
    return filtered.map((o) =>
      pushedAwbs[o.order_id]
        ? {
            ...o,
            awb_number: pushedAwbs[o.order_id],
            delivery_status: "SHIPPED",
          }
        : o,
    );
  }, [filtered, pushedAwbs]);

  /* Deduplicate */
  const deduped = useMemo(() => {
    const seen = new Set();
    return enrichedOrders.filter((o) => {
      if (seen.has(o.order_id)) return false;
      seen.add(o.order_id);
      return true;
    });
  }, [enrichedOrders]);

  const {
    visibleRows,
    sentinelRef,
    hasMore: hasMoreVirtual,
  } = useVirtualRows(deduped);

  /* ── Open detail lightbox ── */
  const openOrder = useCallback(
    async (order) => {
      setActiveOrder(order);
      const id = order.order_id;
      if (detailsCache[id]) return;
      setLoadingDetails((p) => ({ ...p, [id]: true }));
      try {
        const res = await api.get(`/orders/${encodeURIComponent(id)}/details`);
        setDetailsCache((p) => ({ ...p, [id]: res.data }));
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingDetails((p) => ({ ...p, [id]: false }));
      }
    },
    [detailsCache],
  );

  /* ── Show skeleton while initial load is in progress and no rows yet ── */
  if (isInitialLoading && orders.length === 0) {
    return (
      <div className="ot-wrap">
        <ToastContainer />
        <TableSkeleton
          loadedCount={loadedCount}
          totalEstimate={totalEstimate}
        />
      </div>
    );
  }

  return (
    <div className="ot-wrap">
      <ToastContainer />

      {/* Thin progress bar while background pages are still loading */}
      {isLoadingMore && (
        <div style={{ marginBottom: 6 }}>
          <div
            className="ot-skeleton-loading-bar"
            style={{ borderRadius: 4, height: 2 }}
          />
          <div
            style={{
              fontSize: 11,
              color: "var(--text3)",
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              className="ot-skeleton-spinner"
              style={{ width: 10, height: 10, borderWidth: 1.5 }}
            />
            Loading more orders in background…
          </div>
        </div>
      )}

      <div className="ot-table-wrap">
        {deduped.length === 0 ? (
          <div className="ot-empty">
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            No orders match your filters.
          </div>
        ) : (
          <>
            <div className="ot-table-scroll">
              <table className="ot-table">
                <colgroup>
                  <col className="col-orderid" />
                  <col className="col-customer" />
                  <col className="col-mobile" />
                  <col className="col-date ot-col-hide-sm" />
                  <col className="col-items ot-col-hide-md" />
                  <col className="col-amount" />
                  <col className="col-channel ot-col-hide-sm" />
                  <col className="col-payment" />
                  <col className="col-delivery" />
                  <col className="col-fulfill ot-col-hide-sm" />
                  <col className="col-invoice" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Mobile</th>
                    <th className="ot-col-hide-sm">Date</th>
                    <th
                      className="ot-col-hide-md"
                      style={{ textAlign: "center" }}
                    >
                      Qty
                    </th>
                    <th>Amount</th>
                    <th className="ot-col-hide-sm">Channel</th>
                    <th>Payment</th>
                    <th>Delivery</th>
                    <th className="ot-col-hide-sm">Fulfillment</th>
                    <th>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((order) => {
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
                            fontSize: "11.5px",
                            color: "var(--text2)",
                          }}
                        >
                          {cust.mobile || "—"}
                        </td>
                        <td
                          className="ot-col-hide-sm"
                          style={{ color: "var(--text2)" }}
                        >
                          {fmtDate(order.created_at)}
                        </td>
                        <td
                          className="ot-col-hide-md"
                          style={{ color: "var(--text2)", textAlign: "center" }}
                        >
                          {order.total_items ?? "—"}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {fmtCurrency(order.total_amount)}
                        </td>
                        <td className="ot-col-hide-sm">
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
                              gap: 3,
                            }}
                          >
                            <PaymentBadge status={order.payment_status} />
                            {order.payment_status?.toLowerCase() === "paid" &&
                              order.utr_number && (
                                <span
                                  style={{
                                    fontFamily: "'DM Mono', monospace",
                                    fontSize: 10,
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
                          <DeliveryCell
                            order={order}
                            onPushed={(orderId, waybill) => {
                              setPushedAwbs((p) => ({
                                ...p,
                                [orderId]: waybill,
                              }));
                              onAction && onAction(orderId, "refresh");
                            }}
                          />
                        </td>
                        <td className="ot-col-hide-sm">
                          <FulfillmentBadge status={order.fulfillment_status} />
                        </td>
                        <td>
                          <InvoiceCell
                            invoiceNumber={order.invoice_number}
                            orderStatus={order.order_status}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hasMoreVirtual && (
              <div ref={sentinelRef} className="ot-load-more">
                Loading more rows…
              </div>
            )}
            {!hasMoreVirtual && hasMore && (
              <div className="ot-load-more">
                {isLoadingMore ? "Loading more orders…" : " "}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)" }}>
        Showing {Math.min(visibleRows.length, deduped.length)} of{" "}
        {deduped.length} filtered
        {orders.length !== deduped.length ? ` (${orders.length} total)` : ""}
        {isLoadingMore && (
          <span style={{ marginLeft: 8, color: "var(--accent)" }}>
            · fetching more…
          </span>
        )}
      </div>

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
                const c = { ...p };
                delete c[id];
                return c;
              });
              try {
                const res = await api.get(
                  `/orders/${encodeURIComponent(id)}/details`,
                );
                setDetailsCache((p) => ({ ...p, [id]: res.data }));
              } catch (e) {
                console.error(e);
              }
            }
          }}
        />
      )}
    </div>
  );
}
