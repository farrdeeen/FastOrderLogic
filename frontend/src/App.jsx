import { useEffect, useState } from "react";
import axios from "axios";

import OrdersTable from "./components/OrdersTable";
import SearchBar from "./components/SearchBar";
import CreateOrderForm from "./components/CreateOrderForm";
import NavDrawer from "./components/NavDrawer";

import ChatPage from "./components/chat/ChatPage";

import {
  Box,
  Typography,
  CircularProgress,
  Button,
} from "@mui/material";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  // ==========================
  // STATE MANAGEMENT
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

  // ==========================
  // LOAD ORDERS ON PAGE CHANGE
  // ==========================
  useEffect(() => {
    if (activePage === "orders") {
      fetchOrders();
    }
  }, [filters, activePage]);

  // ==========================
  // FETCH ORDERS
  // ==========================
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
  // SYNC WIX ORDERS
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
  // ORDER ACTIONS
  // ==========================
  const handleAction = async (orderId, action) => {
    try {
      await axios.put(
        `${API_URL}/orders/${encodeURIComponent(orderId)}/${action}`
      );
      alert("✅ Action completed");
      fetchOrders();
    } catch (err) {
      console.error("Order action error:", err);
      alert("❌ Action failed");
    }
  };

  // ==========================
  // SIDEBAR NAVIGATION
  // ==========================
  const handleNavigate = (section) => {
    if (section === "logout") {
      alert("Logging out…");
      return;
    }
    setActivePage(section);
  };

  // ==========================
  // PAGE TITLE RENDER
  // ==========================
  const pageTitle = {
    dashboard: "📊 Dashboard Overview",
    orders: "📦 Orders Management",
    payments: "💰 Payment Summary",
    settings: "⚙️ Settings",
    chat: "💬 Chat Support",
  }[activePage];

  // ==========================
  // RENDER UI
  // ==========================
  return (
    <Box sx={{ display: "flex", fontFamily: "Inter, sans-serif" }}>
      {/* SIDEBAR */}
      <NavDrawer onNavigate={handleNavigate} />

      {/* MAIN CONTENT AREA */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 4 },
          backgroundColor: "#f9fafb",
          minHeight: "100vh",
        }}
      >
        {/* PAGE TITLE */}
        <Typography
          variant="h5"
          sx={{ fontWeight: 600, mb: 3, color: "#111827" }}
        >
          {pageTitle}
        </Typography>

        {/* ==========================
            PAGE CONTENT SWITCH
        =========================== */}

        {/* DASHBOARD */}
        {activePage === "dashboard" && (
          <Typography sx={{ color: "#374151" }}>
            Welcome to FastOrderLogic!  
            Analytics and insights coming soon.
          </Typography>
        )}

        {/* ORDERS PAGE */}
        {activePage === "orders" && (
          <>
            {/* SYNC BUTTON */}
            <Button
              variant="contained"
              onClick={handleSyncWix}
              disabled={syncing}
              sx={{
                backgroundColor: "#1e40af",
                mb: 2,
                px: 3,
                py: 1,
                borderRadius: "8px",
                textTransform: "none",
                fontWeight: 600,
                "&:hover": { backgroundColor: "#1e3a8a" },
              }}
            >
              {syncing ? "Syncing..." : "🔄 Sync Wix Orders"}
            </Button>

            {/* ORDER FORM + SEARCH */}
            <CreateOrderForm onOrderCreated={fetchOrders} />
            <SearchBar filters={filters} setFilters={setFilters} />

            {/* TABLE OR LOADER */}
            {loading ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  mt: 4,
                }}
              >
                <CircularProgress />
              </Box>
            ) : (
              <OrdersTable orders={orders} onAction={handleAction} />
            )}
          </>
        )}

        {/* PAYMENTS PAGE */}
        {activePage === "payments" && (
          <Typography sx={{ color: "#374151" }}>
            Payment summaries and Razorpay logs will appear here.
          </Typography>
        )}

        {/* SETTINGS PAGE */}
        {activePage === "settings" && (
          <Typography sx={{ color: "#374151" }}>
            Update roles, preferences, API keys, and more.
          </Typography>
        )}

        {/* CHAT PAGE */}
        {activePage === "chat" && <ChatPage />}
      </Box>
    </Box>
  );
}
