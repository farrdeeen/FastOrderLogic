import { useState, useEffect } from "react";
import api from "../../api/axiosInstance";
import {
  PaymentBadge,
  DeliveryBadge,
  FulfillmentBadge,
  SerialBadge,
  InvoiceButton,
} from "./Badges";
import { fmtCurrency, fmtDate } from "./helpers";
import { toast } from "./ToastSystem";
import AddAddressForm from "./AddAddressForm";
import AddProductPanel from "./AddProductPanel";
import ProductSearchInput from "./ProductSearchInput";
import OfflinePOD from "./OfflinePOD";

/* ─── Derive order lifecycle status automatically ──────────────────────────
   Rules (checked in order):
   1. Has invoice_number  → FULFILLED  (all edits locked)
   2. Has awb_number      → SHIPPED
   3. Has utr_number      → PAID / awaiting shipment
   4. Has serials in DB   → PACKED / ready to ship
   5. Default             → PENDING
   ───────────────────────────────────────────────────────────────────────── */
function deriveStatus({
  invoice_number,
  awb_number,
  utr_number,
  serial_status,
}) {
  if (invoice_number && invoice_number !== "NA" && invoice_number.trim() !== "")
    return "FULFILLED";
  if (awb_number && awb_number !== "To be assigned" && awb_number.trim() !== "")
    return "SHIPPED";
  if (utr_number && utr_number.trim() !== "") return "PAID";
  if (serial_status === "complete" || serial_status === "partial")
    return "PACKED";
  return "PENDING";
}

const STATUS_BADGE = {
  FULFILLED: { label: "Fulfilled", cls: "badge-green" },
  SHIPPED: { label: "Shipped", cls: "badge-blue" },
  PAID: { label: "Paid — Awaiting Shipment", cls: "badge-amber" },
  PACKED: { label: "Packed", cls: "badge-purple" },
  PENDING: { label: "Pending", cls: "badge-gray" },
};

export default function OrderLightbox({
  order,
  details,
  loading,
  onClose,
  onAction,
  invoiceLoading,
}) {
  const [utrOpen, setUtrOpen] = useState(false);
  const [utrValue, setUtrValue] = useState("");
  const [serialOpen, setSerialOpen] = useState(false);
  const [serialItems, setSerialItems] = useState([]);
  const [serialLoading, setSerialLoading] = useState(false);

  const [remarksVal, setRemarksVal] = useState(details?.remarks || "");
  const [remarksEditing, setRemarksEditing] = useState(false);

  // UTR field (standalone, not tied to mark-paid)
  const [utrFieldVal, setUtrFieldVal] = useState(
    details?.utr_number || order.utr_number || "",
  );
  const [utrFieldEditing, setUtrFieldEditing] = useState(false);

  // AWB field (manual update)
  const [awbFieldVal, setAwbFieldVal] = useState(order.awb_number || "");
  const [awbFieldEditing, setAwbFieldEditing] = useState(false);

  // Invoice number field (manual update)
  const [invoiceFieldVal, setInvoiceFieldVal] = useState(
    details?.invoice_number ?? order.invoice_number ?? "",
  );
  const [invoiceFieldEditing, setInvoiceFieldEditing] = useState(false);

  const [localPayStatus, setLocalPayStatus] = useState(order.payment_status);
  const [localOrderStatus, setLocalOrderStatus] = useState(
    order.order_status || "",
  );
  const [confirmReject, setConfirmReject] = useState(false);

  const [emailEditing, setEmailEditing] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [mobileValue, setMobileValue] = useState("");

  const [editingItemId, setEditingItemId] = useState(null);
  const [editingPrice, setEditingPrice] = useState("");

  const [addressMode, setAddressMode] = useState("view");
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [availableAddresses, setAvailableAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  const [editingProductItemId, setEditingProductItemId] = useState(null);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProductForEdit, setSelectedProductForEdit] = useState(null);

  const [showAddProduct, setShowAddProduct] = useState(false);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState(null);

  const [showPOD, setShowPOD] = useState(false);
  const [podData, setPodData] = useState(null);

  // Sync fields when details arrive
  useEffect(() => {
    if (details?.remarks != null) setRemarksVal(details.remarks);
    if (details?.utr_number != null) setUtrFieldVal(details.utr_number || "");
    if (details?.invoice_number != null)
      setInvoiceFieldVal(details.invoice_number || "");
  }, [details]);

  useEffect(() => {
    const cust = order.customer;
    if (cust) {
      setEmailValue(cust.email || "");
      setMobileValue(cust.mobile || "");
    }
    setAwbFieldVal(order.awb_number || "");
  }, [order]);

  useEffect(() => {
    loadProducts();
  }, []);

  /* ── Derived lifecycle status ── */
  const lifecycleStatus = deriveStatus({
    invoice_number: invoiceFieldVal,
    awb_number: awbFieldVal,
    utr_number: utrFieldVal,
    serial_status: details?.serial_status,
  });
  const isFulfilled = lifecycleStatus === "FULFILLED";
  const statusInfo = STATUS_BADGE[lifecycleStatus];

  const loadProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await api.get("/orders/products/list");
      setAvailableProducts(res.data || []);
    } catch {
      setAvailableProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const loadAddresses = async () => {
    setLoadingAddresses(true);
    try {
      const custType = order.customer_id ? "online" : "offline";
      const custId = order.customer_id || order.offline_customer_id;
      const res = await api.get(
        `/dropdowns/customers/${custType}/${custId}/addresses`,
      );
      setAvailableAddresses(res.data || []);
      setSelectedAddressId(order.address_id);
      setAddressMode("select");
    } catch {
      toast.error("Failed to load addresses");
    } finally {
      setLoadingAddresses(false);
    }
  };

  const saveAddress = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-address`,
        {
          address_id: selectedAddressId,
        },
      );
      setAddressMode("view");
      toast.success("Delivery address updated");
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update address");
    }
  };

  const handleAddressCreated = async (newAddress) => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-address`,
        {
          address_id: newAddress.address_id,
        },
      );
      setAddressMode("view");
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.warn(
        "Address created but could not be applied. Please select it manually.",
      );
      setAddressMode("view");
      onAction && onAction(order.order_id, "refresh");
    }
  };

  const saveProduct = async (itemId) => {
    if (!selectedProductForEdit) return;
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-item-product`,
        {
          item_id: itemId,
          product_id: selectedProductForEdit.id,
        },
      );
      toast.success(`Product updated to ${selectedProductForEdit.name}`);
      setEditingProductItemId(null);
      setSelectedProductForEdit(null);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update product");
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      await api.delete(
        `/orders/${encodeURIComponent(order.order_id)}/items/${itemId}`,
      );
      toast.success("Item removed from order");
      setConfirmDeleteItemId(null);
      onAction && onAction(order.order_id, "refresh");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to remove item");
      setConfirmDeleteItemId(null);
    }
  };

  const handleItemAdded = () => {
    setShowAddProduct(false);
    onAction && onAction(order.order_id, "refresh");
  };

  const openSerials = async () => {
    setSerialLoading(true);
    try {
      const res = await api.get(
        `/orders/${encodeURIComponent(order.order_id)}/serial_numbers`,
      );
      const normalized = (res.data || []).map((it) => ({
        ...it,
        serials: it.serials?.length ? it.serials : Array(it.quantity).fill(""),
      }));
      setSerialItems(normalized);
      setSerialOpen(true);
    } catch {
      toast.error("Failed to load serial numbers");
    } finally {
      setSerialLoading(false);
    }
  };

  const saveSerials = async () => {
    try {
      await api.post(
        `/orders/${encodeURIComponent(order.order_id)}/serial_numbers/save`,
        {
          entries: serialItems,
        },
      );
      toast.success("Serial numbers saved");
      setSerialOpen(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to save serial numbers");
    }
  };

  const submitUTR = async () => {
    if (!utrValue.trim()) {
      toast.warn("Enter UTR number");
      return;
    }
    await onAction(order.order_id, "mark-paid-utr", utrValue.trim());
    setLocalPayStatus("paid");
    setUtrFieldVal(utrValue.trim());
    setUtrOpen(false);
    setUtrValue("");
    onAction && onAction(order.order_id, "refresh");
  };

  const saveUtrField = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-utr`,
        {
          utr_number: utrFieldVal,
        },
      );
      toast.success("UTR number updated");
      setUtrFieldEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update UTR number");
    }
  };

  // ── NEW: Save AWB manually ──
  const saveAwbField = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-awb`,
        {
          awb_number: awbFieldVal,
        },
      );
      toast.success("AWB number updated");
      setAwbFieldEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update AWB number");
    }
  };

  // ── NEW: Save Invoice Number manually ──
  const saveInvoiceField = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-invoice-number`,
        {
          invoice_number: invoiceFieldVal,
        },
      );
      toast.success("Invoice number updated");
      setInvoiceFieldEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update invoice number");
    }
  };

  const handleInvoice = () =>
    onAction && onAction(order.order_id, "create-invoice");

  const saveRemarks = async () => {
    try {
      await onAction(order.order_id, "update-remarks", remarksVal);
      toast.success("Remarks saved");
      setRemarksEditing(false);
    } catch {
      toast.error("Failed to save remarks");
    }
  };

  const saveEmail = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-email`,
        {
          email: emailValue.trim(),
        },
      );
      toast.success("Email updated");
      setEmailEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update email");
    }
  };

  const saveMobile = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-mobile`,
        {
          mobile: mobileValue.trim(),
        },
      );
      toast.success("Mobile updated");
      setMobileEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update mobile");
    }
  };

  const saveItemPrice = async (itemId) => {
    try {
      const newPrice = parseFloat(editingPrice);
      if (isNaN(newPrice) || newPrice < 0) {
        toast.warn("Invalid price");
        return;
      }
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-item-price`,
        {
          item_id: itemId,
          unit_price: newPrice,
        },
      );
      toast.success("Price updated");
      setEditingItemId(null);
      setEditingPrice("");
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update item price");
    }
  };

  const handleReject = async () => {
    try {
      await api.put(`/orders/${encodeURIComponent(order.order_id)}/reject`);
      toast.success("Order rejected");
      setLocalOrderStatus("REJECTED");
      setConfirmReject(false);
      onAction && onAction(order.order_id, "refresh");
      onClose();
    } catch {
      toast.error("Failed to reject order");
    }
  };

  const handlePrintOfflinePOD = async () => {
    try {
      const res = await api.get(
        `/delhivery/pod-data/${encodeURIComponent(order.order_id)}`,
      );
      setPodData(res.data);
      setShowPOD(true);
    } catch {
      setPodData({
        order_id: order.order_id,
        created_at: order.created_at,
        items: [],
        address: {},
        seller: {},
      });
      setShowPOD(true);
    }
  };

  const cust = details?.customer || order.customer;
  const currentInvoice =
    invoiceFieldVal || details?.invoice_number || order.invoice_number;
  const currentOrderStatus = details?.order_status ?? localOrderStatus;

  /* ── Reusable inline field renderer ── */
  const InlineField = ({
    label,
    value,
    editing,
    onEdit,
    onSave,
    onCancel,
    onChange,
    mono = false,
    placeholder = "",
  }) => (
    <div className="form-field">
      <label className="form-label">{label}</label>
      {editing ? (
        <>
          <input
            className="form-input"
            style={
              mono ? { fontFamily: "'DM Mono',monospace", fontSize: 12.5 } : {}
            }
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancel();
            }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
            <button
              className="lb-btn lb-btn-primary lb-btn-sm"
              onClick={onSave}
            >
              Save
            </button>
            <button
              className="lb-btn lb-btn-secondary lb-btn-sm"
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div
          onClick={isFulfilled ? undefined : onEdit}
          style={{
            padding: "9px 11px",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: mono ? 12.5 : 13,
            cursor: isFulfilled ? "default" : "pointer",
            fontFamily: mono ? "'DM Mono',monospace" : "inherit",
            color: value
              ? mono
                ? "var(--green)"
                : "var(--text)"
              : "var(--text3)",
            minHeight: 40,
            display: "flex",
            alignItems: "center",
            opacity: isFulfilled ? 0.7 : 1,
          }}
        >
          {value ||
            (isFulfilled ? "—" : `Click to add ${label.toLowerCase()}…`)}
        </div>
      )}
    </div>
  );

  return (
    <>
      <div
        className="lb-overlay"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="lb-panel">
          {/* ── HEADER ── */}
          <div className="lb-header">
            <div>
              <div className="lb-title">Order Details</div>
              <div className="lb-subtitle">{order.order_id}</div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              {/* Auto-derived lifecycle badge */}
              <span className={`badge ${statusInfo.cls}`}>
                {statusInfo.label}
              </span>
              <PaymentBadge status={localPayStatus} />
              {currentOrderStatus === "REJECTED" && (
                <span className="badge badge-red">Rejected</span>
              )}
              {awbFieldVal && awbFieldVal !== "To be assigned" && (
                <span
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 11,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  AWB: {awbFieldVal}
                </span>
              )}
              <button className="lb-close" onClick={onClose}>
                ✕
              </button>
            </div>
          </div>

          <div className="lb-body">
            {/* ── LEFT COLUMN ── */}
            <div className="lb-section">
              {/* Customer & Order */}
              <div>
                <div className="lb-section-title">Customer & Order</div>
                <div className="lb-info-grid">
                  <div className="lb-info-card">
                    <div className="lb-info-label">Customer</div>
                    <div className="lb-info-value">{cust?.name || "—"}</div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Mobile</div>
                    <div className="lb-info-value">
                      {mobileEditing ? (
                        <input
                          className="inline-edit-input"
                          value={mobileValue}
                          onChange={(e) => setMobileValue(e.target.value)}
                          onBlur={saveMobile}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveMobile();
                            if (e.key === "Escape") {
                              setMobileEditing(false);
                              setMobileValue(cust?.mobile || "");
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <>
                          <span style={{ fontFamily: "'DM Mono',monospace" }}>
                            {cust?.mobile || "—"}
                          </span>
                          {!isFulfilled && (
                            <span
                              className="edit-icon"
                              onClick={() => setMobileEditing(true)}
                              title="Edit mobile"
                            >
                              ✏️
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Email</div>
                    <div className="lb-info-value">
                      {emailEditing ? (
                        <input
                          className="inline-edit-input"
                          type="email"
                          value={emailValue}
                          onChange={(e) => setEmailValue(e.target.value)}
                          onBlur={saveEmail}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEmail();
                            if (e.key === "Escape") {
                              setEmailEditing(false);
                              setEmailValue(cust?.email || "");
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <>
                          <span>{cust?.email || "—"}</span>
                          {!isFulfilled && (
                            <span
                              className="edit-icon"
                              onClick={() => setEmailEditing(true)}
                              title="Edit email"
                            >
                              ✏️
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Channel</div>
                    <div className="lb-info-value">{order.channel || "—"}</div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Created</div>
                    <div className="lb-info-value">
                      {fmtDate(order.created_at)}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Amount</div>
                    <div className="lb-info-value">
                      {fmtCurrency(order.total_amount)}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Payment Type</div>
                    <div className="lb-info-value">
                      {order.payment_type || "—"}
                    </div>
                  </div>
                  {details?.fulfillment_status != null && (
                    <div className="lb-info-card">
                      <div className="lb-info-label">Fulfillment</div>
                      <div className="lb-info-value">
                        <FulfillmentBadge status={details.fulfillment_status} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {loading && (
                <div style={{ color: "var(--text3)", fontSize: 12.5 }}>
                  Loading details…
                </div>
              )}

              {/* ── DELIVERY ADDRESS ── */}
              {(details?.address || !loading) && (
                <div>
                  <div
                    className="lb-section-title"
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    Delivery Address
                    {addressMode === "view" && !isFulfilled && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <span
                          className="edit-icon"
                          onClick={loadAddresses}
                          title="Change address"
                          style={{ cursor: "pointer" }}
                        >
                          ✏️
                        </span>
                        <button
                          className="lb-btn lb-btn-secondary lb-btn-sm"
                          onClick={() => setAddressMode("add")}
                          style={{ fontSize: 11, padding: "2px 8px" }}
                        >
                          ➕ New
                        </button>
                      </div>
                    )}
                  </div>
                  {addressMode === "view" && details?.address && (
                    <div
                      className="lb-info-card"
                      style={{ lineHeight: 1.6, fontSize: 13 }}
                    >
                      <strong>{details.address.name}</strong> ·{" "}
                      {details.address.mobile}
                      <br />
                      {details.address.address_line}, {details.address.city},{" "}
                      {details.address.state_name} — {details.address.pincode}
                      {details.address.landmark && (
                        <span> ({details.address.landmark})</span>
                      )}
                    </div>
                  )}
                  {addressMode === "select" && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {loadingAddresses ? (
                        <div style={{ color: "var(--text3)", fontSize: 12.5 }}>
                          Loading addresses…
                        </div>
                      ) : (
                        <>
                          <select
                            value={selectedAddressId || ""}
                            onChange={(e) =>
                              setSelectedAddressId(parseInt(e.target.value))
                            }
                            className="form-select"
                          >
                            <option value="">Select Address</option>
                            {availableAddresses.map((addr) => (
                              <option
                                key={addr.address_id}
                                value={addr.address_id}
                              >
                                {addr.label ||
                                  `${addr.address_line}, ${addr.city}`}
                              </option>
                            ))}
                          </select>
                          <div style={{ display: "flex", gap: 7 }}>
                            <button
                              className="lb-btn lb-btn-primary lb-btn-sm"
                              onClick={saveAddress}
                            >
                              Save
                            </button>
                            <button
                              className="lb-btn lb-btn-secondary lb-btn-sm"
                              onClick={() => setAddressMode("add")}
                            >
                              ➕ Add New Instead
                            </button>
                            <button
                              className="lb-btn lb-btn-secondary lb-btn-sm"
                              onClick={() => setAddressMode("view")}
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {addressMode === "add" && (
                    <AddAddressForm
                      order={order}
                      onSaved={handleAddressCreated}
                      onCancel={() => setAddressMode("view")}
                    />
                  )}
                </div>
              )}

              {/* ── NOTES: Remarks + UTR + AWB + Invoice Number ── */}
              <div>
                <div className="lb-section-title">Notes & References</div>

                {/* Row 1: Remarks + UTR */}
                <div className="remarks-utr-row" style={{ marginBottom: 10 }}>
                  {/* Remarks */}
                  <div className="form-field">
                    <label className="form-label">Remarks</label>
                    {remarksEditing ? (
                      <>
                        <textarea
                          className="remarks-input"
                          value={remarksVal}
                          onChange={(e) => setRemarksVal(e.target.value)}
                          placeholder="Add a remark…"
                        />
                        <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
                          <button
                            className="lb-btn lb-btn-primary lb-btn-sm"
                            onClick={saveRemarks}
                          >
                            Save
                          </button>
                          <button
                            className="lb-btn lb-btn-secondary lb-btn-sm"
                            onClick={() => setRemarksEditing(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div
                        onClick={
                          isFulfilled
                            ? undefined
                            : () => setRemarksEditing(true)
                        }
                        style={{
                          padding: "9px 11px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          fontSize: 13,
                          cursor: isFulfilled ? "default" : "pointer",
                          color: remarksVal ? "var(--text)" : "var(--text3)",
                          minHeight: 54,
                          opacity: isFulfilled ? 0.7 : 1,
                        }}
                      >
                        {remarksVal ||
                          (isFulfilled ? "—" : "Click to add a remark…")}
                      </div>
                    )}
                  </div>

                  {/* UTR */}
                  <InlineField
                    label="UTR / Ref No."
                    value={utrFieldVal}
                    editing={utrFieldEditing}
                    onEdit={() => setUtrFieldEditing(true)}
                    onSave={saveUtrField}
                    onCancel={() => setUtrFieldEditing(false)}
                    onChange={setUtrFieldVal}
                    mono
                    placeholder="Transaction reference…"
                  />
                </div>

                {/* Row 2: AWB + Invoice Number */}
                <div className="remarks-utr-row">
                  <InlineField
                    label="AWB / Waybill No."
                    value={awbFieldVal}
                    editing={awbFieldEditing}
                    onEdit={() => setAwbFieldEditing(true)}
                    onSave={saveAwbField}
                    onCancel={() => setAwbFieldEditing(false)}
                    onChange={setAwbFieldVal}
                    mono
                    placeholder="Courier tracking number…"
                  />
                  <InlineField
                    label="Invoice Number"
                    value={invoiceFieldVal}
                    editing={invoiceFieldEditing}
                    onEdit={() => setInvoiceFieldEditing(true)}
                    onSave={saveInvoiceField}
                    onCancel={() => setInvoiceFieldEditing(false)}
                    onChange={setInvoiceFieldVal}
                    mono
                    placeholder="e.g. INV-20240101-001…"
                  />
                </div>
              </div>

              {/* UTR mark-paid box */}
              {localPayStatus !== "paid" && utrOpen && (
                <div className="utr-box">
                  <label>Enter UTR / Transaction Reference Number</label>
                  <div className="utr-input-row">
                    <input
                      className="utr-input"
                      placeholder="e.g. UTR123456789012"
                      value={utrValue}
                      onChange={(e) => setUtrValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitUTR()}
                    />
                    <button
                      className="lb-btn lb-btn-success"
                      onClick={submitUTR}
                    >
                      Mark Paid
                    </button>
                    <button
                      className="lb-btn lb-btn-secondary"
                      onClick={() => setUtrOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── RIGHT COLUMN ── */}
            <div className="lb-section">
              {/* Items list */}
              {details?.items?.length > 0 && (
                <div>
                  <div
                    className="lb-section-title"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>Items ({details.items.length})</span>
                    {!isFulfilled && (
                      <button
                        className="lb-btn lb-btn-secondary lb-btn-sm"
                        onClick={() => setShowAddProduct((v) => !v)}
                        style={{ fontSize: 11 }}
                      >
                        {showAddProduct ? "✕ Cancel" : "➕ Add Product"}
                      </button>
                    )}
                  </div>
                  <div className="lb-items-table-wrap">
                    <table className="lb-items-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Qty</th>
                          <th>Unit Price</th>
                          <th>Total</th>
                          {!isFulfilled && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {details.items.map((it) => (
                          <tr key={it.item_id} style={{ overflow: "visible" }}>
                            <td
                              style={{
                                overflow: "visible",
                                position: "relative",
                              }}
                            >
                              {!isFulfilled &&
                              editingProductItemId === it.item_id ? (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                    overflow: "visible",
                                  }}
                                >
                                  <div
                                    style={{
                                      flex: 1,
                                      position: "relative",
                                      overflow: "visible",
                                    }}
                                  >
                                    <ProductSearchInput
                                      products={availableProducts}
                                      value={selectedProductForEdit?.id}
                                      onChange={(p) =>
                                        setSelectedProductForEdit(p)
                                      }
                                      placeholder="Search product…"
                                    />
                                  </div>
                                  <button
                                    className="lb-btn lb-btn-primary lb-btn-sm"
                                    onClick={() => saveProduct(it.item_id)}
                                    disabled={!selectedProductForEdit}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    className="lb-btn lb-btn-secondary lb-btn-sm"
                                    onClick={() => {
                                      setEditingProductItemId(null);
                                      setSelectedProductForEdit(null);
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <span>{it.product_name}</span>
                                  {!isFulfilled && (
                                    <span
                                      className="edit-icon"
                                      onClick={() => {
                                        setEditingProductItemId(it.item_id);
                                        setSelectedProductForEdit(null);
                                      }}
                                      title="Edit product"
                                    >
                                      ✏️
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>{it.quantity}</td>
                            <td>
                              {!isFulfilled && editingItemId === it.item_id ? (
                                <input
                                  className="inline-edit-input"
                                  type="number"
                                  step="0.01"
                                  value={editingPrice}
                                  onChange={(e) =>
                                    setEditingPrice(e.target.value)
                                  }
                                  onBlur={() => saveItemPrice(it.item_id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      saveItemPrice(it.item_id);
                                    if (e.key === "Escape") {
                                      setEditingItemId(null);
                                      setEditingPrice("");
                                    }
                                  }}
                                  autoFocus
                                  style={{ width: "110px" }}
                                />
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <span>{fmtCurrency(it.unit_price)}</span>
                                  {!isFulfilled && (
                                    <span
                                      className="edit-icon"
                                      onClick={() => {
                                        setEditingItemId(it.item_id);
                                        setEditingPrice(it.unit_price);
                                      }}
                                      title="Edit price"
                                    >
                                      ✏️
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>{fmtCurrency(it.total_price)}</td>
                            {!isFulfilled && (
                              <td style={{ width: 32, textAlign: "center" }}>
                                {confirmDeleteItemId === it.item_id ? (
                                  <div style={{ display: "flex", gap: 4 }}>
                                    <button
                                      className="lb-btn lb-btn-danger lb-btn-sm"
                                      onClick={() =>
                                        handleDeleteItem(it.item_id)
                                      }
                                      style={{
                                        padding: "2px 7px",
                                        fontSize: 11,
                                      }}
                                    >
                                      Yes
                                    </button>
                                    <button
                                      className="lb-btn lb-btn-secondary lb-btn-sm"
                                      onClick={() =>
                                        setConfirmDeleteItemId(null)
                                      }
                                      style={{
                                        padding: "2px 7px",
                                        fontSize: 11,
                                      }}
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <span
                                    className="del-icon"
                                    title="Remove item"
                                    onClick={() =>
                                      setConfirmDeleteItemId(it.item_id)
                                    }
                                  >
                                    🗑
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {showAddProduct && !isFulfilled && (
                    <AddProductPanel
                      orderId={order.order_id}
                      products={availableProducts}
                      onAdded={handleItemAdded}
                      onCancel={() => setShowAddProduct(false)}
                    />
                  )}
                </div>
              )}

              {/* Empty items state */}
              {!loading &&
                details &&
                (!details.items || details.items.length === 0) && (
                  <div>
                    <div
                      className="lb-section-title"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>Items</span>
                      {!isFulfilled && (
                        <button
                          className="lb-btn lb-btn-secondary lb-btn-sm"
                          onClick={() => setShowAddProduct((v) => !v)}
                          style={{ fontSize: 11 }}
                        >
                          {showAddProduct ? "✕ Cancel" : "➕ Add Product"}
                        </button>
                      )}
                    </div>
                    {showAddProduct && !isFulfilled && (
                      <AddProductPanel
                        orderId={order.order_id}
                        products={availableProducts}
                        onAdded={handleItemAdded}
                        onCancel={() => setShowAddProduct(false)}
                      />
                    )}
                  </div>
                )}

              {/* ── SERIAL STATUS BADGE ── */}
              {details?.serial_status && (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div className="lb-section-title" style={{ marginBottom: 0 }}>
                    Serial Status:
                  </div>
                  <SerialBadge status={details.serial_status} />
                </div>
              )}

              {/* ── SERIAL NUMBERS READ VIEW (Point 4) ── */}
              {details?.serial_items?.length > 0 && !serialOpen && (
                <div>
                  <div className="lb-section-title">
                    Assigned Serial Numbers
                  </div>
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      overflow: "hidden",
                    }}
                  >
                    {details.serial_items.map(
                      (item) =>
                        item.serials?.length > 0 && (
                          <div
                            key={item.item_id}
                            style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid var(--border)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11.5,
                                fontWeight: 600,
                                color: "var(--text2)",
                                marginBottom: 6,
                              }}
                            >
                              {item.product_name}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 6,
                              }}
                            >
                              {item.serials.map((sn, i) => (
                                <span
                                  key={i}
                                  style={{
                                    fontFamily: "'DM Mono',monospace",
                                    fontSize: 11,
                                    background: "var(--surface2)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 5,
                                    padding: "2px 8px",
                                    color: "var(--text)",
                                  }}
                                >
                                  {sn}
                                </span>
                              ))}
                            </div>
                          </div>
                        ),
                    )}
                  </div>
                </div>
              )}

              {/* Serial entry / edit panel */}
              {serialOpen && (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "11px 14px",
                      background: "var(--surface2)",
                      borderBottom: "1px solid var(--border)",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    Assign Serial Numbers
                  </div>
                  <div style={{ padding: 14 }}>
                    {serialItems.map((item) => (
                      <div className="serial-item" key={item.item_id}>
                        <h4>
                          {item.product_name} — Qty {item.quantity}
                        </h4>
                        {item.serials.map((sn, i) => (
                          <input
                            key={`${item.item_id}-${i}`}
                            className="serial-input"
                            type="text"
                            value={sn}
                            placeholder={`Serial ${i + 1}`}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSerialItems((prev) =>
                                prev.map((it) =>
                                  it.item_id === item.item_id
                                    ? {
                                        ...it,
                                        serials: it.serials.map((s, idx) =>
                                          idx === i ? val : s,
                                        ),
                                      }
                                    : it,
                                ),
                              );
                            }}
                          />
                        ))}
                      </div>
                    ))}
                    <div
                      style={{
                        display: "flex",
                        gap: 7,
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        className="lb-btn lb-btn-secondary"
                        onClick={() => setSerialOpen(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="lb-btn lb-btn-primary"
                        onClick={saveSerials}
                      >
                        Save Serials
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── ACTION BAR ── */}
          <div className="lb-actions">
            {!isFulfilled && (
              <>
                {localPayStatus !== "paid" ? (
                  <button
                    className="lb-btn lb-btn-success"
                    onClick={() => setUtrOpen((v) => !v)}
                  >
                    💳 Mark as Paid
                  </button>
                ) : (
                  <span
                    className="badge badge-green"
                    style={{ fontSize: 11.5 }}
                  >
                    ✓ Payment Received
                  </span>
                )}

                <button
                  className="lb-btn lb-btn-secondary"
                  onClick={
                    serialOpen ? () => setSerialOpen(false) : openSerials
                  }
                  disabled={serialLoading}
                >
                  {serialLoading ? "…" : "🔢 Serials"}
                </button>

                <InvoiceButton
                  orderId={order.order_id}
                  invoiceNumber={order.invoice_number}
                  detailsInvoice={currentInvoice}
                  onGenerate={handleInvoice}
                  loading={invoiceLoading}
                  orderStatus={currentOrderStatus}
                />
              </>
            )}

            {isFulfilled && (
              <span className="badge badge-green" style={{ fontSize: 12 }}>
                🔒 Order Fulfilled — editing disabled
              </span>
            )}

            <button
              className="lb-btn lb-btn-orange"
              onClick={handlePrintOfflinePOD}
            >
              🖨️ Print POD
            </button>
            <button
              className="lb-btn lb-btn-secondary"
              onClick={handlePrintOfflinePOD}
            >
              ⬇️ Download POD
            </button>

            <div style={{ flex: 1 }} />

            {!isFulfilled &&
              (confirmReject ? (
                <>
                  <span style={{ fontSize: 12, color: "var(--red)" }}>
                    Reject this order?
                  </span>
                  <button
                    className="lb-btn lb-btn-danger"
                    onClick={handleReject}
                  >
                    Yes, Reject
                  </button>
                  <button
                    className="lb-btn lb-btn-secondary"
                    onClick={() => setConfirmReject(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                currentOrderStatus !== "REJECTED" && (
                  <button
                    className="lb-btn lb-btn-danger"
                    onClick={() => setConfirmReject(true)}
                  >
                    ⛔ Reject
                  </button>
                )
              ))}
          </div>
        </div>
      </div>

      {showPOD && podData && (
        <OfflinePOD data={podData} onClose={() => setShowPOD(false)} />
      )}
    </>
  );
}
