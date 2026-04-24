import { useState, useRef } from "react";
import logoSrc from "../../assets/logo.png";
import BarcodeCanvas from "./BarcodeCanvas";
import { fmtCurrency, fmtDate } from "./helpers";
import { toast } from "./ToastSystem";

const SIZE_CONFIG = {
  A5: { w: "148mm", h: "210mm", pad: "8mm", fontSize: "11.5pt", barcodeH: 68 },
  A6: { w: "105mm", h: "148mm", pad: "6mm", fontSize: "9.5pt", barcodeH: 50 },
};

function buildPrintHtml({ data, cfg, paperSize }) {
  const addr = data.address || {};
  const seller = data.seller || {};
  const items = data.items || [];
  const total = items.reduce((s, i) => s + parseFloat(i.total_price || 0), 0);
  const hasAwb = data.awb_number && data.awb_number !== "To be assigned";

  const itemRows = items
    .map(
      (it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.product_name || ""}</td>
        <td style="text-align:center">${it.quantity}</td>
        <td>${fmtCurrency(it.unit_price)}</td>
        <td>${fmtCurrency(it.total_price)}</td>
      </tr>`,
    )
    .join("");

  const totalRow = `
    <tr style="border-top:2px solid #000;font-weight:700">
      <td colspan="3"></td>
      <td><strong>Total</strong></td>
      <td><strong>${fmtCurrency(total)}</strong></td>
    </tr>`;

  const logoHtml = `<img src="${logoSrc}" alt="Logo" style="max-height:84px;max-width:170px;object-fit:contain;" />`;

  const barcodeScript = hasAwb
    ? `<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
       <script>
         window.onload = function() {
           try {
             JsBarcode("#awb-barcode", "${data.awb_number}", {
               format:"CODE128", width:2.2, height:${cfg.barcodeH},
               displayValue:false, margin:4, background:"#fafafa", lineColor:"#000"
             });
           } catch(e) {}
         };
       </script>`
    : "";

  const barcodeArea = hasAwb
    ? `<div class="pod-barcode-area">
         <svg id="awb-barcode"></svg>
         <div class="pod-barcode-awb">${data.awb_number}</div>
       </div>`
    : `<div class="pod-barcode-area">
         <div class="pod-barcode-empty-label">Stick courier barcode / label here</div>
       </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>POD — ${data.order_id}</title>
  ${barcodeScript}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');
    @page { size: ${cfg.w} ${cfg.h}; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${cfg.w}; height: ${cfg.h}; overflow: hidden; }
    body {
      font-family: 'DM Sans', Arial, sans-serif; font-size: ${cfg.fontSize};
      color: #000; background: #fff; padding: ${cfg.pad}; line-height: 1.45;
    }
    .pod-label { width: 100%; height: 100%; display: flex; flex-direction: column; }
    .pod-header {
      display:flex; justify-content:space-between; align-items:flex-start;
      border-bottom:2px solid #000; padding-bottom:4mm; margin-bottom:4mm; gap:8px; flex-shrink:0;
    }
    .pod-meta-right { text-align:right; }
    .pod-order-id { font-family:'DM Mono',monospace; font-size:1.3em; font-weight:700; }
    .pod-date-line { font-size:0.75em; color:#555; margin-top:1px; font-family:'DM Mono',monospace; }
    .pod-barcode-area {
      border:1.5px dashed #999; border-radius:4px; padding:4px 6px; margin-bottom:4mm;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      min-height:50px; background:#fafafa; flex-shrink:0;
    }
    .pod-barcode-awb { font-family:'DM Mono',monospace; font-size:1.05em; font-weight:700; letter-spacing:2px; margin-top:2px; text-align:center; }
    .pod-barcode-empty-label { font-size:0.72em; color:#bbb; text-align:center; text-transform:uppercase; letter-spacing:.6px; padding:6px 0; }
    svg#awb-barcode { max-width:100%; height:auto; }
    .pod-section { margin-bottom:3mm; flex-shrink:0; }
    .pod-section-title { font-size:0.7em; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#555; margin-bottom:2mm; }
    .pod-address-box { border:1.5px solid #000; border-radius:3px; padding:3px 6px; background:#f9f9f9; line-height:1.6; }
    .pod-address-name { font-size:1.1em; font-weight:700; }
    .pod-from-box { border:1px solid #888; border-radius:3px; padding:3px 5px; font-size:0.85em; line-height:1.5; background:#f5f5f5; }
    .pod-items-section { flex:1; min-height:0; overflow:hidden; margin-bottom:3mm; }
    .pod-items-table { width:100%; border-collapse:collapse; font-size:0.83em; }
    .pod-items-table th { background:#111; color:#fff; padding:2px 4px; text-align:left; font-size:0.78em; }
    .pod-items-table td { padding:2px 4px; border-bottom:1px solid #ddd; }
    .pod-footer { display:flex; justify-content:space-between; align-items:flex-end; border-top:1.5px solid #000; padding-top:3mm; flex-shrink:0; }
    .pod-footer-left { font-size:0.85em; line-height:1.7; }
    .pod-sig-box { border:1px solid #999; border-radius:3px; padding:12px 24px 4px; text-align:center; font-size:0.72em; color:#666; }
    .pod-fine-print { margin-top:2mm; text-align:center; font-size:0.67em; color:#aaa; border-top:1px dashed #ccc; padding-top:2mm; flex-shrink:0; }
  </style>
</head>
<body>
  <div class="pod-label">
    <div class="pod-header">
      ${logoHtml}
      <div class="pod-meta-right">
        <div class="pod-order-id">${data.order_id}</div>
        <div class="pod-date-line">${fmtDate(data.created_at)} &nbsp; Status: <strong>${(data.payment_status || "—").toUpperCase()}</strong></div>
      </div>
    </div>
    ${barcodeArea}
    <div class="pod-section">
      <div class="pod-section-title">Deliver To</div>
      <div class="pod-address-box">
        <div class="pod-address-name">${addr.name || ""}</div>
        <div>${addr.address_line || ""}${addr.locality ? `, ${addr.locality}` : ""}</div>
        <div>${addr.city || ""}, ${addr.state_name || ""} — <strong>${addr.pincode || ""}</strong></div>
        ${addr.landmark ? `<div>Near: ${addr.landmark}</div>` : ""}
        <div>📞 <strong>${addr.mobile || ""}</strong></div>
      </div>
    </div>
    <div class="pod-section">
      <div class="pod-section-title">From</div>
      <div class="pod-from-box">
        <strong>${seller.name || ""}</strong><br/>
        ${seller.address || ""}${seller.phone ? `<br/>📞 ${seller.phone}` : ""}
      </div>
    </div>
    <div class="pod-items-section">
      <div class="pod-section-title">Order Items</div>
      <table class="pod-items-table">
        <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>${itemRows}${totalRow}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

export default function OfflinePOD({ data, onClose }) {
  const [paperSize, setPaperSize] = useState("A5");
  const printWindowRef = useRef(null);

  if (!data) return null;

  const addr = data.address || {};
  const seller = data.seller || {};
  const items = data.items || [];
  const total = items.reduce((s, i) => s + parseFloat(i.total_price || 0), 0);
  const hasAwb = data.awb_number && data.awb_number !== "To be assigned";
  const cfg = SIZE_CONFIG[paperSize];

  const openWindow = () => {
    if (printWindowRef.current && !printWindowRef.current.closed) {
      printWindowRef.current.close();
    }
    const win = window.open(
      "",
      "_blank",
      "width=700,height=600,scrollbars=no,toolbar=no,menubar=no",
    );
    if (!win) {
      toast.error("Popup blocked. Please allow popups for this site.");
      return null;
    }
    printWindowRef.current = win;
    win.document.open();
    win.document.write(buildPrintHtml({ data, cfg, paperSize }));
    win.document.close();
    return win;
  };

  const handlePrint = () => {
    const win = openWindow();
    if (!win) return;
    const doPrint = () => {
      win.focus();
      win.print();
      win.onafterprint = () => win.close();
    };
    setTimeout(doPrint, hasAwb ? 800 : 200);
  };

  const handleDownloadPDF = () => {
    const win = openWindow();
    if (!win) return;
    setTimeout(
      () => {
        win.focus();
        win.print();
      },
      hasAwb ? 800 : 200,
    );
  };

  const previewClass =
    paperSize === "A5" ? "pod-label pod-label-a5" : "pod-label pod-label-a6";

  return (
    <div
      className="track-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="track-modal" style={{ maxWidth: 680 }}>
        {/* Header */}
        <div className="track-modal-header">
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              📦 Print POD / Shipping Label
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--text3)",
                fontFamily: "'DM Mono',monospace",
                marginTop: 2,
              }}
            >
              {data.order_id}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="pod-size-selector">
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--text3)",
                  marginRight: 2,
                }}
              >
                Size:
              </span>
              {["A5", "A6"].map((sz) => (
                <button
                  key={sz}
                  className={`pod-size-btn${paperSize === sz ? " active" : ""}`}
                  onClick={() => setPaperSize(sz)}
                >
                  {sz}
                </button>
              ))}
            </div>
            <button className="lb-btn lb-btn-primary" onClick={handlePrint}>
              🖨️ Print
            </button>
            <button
              className="lb-btn lb-btn-secondary"
              onClick={handleDownloadPDF}
            >
              ⬇️ Download PDF
            </button>
            <button className="lb-close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Screen preview */}
        <div className="pod-preview-wrap">
          <div className={previewClass}>
            <div className="pod-header">
              <img src={logoSrc} alt="Logo" className="pod-logo" />
              <div className="pod-meta-right">
                <div className="pod-order-id">{data.order_id}</div>
                <div className="pod-date-line">{fmtDate(data.created_at)}</div>
                {data.invoice_number && (
                  <div className="pod-date-line">
                    INV: {data.invoice_number}
                  </div>
                )}
              </div>
            </div>

            <div className="pod-barcode-area">
              {hasAwb ? (
                <>
                  <BarcodeCanvas
                    value={data.awb_number}
                    height={cfg.barcodeH}
                  />
                  <div className="pod-barcode-awb">{data.awb_number}</div>
                  <div className="pod-barcode-sub">Delhivery AWB — CODE128</div>
                </>
              ) : (
                <div className="pod-barcode-empty-label">
                  Stick courier barcode / label here
                </div>
              )}
            </div>

            <div className="pod-section">
              <div className="pod-section-title">Deliver To</div>
              <div className="pod-address-box">
                <div className="pod-address-name">{addr.name}</div>
                <div>
                  {addr.address_line}
                  {addr.locality ? `, ${addr.locality}` : ""}
                </div>
                <div>
                  {addr.city}, {addr.state_name} —{" "}
                  <strong>{addr.pincode}</strong>
                </div>
                {addr.landmark && <div>Near: {addr.landmark}</div>}
                <div>
                  📞 <strong>{addr.mobile}</strong>
                </div>
              </div>
            </div>

            <div className="pod-section">
              <div className="pod-section-title">From</div>
              <div className="pod-from-box">
                <strong>{seller.name}</strong>
                <br />
                {seller.address}
                {seller.phone ? (
                  <>
                    <br />
                    📞 {seller.phone}
                  </>
                ) : null}
              </div>
            </div>

            <div className="pod-section">
              <div className="pod-section-title">Order Items</div>
              <table className="pod-items-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.item_id}>
                      <td>{i + 1}</td>
                      <td>{it.product_name}</td>
                      <td style={{ fontFamily: "monospace" }}>
                        {it.sku_id || "—"}
                      </td>
                      <td style={{ textAlign: "center" }}>{it.quantity}</td>
                      <td>{fmtCurrency(it.unit_price)}</td>
                      <td>{fmtCurrency(it.total_price)}</td>
                    </tr>
                  ))}
                  <tr className="pod-total-row">
                    <td colSpan={4}></td>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td>
                      <strong>{fmtCurrency(total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="pod-footer">
              <div className="pod-footer-left">
                Payment:{" "}
                <strong>{data.payment_type?.toUpperCase() || "—"}</strong>
                <br />
                Status:{" "}
                <strong>{data.payment_status?.toUpperCase() || "—"}</strong>
                {data.utr_number && (
                  <>
                    <br />
                    <span
                      style={{ fontFamily: "monospace", fontSize: "0.82em" }}
                    >
                      UTR: {data.utr_number}
                    </span>
                  </>
                )}
              </div>
              <div className="pod-sig-box">Receiver's Signature</div>
            </div>

            <div className="pod-fine-print">
              Computer-generated document.
              {seller.phone ? ` Queries: ${seller.phone}` : ""}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "10px 20px",
            fontSize: 11.5,
            color: "var(--text3)",
            background: "var(--surface2)",
            borderTop: "1px solid var(--border)",
            borderRadius: "0 0 var(--radius-xl) var(--radius-xl)",
          }}
        >
          💡 Select <strong>A5</strong> or <strong>A6</strong> above, then click
          Print. In the browser dialog, set paper size to match and disable
          headers/footers for best results.
        </div>
      </div>
    </div>
  );
}
