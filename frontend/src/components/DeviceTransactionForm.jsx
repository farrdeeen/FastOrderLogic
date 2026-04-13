import { useState, useRef, useCallback } from "react";
import axiosInstance from "../api/axiosInstance";

export default function DeviceTransactionForm() {
  const [vendor, setVendor] = useState("");
  const [inOut, setInOut] = useState(1); // 1 = In, 0 = Out
  const [modelName, setModelName] = useState("");
  const [price, setPrice] = useState("");
  const [remarks, setRemarks] = useState("");
  const [serials, setSerials] = useState([""]);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const inputRefs = useRef([]);

  const scannedCount = serials.filter((s) => s.trim().length > 0).length;

  const handleSerialKeyDown = useCallback(
    (e, index) => {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();

        const rawValue = serials[index].trim();
        if (!rawValue) return;

        // 🔥 Split by comma (and clean spaces)
        const parts = rawValue
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        setSerials((prev) => {
          const updated = [...prev];

          // Replace current index with first value
          updated[index] = parts[0];

          // Insert remaining values after current index
          if (parts.length > 1) {
            updated.splice(index + 1, 0, ...parts.slice(1));
          }

          // Always ensure one empty input at end
          if (updated[updated.length - 1] !== "") {
            updated.push("");
          }

          return updated;
        });

        // Focus next field properly
        setTimeout(() => {
          inputRefs.current[index + parts.length]?.focus();
        }, 50);
      }
    },
    [serials],
  );

  const updateSerial = (index, value) => {
    setSerials((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const removeSerial = (index) => {
    if (serials.length === 1) {
      setSerials([""]);
      return;
    }
    setSerials((prev) => prev.filter((_, i) => i !== index));
    inputRefs.current = inputRefs.current.filter((_, i) => i !== index);
  };

  const handleSubmit = async () => {
    const validSerials = serials.filter((s) => s.trim().length > 0);
    if (!vendor.trim() || !modelName.trim() || validSerials.length === 0) {
      setToast({
        type: "error",
        msg: "Vendor, Item Name, and at least one serial number are required.",
      });
      setTimeout(() => setToast(null), 3500);
      return;
    }

    setSubmitting(true);
    try {
      await axiosInstance.post("/device-transactions/bulk", {
        vendor: vendor.trim(),
        in_out: inOut,
        model_name: modelName.trim(),
        price: price ? parseFloat(price) : null,
        serials: validSerials,
        remarks: remarks.trim() || null,
      });
      setToast({
        type: "success",
        msg: `${validSerials.length} device(s) saved successfully.`,
      });
      setTimeout(() => setToast(null), 3000);
      // Reset
      setVendor("");
      setModelName("");
      setPrice("");
      setRemarks("");
      setSerials([""]);
      setInOut(1);
    } catch (err) {
      const detail =
        err?.response?.data?.detail || "Submission failed. Please try again.";
      setToast({ type: "error", msg: detail });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.page}>
      {/* ── Top bar ── */}
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>New Device Transaction</h1>
          <p style={styles.pageSubtitle}>
            Scan serial numbers with a barcode scanner
          </p>
        </div>
        <button
          style={{ ...styles.submitBtn, opacity: submitting ? 0.6 : 1 }}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Saving…" : "Submit →"}
        </button>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div
          style={{
            ...styles.toast,
            background: toast.type === "error" ? "#FCEBEB" : "#EAF3DE",
            color: toast.type === "error" ? "#501313" : "#173404",
            border: `0.5px solid ${toast.type === "error" ? "#A32D2D" : "#3B6D11"}`,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Transaction details card ── */}
      <div style={styles.card}>
        <p style={styles.cardTitle}>Transaction Details</p>
        <div style={styles.fieldsGrid}>
          {/* Vendor */}
          <div style={styles.field}>
            <label style={styles.label}>Vendor / Customer</label>
            <input
              style={styles.input}
              type="text"
              placeholder="e.g. Reliance Retail"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
          </div>

          {/* In / Out */}
          <div style={styles.field}>
            <label style={styles.label}>Direction</label>
            <div style={styles.inOutGroup}>
              <button
                style={{
                  ...styles.inOutBtn,
                  ...(inOut === 1 ? styles.inOutBtnIn : {}),
                }}
                onClick={() => setInOut(1)}
              >
                ↓ In
              </button>
              <button
                style={{
                  ...styles.inOutBtn,
                  ...(inOut === 2 ? styles.inOutBtnOut : {}),
                }}
                onClick={() => setInOut(2)}
              >
                ↑ Out
              </button>
            </div>
          </div>

          {/* Model name */}
          <div style={styles.field}>
            <label style={styles.label}>Item / Model Name</label>
            <input
              style={styles.input}
              type="text"
              placeholder="e.g. iPhone 15 Pro"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>

          {/* Price */}
          <div style={styles.field}>
            <label style={styles.label}>Price (₹)</label>
            <input
              style={styles.input}
              type="number"
              placeholder="0.00"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          {/* Remarks */}
          <div style={styles.field}>
            <label style={styles.label}>Remarks</label>
            <input
              style={styles.input}
              type="text"
              placeholder="Optional notes..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Serial numbers card ── */}
      <div style={styles.card}>
        <div style={styles.srHeader}>
          <p style={styles.cardTitle}>Serial Numbers</p>
          <span style={styles.badge}>{scannedCount} scanned</span>
        </div>

        {/* Desktop: horizontal wrap grid | Mobile: single column */}
        <div style={styles.srGrid}>
          {serials.map((serial, i) => (
            <div key={i} style={styles.srItem}>
              <span style={styles.srNum}>
                #{String(i + 1).padStart(2, "0")}
              </span>
              <input
                ref={(el) => (inputRefs.current[i] = el)}
                style={{
                  ...styles.srInput,
                  ...(serial.trim() ? styles.srInputFilled : {}),
                }}
                type="text"
                placeholder="Scan or type…"
                autoComplete="off"
                spellCheck={false}
                value={serial}
                onChange={(e) => updateSerial(i, e.target.value)}
                onKeyDown={(e) => handleSerialKeyDown(e, i)}
                autoFocus={i === 0}
              />
              {serials.length > 1 && (
                <button
                  style={styles.srRemove}
                  onClick={() => removeSerial(i)}
                  title="Remove"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <p style={styles.scanHint}>
          <span style={styles.scanDot} />
          Scanner fires Enter/Tab — each scan auto-adds the next field
        </p>
      </div>
    </div>
  );
}

/* ── Inline styles (no Tailwind dependency) ── */
const styles = {
  page: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: "1.5rem",
    maxWidth: 900,
    margin: "0 auto",
  },
  topBar: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "1.5rem",
    gap: 12,
    flexWrap: "wrap",
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--color-text-primary, #111)",
    margin: 0,
  },
  pageSubtitle: {
    fontSize: 13,
    color: "var(--color-text-secondary, #666)",
    margin: "4px 0 0",
  },
  submitBtn: {
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    padding: "10px 24px",
    borderRadius: 8,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    transition: "opacity 0.15s",
    whiteSpace: "nowrap",
  },
  toast: {
    padding: "10px 16px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    marginBottom: "1rem",
  },
  card: {
    background: "#fff",
    border: "0.5px solid rgba(0,0,0,0.1)",
    borderRadius: 12,
    padding: "1.25rem 1.5rem",
    marginBottom: "1rem",
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.8px",
    textTransform: "uppercase",
    color: "#999",
    marginBottom: "1rem",
  },
  fieldsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: "#555" },
  input: {
    fontFamily: "inherit",
    fontSize: 14,
    padding: "9px 12px",
    borderRadius: 8,
    border: "0.5px solid rgba(0,0,0,0.18)",
    background: "#f9f9f9",
    color: "#111",
    outline: "none",
    transition: "border-color 0.15s",
  },
  inOutGroup: { display: "flex", gap: 8 },
  inOutBtn: {
    flex: 1,
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 0",
    borderRadius: 8,
    border: "0.5px solid rgba(0,0,0,0.18)",
    background: "#f9f9f9",
    color: "#777",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  inOutBtnIn: {
    background: "#EAF3DE",
    border: "0.5px solid #639922",
    color: "#27500A",
  },
  inOutBtnOut: {
    background: "#FCEBEB",
    border: "0.5px solid #A32D2D",
    color: "#501313",
  },
  srHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1rem",
  },
  badge: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: 500,
    background: "#E6F1FB",
    color: "#185FA5",
    borderRadius: 20,
    padding: "3px 10px",
  },
  srGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, 160px)",
    gap: 10,
    justifyContent: "flex-start",
  },
  srItem: { position: "relative", display: "flex", alignItems: "center" },
  srNum: {
    fontFamily: "monospace",
    fontSize: 10,
    color: "#aaa",
    position: "absolute",
    left: 9,
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 1,
  },
  srInput: {
    fontFamily: "monospace",
    fontSize: 13,
    padding: "9px 28px",
    width: "100%",
    borderRadius: 8,
    border: "0.5px solid rgba(0,0,0,0.15)",
    background: "#f9f9f9",
    color: "#111",
    outline: "none",
    transition: "border-color 0.15s, background 0.15s",
  },
  srInputFilled: {
    background: "#EAF3DE",
    border: "0.5px solid #639922",
    color: "#173404",
  },
  srRemove: {
    position: "absolute",
    right: 6,
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "none",
    background: "rgba(0,0,0,0.1)",
    color: "#666",
    fontSize: 9,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  scanHint: {
    fontSize: 12,
    color: "#aaa",
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  scanDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#639922",
    animation: "pulse 1.5s ease-in-out infinite",
    flexShrink: 0,
  },
};
