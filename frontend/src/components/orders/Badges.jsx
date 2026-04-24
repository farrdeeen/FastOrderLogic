export function PaymentBadge({ status }) {
  const map = {
    paid: ["badge-green", "Paid"],
    pending: ["badge-amber", "Pending"],
  };
  const [cls, label] = map[status?.toLowerCase()] || [
    "badge-gray",
    status || "—",
  ];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function DeliveryBadge({ status }) {
  const map = {
    not_shipped: ["badge-gray", "Not Shipped"],
    shipped: ["badge-blue", "Shipped"],
    completed: ["badge-green", "Completed"],
    ready: ["badge-purple", "Ready"],
  };
  const [cls, label] = map[status?.toLowerCase()] || [
    "badge-gray",
    status || "—",
  ];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function FulfillmentBadge({ status }) {
  const map = {
    0: ["badge-gray", "Pending"],
    1: ["badge-amber", "Processing"],
    2: ["badge-blue", "Packed"],
    3: ["badge-purple", "Ready"],
    4: ["badge-green", "Fulfilled"],
    5: ["badge-red", "Cancelled"],
  };
  if (status == null) return <span className="badge badge-gray">—</span>;
  const [cls, label] = map[status] || ["badge-gray", `${status}`];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function SerialBadge({ status }) {
  const map = {
    complete: ["badge-green", "✓ Complete"],
    partial: ["badge-amber", "Partial"],
    none: ["badge-gray", "No Serials"],
  };
  const [cls, label] = map[status] || ["badge-gray", "—"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function InvoiceCell({ invoiceNumber, orderStatus }) {
  if (orderStatus === "REJECTED")
    return <span className="badge badge-red">NA</span>;
  if (invoiceNumber === "NA")
    return <span className="badge badge-red">NA</span>;
  if (invoiceNumber)
    return <span className="invoice-num">🧾 {invoiceNumber}</span>;
  return <span className="badge badge-gray">Pending</span>;
}

export function InvoiceButton({
  orderId,
  invoiceNumber,
  detailsInvoice,
  onGenerate,
  loading,
  orderStatus,
}) {
  const existingInvoice = detailsInvoice || invoiceNumber;

  if (orderStatus === "REJECTED" || existingInvoice === "NA") {
    return (
      <span className="badge badge-red" style={{ fontSize: 11.5 }}>
        Invoice N/A
      </span>
    );
  }

  if (existingInvoice) {
    const printUrl = `${import.meta.env.VITE_API_URL}/zoho/orders/${encodeURIComponent(orderId)}/invoice/print`;
    return (
      <a
        href={printUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="lb-btn lb-btn-teal"
        style={{ textDecoration: "none" }}
      >
        🖨️ Print Invoice
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10.5,
            opacity: 0.75,
            marginLeft: 4,
          }}
        >
          {existingInvoice}
        </span>
      </a>
    );
  }

  return (
    <button
      className="lb-btn lb-btn-primary"
      onClick={onGenerate}
      disabled={loading}
    >
      {loading ? "Generating…" : "🧾 Invoice"}
    </button>
  );
}
