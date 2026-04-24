import { useState, useEffect } from "react";
import api from "../../api/axiosInstance";
import { toast } from "./ToastSystem";

export default function AddAddressForm({ order, onSaved, onCancel }) {
  const [states, setStates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    pincode: "",
    locality: "",
    address_line: "",
    city: "",
    state_id: "",
    landmark: "",
    alternate_phone: "",
    address_type: "HOME",
    email: "",
    gst: "",
  });

  useEffect(() => {
    api
      .get("/orders/states/list")
      .then((r) => setStates(r.data || []))
      .catch(() => setStates([]));
  }, []);

  const set = (field, val) => setForm((p) => ({ ...p, [field]: val }));

  const handleSave = async () => {
    if (
      !form.name ||
      !form.mobile ||
      !form.pincode ||
      !form.address_line ||
      !form.city ||
      !form.state_id
    ) {
      toast.warn("Please fill in all required fields");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post("/orders/addresses/create", {
        ...form,
        state_id: parseInt(form.state_id),
        customer_id: order.customer_id || null,
        offline_customer_id: order.offline_customer_id || null,
      });
      toast.success("Address saved and applied to order");
      onSaved(res.data);
    } catch {
      toast.error("Failed to create address. Please check all fields.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 16,
        background: "var(--surface2)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13 }}>➕ New Address</div>
      <div className="form-grid-2">
        <div className="form-field">
          <label className="form-label">Full Name *</label>
          <input
            className="form-input"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Recipient name"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Mobile *</label>
          <input
            className="form-input"
            value={form.mobile}
            onChange={(e) => set("mobile", e.target.value)}
            placeholder="10-digit mobile"
            maxLength={15}
          />
        </div>
      </div>
      <div className="form-field">
        <label className="form-label">Address Line *</label>
        <input
          className="form-input"
          value={form.address_line}
          onChange={(e) => set("address_line", e.target.value)}
          placeholder="House / Flat / Street"
        />
      </div>
      <div className="form-field">
        <label className="form-label">Locality *</label>
        <input
          className="form-input"
          value={form.locality}
          onChange={(e) => set("locality", e.target.value)}
          placeholder="Area / Locality"
        />
      </div>
      <div className="form-grid-3">
        <div className="form-field">
          <label className="form-label">City *</label>
          <input
            className="form-input"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="City"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Pincode *</label>
          <input
            className="form-input"
            value={form.pincode}
            onChange={(e) => set("pincode", e.target.value)}
            placeholder="6-digit"
            maxLength={10}
          />
        </div>
        <div className="form-field">
          <label className="form-label">State *</label>
          <select
            className="form-select"
            value={form.state_id}
            onChange={(e) => set("state_id", e.target.value)}
          >
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s.state_id} value={s.state_id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-grid-2">
        <div className="form-field">
          <label className="form-label">Landmark</label>
          <input
            className="form-input"
            value={form.landmark}
            onChange={(e) => set("landmark", e.target.value)}
            placeholder="Near / Opposite…"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Alternate Phone</label>
          <input
            className="form-input"
            value={form.alternate_phone}
            onChange={(e) => set("alternate_phone", e.target.value)}
            placeholder="Optional"
            maxLength={15}
          />
        </div>
      </div>
      <div className="form-grid-2">
        <div className="form-field">
          <label className="form-label">Email</label>
          <input
            className="form-input"
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-field">
          <label className="form-label">Address Type</label>
          <select
            className="form-select"
            value={form.address_type}
            onChange={(e) => set("address_type", e.target.value)}
          >
            <option value="HOME">Home</option>
            <option value="WORK">Work</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
      </div>
      <div className="form-field">
        <label className="form-label">GST Number</label>
        <input
          className="form-input"
          value={form.gst}
          onChange={(e) => set("gst", e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 4,
        }}
      >
        <button
          className="lb-btn lb-btn-secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="lb-btn lb-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Address"}
        </button>
      </div>
    </div>
  );
}
