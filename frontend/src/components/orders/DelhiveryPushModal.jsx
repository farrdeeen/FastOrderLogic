import { useState, useEffect } from "react";
import api from "../../api/axiosInstance";
import { toast } from "./ToastSystem";

export default function DelhiveryPushModal({ order, onClose, onSuccess }) {
  const [serviceability, setServiceability] = useState(null);
  const [checking, setChecking] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [form, setForm] = useState({
    weight: "0.5",
    length: "10",
    breadth: "10",
    height: "10",
    payment_mode:
      order.payment_type?.toUpperCase() === "COD" ? "COD" : "Prepaid",
    cod_amount: order.total_amount || 0,
    hsn_code: "",
    e_waybill: "",
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    checkPincode();
  }, []);

  const checkPincode = async () => {
    try {
      setChecking(true);
      const res = await api.get(
        `/delhivery/pod-data/${encodeURIComponent(order.order_id)}`,
      );
      const pin = res.data?.address?.pincode;
      if (pin) {
        const srv = await api.get(`/delhivery/serviceability/${pin}`);
        setServiceability(srv.data);
      }
    } catch {
      /* silent */
    } finally {
      setChecking(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      const res = await api.post("/delhivery/push-order", {
        order_id: order.order_id,
        weight: parseFloat(form.weight) || 0.5,
        length: parseFloat(form.length) || 10,
        breadth: parseFloat(form.breadth) || 10,
        height: parseFloat(form.height) || 10,
        payment_mode: form.payment_mode,
        cod_amount: parseFloat(form.cod_amount) || 0,
        hsn_code: form.hsn_code || undefined,
        e_waybill: form.e_waybill || undefined,
      });
      toast.success(`Pushed to Delhivery! AWB: ${res.data.waybill}`);
      onSuccess(res.data.waybill);
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to push to Delhivery");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div
      className="dlv-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dlv-modal">
        <div className="dlv-modal-header">
          <div>
            <div className="dlv-modal-title">🚚 Push to Delhivery</div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--text3)",
                fontFamily: "'DM Mono',monospace",
                marginTop: 2,
              }}
            >
              {order.order_id}
            </div>
          </div>
          <button className="lb-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="dlv-modal-body">
          {checking && (
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              Checking pincode serviceability…
            </div>
          )}
          {serviceability && !checking && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius)",
                background: serviceability.serviceable
                  ? "var(--green-bg)"
                  : "var(--red-bg)",
                color: serviceability.serviceable ? "#027a48" : "#b42318",
                border: `1px solid ${serviceability.serviceable ? "#a9efc5" : "#fda29b"}`,
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              {serviceability.serviceable
                ? `✓ Pincode serviceable — ${serviceability.city}, ${serviceability.state}`
                : `✕ Pincode NOT serviceable by Delhivery.`}
            </div>
          )}

          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">Payment Mode</label>
              <select
                className="form-select"
                value={form.payment_mode}
                onChange={(e) => set("payment_mode", e.target.value)}
              >
                <option value="Prepaid">Prepaid</option>
                <option value="COD">COD</option>
              </select>
            </div>
            {form.payment_mode === "COD" && (
              <div className="form-field">
                <label className="form-label">COD Amount (₹)</label>
                <input
                  className="form-input"
                  type="number"
                  value={form.cod_amount}
                  onChange={(e) => set("cod_amount", e.target.value)}
                />
              </div>
            )}
          </div>

          <div
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--text2)",
              textTransform: "uppercase",
              letterSpacing: ".4px",
            }}
          >
            Package Dimensions
          </div>
          <div className="form-grid-2">
            {[
              ["weight", "Weight (kg)", "0.1", "0.1"],
              ["length", "Length (cm)", "", ""],
              ["breadth", "Breadth (cm)", "", ""],
              ["height", "Height (cm)", "", ""],
            ].map(([k, l, step, min]) => (
              <div className="form-field" key={k}>
                <label className="form-label">{l}</label>
                <input
                  className="form-input"
                  type="number"
                  step={step || undefined}
                  min={min || undefined}
                  value={form[k]}
                  onChange={(e) => set(k, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label className="form-label">HSN Code (optional)</label>
              <input
                className="form-input"
                placeholder="e.g. 85171290"
                value={form.hsn_code}
                onChange={(e) => set("hsn_code", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">E-Waybill (if &gt;₹50k)</label>
              <input
                className="form-input"
                placeholder="E-waybill number"
                value={form.e_waybill}
                onChange={(e) => set("e_waybill", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="dlv-modal-footer">
          <button className="lb-btn lb-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="lb-btn lb-btn-primary"
            onClick={handlePush}
            disabled={pushing}
          >
            {pushing ? "Pushing…" : "🚀 Push Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
