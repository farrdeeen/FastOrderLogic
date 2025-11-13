import { useEffect, useState } from "react";
import axios from "axios";
import OrdersTable from "./components/OrdersTable";
import SearchBar from "./components/SearchBar";
import CreateOrderForm from "./components/CreateOrderForm";
import NavDrawer from "./components/NavDrawer";
import { Box, Typography, CircularProgress } from "@mui/material";

const API_URL = import.meta.env.VITE_API_URL;

export default function App() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: "",
    payment_status: "",
    delivery_status: "",
    channel: "",
    date_from: "",
    date_to: "",
  });

  const [activePage, setActivePage] = useState("orders");

  // 🔁 Fetch orders when filters change
  useEffect(() => {
    if (activePage === "orders") fetchOrders();
  }, [filters, activePage]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/orders`, { params: filters });
      setOrders(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // 🔄 Handle action buttons in OrdersTable
  const handleAction = async (orderId, action) => {
    try {
      await axios.put(`${API_URL}/orders/${encodeURIComponent(orderId)}/${action}`);
      alert("✅ Action completed successfully");
      fetchOrders();
    } catch (err) {
      console.error(err);
      alert("❌ Action failed");
    }
  };

  // 🔀 Navigation handler
  const handleNavigate = (section) => {
    if (section === "logout") {
      alert("Logging out...");
      return;
    }
    setActivePage(section);
  };

  return (
    <Box sx={{ display: "flex", fontFamily: "Inter, sans-serif" }}>
      {/* 📚 Sidebar Drawer */}
      <NavDrawer onNavigate={handleNavigate} />

      {/* 🧭 Main Page Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 4 },
          backgroundColor: "#f9fafb",
          minHeight: "100vh",
        }}
      >
        {/* Dashboard Title */}
        <Typography
          variant="h5"
          sx={{ fontWeight: 600, mb: 3, color: "#111827" }}
        >
          {activePage === "dashboard"
            ? "📊 Dashboard Overview"
            : activePage === "orders"
            ? "📦 Orders Management"
            : activePage === "payments"
            ? "💰 Payment Summary"
            : activePage === "settings"
            ? "⚙️ Settings"
            : ""}
        </Typography>

        {/* Page Views */}
        {activePage === "dashboard" && (
          <Typography variant="body1" sx={{ color: "#374151" }}>
            Welcome to FastOrderLogic!  
            Here you’ll see quick stats, sales analytics, and top customers.
          </Typography>
        )}

        {activePage === "orders" && (
          <>
            <CreateOrderForm onOrderCreated={fetchOrders} />
            <SearchBar filters={filters} setFilters={setFilters} />
            {loading ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  mt: 4,
                }}
              >
                <CircularProgress color="primary" />
              </Box>
            ) : (
              <OrdersTable orders={orders} onAction={handleAction} />
            )}
          </>
        )}

        {activePage === "payments" && (
          <Typography variant="body1" sx={{ color: "#374151" }}>
            💵 Payment records and Razorpay/Delhivery transaction summaries
            will appear here soon.
          </Typography>
        )}

        {activePage === "settings" && (
          <Typography variant="body1" sx={{ color: "#374151" }}>
            ⚙️ Manage user roles, API keys, and preferences here.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
