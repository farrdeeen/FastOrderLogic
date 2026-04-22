import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";

import { useEffect, useRef, useState, useCallback } from "react";
import api from "./api/axiosInstance";
import { useAuth } from "@clerk/clerk-react";
import OrdersTable from "./components/OrdersTable";
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

export default function App() {
  // ---------------- STATE ----------------
  const { isLoaded, isSignedIn } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
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

  const PAGE_SIZE = 50;

  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [invoiceLoading, setInvoiceLoading] = useState({});

  // dropdown data
  const [productList, setProductList] = useState([]);
  const [customerList, setCustomerList] = useState([]);
  const [statesList, setStatesList] = useState([]);

  // selections
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [addressList, setAddressList] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);

  // modals
  const [customerModalOpen, setCustomerModalOpen] = useState(false);

  // background refresh
  const refreshTimer = useRef(null);

  // ---------------- FILTER HELPERS ----------------
  const customerFilter = createFilterOptions({
    stringify: (o) => `${o.name} ${o.type} ${o.mobile ?? ""}`.toLowerCase(),
  });

  const pageTitle = {
    orders: "📦 Orders Management",
    chat: "💬 Chat Support",
    "create-order": "🆕 Create New Order",
    "device-entry": "Bulk Device In/Out",
  }[activePage];

  // ---------------- FETCH ORDERS ----------------
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/orders", {
        params: {
          ...filters,
          limit: PAGE_SIZE,
          offset: 0,
        },
      });
      const data = res.data || [];
      setOrders(data);
      setOffset(data.length);
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadMoreOrders = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.get("/orders", {
        params: {
          ...filters,
          limit: PAGE_SIZE,
          offset,
        },
      });
      const data = res.data || [];
      setOrders((prev) => [...prev, ...data]);
      setOffset((prev) => prev + data.length);
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }, [filters, hasMore, loadingMore, offset]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (activePage !== "orders") return;
    setOffset(0);
    setHasMore(true);
    fetchOrders();
  }, [filters, activePage, isLoaded, isSignedIn]); // fetchOrders intentionally excluded — it would cause a loop since it depends on filters too

  // ================= BACKGROUND PREFETCH =================
  useEffect(() => {
    if (activePage !== "orders") return;
    if (!hasMore) return;
    if (loadingMore) return;
    if (loading) return;

    const timer = setTimeout(() => {
      loadMoreOrders();
    }, 800);

    return () => clearTimeout(timer);
  }, [activePage, hasMore, loadingMore, loading, loadMoreOrders]);

  // ---------------- BACKGROUND REFRESH ----------------
  const backgroundRefresh = useCallback(async () => {
    const res = await api.get("/orders", {
      params: { limit: PAGE_SIZE, offset: 0 },
    });
    setOrders(res.data || []);
  }, []);

  const scheduleBackgroundRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(backgroundRefresh, 1200);
  }, [backgroundRefresh]);

  // ---------------- DROPDOWNS ----------------
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

  // ---------------- CUSTOMER → ADDRESS ----------------
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

  // ---------------- SYNC WIX ----------------
  const handleSyncWix = async () => {
    try {
      setSyncing(true);
      const res = await api.get("/sync/wix");
      alert(
        `Wix Sync Completed\nInserted: ${res.data.inserted}\nSkipped: ${res.data.skipped}`,
      );
      fetchOrders();
    } catch {
      alert("❌ Wix sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // ---------------- LOCAL UPDATE ----------------
  const updateOrderLocal = (id, updater) => {
    setOrders((prev) =>
      prev.map((o) => (o.order_id === id ? { ...o, ...updater(o) } : o)),
    );
  };

  // ---------------- ACTION HANDLER ----------------
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

  // ---------------- CUSTOMER CREATE ----------------
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

  // ---------------- UI ----------------
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

                {/* SearchBar owns the toolbar UI; filters flow down to OrdersTable */}
                <SearchBar filters={filters} setFilters={setFilters} />

                {loading ? (
                  <CircularProgress sx={{ mt: 4 }} />
                ) : (
                  <OrdersTable
                    orders={orders}
                    filters={filters}
                    onAction={handleAction}
                    onLoadMore={loadMoreOrders}
                    hasMore={hasMore}
                    isLoadingMore={loadingMore}
                    invoiceLoading={invoiceLoading}
                  />
                )}
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
                    fetchOrders();
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
