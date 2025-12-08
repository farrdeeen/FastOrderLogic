import { useEffect, useState } from "react";
import axios from "axios";

import OrdersTable from "./components/OrdersTable";
import SearchBar from "./components/SearchBar";
import CreateOrderForm from "./components/CreateOrderForm";
import NavDrawer from "./components/NavDrawer";
import ChatPage from "./components/chat/ChatPage";
import { Dialog, DialogTitle, DialogContent } from "@mui/material";

import CustomerForm from "./components/forms/CustomerForm";

import {
  Autocomplete,
  TextField,
  createFilterOptions,
  Box,
  Typography,
  CircularProgress,
  Button,
  Fade,
  Paper,
  Modal,
} from "@mui/material";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export default function App() {
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

  // Dropdowns
  const [productList, setProductList] = useState([]);
  const [customerList, setCustomerList] = useState([]);
  const [statesList, setStatesList] = useState([]);

  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");

  // Modal state
  const [customerModalOpen, setCustomerModalOpen] = useState(false);

  // Filter for Autocomplete
  const customerFilter = createFilterOptions({
    stringify: (option) =>
      `${option.name} ${option.type} ${option.mobile ?? ""}`.toLowerCase(),
  });

  const pageTitle = {
    dashboard: "📊 Dashboard Overview",
    orders: "📦 Orders Management",
    payments: "💰 Payment Summary",
    settings: "⚙️ Settings",
    chat: "💬 Chat Support",
    "create-order": "🆕 Create New Order",
  }[activePage];

  // Fetch orders
  useEffect(() => {
    if (activePage === "orders") fetchOrders();
  }, [filters, activePage]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/orders`, { params: filters });
      setOrders(res.data || []);
    } catch (err) {
      console.error("Fetch orders error:", err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  // Load dropdowns when create-order page opens
  useEffect(() => {
    if (activePage !== "create-order") return;

    axios
      .get(`${API_URL}/dropdowns/products/list`)
      .then((res) => setProductList(res.data || []))
      .catch(console.error);

    axios
      .get(`${API_URL}/dropdowns/customers/list`)
      .then((res) => setCustomerList(res.data || []))
      .catch(console.error);

    axios
      .get(`${API_URL}/states/list`)
      .then((res) => setStatesList(res.data || []))
      .catch(console.error);
  }, [activePage]);

  // Sync Wix
  const handleSyncWix = async () => {
    try {
      setSyncing(true);
      const res = await axios.get(`${API_URL}/sync/wix`);
      alert(`Wix Sync Completed\nInserted: ${res.data.inserted}\nSkipped: ${res.data.skipped}`);
      fetchOrders();
    } catch (err) {
      console.error(err);
      alert("❌ Wix sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Create Zoho Invoice
  const handleCreateInvoice = async (order) => {
    if (!order) return alert("Order not found");

    try {
      const res = await axios.post(`${API_URL}/zoho/invoice`, order);
      console.log(res.data);
      alert("Invoice created!");
      fetchOrders();
    } catch (err) {
      console.error(err);
      alert("❌ Invoice creation failed");
    }
  };

  // PUT actions
  const callSimplePut = async (orderId, actionPath) => {
    const url = `${API_URL}/orders/${encodeURIComponent(orderId)}/${actionPath}`;
    return axios.put(url);
  };

  const handleAction = async (orderId, action, payload) => {
    try {
      if (action === "update-delivery") {
        await axios.put(`${API_URL}/orders/${encodeURIComponent(orderId)}/update-delivery`, {
          status: payload,
        });
        return fetchOrders();
      }

      if (action === "create-invoice") {
        const order = orders.find((o) => o.order_id === orderId);
        return handleCreateInvoice(order);
      }

      if (action === "download-invoice") {
        window.open(`${API_URL}/zoho/orders/${encodeURIComponent(orderId)}/invoice/print`);
        return;
      }

      if (action === "update-remarks") {
        await axios.put(`${API_URL}/orders}/remarks`, {
          remarks: payload,
        });
        return fetchOrders();
      }

      const simpleActions = ["toggle-payment", "mark-paid", "mark-fulfilled", "mark-delhivery", "mark-invoiced"];
      if (simpleActions.includes(action)) {
        await callSimplePut(orderId, action);
        return fetchOrders();
      }
      if (action === "serial-status-updated") {
  // Update serial status in the local orders array
  setOrders(prev =>
    prev.map(o =>
      o.order_id === orderId
        ? { ...o, serial_status: payload }
        : o
    )
  );
  return;
}

      console.warn("Unknown action:", action);
    } catch (err) {
      console.error("Action error:", err);
      alert("❌ Action failed");
    }
  };

  const handleNavigate = (section) => {
    if (section === "logout") return alert("Logging out…");
    setActivePage(section);
  };

  // After customer is saved → refresh list + auto-select latest
  const refreshCustomersAfterCreate = async () => {
    try {
      const res = await axios.get(`${API_URL}/dropdowns/customers/list`);
      const list = res.data || [];
      setCustomerList(list);

      if (list.length) {
        const last = list[list.length - 1];
        setSelectedCustomer(`${last.type}:${last.id}`);
      }

      setCustomerModalOpen(false);
    } catch (err) {
      console.error(err);
      alert("Failed to refresh customers");
    }
  };

  return (
    <Box sx={{ display: "flex", fontFamily: "Inter, sans-serif" }}>
      <NavDrawer onNavigate={handleNavigate} />

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

        {/* ORDERS PAGE */}
        <Fade in={activePage === "orders"} timeout={300} unmountOnExit>
          <Box>
            <Button
              variant="contained"
              onClick={handleSyncWix}
              disabled={syncing}
              sx={{ backgroundColor: "#020202ff", mb: 2 }}
            >
              {syncing ? "Syncing..." : "🔄 Sync Wix Orders"}
            </Button>

            <Button
              variant="contained"
              onClick={() => setActivePage("create-order")}
              sx={{ backgroundColor: "#000", mb: 2, ml: 2 }}
            >
              ➕ Create Order
            </Button>

            <SearchBar filters={filters} setFilters={setFilters} />

            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <OrdersTable orders={orders} onAction={handleAction} />
            )}
          </Box>
        </Fade>

        {/* CREATE ORDER PAGE */}
        <Fade in={activePage === "create-order"} timeout={300} unmountOnExit>
          <Paper sx={{ p: 3, borderRadius: 3 }}>
            <Button
              variant="outlined"
              onClick={() => setActivePage("orders")}
              sx={{ mb: 3 }}
            >
              ⬅ Back to Orders
            </Button>

            {/* SEARCH DROPDOWNS */}
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
                options={productList.map((p) => ({ id: p.id, label: p.name }))}
                onChange={(e, v) => v && setSelectedProduct(v.id)}
                renderInput={(params) => <TextField {...params} label="Search Product…" />}
              />

              <Autocomplete
                options={customerList}
                filterOptions={customerFilter}
                getOptionLabel={(c) => `${c.name} (${c.type})`}
                value={
                  customerList.find((c) => `${c.type}:${c.id}` === selectedCustomer) ||
                  null
                }
                onChange={(e, v) =>
                  v ? setSelectedCustomer(`${v.type}:${v.id}`) : setSelectedCustomer("")
                }
                renderInput={(params) => <TextField {...params} label="Select Customer…" />}
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
              <Button variant="contained" sx={{ background: "#2563eb" }}>
                Browse Products
              </Button>

              <Button
                variant="contained"
                sx={{ background: "#22c55e" }}
                onClick={() => setCustomerModalOpen(true)}
              >
                Add Customer
              </Button>
            </Box>

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

        {/* CUSTOMER CREATE MODAL */}
        <Dialog
  open={customerModalOpen}
  onClose={() => setCustomerModalOpen(false)}
  maxWidth="md"
  fullWidth
>
  <DialogTitle sx={{ fontWeight: 600 }}>Create Customer</DialogTitle>

  <DialogContent sx={{ pb: 3 }}>
    <CustomerForm
      states={statesList}
      onClose={() => setCustomerModalOpen(false)}
      onSuccess={refreshCustomersAfterCreate}
    />
  </DialogContent>
</Dialog>


      </Box>
    </Box>
  );
}
