/**
 * forms/CreateOrderForm.jsx
 *
 * FIXES IN THIS VERSION:
 *
 * 1. Back / Browse Products / Add Customer buttons moved INTO the form header
 *    — App.jsx no longer renders any wrapper buttons for this page.
 *
 * 2. Dark theme removed — styles.js now uses a clean light palette.
 *
 * 3. CustomerForm inside the modal uses a compact two-column grid layout so it
 *    never causes vertical scroll on 13"+ screens (max-height + overflow-y on
 *    the modal body handles any overflow gracefully).
 *
 * 4. hasItems bug fixed — was derived from stale closure in disabled prop.
 *    Now computed directly from items.length inside the JSX so it always
 *    reflects the latest render.
 *
 * 5. CREATE ORDER button disabled bug fixed:
 *    Previously hasCustomer required BOTH selectedCustomer AND customerDetails,
 *    meaning the button stayed disabled while customerDetails was still loading
 *    or if the API call failed silently. Now:
 *      - hasCustomerSelected = !!selectedCustomer (immediate, from local state)
 *      - hasCustomerDetails  = !!customerDetails  (async, used only for UI display)
 *    The submit button and address-loading guard against hasCustomerSelected,
 *    not the async-derived hasCustomer. This means the button enables as soon
 *    as a customer is picked, an address is selected, items exist, and a
 *    payment type is chosen — with no dependency on the async details fetch.
 *
 * 6. NEW CUSTOMER AUTO-SELECTION FIX:
 *    CustomerSearch owned `selectedLabel` as purely internal state. When
 *    handleCustomerCreated called setSelectedCustomer(value) from the parent,
 *    CustomerSearch had no way to show the name — the pill never appeared.
 *
 *    Fix: added an `externalLabel` prop to CustomerSearch. The parent builds
 *    the label string ("Name · mobile") and passes it down alongside the value.
 *    A useEffect inside CustomerSearch syncs internal selectedLabel whenever
 *    externalLabel changes to a non-empty string, so the pill renders
 *    immediately after modal close — no extra API call needed.
 *
 *    Changes in the parent (CreateOrderForm):
 *      a) customerSearchLabel state + setCustomerSearchLabel
 *      b) handleCustomerCreated sets both selectedCustomer AND customerSearchLabel
 *      c) CustomerSearch receives externalLabel={customerSearchLabel}
 *         and clears it via onChange when the user hits ✕
 *    Changes in CustomerSearch:
 *      a) accepts externalLabel prop
 *      b) useEffect syncs internal label from externalLabel when it is non-empty
 */

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import api from "../../api/axiosInstance";
import { injectFormStyles } from "./styles";
import CustomerForm from "./CustomerForm";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const clamp = (v, min = 0) => Math.max(min, Number(v) || 0);

function extractErrorMsg(err, fallback = "Something went wrong") {
  if (!err) return fallback;
  const d = err?.response?.data;
  if (!d) return err?.message || fallback;
  if (typeof d === "string") return d;
  if (typeof d?.detail === "string") return d.detail;
  if (Array.isArray(d?.detail)) {
    return d.detail
      .map((e) => `${e.loc?.slice(-1)?.[0] ?? "field"}: ${e.msg}`)
      .join(" · ");
  }
  if (typeof d?.message === "string") return d.message;
  return JSON.stringify(d) || fallback;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`f-toast ${toast.type}`}>
      {toast.type === "success" ? "✓" : "✕"} {toast.msg}
    </div>
  );
}

// ─── Qty Stepper ──────────────────────────────────────────────────────────────
function QtyInput({ value, onChange }) {
  return (
    <div className="f-qty-stepper">
      <button
        className="f-qty-btn"
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        −
      </button>
      <input
        className="f-qty-num"
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(clamp(e.target.value, 1))}
      />
      <button
        className="f-qty-btn"
        type="button"
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

// ─── ProductThumb ─────────────────────────────────────────────────────────────
function ProductThumb({ src, name, size = 40 }) {
  const [status, setStatus] = useState(src ? "loading" : "none");
  useEffect(() => {
    setStatus(src ? "loading" : "none");
  }, [src]);

  if (!src || status === "none" || status === "error") {
    return (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.42,
          background: "var(--f-surface3)",
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        📦
      </div>
    );
  }
  return (
    <div
      style={{ width: size, height: size, position: "relative", flexShrink: 0 }}
    >
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--f-surface3)",
            borderRadius: 4,
          }}
        />
      )}
      <img
        src={src}
        alt={name}
        onLoad={() => setStatus("ok")}
        onError={() => setStatus("error")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: 4,
          display: status === "ok" ? "block" : "none",
        }}
      />
    </div>
  );
}

// ─── Create Customer Modal ─────────────────────────────────────────────────────
function CreateCustomerModal({ open, onClose, states, onCreated }) {
  if (!open) return null;

  const handleSuccess = async () => {
    try {
      const r = await api.get("/dropdowns/customers/list", {
        params: { limit: 1, order: "desc" },
      });
      const newest = (r.data || [])[0];
      if (newest) {
        const id =
          newest.customer_id ||
          newest.id ||
          (typeof newest.value === "string"
            ? newest.value.split(":")[1]
            : null);
        const type =
          newest.type ||
          (typeof newest.value === "string" && newest.value.includes(":")
            ? newest.value.split(":")[0]
            : "offline");
        if (id) {
          onCreated(`${type}:${id}`, newest.name || "", newest.mobile || "");
          return;
        }
      }
    } catch {
      // silently ignore
    }
    onCreated(null);
  };

  return (
    <div
      className="f-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="f-modal f-modal-lg" style={{ maxWidth: 980 }}>
        <div className="f-modal-head">
          <span style={{ fontSize: 15 }}>👤</span>
          <span className="f-modal-title">Create New Customer</span>
          <button className="f-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div
          className="f-modal-body"
          style={{ padding: 0, maxHeight: "100vh", overflowY: "auto" }}
        >
          <CustomerForm
            states={states}
            onClose={onClose}
            onSuccess={handleSuccess}
            compact
          />
        </div>
      </div>
    </div>
  );
}

// ─── Inline Customer Search ────────────────────────────────────────────────────
function CustomerSearch({
  value: controlledValue,
  externalLabel, // FIX #6: parent pushes a display label here after creation
  onChange,
  disabled,
  onOpenCreate,
}) {
  const [q, setQ] = useState("");
  const [results, setRes] = useState([]);
  const [loading, setLoad] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setLabel] = useState("");
  const timerRef = useRef(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Existing: clear internal state when the controlled value is cleared
  useEffect(() => {
    if (!controlledValue) {
      setLabel("");
      setQ("");
      setRes([]);
      setOpen(false);
    }
  }, [controlledValue]);

  // FIX #6: when the parent sets an externalLabel (e.g. after creating a new
  // customer via the modal), sync it into internal selectedLabel so the pill
  // shows immediately — no extra search or API call required.
  useEffect(() => {
    if (externalLabel) {
      setLabel(externalLabel);
      setQ("");
      setRes([]);
      setOpen(false);
    }
  }, [externalLabel]);

  useEffect(() => {
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target))
        setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    const trimmed = q.trim();

    if (trimmed.length < 1) {
      setRes([]);
      setOpen(false);
      setLoad(false);
      return;
    }

    setLoad(true);
    timerRef.current = setTimeout(async () => {
      try {
        let data = [];
        try {
          const r = await api.get("/dropdowns/customers/search", {
            params: { q: trimmed, limit: 25 },
          });
          data = r.data || [];
        } catch {
          const r = await api
            .get("/dropdowns/customers/list")
            .catch(() => ({ data: [] }));
          const all = r.data || [];
          const lower = trimmed.toLowerCase();
          data = all.filter(
            (c) =>
              (c.name || "").toLowerCase().includes(lower) ||
              (c.mobile || "").includes(trimmed),
          );
        }

        const normalised = (data || [])
          .map((r) => {
            const id =
              r.customer_id ||
              r.id ||
              (typeof r.value === "string" ? r.value.split(":")[1] : null);
            if (!id) return null;
            const type =
              r.type ||
              (typeof r.value === "string" && r.value.includes(":")
                ? r.value.split(":")[0]
                : "offline");
            const name = r.name || r.label || "Unknown";
            const mobile = r.mobile || "";
            return {
              value: `${type}:${id}`,
              label: `${name}${mobile ? ` · ${mobile}` : ""}`,
              name,
              mobile,
            };
          })
          .filter(Boolean);

        setRes(normalised);
        setOpen(normalised.length > 0);
      } catch (err) {
        console.error("Customer search failed:", err);
        setRes([]);
        setOpen(false);
      } finally {
        setLoad(false);
      }
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [q]);

  const pick = (item) => {
    setLabel(item.label);
    setQ("");
    setRes([]);
    setOpen(false);
    onChange(item.value);
  };

  const clear = () => {
    setLabel("");
    setQ("");
    setRes([]);
    setOpen(false);
    onChange("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {selectedLabel ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            border: "1px solid var(--f-accent)",
            borderRadius: "var(--f-radius)",
            background: "var(--f-accent-lt)",
            fontSize: 13,
          }}
        >
          <span style={{ flex: 1, color: "var(--f-ink)" }}>
            {selectedLabel}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--f-ink3)",
                fontSize: 13,
                lineHeight: 1,
                padding: "0 2px",
              }}
              title="Change customer"
            >
              ✕
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  position: "absolute",
                  left: 9,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--f-ink3)",
                  pointerEvents: "none",
                }}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={inputRef}
                className="f-input"
                style={{ paddingLeft: 30 }}
                placeholder="Search by name or mobile…"
                value={q}
                disabled={disabled}
                autoComplete="off"
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => {
                  if (results.length > 0) setOpen(true);
                }}
              />
              {loading && (
                <span
                  className="f-spinner"
                  style={{
                    position: "absolute",
                    right: 9,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--f-accent)",
                  }}
                />
              )}
            </div>
            <button
              type="button"
              className="f-btn f-btn-secondary f-btn-sm"
              onClick={onOpenCreate}
              title="Create new customer"
              style={{ flexShrink: 0, whiteSpace: "nowrap" }}
            >
              + New
            </button>
          </div>

          {open && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 3px)",
                left: 0,
                right: 0,
                background: "var(--f-surface)",
                border: "1px solid var(--f-border2)",
                borderRadius: "var(--f-radius)",
                boxShadow: "0 8px 24px rgba(0,0,0,.12)",
                zIndex: 9999,
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {results.length > 0 ? (
                results.map((r) => (
                  <div
                    key={r.value}
                    onClick={() => pick(r)}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--f-border)",
                      transition: "background .1s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--f-surface2)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "")
                    }
                  >
                    <div
                      style={{
                        fontWeight: 500,
                        fontSize: 13,
                        color: "var(--f-ink)",
                      }}
                    >
                      {r.name}
                    </div>
                    {r.mobile && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--f-ink3)",
                          fontFamily: "var(--f-mono)",
                        }}
                      >
                        {r.mobile}
                      </div>
                    )}
                  </div>
                ))
              ) : !loading && q.trim().length >= 1 ? (
                <div
                  style={{
                    padding: "12px",
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--f-ink3)",
                  }}
                >
                  No customers found for &ldquo;{q.trim()}&rdquo;
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Product Browse Modal ──────────────────────────────────────────────────────
function BrowseModal({ open, products, loading, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q.trim().toLowerCase()) ||
          (p.sku_id || "").toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [products, q],
  );

  const handlePick = async (p) => {
    const pid = p.id ?? p.product_id;
    setPicking(pid);
    try {
      const [detailRes, priceRes] = await Promise.allSettled([
        api.get("/dropdowns/products/details", { params: { id: pid } }),
        api.get("/dropdowns/products/get_price", {
          params: { product_id: pid },
        }),
      ]);
      const detail =
        detailRes.status === "fulfilled" ? detailRes.value.data : {};
      const priceVal =
        priceRes.status === "fulfilled" ? priceRes.value.data?.price : null;
      onPick({
        ...p,
        ...detail,
        selling_price: priceVal != null ? Number(priceVal) : undefined,
        id: pid,
      });
    } catch {
      onPick(p);
    } finally {
      setPicking(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="f-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="f-modal f-modal-lg">
        <div className="f-modal-head">
          <span style={{ fontSize: 16 }}>📦</span>
          <span className="f-modal-title">Browse Products</span>
          <button className="f-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="f-modal-body">
          <div className="f-search-wrap">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="f-search-input"
              placeholder="Search by name or SKU…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>

          {loading ? (
            <div className="f-empty">
              <div className="f-empty-icon">⏳</div>Loading products…
            </div>
          ) : filtered.length === 0 ? (
            <div className="f-empty">
              <div className="f-empty-icon">📭</div>No products found
            </div>
          ) : (
            <div className="f-browse-grid">
              {filtered.map((p) => {
                const pid = p.id ?? p.product_id;
                const price = p.price ?? p.mrp ?? p.selling_price ?? 0;
                const isBusy = picking === pid;
                return (
                  <div
                    key={pid}
                    className="f-browse-card"
                    onClick={() => !isBusy && handlePick(p)}
                    style={{
                      opacity: isBusy ? 0.6 : 1,
                      cursor: isBusy ? "wait" : "pointer",
                    }}
                  >
                    <div className="f-browse-card-img">
                      <ProductThumb src={p.image} name={p.name} size={56} />
                    </div>
                    <div className="f-browse-card-name">{p.name}</div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span className="f-browse-card-price">
                        {price > 0 ? fmt(price) : isBusy ? "…" : "—"}
                      </span>
                      <span className="f-browse-card-stock">
                        {isBusy ? (
                          <span
                            className="f-spinner"
                            style={{ width: 11, height: 11 }}
                          />
                        ) : p.stock != null ? (
                          `${p.stock} left`
                        ) : (
                          ""
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="f-modal-foot">
          <button className="f-btn f-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Address Modal ─────────────────────────────────────────────────────────
function AddAddressModal({ open, onClose, onSave, states, customerDetails }) {
  const EMPTY = {
    address_line: "",
    locality: "",
    city: "",
    state_id: "",
    pincode: "",
    landmark: "",
    alternate_phone: "",
    address_type: "HOME",
  };
  const [addr, setAddr] = useState(EMPTY);
  const [saving, setSave] = useState(false);
  const [errors, setErrs] = useState({});
  const [serverErr, setSrvErr] = useState("");

  useEffect(() => {
    if (open) {
      setAddr(EMPTY);
      setErrs({});
      setSrvErr("");
    }
  }, [open]); // eslint-disable-line

  const set = (k, v) => {
    setAddr((p) => ({ ...p, [k]: v }));
    setErrs((p) => ({ ...p, [k]: "" }));
    setSrvErr("");
  };

  const validate = () => {
    const e = {};
    if (!customerDetails?.name?.trim())
      e._customer =
        "Customer must have a name on file before adding an address";
    if (!customerDetails?.mobile?.trim())
      e._customer =
        (e._customer ? e._customer + " and a" : "Customer must have a") +
        " mobile number on file";
    if (!addr.address_line.trim()) e.address_line = "Required";
    if (!addr.city.trim()) e.city = "Required";
    if (!addr.state_id) e.state_id = "Required";
    if (!addr.pincode.trim()) e.pincode = "Required";
    if (addr.pincode && !/^\d{6}$/.test(addr.pincode))
      e.pincode = "Must be 6 digits";
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSave(true);
    setSrvErr("");
    try {
      await onSave({
        ...addr,
        address_type: (addr.address_type || "HOME").toUpperCase(),
        locality: addr.locality.trim() || " ",
        state_id: Number(addr.state_id),
      });
    } catch (err) {
      setSrvErr(extractErrorMsg(err, "Failed to save address"));
    } finally {
      setSave(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="f-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="f-modal">
        <div className="f-modal-head">
          <span style={{ fontSize: 14 }}>📍</span>
          <span className="f-modal-title">Add New Address</span>
          <button className="f-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="f-modal-body">
          {(serverErr || errors._customer) && (
            <div
              style={{
                background: "var(--f-red-lt)",
                border: "1px solid rgba(220,38,38,.2)",
                borderRadius: "var(--f-radius)",
                padding: "8px 10px",
                marginBottom: 12,
                fontSize: 12,
                color: "var(--f-red)",
                lineHeight: 1.5,
              }}
            >
              ✕ {serverErr || errors._customer}
            </div>
          )}

          {customerDetails && (
            <div className="f-cust-card" style={{ marginBottom: 12 }}>
              <div className="f-cust-avatar">
                {(customerDetails.name || "?")[0].toUpperCase()}
              </div>
              <div>
                <div className="f-cust-name">{customerDetails.name}</div>
                <div className="f-cust-meta">{customerDetails.mobile}</div>
              </div>
            </div>
          )}

          <div className="f-field" style={{ marginBottom: 10 }}>
            <label className="f-label required">Address Line</label>
            <input
              className={`f-input ${errors.address_line ? "error" : ""}`}
              placeholder="House / flat / street"
              value={addr.address_line}
              onChange={(e) => set("address_line", e.target.value)}
              autoFocus
            />
            {errors.address_line && (
              <span className="f-error-msg">{errors.address_line}</span>
            )}
          </div>

          <div className="f-grid-2" style={{ marginBottom: 10 }}>
            <div className="f-field">
              <label className="f-label">Locality</label>
              <input
                className="f-input"
                placeholder="Area / sector"
                value={addr.locality}
                onChange={(e) => set("locality", e.target.value)}
              />
            </div>
            <div className="f-field">
              <label className="f-label required">City</label>
              <input
                className={`f-input ${errors.city ? "error" : ""}`}
                placeholder="City"
                value={addr.city}
                onChange={(e) => set("city", e.target.value)}
              />
              {errors.city && (
                <span className="f-error-msg">{errors.city}</span>
              )}
            </div>
          </div>

          <div className="f-grid-3" style={{ marginBottom: 10 }}>
            <div className="f-field">
              <label className="f-label required">State</label>
              <select
                className={`f-select ${errors.state_id ? "error" : ""}`}
                value={addr.state_id}
                onChange={(e) => set("state_id", e.target.value)}
              >
                <option value="">Select state</option>
                {states.map((s) => (
                  <option key={s.state_id} value={s.state_id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.state_id && (
                <span className="f-error-msg">{errors.state_id}</span>
              )}
            </div>
            <div className="f-field">
              <label className="f-label required">Pincode</label>
              <input
                className={`f-input mono ${errors.pincode ? "error" : ""}`}
                placeholder="6-digit"
                maxLength={6}
                value={addr.pincode}
                onChange={(e) =>
                  set("pincode", e.target.value.replace(/\D/g, ""))
                }
              />
              {errors.pincode && (
                <span className="f-error-msg">{errors.pincode}</span>
              )}
            </div>
            <div className="f-field">
              <label className="f-label">Type</label>
              <select
                className="f-select"
                value={addr.address_type}
                onChange={(e) => set("address_type", e.target.value)}
              >
                <option value="HOME">Home</option>
                <option value="OFFICE">Office</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          <div className="f-grid-2">
            <div className="f-field">
              <label className="f-label">Landmark</label>
              <input
                className="f-input"
                placeholder="optional"
                value={addr.landmark}
                onChange={(e) => set("landmark", e.target.value)}
              />
            </div>
            <div className="f-field">
              <label className="f-label">Alt. Phone</label>
              <input
                className="f-input mono"
                placeholder="optional"
                maxLength={10}
                value={addr.alternate_phone}
                onChange={(e) =>
                  set("alternate_phone", e.target.value.replace(/\D/g, ""))
                }
              />
            </div>
          </div>
        </div>

        <div className="f-modal-foot">
          <button className="f-btn f-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="f-btn f-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <span className="f-spinner" /> Saving…
              </>
            ) : (
              "Save Address"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
const CreateOrderForm = forwardRef(function CreateOrderForm(
  {
    onOrderCreated,
    onBack,
    selectedCustomer: externalCustomer,
    selectedProduct,
    selectedAddressId,
  },
  ref,
) {
  injectFormStyles();

  const [productList, setProductList] = useState([]);
  const [statesList, setStatesList] = useState([]);
  const [loadingProds, setLoadingProds] = useState(false);

  const [items, setItems] = useState([]);

  const [selectedCustomer, setSelectedCustomer] = useState(
    externalCustomer || "",
  );

  // FIX #6: label string fed into CustomerSearch so the pill appears immediately
  // after a new customer is created via the modal, without any extra API call.
  const [customerSearchLabel, setCustomerSearchLabel] = useState("");

  const [customerDetails, setCustomerDetails] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedAddressObj, setSelectedAddressObj] = useState(null);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [addrOpen, setAddrOpen] = useState(false);
  const [createCustOpen, setCreateCustOpen] = useState(false);

  const [deliveryCharge, setDeliveryCharge] = useState("");
  const [freeDelivery, setFreeDelivery] = useState(false);
  const [paymentType, setPaymentType] = useState("");
  const [manualSubtotal, setManualSubtotal] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  useImperativeHandle(ref, () => ({ openBrowse: () => setBrowseOpen(true) }));

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Load products and states on mount
  useEffect(() => {
    setLoadingProds(true);
    Promise.all([
      api
        .get("/dropdowns/products/list", {
          params: { include_price: 1, include_image: 1 },
        })
        .catch(() =>
          api.get("/dropdowns/products/list").catch(() => ({ data: [] })),
        ),
      api
        .get("/states/list")
        .catch(() =>
          api.get("/dropdowns/states/list").catch(() => ({ data: [] })),
        ),
    ])
      .then(([pRes, sRes]) => {
        setProductList(pRes.data || []);
        setStatesList(sRes.data || []);
      })
      .catch((err) =>
        showToast(extractErrorMsg(err, "Failed to load form data"), "error"),
      )
      .finally(() => setLoadingProds(false));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!selectedProduct) return;
    addProductById(selectedProduct);
  }, [selectedProduct]); // eslint-disable-line

  useEffect(() => {
    if (selectedAddressId && addresses.length) {
      const found = addresses.find((a) => a.address_id === selectedAddressId);
      if (found) pickAddress(found);
    }
  }, [selectedAddressId, addresses]); // eslint-disable-line

  // When customer changes, load details + addresses
  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerDetails(null);
      setAddresses([]);
      setSelectedAddress("");
      setSelectedAddressObj(null);
      return;
    }

    const parts = String(selectedCustomer).split(":");
    const type = (parts[0] || "").trim();
    const id = (parts[1] || "").trim();
    if (!type || !id) return;

    // Reset address when customer changes
    setSelectedAddress("");
    setSelectedAddressObj(null);

    api
      .get("/dropdowns/customers/details", { params: { type, id } })
      .then((r) => setCustomerDetails(r.data || null))
      .catch(() => {
        setCustomerDetails(null);
        showToast("Could not load customer details", "error");
      });

    api
      .get(`/dropdowns/customers/${type}/${id}/addresses`)
      .then((r) => {
        const list = r.data || [];
        setAddresses(list);
        if (list.length === 1) {
          pickAddress(list[0]);
        } else if (list.length > 1) {
          api
            .get("/dropdowns/customers/details", { params: { type, id } })
            .then((r2) => {
              const adr = r2.data?.address;
              if (!adr) return;
              const found = list.find(
                (x) =>
                  String(x.address_line) === String(adr.address_line) ||
                  String(x.pincode) === String(adr.pincode),
              );
              if (found) pickAddress(found);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        setAddresses([]);
        setSelectedAddress("");
        setSelectedAddressObj(null);
        showToast("Could not load customer addresses", "error");
      });
  }, [selectedCustomer]); // eslint-disable-line

  const pickAddress = (a) => {
    setSelectedAddress(a.address_id);
    setSelectedAddressObj(a);
    setCustomerDetails((prev) => ({
      ...(prev || {}),
      address: {
        address_line: a.address_line,
        locality: a.locality,
        city: a.city,
        state_name: a.state_name || "",
        pincode: a.pincode,
      },
    }));
  };

  const pushItem = useCallback((p) => {
    if (!p) return;
    const pid = p.id ?? p.product_id ?? p.productId;
    setItems((prev) => {
      const existing = prev.find((it) => String(it.product_id) === String(pid));
      if (existing) {
        return prev.map((it) =>
          String(it.product_id) === String(pid)
            ? { ...it, qty: it.qty + 1 }
            : it,
        );
      }
      return [
        ...prev,
        {
          product_id: pid,
          name: p.name ?? "Unnamed",
          image: p.image ?? null,
          mrp: Number(p.mrp ?? p.price ?? 0),
          selling_price: Number(p.selling_price ?? p.price ?? p.mrp ?? 0),
          gst_percent: Number(p.gst_percent ?? 18),
          stock: Number(p.stock ?? 0),
          qty: 1,
          extra_discount_percent: 0,
        },
      ];
    });
  }, []);

  const addProductById = async (productId) => {
    if (!productId) return;
    const pid = Number(productId);
    try {
      const [detailRes, priceRes] = await Promise.allSettled([
        api.get("/dropdowns/products/details", { params: { id: pid } }),
        api.get("/dropdowns/products/get_price", {
          params: { product_id: pid },
        }),
      ]);
      const product =
        detailRes.status === "fulfilled" ? (detailRes.value.data ?? {}) : {};
      const priceVal =
        priceRes.status === "fulfilled" ? priceRes.value.data?.price : null;
      pushItem({
        ...product,
        selling_price: priceVal != null ? Number(priceVal) : undefined,
        id: pid,
      });
    } catch {
      const p = productList.find(
        (x) => String(x.id ?? x.product_id) === String(productId),
      );
      if (p) pushItem(p);
      else showToast("Could not load product details", "error");
    }
  };

  const removeItem = (pid) =>
    setItems((prev) =>
      prev.filter((it) => String(it.product_id) !== String(pid)),
    );

  const updateItem = (pid, changes) =>
    setItems((prev) =>
      prev.map((it) =>
        String(it.product_id) === String(pid) ? { ...it, ...changes } : it,
      ),
    );

  const calc = useMemo(() => {
    let subtotalExclGST = 0;
    let gstTotal = 0;
    items.forEach((it) => {
      const qty = Number(it.qty || 0);
      const sp = Number(it.selling_price || 0);
      const extraPct = Number(it.extra_discount_percent || 0);
      const finalUnit = sp * (1 - extraPct / 100);
      const lineFinal = finalUnit * qty;
      const lineGst = (lineFinal * Number(it.gst_percent || 0)) / 100;
      subtotalExclGST += lineFinal;
      gstTotal += lineGst;
    });
    const effectiveSubtotal =
      manualSubtotal !== "" ? Number(manualSubtotal) : subtotalExclGST;
    const dc = freeDelivery ? 0 : Number(deliveryCharge || 0);
    const total = effectiveSubtotal + dc;
    return { subtotalExclGST, gstTotal, effectiveSubtotal, dc, total };
  }, [items, manualSubtotal, freeDelivery, deliveryCharge]);

  const handleSaveAddress = async (addrData) => {
    if (!selectedCustomer) {
      showToast("Select a customer first", "error");
      return;
    }
    const [type, id] = String(selectedCustomer).split(":");

    const custName = customerDetails?.name?.trim();
    const custMobile = customerDetails?.mobile?.trim();
    if (!custName) {
      showToast(
        "Customer has no name on file — cannot create address",
        "error",
      );
      return;
    }
    if (!custMobile) {
      showToast(
        "Customer has no mobile number on file — cannot create address",
        "error",
      );
      return;
    }

    const payload = {
      name: custName,
      mobile: custMobile,
      ...addrData,
      state_id: Number(addrData.state_id),
      locality: addrData.locality?.trim() || " ",
      address_type: (addrData.address_type || "HOME").toUpperCase(),
      landmark: addrData.landmark?.trim() || null,
      alternate_phone: addrData.alternate_phone?.trim() || null,
      email: customerDetails?.email || null,
      gst: null,
    };

    if (type === "offline") {
      payload.offline_customer_id = Number(id);
      payload.customer_id = null;
    } else {
      payload.customer_id = Number(id);
      payload.offline_customer_id = null;
    }

    await api.post("/orders/addresses/create", payload);

    const res = await api
      .get(`/dropdowns/customers/${type}/${id}/addresses`)
      .catch(() => ({ data: [] }));
    const list = res.data || [];
    setAddresses(list);
    if (list.length) pickAddress(list[list.length - 1]);
    setAddrOpen(false);
    showToast("Address saved successfully!");
  };

  // FIX #6: set BOTH the customer value AND the display label atomically so
  // CustomerSearch renders the pill immediately — no extra search needed.
  const handleCustomerCreated = useCallback(
    (customerValue, name, mobile) => {
      setCreateCustOpen(false);
      if (!customerValue) {
        showToast("Customer created — please search to select them", "success");
        return;
      }
      const label = `${name || "New customer"}${mobile ? ` · ${mobile}` : ""}`;
      setSelectedCustomer(customerValue);
      setCustomerSearchLabel(label); // ← drives the pill in CustomerSearch via externalLabel
      showToast(`Customer "${name || "New customer"}" created and selected!`);
    },
    [showToast],
  );

  const handleSubmit = async () => {
    if (items.length === 0) {
      showToast("Add at least one product", "error");
      return;
    }
    if (!selectedAddress) {
      showToast("Select a delivery address", "error");
      return;
    }
    if (!paymentType) {
      showToast("Select a payment method", "error");
      return;
    }

    const parts = String(selectedCustomer || "").split(":");
    const type = (parts[0] || "").trim();
    const id = Number((parts[1] || "").trim());
    if (!type || !id) {
      showToast("Select a customer", "error");
      return;
    }

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

    const payload = {
      customer_id: type === "online" ? id : null,
      offline_customer_id: type === "offline" ? id : null,
      address_id: selectedAddress,
      total_items: items.reduce((s, it) => s + Number(it.qty || 0), 0),
      subtotal: Number(calc.subtotalExclGST.toFixed(2)),
      gst: Number(calc.gstTotal.toFixed(2)),
      delivery_charge: freeDelivery ? 0 : Number(deliveryCharge || 0),
      total_amount: Number(calc.total.toFixed(2)),
      payment_type: paymentType,
      channel: "offline",
      items: payloadItems,
    };

    setSubmitting(true);
    try {
      await api.post("/orders/create", payload);
      showToast("Order created successfully!");
      setItems([]);
      setDeliveryCharge("");
      setFreeDelivery(false);
      setPaymentType("");
      setManualSubtotal("");
      setTimeout(() => onOrderCreated?.(), 1000);
    } catch (err) {
      showToast(extractErrorMsg(err, "Failed to create order"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── FIX #5: Decouple UI-gating from async customerDetails load ───────────
  const hasCustomerSelected = !!selectedCustomer; // immediate
  const hasCustomerDetails = !!customerDetails; // async, for UI only
  const hasAddress = !!selectedAddress;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="f-wrap">
      <Toast toast={toast} />

      {/* Modals */}
      <BrowseModal
        open={browseOpen}
        products={productList}
        loading={loadingProds}
        onClose={() => setBrowseOpen(false)}
        onPick={(p) => {
          pushItem(p);
          setBrowseOpen(false);
        }}
      />

      <AddAddressModal
        open={addrOpen}
        states={statesList}
        customerDetails={customerDetails}
        onClose={() => setAddrOpen(false)}
        onSave={handleSaveAddress}
      />

      <CreateCustomerModal
        open={createCustOpen}
        states={statesList}
        onClose={() => setCreateCustOpen(false)}
        onCreated={handleCustomerCreated}
      />

      {/* ── Header bar ── */}
      <div className="f-header">
        {onBack && (
          <button
            className="f-btn f-btn-secondary f-btn-sm"
            onClick={onBack}
            style={{ marginRight: 4 }}
          >
            ← Back
          </button>
        )}

        <span className="f-header-title">Create Order</span>
        <span className="f-header-accent">
          {items.length > 0
            ? `${items.reduce((s, it) => s + it.qty, 0)} items · ${fmt(calc.total)}`
            : "New"}
        </span>

        <div className="f-header-actions">
          <button
            className="f-btn f-btn-secondary f-btn-sm"
            onClick={() => setCreateCustOpen(true)}
          >
            👤 Add Customer
          </button>
          <button
            className="f-btn f-btn-primary f-btn-sm"
            onClick={() => setBrowseOpen(true)}
          >
            📦 Browse Products
          </button>
        </div>
      </div>

      {/* ══════════ LEFT COLUMN ══════════ */}
      <div className="f-main">
        {/* ── STEP 1: CUSTOMER ── */}
        <div className="f-section">
          <div className="f-section-head">
            {/* FIX #5: badge uses hasCustomerSelected so it ticks immediately */}
            <div
              className={`f-step-badge ${hasCustomerSelected ? "done" : "active"}`}
            >
              {hasCustomerSelected ? "✓" : "1"}
            </div>
            <h3 className="f-section-title">Customer</h3>
            {hasCustomerDetails && (
              <span className="f-section-badge">{customerDetails.name}</span>
            )}
          </div>

          <div
            className="f-field"
            style={{ marginBottom: hasCustomerSelected ? 10 : 0 }}
          >
            <label className="f-label required">Search or Create</label>
            {/*
              FIX #6: externalLabel fed from parent so the pill renders
              immediately after a new customer is created via the modal.
              When the user clears the selection (✕), onChange fires with ""
              and we also clear customerSearchLabel so externalLabel goes
              back to "" and CustomerSearch resets to the search input.
            */}
            <CustomerSearch
              value={selectedCustomer}
              externalLabel={customerSearchLabel}
              onChange={(val) => {
                setSelectedCustomer(val);
                if (!val) setCustomerSearchLabel("");
              }}
              disabled={submitting}
              onOpenCreate={() => setCreateCustOpen(true)}
            />
          </div>

          {/* Customer details + address — shown once details have loaded */}
          {hasCustomerDetails && (
            <>
              <div className="f-cust-card" style={{ marginTop: 8 }}>
                <div className="f-cust-avatar">
                  {(customerDetails.name || "?")[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="f-cust-name">{customerDetails.name}</div>
                  <div className="f-cust-meta">
                    {customerDetails.mobile}
                    {customerDetails.email ? ` · ${customerDetails.email}` : ""}
                  </div>
                </div>
                <button
                  className="f-btn f-btn-ghost f-btn-sm"
                  onClick={() => setAddrOpen(true)}
                  style={{ flexShrink: 0, alignSelf: "center" }}
                >
                  + Address
                </button>
              </div>

              {addresses.length === 0 ? (
                <div
                  className="f-addr-option"
                  style={{
                    cursor: "default",
                    background: "var(--f-surface2)",
                    color: "var(--f-ink3)",
                    marginTop: 6,
                  }}
                >
                  No addresses on file — click + Address above
                </div>
              ) : (
                <div style={{ marginTop: 6 }}>
                  {addresses.map((a) => (
                    <div
                      key={a.address_id}
                      className={`f-addr-option ${selectedAddress === a.address_id ? "selected" : ""}`}
                      onClick={() => pickAddress(a)}
                    >
                      {a.label || a.address_line}
                      <div className="f-addr-city">
                        {[a.city, a.state_name, a.pincode]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Loading spinner — customer selected but details not yet loaded */}
          {hasCustomerSelected && !hasCustomerDetails && (
            <div className="f-empty" style={{ padding: "12px 0" }}>
              <span
                className="f-spinner"
                style={{ color: "var(--f-accent)" }}
              />
              &nbsp; Loading customer…
            </div>
          )}
        </div>

        {/* ── STEP 2: PRODUCTS ── */}
        <div
          className="f-section"
          style={{
            // FIX #5: gate on hasCustomerSelected, not hasCustomer (which
            // required the async customerDetails to be present)
            opacity: hasCustomerSelected ? 1 : 0.45,
            pointerEvents: hasCustomerSelected ? "auto" : "none",
            transition: "opacity 0.2s",
          }}
        >
          <div className="f-section-head">
            <div
              className={`f-step-badge ${!hasCustomerSelected ? "" : items.length > 0 ? "done" : "active"}`}
            >
              {items.length > 0 ? "✓" : "2"}
            </div>
            <h3 className="f-section-title">Products</h3>
            <span className="f-section-badge">
              {items.length} item{items.length !== 1 ? "s" : ""}
            </span>
            <button
              className="f-btn f-btn-secondary f-btn-sm"
              style={{ marginLeft: 6 }}
              onClick={() => setBrowseOpen(true)}
            >
              + Browse
            </button>
          </div>

          {items.length === 0 ? (
            <div className="f-empty" style={{ padding: "16px" }}>
              <div className="f-empty-icon">📦</div>
              Browse or search to add products
            </div>
          ) : (
            <div className="f-products-scroll">
              {items.map((it) => {
                const finalUnit =
                  Number(it.selling_price || 0) *
                  (1 - (it.extra_discount_percent || 0) / 100);
                const lineTotal = finalUnit * Number(it.qty || 0);
                return (
                  <div className="f-product-row" key={it.product_id}>
                    <ProductThumb src={it.image} name={it.name} size={40} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="f-product-name" title={it.name}>
                        {it.name}
                      </div>
                      <div className="f-product-meta">
                        Stock: {it.stock} &nbsp;·&nbsp; GST: {it.gst_percent}%
                      </div>
                      <div className="f-product-controls">
                        <div className="f-field">
                          <label className="f-label">Qty</label>
                          <QtyInput
                            value={it.qty}
                            onChange={(v) =>
                              updateItem(it.product_id, { qty: v })
                            }
                          />
                        </div>
                        <div className="f-field">
                          <label className="f-label">Unit ₹</label>
                          <input
                            className="f-input mono right"
                            style={{ width: 90 }}
                            type="text"
                            inputMode="decimal"
                            value={
                              it.selling_price === "" ? "" : it.selling_price
                            }
                            placeholder={String(it.mrp || 0)}
                            onFocus={() => {
                              if (it.selling_price === 0)
                                updateItem(it.product_id, {
                                  selling_price: "",
                                });
                            }}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "" || /^\d*\.?\d*$/.test(raw))
                                updateItem(it.product_id, {
                                  selling_price: raw === "" ? "" : Number(raw),
                                });
                            }}
                          />
                        </div>
                        <div className="f-field">
                          <label className="f-label">Disc %</label>
                          <input
                            className="f-input mono right"
                            style={{ width: 62 }}
                            type="number"
                            min={0}
                            max={100}
                            value={it.extra_discount_percent}
                            onChange={(e) =>
                              updateItem(it.product_id, {
                                extra_discount_percent: clamp(e.target.value),
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <div className="f-product-actions">
                      <button
                        className="f-btn f-btn-danger f-btn-sm"
                        onClick={() => removeItem(it.product_id)}
                        title="Remove"
                      >
                        ✕
                      </button>
                      <div>
                        <div className="f-product-price-original">
                          {fmt(it.mrp * it.qty)}
                        </div>
                        <div className="f-product-price">{fmt(lineTotal)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ══════════ RIGHT RAIL ══════════ */}
      <div className="f-rail">
        <div className="f-rail-body">
          {/* Payment & Delivery */}
          <div className="f-rail-label">Payment &amp; Delivery</div>

          <div className="f-field" style={{ marginBottom: 8 }}>
            <label className="f-label required">Payment Method</label>
            <select
              className="f-select"
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value)}
            >
              <option value="">Select…</option>
              <option value="cod">Cash on Delivery</option>
              <option value="prepaid">Prepaid</option>
              <option value="upi">UPI</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "flex-end",
              marginBottom: 8,
            }}
          >
            <div className="f-field" style={{ flex: 1 }}>
              <label className="f-label">Delivery (₹)</label>
              <input
                className="f-input mono right"
                type="text"
                inputMode="decimal"
                disabled={freeDelivery}
                placeholder="0"
                value={deliveryCharge}
                onFocus={() => {
                  if (deliveryCharge === 0) setDeliveryCharge("");
                }}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "" || /^\d*\.?\d*$/.test(raw))
                    setDeliveryCharge(raw === "" ? "" : raw);
                }}
              />
            </div>
            <div
              className={`f-check-row ${freeDelivery ? "checked" : ""}`}
              style={{ padding: "7px 8px", height: "fit-content" }}
              onClick={() => {
                setFreeDelivery((v) => !v);
                if (!freeDelivery) setDeliveryCharge("0");
              }}
            >
              <div className="f-checkbox">✓</div>
              <span className="f-check-label">Free</span>
            </div>
          </div>

          {/* Order Summary */}
          <div className="f-rail-label" style={{ marginTop: 16 }}>
            Order Summary
          </div>

          <div className="f-summary-row">
            <span>Subtotal</span>
            <span className="f-mono">{fmt(calc.subtotalExclGST)}</span>
          </div>
          <div className="f-summary-row">
            <span>GST</span>
            <span className="f-mono">{fmt(calc.gstTotal)}</span>
          </div>
          <div className="f-summary-row">
            <span>Delivery</span>
            <span className="f-mono">
              {freeDelivery ? "Free" : fmt(calc.dc)}
            </span>
          </div>

          {/* Override subtotal */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 6,
              gap: 8,
            }}
          >
            <span
              style={{ fontSize: 11, color: "var(--f-ink3)", flexShrink: 0 }}
            >
              Override subtotal
            </span>
            <input
              className="f-input mono right"
              style={{ width: 110, padding: "5px 8px", fontSize: 12 }}
              type="text"
              inputMode="decimal"
              placeholder={calc.subtotalExclGST.toFixed(2)}
              value={manualSubtotal}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "" || /^\d*\.?\d*$/.test(raw))
                  setManualSubtotal(raw === "" ? "" : raw);
              }}
            />
          </div>

          <div className="f-summary-row total" style={{ marginTop: 10 }}>
            <span>Total</span>
            <span className="f-mono f-summary-total-val">
              {fmt(calc.total)}
            </span>
          </div>

          {/* Selected address preview */}
          {selectedAddressObj && (
            <>
              <div className="f-rail-label" style={{ marginTop: 16 }}>
                Ship To
              </div>
              <div
                style={{
                  background: "var(--f-surface2)",
                  border: "1px solid var(--f-border)",
                  borderRadius: "var(--f-radius)",
                  padding: "8px 10px",
                  fontSize: 11,
                  color: "var(--f-ink2)",
                  lineHeight: 1.6,
                }}
              >
                {selectedAddressObj.address_line}
                {selectedAddressObj.locality?.trim()
                  ? `, ${selectedAddressObj.locality}`
                  : ""}
                <br />
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10 }}>
                  {[
                    selectedAddressObj.city,
                    selectedAddressObj.state_name,
                    selectedAddressObj.pincode,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ── Submit action ── */}
        <div className="f-rail-foot">
          {/* Validation hints */}
          {!hasCustomerSelected && (
            <div
              style={{
                fontSize: 11,
                color: "var(--f-ink3)",
                marginBottom: 8,
                textAlign: "center",
              }}
            >
              Select a customer to continue
            </div>
          )}
          {hasCustomerSelected && !hasAddress && (
            <div
              style={{
                fontSize: 11,
                color: "var(--f-amber)",
                marginBottom: 8,
                textAlign: "center",
              }}
            >
              ⚠ Select a delivery address
            </div>
          )}
          {hasCustomerSelected && items.length === 0 && (
            <div
              style={{
                fontSize: 11,
                color: "var(--f-amber)",
                marginBottom: 8,
                textAlign: "center",
              }}
            >
              ⚠ Add at least one product
            </div>
          )}

          {/*
            FIX #5: disabled now uses hasCustomerSelected (immediate state)
            instead of hasCustomer (which required the async customerDetails
            to resolve). The button enables as soon as:
              - a customer is picked (selectedCustomer is set)
              - an address is chosen (selectedAddress is set)
              - at least one product is in the basket
              - a payment type is selected
          */}
          <button
            className="f-btn f-btn-primary f-btn-lg f-btn-full"
            onClick={handleSubmit}
            disabled={
              submitting ||
              !hasCustomerSelected ||
              !hasAddress ||
              items.length === 0 ||
              !paymentType
            }
          >
            {submitting ? (
              <>
                <span className="f-spinner" /> Creating…
              </>
            ) : (
              "✓ Create Order"
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

export default CreateOrderForm;
