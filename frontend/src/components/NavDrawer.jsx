import React, { useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Toolbar,
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
  Forum as ForumIcon,
  Psychology as PsychologyIcon,
  Logout as LogoutIcon,
} from "@mui/icons-material";

const drawerWidth = 220;
const collapsedWidth = 70;
const mobileBreakpoint = "@media (max-width: 768px)";

export default function NavDrawer({
  onNavigate,
  mobileOpen = false,
  onMobileClose,
  allowedPages,
}) {
  const [open, setOpen] = useState(false);
  const { signOut } = useClerk();

  const handleCollapseToggle = () => setOpen(!open);

  const allowedSet = Array.isArray(allowedPages) ? new Set(allowedPages) : null;

  const menuItems = [
    { text: "Dashboard", icon: <DashboardIcon />, id: "dashboard" },
    { text: "Orders", icon: <ShoppingCartIcon />, id: "orders" },
    { text: "Chat", icon: <ForumIcon />, id: "chat" },
    { text: "Knowledge", icon: <PsychologyIcon />, id: "knowledge" },
  ].filter((item) => !allowedSet || allowedSet.has(item.id));

  const drawerContent = (isMobile = false) => {
    const expanded = isMobile || open;
    const handleSignOut = () => {
      if (mobileOpen && onMobileClose) onMobileClose();
      signOut({ redirectUrl: "/" });
    };

    return (
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
          justifyContent: "center",
          alignItems: "center",
          py: 2,
          cursor: isMobile ? "default" : "pointer",
        }}
        onClick={() => {
          if (!isMobile) setOpen(true);
        }}
      >
        {expanded ? (
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, color: "#1e3a8a", textAlign: "center" }}
          >
            🧾 FastOrderLogic
          </Typography>
        ) : (
          <Tooltip title="Expand Menu" placement="right">
            <MenuIcon sx={{ color: "#264653" }} />
          </Tooltip>
        )}
      </Toolbar>

      <Divider />

      {/* Menu Items */}
      <List sx={{ flexGrow: 1 }}>
        {menuItems.map((item) => (
          <Tooltip
            key={item.text}
            title={!expanded ? item.text : ""}
            placement="right"
            arrow
          >
            <ListItem disablePadding sx={{ display: "block" }}>
              <ListItemButton
                onClick={() => {
                  if (onNavigate) onNavigate(item.id);
                  if (mobileOpen && onMobileClose) onMobileClose();
                }}
                sx={{
                  minHeight: 48,
                  justifyContent: expanded ? "initial" : "center",
                  px: 2.5,
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: 0,
                    mr: expanded ? 2 : "auto",
                    justifyContent: "center",
                    color: "#000000ff",
                  }}
                >
                  {item.icon}
                </ListItemIcon>

                {expanded && (
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

      <List>
        <Tooltip
          title={!expanded ? "Sign out" : ""}
          placement="right"
          arrow
        >
          <ListItem disablePadding sx={{ display: "block" }}>
            <ListItemButton
              onClick={handleSignOut}
              sx={{
                minHeight: 48,
                justifyContent: expanded ? "initial" : "center",
                px: 2.5,
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 0,
                  mr: expanded ? 2 : "auto",
                  justifyContent: "center",
                  color: "#991b1b",
                }}
              >
                <LogoutIcon />
              </ListItemIcon>
              {expanded && (
                <ListItemText
                  primary="Sign out"
                  primaryTypographyProps={{
                    fontWeight: 600,
                    color: "#991b1b",
                  }}
                />
              )}
            </ListItemButton>
          </ListItem>
        </Tooltip>
      </List>

      <Divider />

      {/* Bottom Toggle */}
      {!isMobile && (
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
      )}
    </Box>
    );
  };

  return (
    <Box sx={{ display: "flex" }}>
      

      {/* Permanent drawer */}
      <Drawer
        variant="permanent"
        open={open}
        sx={{
          display: "block",
          width: open ? drawerWidth : collapsedWidth,
          flexShrink: 0,
          whiteSpace: "nowrap",
          boxSizing: "border-box",
          [mobileBreakpoint]: { display: "none" },
          "& .MuiDrawer-paper": {
            width: open ? drawerWidth : collapsedWidth,
            transition: "width 0.3s ease",
            overflowX: "hidden",
          },
        }}
      >
        {drawerContent(false)}
      </Drawer>

      {/* Mobile drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: "none",
          [mobileBreakpoint]: { display: "block" },
          "& .MuiDrawer-paper": {
            boxSizing: "border-box",
            width: "min(86vw, 300px)",
            maxWidth: "100vw",
            height: "100dvh",
          },
        }}
      >
        {drawerContent(true)}
      </Drawer>
    </Box>
  );
}
