// src/components/CreateOrderForm.jsx
import React, { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import axios from "axios";

import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  TextField,
  Typography,
  IconButton,
  Paper,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Checkbox,
  FormControlLabel,
} from "@mui/material";

import CloseIcon from "@mui/icons-material/Close";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export default function CreateOrderForm({
  onOrderCreated,
  selectedCustomer,
  selectedProduct,
}) {
  const { register, handleSubmit, reset, setValue, watch, getValues } = useForm();

  const [productList, setProductList] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [items, setItems] = useState([]);

  const [customerDetails, setCustomerDetails] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState("");

  const [statesList, setStatesList] = useState([]);

  const [freeDelivery, setFreeDelivery] = useState(false);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [manualSubtotal, setManualSubtotal] = useState("");

  const [addrOpen, setAddrOpen] = useState(false);
  const [newAddr, setNewAddr] = useState({
    address_line: "",
    locality: "",
    city: "",
    state_id: "",
    pincode: "",
    landmark: "",
    alternate_phone: "",
    address_type: "home",
  });

  // Load products + states
  useEffect(() => {
    setLoadingProducts(true);
    axios
      .get(`${API_URL}/dropdowns/products/list`)
      .then((res) => setProductList(res.data || []))
      .catch((err) => console.error("Products load error:", err))
      .finally(() => setLoadingProducts(false));

    axios
      .get(`${API_URL}/states/list`)
      .then((res) => setStatesList(res.data || []))
      .catch((err) => {
        console.error("States load error:", err);
        setStatesList([]);
      });
  }, []);

  // Auto-add selected product
  useEffect(() => {
    if (!selectedProduct) return;

    const pid = Number(selectedProduct);

    if (!Number.isNaN(pid) && pid > 0) {
      addProductById(pid);
    } else {
      const found = productList.find(
        (p) =>
          String(p.id) === String(selectedProduct) ||
          String(p.product_id) === String(selectedProduct)
      );
      if (found) pushItemFromProduct(found);
    }
  }, [selectedProduct]);

  // When customer changes
  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerDetails(null);
      setAddresses([]);
      setSelectedAddress("");
      setValue("customer_id", null);
      setValue("offline_customer_id", null);
      setValue("address_id", null);
      return;
    }

    const [typeRaw, idRaw] = String(selectedCustomer).split(":");
    const type = (typeRaw || "").trim();
    const id = (idRaw || "").trim();
    if (!type || !id) return;

    const numericId = Number(id);

    if (type === "online") {
      setValue("customer_id", Number.isFinite(numericId) ? numericId : null);
      setValue("offline_customer_id", null);
    } else {
      setValue("customer_id", null);
      setValue("offline_customer_id", Number.isFinite(numericId) ? numericId : null);
    }

    axios
      .get(`${API_URL}/dropdowns/customers/details`, { params: { type, id } })
      .then((res) => {
        setCustomerDetails(res.data || null);
      })
      .catch((err) => {
        console.error("Customer details fetch error:", err);
        setCustomerDetails(null);
      });

    axios
      .get(`${API_URL}/dropdowns/customers/${type}/${id}/addresses`)
      .then((res) => {
        const list = res.data || [];
        setAddresses(list);

        if (list.length === 1) {
          const a = list[0];
          setSelectedAddress(a.address_id);
          setValue("address_id", a.address_id);
          setCustomerDetails((prev) => ({
            ...prev,
            address: {
              address_line: a.address_line,
              locality: a.locality,
              city: a.city,
              state_id: a.state_id,
              state_name: a.state_name || "",
              pincode: a.pincode,
            },
          }));
        } else {
          axios
            .get(`${API_URL}/dropdowns/customers/details`, { params: { type, id } })
            .then((r2) => {
              const adr = r2.data?.address;
              if (!adr) return;

              const found = list.find(
                (x) =>
                  String(x.address_line) === String(adr.address_line) ||
                  String(x.pincode) === String(adr.pincode)
              );
              if (found) {
                setSelectedAddress(found.address_id);
                setValue("address_id", found.address_id);
              }
            })
            .catch(() => {});
        }
      })
      .catch((err) => {
        console.error("Addresses fetch error:", err);
        setAddresses([]);
        setSelectedAddress("");
      });
  }, [selectedCustomer, setValue, statesList]);

  // Add product by ID
  const addProductById = async (productId) => {
    if (!productId) return;
    try {
      const res = await axios.get(`${API_URL}/dropdowns/products/details`, {
        params: { id: productId },
      });
      const product = res.data || {};

      const priceRes = await axios.get(`${API_URL}/dropdowns/products/get_price`, {
        params: { product_id: productId },
      });

      const finalPriceRaw = priceRes?.data?.price;
      const finalPrice =
        finalPriceRaw === undefined || finalPriceRaw === null
          ? 0
          : Number(finalPriceRaw);

      pushItemFromProduct({
        ...product,
        selling_price: finalPrice,
      });
    } catch (err) {
      const p = productList.find(
        (x) =>
          String(x.id) === String(productId) ||
          String(x.product_id) === String(productId)
      );
      if (p) {
        pushItemFromProduct({
          id: p.id ?? p.product_id,
          name: p.name,
          mrp: p.mrp ?? p.price ?? 0,
          selling_price: p.price ?? p.mrp ?? 0,
          gst_percent: p.gst_percent ?? 18,
          image: p.image ?? null,
          stock: p.stock ?? 0,
        });
      } else {
        console.error("Product not found:", err);
      }
    }
  };

  const pushItemFromProduct = (p) => {
    if (!p) return;

    const id = p.id ?? p.product_id ?? p.productId;

    const already = items.find((it) => String(it.product_id) === String(id));
    if (already) {
      setItems((prev) =>
        prev.map((it) =>
          String(it.product_id) === String(id)
            ? { ...it, qty: it.qty + 1 }
            : it
        )
      );
      return;
    }

    const item = {
      product_id: id,
      name: p.name ?? p.title ?? "Unnamed",
      image: p.image ?? null,
      mrp: Number(p.mrp ?? p.price ?? 0),
      selling_price: Number(
        p.selling_price ?? (p.selling_price === 0 ? 0 : p.selling_price ?? 0)
      ),
      gst_percent: Number(p.gst_percent ?? 18),
      stock: Number(p.stock ?? 0),
      qty: 1,
      extra_discount_percent: Number(p.extra_discount_percent ?? 0),
    };

    setItems((prev) => [...prev, item]);
  };

  const removeItem = (product_id) =>
    setItems((prev) =>
      prev.filter((it) => String(it.product_id) !== String(product_id))
    );

  const updateItem = (product_id, changes) =>
    setItems((prev) =>
      prev.map((it) =>
        String(it.product_id) === String(product_id)
          ? { ...it, ...changes }
          : it
      )
    );

  // Calculations
  const calculations = useMemo(() => {
    let originalSubtotal = 0;
    let productDiscount = 0;
    let extraDiscount = 0;
    let subtotalExclGST = 0;
    let gstTotal = 0;

    items.forEach((it) => {
      const qty = Number(it.qty || 0);
      const mrp = Number(it.mrp || 0);
      const sp = Number(it.selling_price || 0);
      const extraPct = Number(it.extra_discount_percent || 0);

      const finalUnit = sp * (1 - extraPct / 100);
      const lineFinal = finalUnit * qty;
      const lineProductDiscount = Math.max(0, (mrp - sp) * qty);
      const lineExtraDiscount = Math.max(0, (sp - finalUnit) * qty);
      const lineGst = (lineFinal * Number(it.gst_percent || 0)) / 100;

      originalSubtotal += mrp * qty;
      productDiscount += lineProductDiscount;
      extraDiscount += lineExtraDiscount;
      subtotalExclGST += lineFinal;
      gstTotal += lineGst;
    });

    const effectiveSubtotal =
      manualSubtotal !== "" ? Number(manualSubtotal) : subtotalExclGST;

    const delivery_charge = Number(watch("delivery_charge") || 0);

    const total =
      effectiveSubtotal +  (freeDelivery ? 0 : delivery_charge);

    return {
      originalSubtotal,
      productDiscount,
      extraDiscount,
      subtotalExclGST,
      gstTotal,
      delivery_charge,
      total,
      effectiveSubtotal,
    };
  }, [JSON.stringify(items), watch("delivery_charge"), freeDelivery, manualSubtotal]);

  // Open address modal
  const openAddAddr = () => {
    setNewAddr({
      address_line: "",
      locality: "",
      city: "",
      state_id: "",
      pincode: "",
      landmark: "",
      alternate_phone: "",
      address_type: "home",
    });
    setAddrOpen(true);
  };

  // Add new address
  const handleAddNewAddress = async () => {
    if (!selectedCustomer) return alert("Select a customer first");

    const [type, id] = String(selectedCustomer).split(":");
    if (!type || !id) return alert("Invalid customer");

    if (!newAddr.address_line || !newAddr.city || !newAddr.state_id || !newAddr.pincode) {
      return alert("Please fill address line, city, state and pincode");
    }

    try {
      const body = {
        cust_type: type,
        customer_id: Number(id),
        name: customerDetails?.name ?? "",
        mobile: customerDetails?.mobile ?? "",
        address_line: newAddr.address_line,
        locality: newAddr.locality ?? "",
        city: newAddr.city,
        state_id: Number(newAddr.state_id),
        pincode: newAddr.pincode,
        landmark: newAddr.landmark ?? "",
        alternate_phone: newAddr.alternate_phone ?? "",
        address_type: newAddr.address_type ?? "home",
      };

      await axios.post(`${API_URL}/customers/address/create`, body);

      const res = await axios.get(
        `${API_URL}/dropdowns/customers/${type}/${id}/addresses`
      );
      const list = res.data || [];
      setAddresses(list);

      if (list.length) {
        const newest = list[list.length - 1];
        setSelectedAddress(newest.address_id);
        setValue("address_id", newest.address_id);
        setCustomerDetails((prev) => ({
          ...prev,
          address: {
            address_line: newest.address_line,
            locality: newest.locality,
            city: newest.city,
            state_name: newest.state_name || "",
            state_id: newest.state_id,
            pincode: newest.pincode,
          },
        }));
      }

      setAddrOpen(false);
      setNewAddr({
        address_line: "",
        locality: "",
        city: "",
        state_id: "",
        pincode: "",
        landmark: "",
        alternate_phone: "",
        address_type: "home",
      });

      alert("Address added");
    } catch (err) {
      console.error("Add address error:", err);
      alert("Failed to add address");
    }
  };

  // Submit Order
  const onSubmit = async (formData) => {
    if (!items.length) return alert("Add at least one product");
    if (!selectedAddress) return alert("Select an address");

    const payloadItems = items.map((it) => {
      const qty = Number(it.qty || 0);
      const sp = Number(it.selling_price || 0);
      const extraPct = Number(it.extra_discount_percent || 0);

      const finalUnit = sp * (1 - extraPct / 100);
      const lineFinal = finalUnit * qty;
      const lineGst = (lineFinal * Number(it.gst_percent || 0)) / 100;

      return {
        product_id: it.product_id,
        qty,
        final_unit_price: Number(finalUnit.toFixed(2)),
        line_total: Number(lineFinal.toFixed(2)),
        gst_amount: Number(lineGst.toFixed(2)),
      };
    });

    const rawCustomerId = formData.customer_id;
    const rawOfflineId = formData.offline_customer_id;

    const customer_id =
      rawCustomerId === undefined ||
      rawCustomerId === "" ||
      rawCustomerId === null
        ? null
        : Number(rawCustomerId);

    const offline_customer_id =
      rawOfflineId === undefined ||
      rawOfflineId === "" ||
      rawOfflineId === null
        ? null
        : Number(rawOfflineId);

    if (!customer_id && !offline_customer_id) {
      return alert(
        "Offline customer id is required (Option 1: orders are offline). Please select a customer."
      );
    }

    const payload = {
      customer_id: customer_id || null,
      offline_customer_id: offline_customer_id || null,
      address_id: selectedAddress,
      total_items: items.reduce((s, it) => s + Number(it.qty || 0), 0),
      subtotal: Number(calculations.subtotalExclGST.toFixed(2)),
      gst: Number(calculations.gstTotal.toFixed(2)),
      delivery_charge: freeDelivery ? 0 : Number(formData.delivery_charge || 0),
      total_amount: Number(calculations.total.toFixed(2)),
      payment_type: formData.payment_type || "pending",
      channel: "offline",
      items: payloadItems,
    };

    console.log("FINAL PAYLOAD →", payload);

    try {
      await axios.post(`${API_URL}/orders/create`, payload);
      alert("Order created successfully!");

      reset();
      setItems([]);
      setCustomerDetails(null);
      setAddresses([]);
      setSelectedAddress("");

      setValue("customer_id", null);
      setValue("offline_customer_id", null);
      setValue("address_id", null);
      setValue("delivery_charge", 0);

      onOrderCreated && onOrderCreated();
    } catch (err) {
      console.error("Order create error:", err.response?.data || err);
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data ||
        err.message ||
        "Failed to create order";
      alert(msg);
    }
  };

  // Render
  return (
    <Box component="section">
      <ProductBrowseDialog
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        products={productList}
        loading={loadingProducts}
        onPick={(p) => {
          pushItemFromProduct(p);
          setBrowseOpen(false);
        }}
      />

      {/* PRODUCT LIST */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 4 }}>
        {items.length > 0 &&
          items.map((it) => (
            <Paper key={it.product_id} sx={{ p: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={1}>
                  {it.image ? (
                    <img
                      src={it.image}
                      alt={it.name}
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: "cover",
                        borderRadius: 6,
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 64,
                        height: 64,
                        bgcolor: "#f3f4f6",
                        borderRadius: 1,
                      }}
                    />
                  )}
                </Grid>

                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle1">{it.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Available: {it.stock}
                  </Typography>

                  <Box sx={{ mt: 1 }}>
                    <Typography component="span" sx={{ mr: 1 }}>
                      Qty:
                    </Typography>
                    <TextField
                      size="small"
                      type="number"
                      value={it.qty}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value || 0));
                        updateItem(it.product_id, { qty: v });
                      }}
                      sx={{ width: 90 }}
                    />
                  </Box>
                </Grid>

                <Grid item xs={12} md={4} sx={{ textAlign: "right" }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ textDecoration: "line-through" }}
                  >
                    ₹{Number(it.mrp).toFixed(2)}
                  </Typography>

                  <Box
                    sx={{
                      display: "flex",
                      gap: 1,
                      alignItems: "center",
                      justifyContent: "flex-end",
                      mt: 1,
                    }}
                  >
                    <Box>
                      <Typography variant="caption">Extra Discount %</Typography>
                      <TextField
                        size="small"
                        type="number"
                        value={it.extra_discount_percent}
                        onChange={(e) =>
                          updateItem(it.product_id, {
                            extra_discount_percent: Number(e.target.value || 0),
                          })
                        }
                        sx={{ width: 90, ml: 1 }}
                      />
                    </Box>

                    <Box>
                      <Typography variant="caption">Final Price</Typography>
                      <TextField
                        size="small"
                        type="text"
                        placeholder="0"
                        value={
                          it.selling_price === 0 || it.selling_price === "0"
                            ? ""
                            : it.selling_price
                        }
                        onFocus={() => {
                          if (it.selling_price === 0 || it.selling_price === "0") {
                            updateItem(it.product_id, { selling_price: "" });
                          }
                        }}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                            updateItem(it.product_id, {
                              selling_price: raw === "" ? "" : Number(raw),
                            });
                          }
                        }}
                        sx={{ width: 120, ml: 1 }}
                        inputProps={{
                          inputMode: "decimal",
                          style: { textAlign: "right" },
                        }}
                      />
                    </Box>

                    <IconButton onClick={() => removeItem(it.product_id)}>
                      <CloseIcon />
                    </IconButton>
                  </Box>
                </Grid>
              </Grid>
            </Paper>
          ))}
      </Box>

      {/* CUSTOMER DETAILS */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Customer Details
        </Typography>

        {customerDetails ? (
          <>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography>
                  <strong>Name:</strong> {customerDetails.name}
                </Typography>
                <Typography>
                  <strong>Phone:</strong> {customerDetails.mobile}
                </Typography>
                <Typography>
                  <strong>Email:</strong> {customerDetails.email}
                </Typography>
              </Grid>

              <Grid item xs={12} md={6}>
                {addresses.length > 0 && (
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel id="address-select-label">
                      Select Address
                    </InputLabel>
                    <Select
                      labelId="address-select-label"
                      label="Select Address"
                      value={selectedAddress}
                      onChange={(e) => {
                        const aid = e.target.value;
                        setSelectedAddress(aid);
                        setValue("address_id", aid);

                        const found = addresses.find(
                          (a) => a.address_id === aid
                        );
                        if (found) {
                          setCustomerDetails((prev) => ({
                            ...prev,
                            address: {
                              address_line: found.address_line,
                              locality: found.locality,
                              city: found.city,
                              pincode: found.pincode,
                              state_id: found.state_id,
                              state_name:
                                found.state_name ||
                                statesList.find((s) => s.id === found.state_id)
                                  ?.name ||
                                "",
                            },
                          }));
                        }
                      }}
                    >
                      {addresses.map((a) => (
                        <MenuItem key={a.address_id} value={a.address_id}>
                          {a.label ||
                            `${a.address_line} — ${a.city}`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <Button variant="outlined" onClick={() => setAddrOpen(true)}>
                  ➕ Add New Address
                </Button>
              </Grid>
            </Grid>

            {customerDetails.address ? (
              <Box sx={{ mt: 3 }}>
                <Typography>
                  <strong>Address:</strong>{" "}
                  {customerDetails.address.address_line}
                </Typography>
                <Typography>
                  <strong>Locality:</strong>{" "}
                  {customerDetails.address.locality}
                </Typography>
                <Typography>
                  <strong>City/State/Pincode:</strong>{" "}
                  {customerDetails.address.city} /{" "}
                  {customerDetails.address.state_name || ""} -{" "}
                  {customerDetails.address.pincode}
                </Typography>
              </Box>
            ) : (
              <Typography sx={{ mt: 2 }}>
                No address available
              </Typography>
            )}
          </>
        ) : (
          <Typography color="text.secondary">No customer selected.</Typography>
        )}
      </Paper>

      {/* PAYMENT METHOD */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6">Payment Method</Typography>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="payment-method-label">Payment Method</InputLabel>
          <Select
            labelId="payment-method-label"
            label="Payment Method"
            {...register("payment_type")}
          >
            <MenuItem value="">Select Payment Method</MenuItem>
            <MenuItem value="cod">Cash on Delivery</MenuItem>
            <MenuItem value="prepaid">Prepaid</MenuItem>
            <MenuItem value="upi">UPI</MenuItem>
          </Select>
        </FormControl>

        <FormControlLabel
          control={
            <Checkbox
              checked={freeDelivery}
              onChange={(e) => setFreeDelivery(e.target.checked)}
            />
          }
          label="Free Delivery"
        />
      </Paper>

      {/* PAYMENT SUMMARY */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}></Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Payment Summary
            </Typography>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 3,
                alignItems: "center",
              }}
            >
              {/* Subtotal Editable */}
              <Box>
                <Typography sx={{ mb: 0.5 }}>Subtotal</Typography>
                <TextField
                  size="small"
                  type="text"
                  placeholder={calculations.subtotalExclGST.toFixed(2)}
                  value={manualSubtotal}
                  onChange={(e) => {
                    const val = e.target.value;
                    setManualSubtotal(val === "" ? "" : Number(val));
                  }}
                  fullWidth
                  inputProps={{ style: { textAlign: "right" } }}
                />
              </Box>

              {/* Delivery Charge */}
              <Box>
                <Typography sx={{ mb: 0.5 }}>Delivery Charge</Typography>
                <TextField
                  size="small"
                  type="text"
                  placeholder="0"
                  value={
                    watch("delivery_charge") === 0
                      ? ""
                      : watch("delivery_charge") || ""
                  }
                  onFocus={() => {
                    if (watch("delivery_charge") === 0) {
                      setValue("delivery_charge", "");
                    }
                  }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                      setValue("delivery_charge", raw === "" ? "" : Number(raw));
                    }
                  }}
                  disabled={freeDelivery}
                  fullWidth
                  inputProps={{ style: { textAlign: "right" } }}
                />
              </Box>

              {/* Total */}
              <Box>
                <Typography sx={{ mb: 0.5 }}>Total</Typography>
                <TextField
                  size="small"
                  type="text"
                  value={String(
                    Math.round(
                      (manualSubtotal !== ""
                        ? Number(manualSubtotal)
                        : calculations.subtotalExclGST) +
                        (freeDelivery
                          ? 0
                          : Number(watch("delivery_charge") || 0))
                    )
                  )}
                  disabled
                  fullWidth
                  inputProps={{ style: { textAlign: "right" } }}
                />
              </Box>
            </Box>

            <Button
              variant="contained"
              onClick={handleSubmit(onSubmit)}
              sx={{ mt: 3, width: "100%" }}
            >
              ➕ Create Order
            </Button>
          </Paper>
        </Grid>
      </Grid>

      {/* ADD NEW ADDRESS DIALOG */}
      <Dialog
        open={addrOpen}
        onClose={() => setAddrOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          Add New Address
          <IconButton
            onClick={() => setAddrOpen(false)}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers>
          <TextField
            label="Name"
            fullWidth
            sx={{ mb: 2 }}
            value={customerDetails?.name || ""}
            disabled
          />
          <TextField
            label="Mobile"
            fullWidth
            sx={{ mb: 2 }}
            value={customerDetails?.mobile || ""}
            disabled
          />

          <TextField
            label="Address Line"
            fullWidth
            sx={{ mb: 2 }}
            value={newAddr.address_line}
            onChange={(e) =>
              setNewAddr((s) => ({ ...s, address_line: e.target.value }))
            }
          />
          <TextField
            label="Locality"
            fullWidth
            sx={{ mb: 2 }}
            value={newAddr.locality}
            onChange={(e) =>
              setNewAddr((s) => ({ ...s, locality: e.target.value }))
            }
          />
          <TextField
            label="City"
            fullWidth
            sx={{ mb: 2 }}
            value={newAddr.city}
            onChange={(e) => setNewAddr((s) => ({ ...s, city: e.target.value }))}
          />

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="state-select-label">State</InputLabel>
            <Select
              labelId="state-select-label"
              label="State"
              value={newAddr.state_id}
              onChange={(e) =>
                setNewAddr((s) => ({ ...s, state_id: e.target.value }))
              }
            >
              <MenuItem value="">Select state</MenuItem>
              {statesList.map((st) => (
                <MenuItem
                  key={st.state_id ?? st.id}
                  value={st.state_id ?? st.id}
                >
                  {st.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Pincode"
            fullWidth
            sx={{ mb: 2 }}
            value={newAddr.pincode}
            onChange={(e) =>
              setNewAddr((s) => ({ ...s, pincode: e.target.value }))
            }
          />
          <TextField
            label="Landmark (optional)"
            fullWidth
            sx={{ mb: 2 }}
            value={newAddr.landmark}
            onChange={(e) =>
              setNewAddr((s) => ({ ...s, landmark: e.target.value }))
            }
          />
          <TextField
            label="Alternate Phone (optional)"
            fullWidth
            sx={{ mb: 2 }}
            value={newAddr.alternate_phone}
            onChange={(e) =>
              setNewAddr((s) => ({ ...s, alternate_phone: e.target.value }))
            }
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setAddrOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddNewAddress}>
            Save Address
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* Product Browse Dialog Component */
function ProductBrowseDialog({ open, onClose, products = [], onPick, loading }) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = products.filter((p) =>
    (p.name || "")
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        Browse Products
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ mb: 2, display: "flex", gap: 2 }}>
          <TextField
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            size="small"
          />
        </Box>

        {loading ? (
          <Typography>Loading...</Typography>
        ) : filtered.length === 0 ? (
          <Typography>No products found.</Typography>
        ) : (
          <Grid container spacing={2}>
            {filtered.map((p) => (
              <Grid item xs={12} md={6} key={p.id ?? p.product_id}>
                <Paper
                  sx={{
                    display: "flex",
                    gap: 2,
                    p: 2,
                    alignItems: "center",
                  }}
                >
                  <Box
                    sx={{
                      width: 72,
                      height: 72,
                      bgcolor: "#f3f4f6",
                      borderRadius: 1,
                    }}
                  >
                    {p.image && (
                      <img
                        src={p.image}
                        alt={p.name}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    )}
                  </Box>

                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle1">{p.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      ₹{(p.price ?? p.mrp ?? 0).toFixed(2)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Available: {p.stock ?? "-"}
                    </Typography>

                    <Box sx={{ mt: 1 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => onPick(p)}
                      >
                        Add
                      </Button>
                    </Box>
                  </Box>
                </Paper>
              </Grid>
            ))}
          </Grid>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
