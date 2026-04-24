import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";

import { useEffect, useRef, useState, useCallback } from "react";
import api from "./api/axiosInstance";
import { useAuth } from "@clerk/clerk-react";
import OrdersTable from "./components/orders";
import SearchBar from "./components/SearchBar";
import CreateOrderForm from "./components/CreateOrderForm";
import NavDrawer from "./components/NavDrawer";
import ChatPage from "./chat/ChatPage";
import DeviceTransactionForm from "./components/DeviceTransactionForm";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  Autocomplete,
  TextField,
  createFilterOptions,
  Box,
  Typography,
  CircularProgress,
  Button,
  Fade,
  Paper,
} from "@mui/material";

import CustomerForm from "./components/forms/CustomerForm";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// Orders per page — larger pages = fewer round-trips = faster total load.
// 500 is safe for MySQL + FastAPI; bump to 1000 if your server handles it.
const PAGE_SIZE = 500;

// How many pages to fetch in parallel after the first page arrives.
// 3 concurrent requests saturates a typical HTTP/1.1 connection pool without
// overwhelming the DB. Increase to 4–5 if you use HTTP/2 or a connection pool
// with more headroom.
const PARALLEL_PAGES = 3;

export default function App() {
  const { isLoaded, isSignedIn } = useAuth();

  // ── Orders state ──────────────────────────────────────────────────────────
  const [orders, setOrders] = useState([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalEstimate, setTotalEstimate] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // ── New unified filter shape (matches updated SearchBar) ──────────────────
  const [filters, setFilters] = useState({
    search: "",
    quick_status: "", // "payment_pending" | "shipping_pending" | "serial_pending" | "invoice_pending" | "complete" | ""
    channel: "",
    date_from: "",
    date_to: "",
  });

  const [activePage, setActivePage] = useState("orders");
  const [invoiceLoading, setInvoiceLoading] = useState({});

  // dropdown / form state
  const [productList, setProductList] = useState([]);
  const [customerList, setCustomerList] = useState([]);
  const [statesList, setStatesList] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [addressList, setAddressList] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);

  // Keep a ref to the current fetch run so stale async chains can abort
  const fetchRunRef = useRef(0);

  // ── Filter helpers ────────────────────────────────────────────────────────
  const customerFilter = createFilterOptions({
    stringify: (o) => `${o.name} ${o.type} ${o.mobile ?? ""}`.toLowerCase(),
  });

  const pageTitle = {
    orders: "📦 Orders Management",
    chat: "💬 Chat Support",
    "create-order": "🆕 Create New Order",
    "device-entry": "Bulk Device In/Out",
  }[activePage];

  // ── Core fetch: page 0 + parallel remaining pages ─────────────────────────
  //
  // SPEED IMPROVEMENTS vs original sequential approach:
  //
  // 1. PAGE_SIZE bumped 300 → 500: fewer pages to fetch, fewer round-trips.
  //
  // 2. Count and page-0 fire in PARALLEL (Promise.allSettled) instead of
  //    sequentially — saves one full network round-trip before first render.
  //
  // 3. Remaining pages fetched CONCURRENTLY in sliding windows of PARALLEL_PAGES
  //    instead of one-at-a-time. For 30k orders at 500/page = 60 pages total:
  //      • Old: 60 sequential requests ≈ 60 × RTT overhead
  //      • New: ceil(60/3) = 20 parallel batches ≈ 20 × RTT overhead
  //    This alone is a 3× reduction in elapsed streaming time.
  //
  // 4. State is set once per parallel batch (not per page) to reduce re-renders.
  //
  // The API-level filters (channel, date_from, date_to) are still passed through.
  // quick_status / search remain client-side only.
  // ─────────────────────────────────────────────────────────────────────────
  const fetchAllOrders = useCallback(async (activeFilters) => {
    const run = ++fetchRunRef.current;

    setIsInitialLoading(true);
    setIsLoadingMore(false);
    setOrders([]);
    setTotalEstimate(null);

    // Build API-level params (omit client-side-only fields)
    const apiParams = {
      channel: activeFilters.channel || undefined,
      date_from: activeFilters.date_from || undefined,
      date_to: activeFilters.date_to || undefined,
    };

    // ── Fire count + page-0 in parallel ──────────────────────────────────
    const [countResult, page0Result] = await Promise.allSettled([
      api.get("/orders/count", { params: apiParams }),
      api.get("/orders", {
        params: { ...apiParams, limit: PAGE_SIZE, offset: 0 },
      }),
    ]);

    if (fetchRunRef.current !== run) return;

    // Apply count hint
    if (countResult.status === "fulfilled") {
      setTotalEstimate(countResult.value.data?.count ?? null);
    }

    // If page-0 failed, bail out
    if (page0Result.status === "rejected") {
      console.error("fetchAllOrders page-0 error:", page0Result.reason);
      setIsInitialLoading(false);
      return;
    }

    const firstBatch = page0Result.value.data || [];
    setIsInitialLoading(false);

    // All data arrived in one page — done
    if (firstBatch.length < PAGE_SIZE) {
      setOrders(firstBatch);
      setIsLoadingMore(false);
      return;
    }

    setIsLoadingMore(true);

    // ── Remaining pages — concurrent sliding window ───────────────────────
    // We don't know total pages upfront, so we fetch PARALLEL_PAGES at a
    // time, stop when any page returns fewer than PAGE_SIZE rows.
    const accumulated = [...firstBatch];
    let offset = PAGE_SIZE;
    let done = false;

    while (!done) {
      if (fetchRunRef.current !== run) return;

      // Build a batch of up to PARALLEL_PAGES concurrent requests
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

      // Merge results in page-index order to keep created_at DESC ordering
      for (const result of results) {
        if (!result.ok) {
          console.error("fetchAllOrders page error:", result.err);
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

      // Single state update per batch — much fewer re-renders
      if (fetchRunRef.current === run) {
        setOrders([...accumulated]);
      }
    }

    if (fetchRunRef.current !== run) return;
    setOrders(accumulated);
    setIsLoadingMore(false);
  }, []);

  // Re-fetch when API-level filters or page change
  // quick_status / search are client-side so DON'T trigger a re-fetch
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (activePage !== "orders") return;
    fetchAllOrders(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Only API-level filter fields trigger a re-fetch
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

      if (newEntries.length === 0) {
        return Array.from(map.values());
      }

      return [...newEntries, ...Array.from(map.values())];
    });
  }, []);

  // ── Dropdowns ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activePage !== "create-order") return;
    api
      .get("/dropdowns/products/list")
      .then((r) => setProductList(r.data || []));
    api
      .get("/dropdowns/customers/list")
      .then((r) => setCustomerList(r.data || []));
    api.get("/states/list").then((r) => setStatesList(r.data || []));
  }, [activePage]);

  // ── Customer → Address ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCustomer) {
      setAddressList([]);
      setSelectedAddressId(null);
      return;
    }
    const [type, id] = selectedCustomer.split(":");
    api
      .get(`/customers/${type}/${id}/addresses`)
      .then((res) => {
        setAddressList(res.data || []);
        setSelectedAddressId(null);
      })
      .catch((err) => {
        console.error("Failed to load addresses", err);
        setAddressList([]);
      });
  }, [selectedCustomer]);

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
        // ── Payment ──
        case "mark-paid":
          await api.put(`/orders/${encodeURIComponent(orderId)}/mark-paid`);
          break;

        case "mark-paid-utr":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/mark-paid-utr`,
            {
              utr_number: payload,
            },
          );
          break;

        case "toggle-payment":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/toggle-payment`,
          );
          break;

        // ── Delivery ──
        case "update-delivery":
          await api.put(
            `/orders/${encodeURIComponent(orderId)}/update-delivery`,
            {
              status: payload,
            },
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
            {
              awb: payload,
            },
          );
          break;

        // ── AWB / Invoice number ──
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

        // ── Invoice create (Zoho) ──
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

        // ── Download ──
        case "download-invoice":
          window.open(
            `${API_URL}/zoho/orders/${encodeURIComponent(orderId)}/invoice/print`,
          );
          return;

        // ── Remarks ──
        case "update-remarks":
          await api.put(`/orders/${encodeURIComponent(orderId)}/remarks`, {
            remarks: payload,
          });
          break;

        // ── Serial status ──
        case "serial-status-updated":
          handleOrdersUpdate([{ order_id: orderId, serial_status: payload }]);
          return;

        // ── Reject ──
        case "reject":
          await api.put(`/orders/${encodeURIComponent(orderId)}/reject`);
          break;

        // ── Delete ──
        case "delete-order":
          if (!window.confirm("Delete this order?")) return;
          await api.delete(`/orders/${encodeURIComponent(orderId)}`);
          setOrders((prev) => prev.filter((o) => o.order_id !== orderId));
          return;

        // ── Refresh ──
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

  // ── Customer create ───────────────────────────────────────────────────────
  const refreshCustomersAfterCreate = async () => {
    const res = await api.get("/dropdowns/customers/list");
    const list = res.data || [];
    setCustomerList(list);
    if (list.length) {
      const last = list[list.length - 1];
      setSelectedCustomer(`${last.type}:${last.id}`);
    }
    setCustomerModalOpen(false);
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ================= SIGNED OUT ================= */}
      <SignedOut>
        <Box
          sx={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f9fafb",
          }}
        >
          <SignIn />
        </Box>
      </SignedOut>

      {/* ================= SIGNED IN ================= */}
      <SignedIn>
        <Box sx={{ display: "flex", fontFamily: "Inter, sans-serif" }}>
          <NavDrawer onNavigate={handleNavigate} />

          <Box
            component="main"
            sx={{ flexGrow: 1, p: 4, background: "#f9fafb" }}
          >
            {/* TOP BAR */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 3,
              }}
            >
              <Typography variant="h5" sx={{ fontWeight: 600 }}>
                {pageTitle}
              </Typography>
              <UserButton afterSignOutUrl="/" />
            </Box>

            {/* ================= ORDERS ================= */}
            <Fade in={activePage === "orders"} unmountOnExit>
              <Box>
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
                  Bulk in Out
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
              </Box>
            </Fade>

            {/* ================= CREATE ORDER ================= */}
            <Fade in={activePage === "create-order"} unmountOnExit>
              <Paper sx={{ p: 3, borderRadius: 3 }}>
                <Button
                  variant="outlined"
                  onClick={() => setActivePage("orders")}
                  sx={{ mb: 3 }}
                >
                  ⬅ Back to Orders
                </Button>

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                    gap: 2,
                    mb: 3,
                  }}
                >
                  <Autocomplete
                    freeSolo
                    options={productList.map((p) => ({
                      id: p.id,
                      label: p.name,
                    }))}
                    onChange={(e, v) => v && setSelectedProduct(v.id)}
                    renderInput={(params) => (
                      <TextField {...params} label="Search Product…" />
                    )}
                  />

                  <Autocomplete
                    options={customerList}
                    filterOptions={customerFilter}
                    getOptionLabel={(c) => `${c.name} (${c.type})`}
                    value={
                      customerList.find(
                        (c) => `${c.type}:${c.id}` === selectedCustomer,
                      ) || null
                    }
                    onChange={(e, v) =>
                      v
                        ? setSelectedCustomer(`${v.type}:${v.id}`)
                        : setSelectedCustomer("")
                    }
                    renderInput={(params) => (
                      <TextField {...params} label="Select Customer…" />
                    )}
                  />

                  {addressList.length > 0 && (
                    <Autocomplete
                      options={addressList}
                      getOptionLabel={(a) =>
                        `${a.address_line}, ${a.city} - ${a.pincode}`
                      }
                      value={
                        addressList.find(
                          (a) => a.address_id === selectedAddressId,
                        ) || null
                      }
                      onChange={(e, v) =>
                        setSelectedAddressId(v ? v.address_id : null)
                      }
                      renderInput={(params) => (
                        <TextField {...params} label="Select Address…" />
                      )}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 2,
                    background: "#f8fafc",
                    p: 2,
                    borderRadius: "12px",
                    mb: 3,
                  }}
                >
                  <Button variant="contained" sx={{ background: "#2563eb" }}>
                    Browse Products
                  </Button>
                  <Button
                    variant="contained"
                    sx={{ background: "#22c55e" }}
                    onClick={() => setCustomerModalOpen(true)}
                  >
                    ➕ Add Customer
                  </Button>
                </Box>

                <CreateOrderForm
                  onOrderCreated={() => {
                    setActivePage("orders");
                    fetchAllOrders(filters);
                  }}
                  selectedCustomer={selectedCustomer}
                  selectedProduct={selectedProduct}
                  selectedAddressId={selectedAddressId}
                />
              </Paper>
            </Fade>

            {/* ================= CHAT ================= */}
            <Fade in={activePage === "chat"} unmountOnExit>
              <ChatPage />
            </Fade>

            {/* ================= DEVICE ENTRY ================= */}
            <Fade in={activePage === "device-entry"} unmountOnExit>
              <Paper sx={{ p: 3, borderRadius: 3 }}>
                <Button
                  variant="outlined"
                  onClick={() => setActivePage("orders")}
                  sx={{ mb: 3 }}
                >
                  ⬅ Back to Orders
                </Button>
                <DeviceTransactionForm />
              </Paper>
            </Fade>

            {/* ================= CUSTOMER MODAL ================= */}
            <Dialog
              open={customerModalOpen}
              onClose={() => setCustomerModalOpen(false)}
              maxWidth="md"
              fullWidth
            >
              <DialogTitle>Create Customer</DialogTitle>
              <DialogContent>
                <CustomerForm
                  states={statesList}
                  onClose={() => setCustomerModalOpen(false)}
                  onSuccess={refreshCustomersAfterCreate}
                />
              </DialogContent>
            </Dialog>
          </Box>
        </Box>
      </SignedIn>
    </>
  );
}
