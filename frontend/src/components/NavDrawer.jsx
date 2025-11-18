import React, { useState } from "react";
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Toolbar,
  AppBar,
  Typography,
  Box,
  Divider,
  Tooltip,
} from "@mui/material";

import {
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Dashboard as DashboardIcon,
  ShoppingCart as ShoppingCartIcon,
  Payments as PaymentsIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  Forum as ForumIcon,          // ✅ Chat Icon Added
} from "@mui/icons-material";

const drawerWidth = 220;
const collapsedWidth = 70;

export default function NavDrawer({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleCollapseToggle = () => setOpen(!open);

  // ⬇️ NEW CHAT MENU ENTRY ADDED HERE
  const menuItems = [
    { text: "Dashboard", icon: <DashboardIcon />, id: "dashboard" },
    { text: "Orders", icon: <ShoppingCartIcon />, id: "orders" },
    { text: "Payments", icon: <PaymentsIcon />, id: "payments" },
    { text: "Chat", icon: <ForumIcon />, id: "chat" },
    { text: "Settings", icon: <SettingsIcon />, id: "settings" },
    { text: "Logout", icon: <LogoutIcon />, id: "logout" },
  ];

  const drawerContent = (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#f9fafb",
        borderRight: "1px solid #e5e7eb",
      }}
    >
      {/* Top Logo / Header */}
      <Toolbar
        sx={{
          display: "flex",
          justifyContent: open ? "center" : "center",
          alignItems: "center",
          py: 2,
          cursor: "pointer",
        }}
        onClick={() => setOpen(true)}
      >
        {open ? (
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, color: "#1e3a8a", textAlign: "center" }}
          >
            🧾 FastOrderLogic
          </Typography>
        ) : (
          <Tooltip title="Expand Menu" placement="right">
            <MenuIcon sx={{ color: "#1e3a8a" }} />
          </Tooltip>
        )}
      </Toolbar>

      <Divider />

      {/* Menu Items */}
      <List sx={{ flexGrow: 1 }}>
        {menuItems.map((item) => (
          <Tooltip
            key={item.text}
            title={!open ? item.text : ""}
            placement="right"
            arrow
          >
            <ListItem disablePadding sx={{ display: "block" }}>
              <ListItemButton
                onClick={() => {
                  if (onNavigate) onNavigate(item.id);
                  if (mobileOpen) setMobileOpen(false);
                }}
                sx={{
                  minHeight: 48,
                  justifyContent: open ? "initial" : "center",
                  px: 2.5,
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    mr: open ? 2 : "auto",
                    justifyContent: "center",
                    color: "#2563eb",
                  }}
                >
                  {item.icon}
                </ListItemIcon>

                {open && (
                  <ListItemText
                    primary={item.text}
                    primaryTypographyProps={{
                      fontWeight: 500,
                      color: "#1f2937",
                    }}
                  />
                )}
              </ListItemButton>
            </ListItem>
          </Tooltip>
        ))}
      </List>

      <Divider />

      {/* Bottom Toggle */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          py: 1.5,
          cursor: "pointer",
          borderTop: "1px solid #e5e7eb",
          backgroundColor: "#f3f4f6",
          "&:hover": { backgroundColor: "#e0e7ff" },
        }}
        onClick={handleCollapseToggle}
      >
        <IconButton>
          {open ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </IconButton>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex" }}>
      {/* AppBar */}
      <AppBar
        position="fixed"
        sx={{
          zIndex: (theme) => theme.zIndex.drawer + 1,
          backgroundColor: "#1e40af",
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap>
            FastOrderLogic Dashboard
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Permanent drawer */}
      <Drawer
        variant="permanent"
        open={open}
        sx={{
          width: open ? drawerWidth : collapsedWidth,
          flexShrink: 0,
          whiteSpace: "nowrap",
          boxSizing: "border-box",
          "& .MuiDrawer-paper": {
            width: open ? drawerWidth : collapsedWidth,
            transition: "width 0.3s ease",
            overflowX: "hidden",
          },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleDrawerToggle}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", sm: "none" },
          "& .MuiDrawer-paper": { boxSizing: "border-box", width: drawerWidth },
        }}
      >
        {drawerContent}
      </Drawer>
    </Box>
  );
}
