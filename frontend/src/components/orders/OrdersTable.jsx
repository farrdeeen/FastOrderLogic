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

/* ─── Boot / Splash screen ───────────────────────
   Shown while ALL pages are still streaming in.
   Replaced by the real table only once isLoadingMore
   AND isInitialLoading are both false.
   ─────────────────────────────────────────────── */
const BOOT_STYLES = `
  @keyframes bt-bar {
    0%   { width: 0% }
    15%  { width: 22% }
    35%  { width: 45% }
    55%  { width: 62% }
    75%  { width: 80% }
    90%  { width: 91% }
    100% { width: 100% }
  }
  @keyframes bt-fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes bt-pulse-dot {
    0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
    40%           { opacity: 1;   transform: scale(1.2); }
  }
  @keyframes bt-spin-ring {
    to { transform: rotate(360deg); }
  }
  @keyframes bt-count-up {
    from { opacity: 0.4; }
    to   { opacity: 1; }
  }

  .bt-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f4f5f7;
    z-index: 900;
    font-family: 'DM Sans', sans-serif;
  }
  .bt-card {
    background: #ffffff;
    border: 1px solid #e4e7ec;
    border-radius: 16px;
    padding: 40px 48px;
    box-shadow: 0 20px 24px -4px rgba(16,24,40,.08), 0 8px 8px -4px rgba(16,24,40,.03);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    min-width: 340px;
    animation: bt-fade-in 0.3s ease both;
  }
  .bt-icon-ring {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 3px solid #e4e7ec;
    border-top-color: #1570ef;
    animation: bt-spin-ring 0.9s linear infinite;
  }
  .bt-title {
    font-size: 15px;
    font-weight: 600;
    color: #101828;
    text-align: center;
    line-height: 1.4;
  }
  .bt-subtitle {
    font-size: 12.5px;
    color: #98a2b3;
    text-align: center;
    margin-top: -18px;
    font-family: 'DM Mono', monospace;
  }
  .bt-bar-track {
    width: 260px;
    height: 4px;
    background: #e4e7ec;
    border-radius: 99px;
    overflow: hidden;
  }
  .bt-bar-fill {
    height: 100%;
    border-radius: 99px;
    background: linear-gradient(90deg, #1570ef 0%, #60a5fa 100%);
    animation: bt-bar var(--bt-duration, 8s) cubic-bezier(.4,0,.2,1) both;
    will-change: width;
  }
  .bt-dots {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .bt-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #1570ef;
    animation: bt-pulse-dot 1.4s ease-in-out infinite;
  }
  .bt-dot:nth-child(2) { animation-delay: 0.2s; }
  .bt-dot:nth-child(3) { animation-delay: 0.4s; }
  .bt-count {
    font-size: 13px;
    color: #475467;
    font-family: 'DM Mono', monospace;
    animation: bt-count-up 0.3s ease;
  }
  .bt-count strong {
    color: #101828;
    font-weight: 700;
  }
`;

function injectBootStyles() {
  if (document.getElementById("bt-styles")) return;
  const s = document.createElement("style");
  s.id = "bt-styles";
  s.textContent = BOOT_STYLES;
  document.head.appendChild(s);
}

function BootScreen({ loadedCount, totalEstimate, durationHint }) {
  injectBootStyles();

  /* Estimate a sensible bar animation duration:
     if we already know total, pace it to ~that many ms per order
     otherwise fall back to a slow 10s crawl */
  const dur = durationHint
    ? `${Math.max(3, Math.min(durationHint, 15))}s`
    : "10s";

  const pct =
    totalEstimate && loadedCount
      ? Math.min(Math.round((loadedCount / totalEstimate) * 100), 95)
      : null;

  return (
    <div className="bt-overlay">
      <div className="bt-card">
        <div className="bt-icon-ring" />

        <div>
          <div className="bt-title">Loading your orders…</div>
          <div className="bt-subtitle" style={{ marginTop: 4 }}>
            Please wait while we fetch everything
          </div>
        </div>

        <div
          className="bt-bar-track"
          title={pct != null ? `${pct}% loaded` : "Loading…"}
        >
          <div className="bt-bar-fill" style={{ "--bt-duration": dur }} />
        </div>

        {loadedCount > 0 ? (
          <div className="bt-count" key={loadedCount}>
            <strong>{loadedCount.toLocaleString()}</strong>
            {totalEstimate
              ? ` / ~${totalEstimate.toLocaleString()} orders`
              : " orders loaded so far…"}
          </div>
        ) : (
          <div className="bt-dots">
            <span className="bt-dot" />
            <span className="bt-dot" />
            <span className="bt-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────── */
export default function OrdersTable({
  orders = [],
  filters = {},
  onAction,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
  isInitialLoading = false,
  loadedCount = 0,
  totalEstimate = null,
  invoiceLoading = {},
}) {
  injectStyles();

  const [activeOrder, setActiveOrder] = useState(null);
  const [detailsCache, setDetailsCache] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});
  const [pushedAwbs, setPushedAwbs] = useState({});

  /* ── Show boot screen while data is still streaming ──
     We only switch to the real table once BOTH flags are false.
     This prevents any flickering — the table appears exactly once,
     fully loaded. */
  const isBusy = isInitialLoading || isLoadingMore;

  /* Estimate bar duration from total / rate */
  const durationHint = useMemo(() => {
    if (!totalEstimate) return null;
    /* Assume ~300 orders/second as a rough throughput guess */
    return Math.round(totalEstimate / 300);
  }, [totalEstimate]);

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
        if (target === "online") {
          if (!["online", "wix", "website"].includes(ch)) return false;
        } else {
          if (ch !== target) return false;
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

  /* ── Boot screen: shown until ALL pages have arrived ── */
  if (isBusy) {
    return (
      <>
        <ToastContainer />
        <BootScreen
          loadedCount={loadedCount}
          totalEstimate={totalEstimate}
          durationHint={durationHint}
        />
      </>
    );
  }

  /* ── Fully loaded: render table ── */
  return (
    <div className="ot-wrap">
      <ToastContainer />

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
          </>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)" }}>
        Showing {Math.min(visibleRows.length, deduped.length)} of{" "}
        {deduped.length} filtered
        {orders.length !== deduped.length ? ` (${orders.length} total)` : ""}
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
