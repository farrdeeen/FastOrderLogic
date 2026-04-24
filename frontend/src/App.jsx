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

// How many orders to fetch per batch. Larger = fewer round trips.
const PAGE_SIZE = 300;

export default function App() {
  const { isLoaded, isSignedIn } = useAuth();

  // ── Orders state ──────────────────────────────────────────────────────────
  const [orders, setOrders] = useState([]);

  // true only during the very first fetch after a filter change
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // true while background pages are still streaming in
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // total row estimate from /count endpoint (optional, for progress hint)
  const [totalEstimate, setTotalEstimate] = useState(null);

  const [syncing, setSyncing] = useState(false);

  const [filters, setFilters] = useState({
    search: "",
    payment_status: "",
    delivery_status: "",
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

  const refreshTimer = useRef(null);

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

  // ── Core fetch: streams ALL pages, then clears the loading flags ONCE ─────
  //
  // Strategy:
  //   1. Mark isInitialLoading=true  → BootScreen shows
  //   2. Fetch page 0               → setOrders (replaces stale data)
  //   3. Mark isInitialLoading=false, isLoadingMore=true
  //      → BootScreen still shows because OrdersTable checks BOTH flags
  //   4. Stream remaining pages     → accumulate in a local array, then
  //      do ONE setOrders call at the end so React never re-renders mid-stream
  //   5. Mark isLoadingMore=false   → table appears, fully loaded, zero flicker
  //
  const fetchAllOrders = useCallback(async (activeFilters) => {
    // Stamp this run; any previous run that's still awaiting will bail out
    const run = ++fetchRunRef.current;

    setIsInitialLoading(true);
    setIsLoadingMore(false);
    setOrders([]);
    setTotalEstimate(null);

    // Fire a fast count query in parallel so the boot screen can show
    // a realistic total (non-blocking — we don't await it before fetching)
    api
      .get("/orders/count", { params: activeFilters })
      .then((r) => {
        if (fetchRunRef.current === run)
          setTotalEstimate(r.data?.count ?? null);
      })
      .catch(() => {});

    try {
      // ── Page 0 ──
      const first = await api.get("/orders", {
        params: { ...activeFilters, limit: PAGE_SIZE, offset: 0 },
      });
      if (fetchRunRef.current !== run) return; // stale, abort

      const firstBatch = first.data || [];
      const accumulated = [...firstBatch];

      // Switch: initial done, background streaming starts
      // Both flags are set in one synchronous block so React batches them
      // and the BootScreen condition (isBusy = initial || loadingMore) stays
      // true without a gap — the table never flashes.
      setIsInitialLoading(false);

      if (firstBatch.length < PAGE_SIZE) {
        // Got everything in one page — done
        setOrders(accumulated);
        setIsLoadingMore(false);
        return;
      }

      setIsLoadingMore(true);

      // ── Remaining pages ──
      let offset = PAGE_SIZE;
      while (true) {
        if (fetchRunRef.current !== run) return; // filter changed, abort

        const res = await api.get("/orders", {
          params: { ...activeFilters, limit: PAGE_SIZE, offset },
        });
        if (fetchRunRef.current !== run) return;

        const batch = res.data || [];
        accumulated.push(...batch);

        // Update the count hint so the boot screen shows progress
        // (We update orders here too so if the parent ever un-gates early
        //  it shows real data — currently kept behind the boot screen)
        setOrders([...accumulated]);

        if (batch.length < PAGE_SIZE) break; // last page
        offset += PAGE_SIZE;
      }

      if (fetchRunRef.current !== run) return;

      // Final single commit — marks the table as ready
      setOrders(accumulated);
    } catch (err) {
      console.error("fetchAllOrders error:", err);
      if (fetchRunRef.current === run) {
        setIsInitialLoading(false);
      }
    } finally {
      if (fetchRunRef.current === run) {
        setIsLoadingMore(false);
      }
    }
  }, []); // no deps — receives filters as argument to avoid stale closures

  // Re-fetch whenever filters or page changes
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (activePage !== "orders") return;
    fetchAllOrders(filters);
  }, [filters, activePage, isLoaded, isSignedIn, fetchAllOrders]);

  // ── Background refresh (lightweight, doesn't affect loading flags) ────────
  const backgroundRefresh = useCallback(async () => {
    try {
      const res = await api.get("/orders", {
        params: { limit: PAGE_SIZE, offset: 0 },
      });
      // Merge only the first page silently — keeps the list fresh
      // without triggering the boot screen
      setOrders((prev) => {
        const updated = res.data || [];
        const updatedIds = new Set(updated.map((o) => o.order_id));
        // Replace updated rows, keep the rest
        const merged = prev.map((o) =>
          updatedIds.has(o.order_id)
            ? updated.find((u) => u.order_id === o.order_id)
            : o,
        );
        return merged;
      });
    } catch (err) {
      console.error("backgroundRefresh error:", err);
    }
  }, []);

  const scheduleBackgroundRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(backgroundRefresh, 1200);
  }, [backgroundRefresh]);

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

  // ── Local optimistic update ───────────────────────────────────────────────
  const updateOrderLocal = (id, updater) => {
    setOrders((prev) =>
      prev.map((o) => (o.order_id === id ? { ...o, ...updater(o) } : o)),
    );
  };

  // ── Action handler ────────────────────────────────────────────────────────
  const handleAction = async (orderId, action, payload) => {
    try {
      if (action === "mark-paid-utr") {
        updateOrderLocal(orderId, () => ({
          payment_status: "paid",
          utr_number: payload,
        }));
        await api.put(`/orders/${encodeURIComponent(orderId)}/mark-paid-utr`, {
          utr_number: payload,
        });
        scheduleBackgroundRefresh();
        return;
      }

      if (action === "update-delivery") {
        updateOrderLocal(orderId, () => ({ delivery_status: payload }));
        await api.put(
          `/orders/${encodeURIComponent(orderId)}/update-delivery`,
          {
            status: payload,
          },
        );
        scheduleBackgroundRefresh();
        return;
      }

      if (action === "toggle-payment") {
        updateOrderLocal(orderId, (o) => ({
          payment_status: o.payment_status === "paid" ? "pending" : "paid",
        }));
        await api.put(`/orders/${encodeURIComponent(orderId)}/toggle-payment`);
        scheduleBackgroundRefresh();
        return;
      }

      if (action === "create-invoice") {
        setInvoiceLoading((prev) => ({ ...prev, [orderId]: true }));
        try {
          await api.post(`/zoho/invoice/${encodeURIComponent(orderId)}`);
          alert("✅ Invoice created successfully");
          scheduleBackgroundRefresh();
        } catch (err) {
          console.error(err);
          alert("❌ Invoice creation failed");
        } finally {
          setInvoiceLoading((prev) => ({ ...prev, [orderId]: false }));
        }
        return;
      }

      if (action === "download-invoice") {
        window.open(
          `${API_URL}/zoho/orders/${encodeURIComponent(orderId)}/invoice/print`,
        );
        return;
      }

      if (action === "update-remarks") {
        updateOrderLocal(orderId, () => ({ remarks: payload }));
        await api.put(`/orders/${encodeURIComponent(orderId)}/remarks`, {
          remarks: payload,
        });
        scheduleBackgroundRefresh();
        return;
      }

      if (action === "serial-status-updated") {
        updateOrderLocal(orderId, () => ({ serial_status: payload }));
        return;
      }

      if (action === "delete-order") {
        if (!window.confirm("Delete this order?")) return;
        await api.delete(`/orders/${encodeURIComponent(orderId)}`);
        setOrders((prev) => prev.filter((o) => o.order_id !== orderId));
        return;
      }
    } catch (err) {
      console.error(err);
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

  // ── Derived count shown in the boot screen ────────────────────────────────
  const loadedCount = orders.length;

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

                {/*
                  OrdersTable is ALWAYS mounted while on the orders page.
                  It owns the boot screen internally — no CircularProgress
                  wrapper here, which was the main source of flicker.
                */}
                <OrdersTable
                  orders={orders}
                  filters={filters}
                  onAction={handleAction}
                  isInitialLoading={isInitialLoading}
                  isLoadingMore={isLoadingMore}
                  loadedCount={loadedCount}
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
