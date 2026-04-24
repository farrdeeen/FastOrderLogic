import { useEffect, useRef, useState } from "react";

let _jsBarcodePromise = null;

function loadJsBarcode() {
  if (_jsBarcodePromise) return _jsBarcodePromise;
  _jsBarcodePromise = new Promise((resolve) => {
    if (window.JsBarcode) {
      resolve(window.JsBarcode);
      return;
    }
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";
    script.onload = () => resolve(window.JsBarcode);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return _jsBarcodePromise;
}

export default function BarcodeCanvas({ value, height = 60 }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!value) return;
    loadJsBarcode().then((JsBarcode) => {
      if (!JsBarcode || !canvasRef.current) {
        setFailed(true);
        return;
      }
      try {
        JsBarcode(canvasRef.current, value, {
          format: "CODE128",
          width: 2.2,
          height,
          displayValue: false,
          margin: 4,
          background: "#fafafa",
          lineColor: "#000",
        });
        setReady(true);
      } catch {
        setFailed(true);
      }
    });
  }, [value, height]);

  if (!value) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pod-barcode-canvas"
        style={{ display: ready ? "block" : "none", maxWidth: "100%" }}
      />
      {failed && (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "#b00",
            padding: 4,
          }}
        >
          Barcode render failed — AWB: {value}
        </div>
      )}
    </>
  );
}
