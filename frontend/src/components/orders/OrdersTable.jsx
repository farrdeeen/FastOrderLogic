import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "../../api/axiosInstance";
import { injectStyles } from "./styles";
import { ToastContainer } from "./ToastSystem";
import { PaymentBadge, DeliveryBadge, InvoiceCell } from "./Badges";
import { fmtCurrency, fmtDate } from "./helpers";
import DeliveryCell from "./DeliveryCell";
import OrderLightbox from "./OrderLightbox";

/* ─── Auto lifecycle badge ──────────────────────────────────────────────────
   Priority: invoice_number → awb_number → utr_number → Pending
   ─────────────────────────────────────────────────────────────────────────── */
function LifecycleBadge({ order }) {
  const { invoice_number, awb_number, utr_number } = order;
  if (invoice_number && invoice_number !== "NA" && invoice_number.trim() !== "")
    return <span className="badge badge-green">Fulfilled</span>;
  if (awb_number && awb_number !== "To be assigned" && awb_number.trim() !== "")
    return <span className="badge badge-blue">Shipped</span>;
  if (utr_number && utr_number.trim() !== "")
    return <span className="badge badge-amber">Paid</span>;
  return <span className="badge badge-gray">Pending</span>;
}

/* ─── Serial status badge ─────────────────────────────────────────────────── */
function SerialBadge({ status }) {
  if (!status || status === "none") return null;
  if (status === "complete")
    return (
      <span
        className="badge badge-green"
        style={{ fontSize: 10, padding: "1px 6px" }}
      >
        Serials ✓
      </span>
    );
  return (
    <span
      className="badge badge-amber"
      style={{ fontSize: 10, padding: "1px 6px" }}
    >
      Partial
    </span>
  );
}

/* ─── Virtualised row window ──────────────────────────────────────────────── */
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

/* ─── Boot / Splash screen ─────────────────────────────────────────────────── */
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
  @keyframes bt-spin-ring { to { transform: rotate(360deg); } }
  @keyframes bt-count-up { from { opacity: 0.4; } to { opacity: 1; } }

  .bt-overlay {
    position: fixed; inset: 0; display: flex; align-items: center;
    justify-content: center; background: #f4f5f7; z-index: 900;
    font-family: 'DM Sans', sans-serif;
  }
  .bt-card {
    background: #ffffff; border: 1px solid #e4e7ec; border-radius: 16px;
    padding: 40px 48px; box-shadow: 0 20px 24px -4px rgba(16,24,40,.08), 0 8px 8px -4px rgba(16,24,40,.03);
    display: flex; flex-direction: column; align-items: center;
    gap: 28px; min-width: 340px; animation: bt-fade-in 0.3s ease both;
  }
  .bt-icon-ring {
    width: 56px; height: 56px; border-radius: 50%;
    border: 3px solid #e4e7ec; border-top-color: #1570ef;
    animation: bt-spin-ring 0.9s linear infinite;
  }
  .bt-title { font-size: 15px; font-weight: 600; color: #101828; text-align: center; }
  .bt-subtitle { font-size: 12.5px; color: #98a2b3; text-align: center; margin-top: -18px; font-family: 'DM Mono', monospace; }
  .bt-bar-track { width: 260px; height: 4px; background: #e4e7ec; border-radius: 99px; overflow: hidden; }
  .bt-bar-fill {
    height: 100%; border-radius: 99px;
    background: linear-gradient(90deg, #1570ef 0%, #60a5fa 100%);
    animation: bt-bar var(--bt-duration, 8s) cubic-bezier(.4,0,.2,1) both;
    will-change: width;
  }
  .bt-dots { display: flex; gap: 6px; align-items: center; }
  .bt-dot {
    width: 6px; height: 6px; border-radius: 50%; background: #1570ef;
    animation: bt-pulse-dot 1.4s ease-in-out infinite;
  }
  .bt-dot:nth-child(2) { animation-delay: 0.2s; }
  .bt-dot:nth-child(3) { animation-delay: 0.4s; }
  .bt-count { font-size: 13px; color: #475467; font-family: 'DM Mono', monospace; animation: bt-count-up 0.3s ease; }
  .bt-count strong { color: #101828; font-weight: 700; }
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

/* ─── Delta sync toast ─────────────────────────────────────────────────────── */
function SyncIndicator({ syncing, lastSync }) {
  if (syncing)
    return (
      <span
        style={{
          fontSize: 11,
          color: "var(--text3)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            border: "1.5px solid #e4e7ec",
            borderTopColor: "var(--accent)",
            animation: "spin .7s linear infinite",
            display: "inline-block",
          }}
        />
        Syncing…
      </span>
    );
  if (!lastSync) return null;
  return (
    <span style={{ fontSize: 11, color: "var(--text3)" }}>
      ↻ Synced {lastSync}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLIENT-SIDE FILTER — maps quick_status + other fields to row visibility
   ═══════════════════════════════════════════════════════════════════════════ */
function applyFilters(orders, filters) {
  const {
    search = "",
    quick_status = "",
    channel = "",
    date_from = "",
    date_to = "",
    // Legacy compat — kept so parent components that still pass old shape work
    payment_status = "",
    delivery_status = "",
    pending_invoice = false,
  } = filters;

  return orders.filter((o) => {
    const cust = o.customer || {};

    // ── Text search ──
    if (search) {
      const q = search.toLowerCase().trim();
      const hay = [o.order_id, cust.name, cust.mobile, o.awb_number, o.channel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    // ── Quick status (new unified filter) ──
    if (quick_status) {
      switch (quick_status) {
        case "payment_pending":
          if (o.payment_status?.toLowerCase() === "paid") return false;
          break;
        case "shipping_pending":
          // Paid but not yet shipped
          if (o.payment_status?.toLowerCase() !== "paid") return false;
          if (o.delivery_status?.toUpperCase() !== "NOT_SHIPPED") return false;
          break;
        case "serial_pending":
          // serial_status injected by backend or locally tracked
          // Treat missing serial_status as "none" (pending)
          if (o.serial_status === "complete") return false;
          break;
        case "invoice_pending": {
          const inv = (o.invoice_number || "").trim();
          if (inv && inv !== "") return false;
          break;
        }
        case "complete": {
          const inv = (o.invoice_number || "").trim();
          if (!inv || inv === "" || inv === "NA") return false;
          break;
        }
        default:
          break;
      }
    }

    // ── Legacy compat filters (still work if passed) ──
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
    if (pending_invoice) {
      const inv = (o.invoice_number || "").trim();
      if (inv && inv !== "") return false;
    }

    // ── Channel ──
    if (channel) {
      const ch = (o.channel || "").trim().toLowerCase();
      const target = channel.toLowerCase();
      if (target === "online") {
        if (!["online", "wix", "website"].includes(ch)) return false;
      } else {
        if (ch !== target) return false;
      }
    }

    // ── Date range ──
    if (date_from || date_to) {
      const d = new Date(o.created_at);
      if (date_from && d < new Date(date_from)) return false;
      if (date_to) {
        const end = new Date(date_to);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
    }

    return true;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function OrdersTable({
  orders = [],
  filters = {},
  onAction,
  onOrdersUpdate, // NEW: callback so parent can merge delta orders
  isInitialLoading = false,
  isLoadingMore = false,
  loadedCount = 0,
  totalEstimate = null,
  invoiceLoading = {},
}) {
  injectStyles();

  const [activeOrder, setActiveOrder] = useState(null);
  const [detailsCache, setDetailsCache] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});
  const [pushedAwbs, setPushedAwbs] = useState({});

  // ── Delta sync state ──
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const lastSyncTs = useRef(null); // ISO timestamp of last successful sync
  const syncTimer = useRef(null);

  const isBusy = isInitialLoading || isLoadingMore;

  const durationHint = useMemo(() => {
    if (!totalEstimate) return null;
    return Math.round(totalEstimate / 300);
  }, [totalEstimate]);

  /* ── Delta sync: poll /orders/recent-changes every 20 s ─────────────────
     Only fetches rows where updated_at > last sync timestamp.
     For 30k orders with ≤10 operators, this keeps traffic minimal.
     ─────────────────────────────────────────────────────────────────────── */
  const runDeltaSync = useCallback(async () => {
    if (!lastSyncTs.current) {
      // On first run, just set the baseline timestamp and skip fetching
      lastSyncTs.current = new Date().toISOString();
      return;
    }
    try {
      setSyncing(true);
      const res = await api.get("/orders/recent-changes", {
        params: { since: lastSyncTs.current },
      });
      const changed = res.data || [];
      if (changed.length > 0 && onOrdersUpdate) {
        onOrdersUpdate(changed);
      }
      lastSyncTs.current = new Date().toISOString();
      const now = new Date();
      setLastSync(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      );
    } catch (e) {
      // Silent fail — don't disrupt UX for background sync errors
      console.warn("Delta sync failed:", e?.message);
    } finally {
      setSyncing(false);
    }
  }, [onOrdersUpdate]);

  // Start polling once the table is fully loaded
  useEffect(() => {
    if (isBusy) return;

    // Set baseline timestamp when data finishes loading
    if (!lastSyncTs.current) {
      lastSyncTs.current = new Date().toISOString();
    }

    syncTimer.current = setInterval(runDeltaSync, 20_000); // every 20s
    return () => clearInterval(syncTimer.current);
  }, [isBusy, runDeltaSync]);

  /* ── Client-side filter + enrichment ── */
  const filtered = useMemo(
    () => applyFilters(orders, filters),
    [orders, filters],
  );

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

  /* ── Optimistic local update helper ─────────────────────────────────────
     Mutates the order in-place in the parent orders array via onOrdersUpdate.
     This gives instant feedback without any re-fetch.
     ─────────────────────────────────────────────────────────────────────── */
  const applyLocalUpdate = useCallback(
    (orderId, patch) => {
      if (onOrdersUpdate) {
        // Wrap in the same shape as delta-sync response
        const current = orders.find((o) => o.order_id === orderId);
        if (current) {
          onOrdersUpdate([{ ...current, ...patch, order_id: orderId }]);
        }
      }
    },
    [orders, onOrdersUpdate],
  );

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

  /* ── Action handler: intercepts actions for optimistic updates ─────────
     After calling the real onAction (parent), we patch the local state
     immediately so the row reflects the change without waiting for a sync.
     ─────────────────────────────────────────────────────────────────────── */
  const handleAction = useCallback(
    async (id, action, payload) => {
      // Call parent handler first (makes the API call)
      if (onAction) await onAction(id, action, payload);

      // Optimistic local patches
      switch (action) {
        case "mark-paid":
          applyLocalUpdate(id, {
            payment_status: "paid",
            order_status: "APPR",
          });
          break;
        case "mark-paid-utr":
          applyLocalUpdate(id, {
            payment_status: "paid",
            order_status: "APPR",
            utr_number: payload?.utr_number || payload,
          });
          break;
        case "toggle-payment":
          // We don't know current state here, so invalidate and let sync handle it
          // But we DO know from context — find the order
          {
            const o = orders.find((x) => x.order_id === id);
            if (o) {
              const newStatus =
                o.payment_status === "paid" ? "pending" : "paid";
              applyLocalUpdate(id, {
                payment_status: newStatus,
                order_status: newStatus === "paid" ? "APPR" : "PEND",
              });
            }
          }
          break;
        case "mark-fulfilled":
          applyLocalUpdate(id, { delivery_status: "READY" });
          break;
        case "mark-delhivery":
          applyLocalUpdate(id, {
            delivery_status: "SHIPPED",
            awb_number: payload || "To be assigned",
          });
          break;
        case "update-awb":
          applyLocalUpdate(id, {
            awb_number: payload,
            delivery_status: payload ? "SHIPPED" : "NOT_SHIPPED",
          });
          break;
        case "update-invoice-number":
          applyLocalUpdate(id, { invoice_number: payload });
          break;
        case "create-invoice":
          // invoice number comes back from api — trigger details refresh
          break;
        case "mark-invoiced":
          applyLocalUpdate(id, { order_status: "COMPLETED" });
          break;
        case "reject":
          applyLocalUpdate(id, {
            order_status: "REJECTED",
            invoice_number: "NA",
          });
          break;
        case "update-remarks":
          setDetailsCache((p) => ({
            ...p,
            [id]: { ...p[id], remarks: payload },
          }));
          break;
        case "refresh":
          // Invalidate details cache and re-fetch details silently
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
            // Also patch serial_status locally
            if (res.data?.serial_status) {
              applyLocalUpdate(id, { serial_status: res.data.serial_status });
            }
          } catch (e) {
            console.error(e);
          }
          break;
        default:
          break;
      }
    },
    [onAction, applyLocalUpdate, orders],
  );

  /* ── Boot screen ── */
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
                    <th className="ot-col-hide-sm">Status</th>
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

                        {/* Payment + UTR */}
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

                        {/* Delivery */}
                        <td>
                          <DeliveryCell
                            order={order}
                            onPushed={(orderId, waybill) => {
                              setPushedAwbs((p) => ({
                                ...p,
                                [orderId]: waybill,
                              }));
                              applyLocalUpdate(orderId, {
                                awb_number: waybill,
                                delivery_status: "SHIPPED",
                              });
                              onAction && onAction(orderId, "refresh");
                            }}
                          />
                        </td>

                        {/* Status — auto-derived */}
                        <td className="ot-col-hide-sm">
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                            }}
                          >
                            <LifecycleBadge order={order} />
                            <SerialBadge status={order.serial_status} />
                          </div>
                        </td>

                        {/* Invoice */}
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

      {/* ── Footer: count + sync indicator ── */}
      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          color: "var(--text3)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>
          Showing {Math.min(visibleRows.length, deduped.length)} of{" "}
          {deduped.length} filtered
          {orders.length !== deduped.length ? ` (${orders.length} total)` : ""}
        </span>
        <SyncIndicator syncing={syncing} lastSync={lastSync} />
      </div>

      {activeOrder && (
        <OrderLightbox
          order={activeOrder}
          details={detailsCache[activeOrder.order_id]}
          loading={loadingDetails[activeOrder.order_id]}
          invoiceLoading={invoiceLoading[activeOrder.order_id]}
          onClose={() => setActiveOrder(null)}
          onAction={handleAction}
        />
      )}
    </div>
  );
}
