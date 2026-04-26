/**
 * forms/CustomerForm.jsx
 *
 * FIXES APPLIED:
 *
 * 1. DEFENSIVE STATE OBJECT MAPPING (normaliseStates):
 *    The API might return { id, name } or { state_id, name } depending on which
 *    endpoint responds. We normalise both shapes on load so the rest of the
 *    component always works with { state_id, name }.
 *
 * 2. STATE_ID OPTION VALUE:
 *    value={String(s.state_id)} — stable, non-empty for every real state.
 *
 * 3. VALIDATE state_id CHECK:
 *    if (form.state_id === "") — explicit check, won't false-positive on "0".
 *
 * 4. PAYLOAD state_id PARSING:
 *    form.state_id !== "" ? parseInt(form.state_id, 10) : null
 *
 * 5. LAYOUT FIX:
 *    Form now uses full horizontal space in two side-by-side sections
 *    (Customer Details | Address Details) with no vertical scroll.
 *    All fields are distributed across a 3-column grid per section.
 */

import { useState, useEffect } from "react";
import api from "../../api/axiosInstance";
import { injectFormStyles } from "./styles";

const EMPTY_FORM = {
  name: "",
  mobile: "",
  email: "",
  gst_number: "",
  customer_type: "offline",
  address_line: "",
  locality: "",
  city: "",
  state_id: "",
  pincode: "",
  landmark: "",
  alternate_phone: "",
  address_type: "home",
};

/**
 * Normalise whatever shape the states API returns into { state_id, name }.
 * Handles: { state_id, name }, { id, name }, { value, label }, etc.
 * This is the key defensive layer — the component never breaks regardless
 * of which endpoint responds or what field names it uses.
 */
function normaliseStates(raw = []) {
  return raw
    .map((s) => ({
      state_id: s.state_id ?? s.id ?? s.value ?? null,
      name: s.name ?? s.label ?? s.state_name ?? "",
    }))
    .filter((s) => s.state_id !== null && s.state_id !== undefined && s.name);
}

export default function CustomerForm({
  onClose,
  onSuccess,
  states: propStates = [],
}) {
  injectFormStyles();

  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [states, setStates] = useState(() => normaliseStates(propStates));
  const [loadingStates, setLoadingStates] = useState(propStates.length === 0);

  // Load states on mount if parent didn't provide them
  useEffect(() => {
    if (propStates.length > 0) {
      const normalised = normaliseStates(propStates);
      console.log(
        "[CustomerForm] using propStates, first item:",
        normalised[0],
      );
      setStates(normalised);
      setLoadingStates(false);
      return;
    }

    const tryFetch = (url) =>
      api.get(url).then((r) => {
        const raw = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        console.log(`[CustomerForm] ${url} raw[0]:`, raw[0]);
        const normalised = normaliseStates(raw);
        console.log(`[CustomerForm] ${url} normalised[0]:`, normalised[0]);
        if (normalised.length === 0) throw new Error("empty after normalise");
        return normalised;
      });

    tryFetch("/states/list")
      .catch(() => tryFetch("/dropdowns/states/list"))
      .then((normalised) => setStates(normalised))
      .catch(() => setStates([]))
      .finally(() => setLoadingStates(false));
  }, []); // eslint-disable-line

  // Sync if parent later provides states
  useEffect(() => {
    if (propStates.length > 0) {
      const normalised = normaliseStates(propStates);
      setStates(normalised);
      setLoadingStates(false);
    }
  }, [propStates]);

  const set = (field, value) => {
    setForm((p) => ({ ...p, [field]: value }));
    if (errors[field]) setErrors((p) => ({ ...p, [field]: "" }));
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const hasAddress = () =>
    !!(form.address_line.trim() || form.city.trim() || form.pincode.trim());

  const validate = () => {
    const e = {};

    if (!form.name.trim()) e.name = "Name is required";
    if (!form.mobile.trim()) e.mobile = "Mobile is required";

    if (form.mobile && !/^\d{10}$/.test(form.mobile.trim()))
      e.mobile = "Enter a valid 10-digit mobile number";

    if (form.email && !/\S+@\S+\.\S+/.test(form.email))
      e.email = "Enter a valid email";

    if (form.pincode && !/^\d{6}$/.test(form.pincode))
      e.pincode = "Enter a valid 6-digit pincode";

    if (hasAddress()) {
      if (!form.address_line.trim())
        e.address_line = "Address line is required";
      if (!form.city.trim()) e.city = "City is required";
      // FIX: explicit empty-string check — state_id="0" is a valid selection
      if (form.state_id === "") e.state_id = "State is required";
      if (!form.pincode.trim()) e.pincode = "Pincode is required";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);

    try {
      const parsedStateId =
        form.state_id !== "" ? parseInt(form.state_id, 10) : null;

      console.log(
        "[CustomerForm] state_id raw:",
        form.state_id,
        "→ parsed:",
        parsedStateId,
      );

      const payload = {
        ...form,
        state_id: Number.isFinite(parsedStateId) ? parsedStateId : null,
        email: form.email.trim() || null,
        gst_number: form.gst_number.trim() || null,
        landmark: form.landmark.trim() || null,
        alternate_phone: form.alternate_phone.trim() || null,
        locality: form.locality.trim() || "",
      };

      console.log("[CustomerForm] submitting payload:", payload);

      const res = await api.post("/customers/create", payload);
      showToast("Customer created successfully!");
      setTimeout(() => onSuccess(res.data), 500);
    } catch (err) {
      console.error("[CustomerForm] ERROR:", err?.response?.data);
      const detail = err?.response?.data?.detail || "Failed to create customer";
      showToast(detail, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="f-cf-wrap">
      {toast && (
        <div className={`f-toast ${toast.type}`}>
          {toast.type === "success" ? "✓" : "✕"} {toast.msg}
        </div>
      )}

      {/* ── Two-column horizontal layout ── */}
      <div className="f-cf-body">
        {/* ── LEFT: Customer Details ── */}
        <div className="f-section f-cf-panel">
          <div className="f-section-head">
            <div className="f-section-icon">👤</div>
            <h3 className="f-section-title">Customer Details</h3>
          </div>

          <div className="f-cf-2">
            <div className="f-field">
              <label className="f-label required">Full Name</label>
              <input
                className={`f-input ${errors.name ? "error" : ""}`}
                placeholder="e.g. Rahul Sharma"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                autoFocus
              />
              {errors.name && (
                <span className="f-error-msg">{errors.name}</span>
              )}
            </div>

            <div className="f-field">
              <label className="f-label required">Mobile Number</label>
              <input
                className={`f-input mono ${errors.mobile ? "error" : ""}`}
                placeholder="10-digit number"
                value={form.mobile}
                maxLength={10}
                onChange={(e) =>
                  set("mobile", e.target.value.replace(/\D/g, ""))
                }
              />
              {errors.mobile && (
                <span className="f-error-msg">{errors.mobile}</span>
              )}
            </div>

            <div className="f-field">
              <label className="f-label">Customer Type</label>
              <select
                className="f-select"
                value={form.customer_type}
                onChange={(e) => set("customer_type", e.target.value)}
              >
                <option value="offline">Offline</option>
                <option value="online">Online</option>
              </select>
            </div>

            <div className="f-field">
              <label className="f-label">Email</label>
              <input
                className={`f-input ${errors.email ? "error" : ""}`}
                type="email"
                placeholder="optional"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
              {errors.email && (
                <span className="f-error-msg">{errors.email}</span>
              )}
            </div>

            <div className="f-field">
              <label className="f-label">GST Number</label>
              <input
                className="f-input mono"
                placeholder="optional"
                value={form.gst_number}
                maxLength={15}
                onChange={(e) =>
                  set("gst_number", e.target.value.toUpperCase())
                }
              />
            </div>

            <div className="f-field">
              <label className="f-label">Alternate Phone</label>
              <input
                className="f-input mono"
                placeholder="optional"
                value={form.alternate_phone}
                maxLength={10}
                onChange={(e) =>
                  set("alternate_phone", e.target.value.replace(/\D/g, ""))
                }
              />
            </div>
          </div>
        </div>

        {/* ── RIGHT: Address Details ── */}
        <div className="f-section f-cf-panel">
          <div className="f-section-head">
            <div className="f-section-icon">📍</div>
            <h3 className="f-section-title">Address Details</h3>
            <span className="f-section-badge">Optional</span>
          </div>

          <div className="f-cf-grid3">
            <div className="f-field f-cf-col-span-3">
              <label className="f-label">Address Line</label>
              <input
                className={`f-input ${errors.address_line ? "error" : ""}`}
                placeholder="House / flat / building / street"
                value={form.address_line}
                onChange={(e) => set("address_line", e.target.value)}
              />
              {errors.address_line && (
                <span className="f-error-msg">{errors.address_line}</span>
              )}
            </div>

            <div className="f-field f-cf-col-span-2">
              <label className="f-label">Locality / Area</label>
              <input
                className="f-input"
                placeholder="e.g. Sector 15"
                value={form.locality}
                onChange={(e) => set("locality", e.target.value)}
              />
            </div>

            <div className="f-field">
              <label className="f-label">City</label>
              <input
                className={`f-input ${errors.city ? "error" : ""}`}
                placeholder="e.g. Noida"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
              {errors.city && (
                <span className="f-error-msg">{errors.city}</span>
              )}
            </div>

            <div className="f-field f-cf-col-span-3">
              <label className="f-label">State</label>
              <select
                className={`f-select ${errors.state_id ? "error" : ""}`}
                value={form.state_id}
                onChange={(e) => {
                  console.log("[CustomerForm] state selected:", e.target.value);
                  set("state_id", e.target.value);
                }}
                disabled={loadingStates}
              >
                <option value="">
                  {loadingStates
                    ? "Loading states…"
                    : `Select state (${states.length} loaded)`}
                </option>
                {states.map((s) => (
                  <option key={String(s.state_id)} value={String(s.state_id)}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.state_id && (
                <span className="f-error-msg">{errors.state_id}</span>
              )}
            </div>

            <div className="f-field f-cf-col-span-2">
              <label className="f-label">Pincode</label>
              <input
                className={`f-input mono ${errors.pincode ? "error" : ""}`}
                placeholder="6-digit"
                value={form.pincode}
                maxLength={6}
                onChange={(e) =>
                  set("pincode", e.target.value.replace(/\D/g, ""))
                }
              />
              {errors.pincode && (
                <span className="f-error-msg">{errors.pincode}</span>
              )}
            </div>

            <div className="f-field">
              <label className="f-label">Address Type</label>
              <select
                className="f-select"
                value={form.address_type}
                onChange={(e) => set("address_type", e.target.value)}
              >
                <option value="home">Home</option>
                <option value="office">Office</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="f-field f-cf-col-span-3">
              <label className="f-label">Landmark</label>
              <input
                className="f-input"
                placeholder="optional"
                value={form.landmark}
                onChange={(e) => set("landmark", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="f-cf-footer">
        <button className="f-btn f-btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="f-btn f-btn-primary"
          onClick={handleSubmit}
          disabled={saving || loadingStates}
          style={{ minWidth: 120 }}
        >
          {saving ? (
            <>
              <span className="f-spinner" /> Saving…
            </>
          ) : (
            "✓ Save Customer"
          )}
        </button>
      </div>
    </div>
  );
}
