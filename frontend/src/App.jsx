import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";

import { useEffect, useRef, useState, useCallback } from "react";
import api from "./api/axiosInstance";
import { useAuth } from "@clerk/clerk-react";
import OrdersTable from "./components/orders";
import SearchBar from "./components/SearchBar";
import NavDrawer from "./components/NavDrawer";
import ChatPage from "./chat/ChatPage";
import DeviceTransactionForm from "./components/DeviceTransactionForm";

// ── Forms now live in components/forms/ ──────────────────────────────────────
import CreateOrderForm from "./components/forms/CreateOrderForm";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  Button,
  Fade,
  Paper,
} from "@mui/material";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const PAGE_SIZE = 500;
const PARALLEL_PAGES = 3;

export default function App() {
  const { isLoaded, isSignedIn } = useAuth();

  // ── Orders state ──────────────────────────────────────────────────────────
  const [orders, setOrders] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalEstimate, setTotalEstimate] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [filters, setFilters] = useState({
    search: "",
    quick_status: "",
    channel: "",
    date_from: "",
    date_to: "",
  });

  const [activePage, setActivePage] = useState("orders");
  const [invoiceLoading, setInvoiceLoading] = useState({});

  const fetchRunRef = useRef(0);

  const pageTitle = {
    orders: "📦 Orders Management",
    chat: "💬 Chat Support",
    "create-order": "🆕 Create New Order",
    "device-entry": "Bulk Device In/Out",
  }[activePage];

  // ── Core fetch: parallel count + page-0, then concurrent batches ──────────
  const fetchAllOrders = useCallback(async (activeFilters) => {
    const run = ++fetchRunRef.current;

    setIsInitialLoading(true);
    setIsLoadingMore(false);
    setOrders([]);
    setTotalEstimate(null);

    const apiParams = {
      channel: activeFilters.channel || undefined,
      date_from: activeFilters.date_from || undefined,
      date_to: activeFilters.date_to || undefined,
    };

    const [countResult, page0Result] = await Promise.allSettled([
      api.get("/orders/count", { params: apiParams }),
      api.get("/orders", {
        params: { ...apiParams, limit: PAGE_SIZE, offset: 0 },
      }),
    ]);

    if (fetchRunRef.current !== run) return;

    if (countResult.status === "fulfilled") {
      setTotalEstimate(countResult.value.data?.count ?? null);
    }
    if (page0Result.status === "rejected") {
      console.error("fetchAllOrders page-0 error:", page0Result.reason);
      setIsInitialLoading(false);
      return;
    }

    const firstBatch = page0Result.value.data || [];
    setIsInitialLoading(false);

    if (firstBatch.length < PAGE_SIZE) {
      setOrders(firstBatch);
      setIsLoadingMore(false);
      return;
    }

    setIsLoadingMore(true);
    const accumulated = [...firstBatch];
    let offset = PAGE_SIZE;
    let done = false;

    while (!done) {
      if (fetchRunRef.current !== run) return;

      const batch = [];
      for (let i = 0; i < PARALLEL_PAGES; i++) {
        batch.push(
          api
            .get("/orders", {
              params: {
                ...apiParams,
                limit: PAGE_SIZE,
                offset: offset + i * PAGE_SIZE,
              },
            })
            .then((r) => ({ ok: true, data: r.data || [], pageIndex: i }))
            .catch((err) => ({ ok: false, err, pageIndex: i })),
        );
      }

      const results = await Promise.all(batch);
      if (fetchRunRef.current !== run) return;

      for (const result of results) {
        if (!result.ok) {
          done = true;
          break;
        }
        accumulated.push(...result.data);
        if (result.data.length < PAGE_SIZE) {
          done = true;
          break;
        }
      }

      offset += PARALLEL_PAGES * PAGE_SIZE;
      if (fetchRunRef.current === run) setOrders([...accumulated]);
    }

    if (fetchRunRef.current !== run) return;
    setOrders(accumulated);
    setIsLoadingMore(false);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (activePage !== "orders") return;
    fetchAllOrders(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.channel,
    filters.date_from,
    filters.date_to,
    activePage,
    isLoaded,
    isSignedIn,
    fetchAllOrders,
  ]);

  // ── Delta / optimistic merge ──────────────────────────────────────────────
  const handleOrdersUpdate = useCallback((changedOrders) => {
    setOrders((prev) => {
      const map = new Map(prev.map((o) => [o.order_id, o]));
      const newEntries = [];
      for (const changed of changedOrders) {
        if (map.has(changed.order_id)) {
          map.set(changed.order_id, {
            ...map.get(changed.order_id),
            ...changed,
          });
        } else {
          newEntries.push(changed);
        }
      }
      if (newEntries.length === 0) return Array.from(map.values());
      return [...newEntries, ...Array.from(map.values())];
    });
  }, []);

  // ── Sync Wix ──────────────────────────────────────────────────────────────
  const handleSyncWix = async () => {
    try {
      setSyncing(true);
      const res = await api.get("/sync/wix");
      alert(
        `Wix Sync Completed\nInserted: ${res.data.inserted}\nSkipped: ${res.data.skipped}`,
      );
      fetchAllOrders(filters);
    } catch {
      alert("❌ Wix sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // ── Action handler ────────────────────────────────────────────────────────
  const handleAction = async (orderId, action, payload) => {
    try {
      switch (action) {
        case "mark-paid":
          await api.put(`/orders/${encodeURIComponent(orderId)}/mark-paid`);
          break;
        case "mark-paid-utr":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/mark-paid-utr`,
            { utr_number: payload },
          );
          break;
        case "toggle-payment":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/toggle-payment`,
          );
          break;
        case "update-delivery":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/update-delivery`,
            { status: payload },
          );
          break;
        case "mark-fulfilled":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/mark-fulfilled`,
          );
          break;
        case "mark-delhivery":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/mark-delhivery`,
            { awb: payload },
          );
          break;
        case "update-awb":
          await api.put(`/orders/${encodeURIComponent(orderId)}/update-awb`, {
            awb_number: payload,
          });
          break;
        case "update-invoice-number":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/update-invoice-number`,
            { invoice_number: payload },
          );
          break;
        case "create-invoice":
          setInvoiceLoading((prev) => ({ ...prev, [orderId]: true }));
          try {
            const res = await api.post(
              `/zoho/invoice/${encodeURIComponent(orderId)}`,
            );
            alert("✅ Invoice created successfully");
            if (res.data?.invoice_number) {
              handleOrdersUpdate([
                { order_id: orderId, invoice_number: res.data.invoice_number },
              ]);
            }
          } catch (err) {
            console.error(err);
            alert("❌ Invoice creation failed");
          } finally {
            setInvoiceLoading((prev) => ({ ...prev, [orderId]: false }));
          }
          return;
        case "download-invoice":
          window.open(
            `${API_URL}/zoho/orders/${encodeURIComponent(orderId)}/invoice/print`,
          );
          return;
        case "update-remarks":
          await api.put(`/orders/${encodeURIComponent(orderId)}/remarks`, {
            remarks: payload,
          });
          break;
        case "serial-status-updated":
          handleOrdersUpdate([{ order_id: orderId, serial_status: payload }]);
          return;
        case "reject":
          await api.put(`/orders/${encodeURIComponent(orderId)}/reject`);
          break;
        case "delete-order":
          if (!window.confirm("Delete this order?")) return;
          await api.delete(`/orders/${encodeURIComponent(orderId)}`);
          setOrders((prev) => prev.filter((o) => o.order_id !== orderId));
          return;
        case "refresh":
          return;
        default:
          console.warn("Unknown action:", action);
          return;
      }
    } catch (err) {
      console.error(`Action "${action}" failed for ${orderId}:`, err);
      alert("❌ Action failed");
    }
  };

  const handleNavigate = (section) => {
    if (section === "logout") return alert("Logging out…");
    setActivePage(section);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ═════════════ SIGNED OUT ═════════════ */}
      <SignedOut>
        <Box
          sx={{
            flexGrow: 1,

            p: 2, // reduce padding (important)

            background: "#f7f6f3",

            height: "100vh",

            overflow: "hidden", // 🔥 CRITICAL

            display: "flex",

            flexDirection: "column",
          }}
        >
          <SignIn />
        </Box>
      </SignedOut>

      {/* ═════════════ SIGNED IN ═════════════ */}
      <SignedIn>
        <Box sx={{ display: "flex", fontFamily: "IBM Plex Sans, sans-serif" }}>
          <NavDrawer onNavigate={handleNavigate} />

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              p: 4,
              background: "#f7f6f3",
              minHeight: "100vh",
            }}
          >
            {/* TOP BAR */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 1,
              }}
            >
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 600,
                  fontFamily: "IBM Plex Sans, sans-serif",
                }}
              >
                {pageTitle}
              </Typography>
              <UserButton afterSignOutUrl="/" />
            </Box>

            {/* ═══════════ ORDERS PAGE ═══════════ */}
            <Fade in={activePage === "orders"} mountOnEnter unmountOnExit>
              <div>
                <Button
                  variant="contained"
                  onClick={handleSyncWix}
                  disabled={syncing}
                  sx={{ mb: 2 }}
                >
                  {syncing ? "Syncing..." : "🔄 Sync Wix Orders"}
                </Button>
                <Button
                  variant="contained"
                  sx={{ mb: 2, ml: 2 }}
                  onClick={() => setActivePage("create-order")}
                >
                  ➕ Create Order
                </Button>
                <Button
                  variant="contained"
                  sx={{ mb: 2, ml: 4 }}
                  onClick={() => setActivePage("device-entry")}
                >
                  Bulk In/Out
                </Button>

                <SearchBar filters={filters} setFilters={setFilters} />

                <OrdersTable
                  orders={orders}
                  filters={filters}
                  onAction={handleAction}
                  onOrdersUpdate={handleOrdersUpdate}
                  isInitialLoading={isInitialLoading}
                  isLoadingMore={isLoadingMore}
                  loadedCount={orders.length}
                  totalEstimate={totalEstimate}
                  invoiceLoading={invoiceLoading}
                />
              </div>
            </Fade>

            {/* ═══════════ CREATE ORDER PAGE ═══════════ */}
            <Fade in={activePage === "create-order"} mountOnEnter unmountOnExit>
              <div style={{ flex: 1, minHeight: 0 }}>
                {/*
                  CreateOrderForm now owns its header with Back / Browse / Add Customer.
                  No wrapper buttons needed here — keeps App.jsx clean and avoids
                  any layout that would trigger vertical scroll.
                */}
                <CreateOrderForm
                  onOrderCreated={() => {
                    setActivePage("orders");
                    fetchAllOrders(filters);
                  }}
                  onBack={() => setActivePage("orders")}
                />
              </div>
            </Fade>

            {/* ═══════════ CHAT PAGE ═══════════ */}
            <div style={{ display: activePage === "chat" ? "block" : "none" }}>
              {activePage === "chat" && <ChatPage />}
            </div>

            {/* ═══════════ DEVICE ENTRY PAGE ═══════════ */}
            <Fade in={activePage === "device-entry"} mountOnEnter unmountOnExit>
              <div>
                <Paper sx={{ p: 3, borderRadius: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => setActivePage("orders")}
                    sx={{ mb: 3 }}
                  >
                    ⬅ Back to Orders
                  </Button>
                  <DeviceTransactionForm />
                </Paper>
              </div>
            </Fade>
          </Box>
        </Box>
      </SignedIn>
    </>
  );
}
