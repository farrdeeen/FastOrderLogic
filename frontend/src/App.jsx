import { useEffect, useState } from "react";
import axios from "axios";

import OrdersTable from "./components/OrdersTable";
import SearchBar from "./components/SearchBar";
import CreateOrderForm from "./components/CreateOrderForm";
import NavDrawer from "./components/NavDrawer";
import ChatPage from "./components/chat/ChatPage";
import { Autocomplete, TextField, createFilterOptions } from "@mui/material";

import {
  Box,
  Typography,
  CircularProgress,
  Button,
  Fade,
  Paper,
} from "@mui/material";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  // ==========================
  // STATE
  // ==========================
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

  // NEW STATES FOR CREATE ORDER PAGE
  const [productList, setProductList] = useState([]);
  const [customerList, setCustomerList] = useState([]);

  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");

  const customerFilter = createFilterOptions({
    stringify: (option) =>
      `${option.name} ${option.type} ${option.mobile ?? ""}`.toLowerCase(),
  });

  // PAGE TITLES
  const pageTitle = {
    dashboard: "📊 Dashboard Overview",
    orders: "📦 Orders Management",
    payments: "💰 Payment Summary",
    settings: "⚙️ Settings",
    chat: "💬 Chat Support",
    "create-order": "🆕 Create New Order",
  }[activePage];

  // ==========================
  // FETCH ORDERS
  // ==========================
  useEffect(() => {
    if (activePage === "orders") fetchOrders();
  }, [filters, activePage]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/orders`, { params: filters });
      setOrders(res.data);
    } catch (err) {
      console.error("Fetch orders error:", err);
    } finally {
      setLoading(false);
    }
  };

  // ==========================
  // LOAD DROPDOWNS FOR CREATE ORDER PAGE
  // ==========================
  useEffect(() => {
    if (activePage === "create-order") {
      axios
        .get(`${API_URL}/dropdowns/products/list`)
        .then((res) => setProductList(res.data))
        .catch((err) => console.error("Product load err:", err));

      axios
        .get(`${API_URL}/dropdowns/customers/list`)
        .then((res) => setCustomerList(res.data))
        .catch((err) => console.error("Customer load err:", err));
    }
  }, [activePage]);

  // ==========================
  // SYNC WIX
  // ==========================
  const handleSyncWix = async () => {
    try {
      setSyncing(true);
      const res = await axios.get(`${API_URL}/sync/wix`);

      alert(
        `🔄 Wix Sync Completed\nInserted: ${res.data.inserted}\nSkipped: ${res.data.skipped}`
      );

      fetchOrders();
    } catch (err) {
      console.error("Wix sync error:", err);
      alert("❌ Wix sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // ==========================
  // ZOHO INVOICE CREATION
  // ==========================
  const handleCreateInvoice = async (order) => {
    try {
      const res = await axios.post(`${API_URL}/zoho/invoice`, order);
      alert("🧾 Invoice created successfully in Zoho Books!");
      console.log("Zoho Invoice:", res.data);
      fetchOrders();
    } catch (err) {
      console.error("Zoho Invoice Error:", err);
      alert("❌ Failed to create invoice");
    }
  };

  // ==========================
  // GENERIC ORDER ACTION HANDLER
  // ==========================
  const handleOrderAction = async (orderId, action) => {
    try {
      // Skip update-delivery (handled separately)
      if (action === "update-delivery") return;

      await axios.put(
        `${API_URL}/orders/${encodeURIComponent(orderId)}/${action}`
      );

      fetchOrders();
    } catch (err) {
      console.error("Order action error:", err);
      alert("❌ Action failed");
    }
  };

  // ==========================
  // MASTER ACTION ROUTER (FIXED!)
  // ==========================
  const handleAction = async (orderId, action, payload) => {
    try {
      // Delivery status update
      if (action === "update-delivery") {
        await axios.put(`${API_URL}/orders/${orderId}/update-delivery`, {
          status: payload,
        });
        fetchOrders();
        return;
      }

      // Invoice creation requires passing the whole order
      if (action === "create-invoice") {
        const order = orders.find((o) => o.order_id === orderId);
        return handleCreateInvoice(order);
      }

      // Download invoice
      if (action === "download-invoice") {
        window.open(`${API_URL}/zoho/orders/${orderId}/invoice/download`);
        return;
      }

      // Default: toggle payment and others
      await handleOrderAction(orderId, action);
    } catch (err) {
      console.error("Action Error:", err);
      alert("❌ Action failed");
    }
  };

  // ==========================
  // NAVIGATION
  // ==========================
  const handleNavigate = (section) => {
    if (section === "logout") {
      alert("Logging out…");
      return;
    }
    setActivePage(section);
  };

  // ==========================
  // RENDER UI
  // ==========================
  return (
    <Box sx={{ display: "flex", fontFamily: "Inter, sans-serif" }}>
      {/* SIDEBAR */}
      <NavDrawer onNavigate={handleNavigate} />

      {/* MAIN PANEL */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 4 },
          backgroundColor: "#f9fafb",
          minHeight: "100vh",
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
          {pageTitle}
        </Typography>

        {/* ========================== */}
        {/* ORDERS PAGE */}
        {/* ========================== */}
        <Fade in={activePage === "orders"} timeout={300} unmountOnExit>
          <Box>
            {/* SYNC WIX */}
            <Button
              variant="contained"
              onClick={handleSyncWix}
              disabled={syncing}
              sx={{
                backgroundColor: "#020202ff",
                mb: 2,
                px: 3,
                py: 1,
                borderRadius: "8px",
                fontWeight: 600,
                textTransform: "none",
              }}
            >
              {syncing ? "Syncing..." : "🔄 Sync Wix Orders"}
            </Button>

            {/* CREATE ORDER */}
            <Button
              variant="contained"
              onClick={() => setActivePage("create-order")}
              sx={{
                backgroundColor: "#000000ff",
                mb: 2,
                ml: 2,
                px: 3,
                py: 1,
                borderRadius: "8px",
                fontWeight: 600,
                textTransform: "none",
              }}
            >
              ➕ Create Order
            </Button>

            {/* SEARCH */}
            <SearchBar filters={filters} setFilters={setFilters} />

            {/* TABLE / LOADER */}
            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <OrdersTable orders={orders} onAction={handleAction} />
            )}
          </Box>
        </Fade>

        {/* ========================== */}
        {/* CREATE ORDER PAGE */}
        {/* ========================== */}
        <Fade in={activePage === "create-order"} timeout={300} unmountOnExit>
          <Paper sx={{ p: 3, borderRadius: 3 }}>
            {/* BACK BUTTON */}
            <Button
              variant="outlined"
              onClick={() => setActivePage("orders")}
              sx={{
                mb: 3,
                textTransform: "none",
                borderRadius: "8px",
                fontWeight: 600,
                backgroundColor: "#f3f4f6",
              }}
            >
              ⬅ Back to Orders
            </Button>

            {/* PRODUCT + CUSTOMER DROPDOWNS */}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: 2,
                mb: 3,
              }}
            >
              {/* PRODUCT SEARCH */}
              <Autocomplete
                freeSolo
                options={productList.map((p) => ({
                  id: p.id,
                  label: p.name,
                }))}
                onChange={(e, value) => {
                  if (value) setSelectedProduct(value.id);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Search Product…"
                    placeholder="Type to search products"
                    variant="outlined"
                    sx={{ background: "white", borderRadius: 1 }}
                  />
                )}
              />

              {/* CUSTOMER SEARCH */}
              <Autocomplete
                options={customerList}
                filterOptions={customerFilter}
                getOptionLabel={(c) => `${c.name} (${c.type})`}
                value={
                  customerList.find(
                    (c) => `${c.type}:${c.id}` === selectedCustomer
                  ) || null
                }
                onChange={(e, newValue) => {
                  if (newValue) {
                    setSelectedCustomer(`${newValue.type}:${newValue.id}`);
                  } else {
                    setSelectedCustomer("");
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Customer…"
                    size="small"
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        borderRadius: "8px",
                      },
                    }}
                  />
                )}
                sx={{ width: "100%" }}
              />
            </Box>

            {/* ACTION BUTTONS */}
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
              <Button
                variant="contained"
                sx={{
                  background: "#2563eb",
                  borderRadius: "8px",
                  textTransform: "none",
                  fontWeight: 600,
                }}
              >
                Browse Products
              </Button>

              <Button
                variant="contained"
                sx={{
                  background: "#22c55e",
                  borderRadius: "8px",
                  textTransform: "none",
                  fontWeight: 600,
                }}
              >
                Select Customer
              </Button>
            </Box>

            {/* ORDER FORM */}
            <CreateOrderForm
              onOrderCreated={() => setActivePage("orders")}
              selectedCustomer={selectedCustomer}
              selectedProduct={selectedProduct}
            />
          </Paper>
        </Fade>

        {/* OTHER PAGES */}
        <Fade in={activePage === "payments"} timeout={200} unmountOnExit>
          <Typography>Payment logs will appear here.</Typography>
        </Fade>

        <Fade in={activePage === "settings"} timeout={200} unmountOnExit>
          <Typography>Settings coming soon.</Typography>
        </Fade>

        <Fade in={activePage === "chat"} timeout={200} unmountOnExit>
          <ChatPage />
        </Fade>
      </Box>
    </Box>
  );
}
