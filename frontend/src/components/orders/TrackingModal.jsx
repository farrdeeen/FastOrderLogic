import { useState, useEffect } from "react";
import api from "../../api/axiosInstance";
import { fmtDate, fmtDateTime } from "./helpers";

export default function TrackingModal({
  waybill,
  orderId,
  onClose,
  onPrintPOD,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(
          `/delhivery/track/${encodeURIComponent(waybill)}`,
        );
        setData(res.data);
      } catch (err) {
        setError(err?.response?.data?.detail || "Failed to load tracking data");
      } finally {
        setLoading(false);
      }
    })();
  }, [waybill]);

  const statusColor = (s = "") => {
    const lower = s.toLowerCase();
    if (lower.includes("deliver")) return "#027a48";
    if (lower.includes("transit") || lower.includes("scan"))
      return "var(--accent)";
    if (lower.includes("pick")) return "var(--amber)";
    return "var(--text2)";
  };

  return (
    <div
      className="track-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="track-modal">
        <div className="track-modal-header">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              📦 Shipment Tracking
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 12,
                  color: "var(--accent)",
                  fontWeight: 600,
                }}
              >
                {waybill}
              </span>
              {data?.status && (
                <span className="badge badge-blue" style={{ fontSize: 11 }}>
                  {data.status}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="lb-btn lb-btn-orange lb-btn-sm"
              onClick={onPrintPOD}
            >
              🖨️ Print POD
            </button>
            <button className="lb-close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {data && (
          <div
            style={{
              padding: "10px 18px",
              background: "var(--surface2)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 20,
              flexWrap: "wrap",
              fontSize: 12,
            }}
          >
            <span>
              <strong>Origin:</strong> {data.origin || "—"}
            </span>
            <span>
              <strong>Dest:</strong> {data.destination || "—"}
            </span>
            {data.expected_date && (
              <span>
                <strong>EDD:</strong> {fmtDate(data.expected_date)}
              </span>
            )}
          </div>
        )}

        <div className="track-timeline">
          {loading && <div className="track-empty">Loading tracking data…</div>}
          {error && (
            <div className="track-empty" style={{ color: "var(--red)" }}>
              {error}
            </div>
          )}
          {!loading &&
            !error &&
            (!data?.timeline || data.timeline.length === 0) && (
              <div className="track-empty">
                No tracking events yet. Check back soon.
              </div>
            )}
          {!loading &&
            !error &&
            data?.timeline?.map((ev, i) => (
              <div className="track-event" key={i}>
                <div className={`track-dot ${i > 0 ? "track-dot-gray" : ""}`} />
                <div className="track-event-content">
                  <div
                    className="track-event-status"
                    style={{
                      color: i === 0 ? statusColor(ev.status) : "var(--text)",
                    }}
                  >
                    {ev.status}
                  </div>
                  {ev.location && (
                    <div className="track-event-loc">📍 {ev.location}</div>
                  )}
                  {ev.remark && (
                    <div className="track-event-loc">{ev.remark}</div>
                  )}
                  <div className="track-event-date">{fmtDateTime(ev.date)}</div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
