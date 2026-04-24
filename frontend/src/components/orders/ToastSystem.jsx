import { useState, useRef, useCallback } from "react";

let _toastDispatch = null;

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const timerRef = useRef({});

  _toastDispatch = useCallback((msg, type = "info", duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type }]);
    timerRef.current[id] = setTimeout(() => removeToast(id), duration);
    return id;
  }, []);

  const removeToast = (id) => {
    clearTimeout(timerRef.current[id]);
    setToasts((p) => p.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 220);
  };

  const iconMap = { success: "✓", error: "✕", warn: "⚠", info: "ℹ" };

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type} ${t.exiting ? "toast-exit" : ""}`}
        >
          <span>{iconMap[t.type] || "ℹ"}</span>
          <span style={{ flex: 1 }}>{t.msg}</span>
          <button className="toast-close" onClick={() => removeToast(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function toast(msg, type = "info", duration = 3500) {
  if (_toastDispatch) _toastDispatch(msg, type, duration);
}
toast.success = (m, d) => toast(m, "success", d);
toast.error = (m, d) => toast(m, "error", d);
toast.warn = (m, d) => toast(m, "warn", d);
toast.info = (m, d) => toast(m, "info", d);
