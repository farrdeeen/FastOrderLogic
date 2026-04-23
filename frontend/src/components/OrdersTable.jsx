import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import api from "../api/axiosInstance";
import logoSrc from "../assets/logo.png"; // adjust extension if needed (.svg, .webp, etc.)
/* ─────────────────────────────────────────────
   GLOBAL STYLES  (injected once)
───────────────────────────────────────────── */
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

  :root {
    --bg: #f4f5f7;
    --surface: #ffffff;
    --surface2: #f8f9fb;
    --border: #e4e7ec;
    --border2: #d0d5dd;
    --text: #101828;
    --text2: #475467;
    --text3: #98a2b3;
    --accent: #1570ef;
    --accent-light: #eff4ff;
    --accent-dark: #0e4fc7;
    --green: #12b76a;
    --green-bg: #ecfdf3;
    --red: #f04438;
    --red-bg: #fef3f2;
    --amber: #f79009;
    --amber-bg: #fffaeb;
    --purple: #7f56d9;
    --purple-bg: #f4f3ff;
    --shadow-sm: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1);
    --shadow-md: 0 4px 8px -2px rgba(16,24,40,.1), 0 2px 4px -2px rgba(16,24,40,.06);
    --shadow-xl: 0 20px 24px -4px rgba(16,24,40,.08), 0 8px 8px -4px rgba(16,24,40,.03);
    --radius: 8px; --radius-lg: 12px; --radius-xl: 16px;
    font-family: 'DM Sans', sans-serif;
  }

  .ot-wrap { font-family: 'DM Sans', sans-serif; color: var(--text); width: 100%; }

  /* ── RESPONSIVE TABLE WRAPPER ── */
  .ot-table-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm);
    width: 100%;
  }
  .ot-table-scroll { overflow-x: auto; width: 100%; }
  .ot-table {
    width: 100%; border-collapse: collapse;
    font-size: clamp(11px, 1.1vw, 13.5px);
    min-width: 900px;
  }
  .ot-table thead tr { background: var(--surface2); border-bottom: 1px solid var(--border); }
  .ot-table th {
    padding: clamp(7px,0.7vw,11px) clamp(7px,0.9vw,14px);
    text-align: left; font-weight: 600;
    font-size: clamp(10px,1vw,12px); color: var(--text2);
    letter-spacing: .3px; white-space: nowrap; user-select: none;
  }
  .ot-table td {
    padding: clamp(7px,0.7vw,12px) clamp(7px,0.9vw,14px);
    border-bottom: 1px solid var(--border); vertical-align: middle;
  }
  .ot-table tbody tr:last-child td { border-bottom: none; }
  .ot-table tbody tr { transition: background .1s; cursor: pointer; }
  .ot-table tbody tr:hover td { background: #fafbff; }

  @media (max-width: 1300px) {
    .ot-col-hide-sm { display: none; }
  }

  .badge {
    display: inline-flex; align-items: center; gap: 3px;
    padding: clamp(2px,0.3vw,3px) clamp(6px,0.7vw,9px);
    border-radius: 20px; font-size: clamp(10px,0.95vw,11.5px);
    font-weight: 600; letter-spacing: .2px; white-space: nowrap;
  }
  .badge-green  { background: var(--green-bg); color: #027a48; }
  .badge-red    { background: var(--red-bg);   color: #b42318; }
  .badge-amber  { background: var(--amber-bg); color: #b54708; }
  .badge-purple { background: var(--purple-bg);color: #6941c6; }
  .badge-gray   { background: var(--bg);       color: var(--text2); }
  .badge-blue   { background: var(--accent-light); color: var(--accent-dark); }
  .badge-orange { background: #fff7ed; color: #c2410c; }
  .badge::before {
    content: ''; display: inline-block; width: 5px; height: 5px;
    border-radius: 50%; background: currentColor; opacity: .8;
  }

  .order-id { font-family: 'DM Mono', monospace; font-size: clamp(10px,1vw,12.5px); color: var(--accent); font-weight: 500; }
  .invoice-num { font-family: 'DM Mono', monospace; font-size: 11.5px; color: #027a48; font-weight: 500; }
  .ot-load-more { padding: 14px; text-align: center; color: var(--text3); font-size: 13px; }

  /* ── DELIVERY CELL ── */
  .delivery-cell { display: flex; flex-direction: column; gap: 4px; }
  .waybill-link {
    font-family: 'DM Mono', monospace; font-size: clamp(9px,0.9vw,11px); color: var(--accent);
    cursor: pointer; text-decoration: underline dotted; white-space: nowrap;
    background: none; border: none; padding: 0; font-weight: 500;
  }
  .waybill-link:hover { color: var(--accent-dark); }
  .push-btn {
    display: inline-flex; align-items: center; gap: 3px;
    padding: clamp(2px,0.3vw,3px) clamp(6px,0.7vw,8px);
    border-radius: 20px; font-size: clamp(10px,0.95vw,11px); font-weight: 600; cursor: pointer;
    background: var(--accent-light); color: var(--accent-dark);
    border: 1px solid #b2ccff; transition: all .15s; white-space: nowrap;
  }
  .push-btn:hover { background: #dbeafe; }
  .push-btn:disabled { opacity: .5; pointer-events: none; }

  /* ── LIGHTBOX ── */
  .lb-overlay {
    position: fixed; inset: 0; background: rgba(16,24,40,.6);
    backdrop-filter: blur(3px); display: flex; justify-content: center;
    align-items: flex-start; padding: 20px 16px; z-index: 1000; overflow-y: auto;
    animation: fadeIn .15s ease;
  }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  .lb-panel {
    background: var(--surface); border-radius: var(--radius-xl);
    width: 100%; max-width: 1200px; box-shadow: var(--shadow-xl);
    animation: slideUp .2s ease; overflow: hidden; flex-shrink: 0;
    display: flex; flex-direction: column; max-height: calc(100vh - 40px);
  }
  @keyframes slideUp { from { transform: translateY(20px); opacity: 0 } to { transform: none; opacity: 1 } }
  .lb-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px 14px; border-bottom: 1px solid var(--border);
    background: var(--surface2); flex-shrink: 0;
  }
  .lb-title { font-size: 15px; font-weight: 600; color: var(--text); }
  .lb-subtitle { font-size: 12px; color: var(--text3); margin-top: 2px; font-family: 'DM Mono', monospace; }
  .lb-close {
    width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--border2);
    background: transparent; cursor: pointer; display: flex; align-items: center;
    justify-content: center; color: var(--text2); transition: all .15s;
  }
  .lb-close:hover { background: var(--red-bg); color: var(--red); border-color: var(--red); }
  .lb-body {
    padding: 20px; display: grid; grid-template-columns: 1fr 1fr;
    gap: 20px; overflow-y: auto; flex: 1;
  }
  .lb-section { display: flex; flex-direction: column; gap: 14px; }
  .lb-section-title {
    font-size: 10.5px; font-weight: 600; color: var(--text3);
    letter-spacing: .7px; text-transform: uppercase; margin-bottom: 8px;
  }
  .lb-info-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
  .lb-info-card { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); padding: 9px 12px; }
  .lb-info-label { font-size: 10.5px; color: var(--text3); font-weight: 500; margin-bottom: 2px; }
  .lb-info-value { font-size: 13px; color: var(--text); font-weight: 500; display: flex; align-items: center; gap: 6px; }

  .edit-icon { cursor: pointer; color: var(--text3); transition: color 0.15s; font-size: 13px; }
  .edit-icon:hover { color: var(--accent); }
  .inline-edit-input {
    padding: 5px 9px; border: 1px solid var(--accent); border-radius: 5px;
    font-family: inherit; font-size: 13px; outline: none; width: 100%;
    box-shadow: 0 0 0 3px rgba(21,112,239,.12);
  }
  .inline-edit-select {
    padding: 5px 9px; border: 1px solid var(--accent); border-radius: 5px;
    font-family: inherit; font-size: 12.5px; outline: none; width: 100%;
    box-shadow: 0 0 0 3px rgba(21,112,239,.12); background: var(--surface); cursor: pointer;
  }

  .lb-items-table-wrap { border: 1px solid var(--border); border-radius: var(--radius); overflow: visible; }
  .lb-items-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .lb-items-table th {
    padding: 7px 9px; background: var(--surface2); text-align: left;
    font-size: 11px; color: var(--text3); font-weight: 600; border-bottom: 1px solid var(--border);
  }
  .lb-items-table td { padding: 9px; border-bottom: 1px solid var(--border); color: var(--text); overflow: visible; }
  .lb-items-table tr:last-child td { border-bottom: none; }

  .lb-actions {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    padding: 14px 20px; border-top: 1px solid var(--border);
    background: var(--surface2); flex-shrink: 0;
  }
  .lb-btn {
    display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px;
    border-radius: var(--radius); font-family: inherit; font-size: 12.5px; font-weight: 500;
    cursor: pointer; border: 1px solid transparent; transition: all .15s;
  }
  .lb-btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .lb-btn-primary:hover { background: var(--accent-dark); }
  .lb-btn-secondary { background: var(--surface); color: var(--text2); border-color: var(--border2); }
  .lb-btn-secondary:hover { background: var(--bg); }
  .lb-btn-danger { background: var(--surface); color: var(--red); border-color: #fda29b; }
  .lb-btn-danger:hover { background: var(--red-bg); }
  .lb-btn-success { background: var(--green-bg); color: #027a48; border-color: #a9efc5; }
  .lb-btn-success:hover { background: #d1fadf; }
  .lb-btn-teal { background: #f0fdfa; color: #0d9488; border-color: #99f6e4; }
  .lb-btn-teal:hover { background: #ccfbf1; }
  .lb-btn-orange { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
  .lb-btn-orange:hover { background: #ffedd5; }
  .lb-btn-sm { padding: 4px 9px; font-size: 11.5px; }
  .lb-btn:disabled { opacity: .5; pointer-events: none; }

  /* ── UTR BOX ── */
  .utr-box {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 14px; margin-top: 6px;
  }
  .utr-box label { font-size: 11.5px; font-weight: 600; color: var(--text2); display: block; margin-bottom: 5px; }
  .utr-input-row { display: flex; gap: 7px; }
  .utr-input {
    flex: 1; padding: 8px 11px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: 'DM Mono', monospace;
    font-size: 12.5px; outline: none; transition: border .15s;
  }
  .utr-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── SERIAL ── */
  .serial-item { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 10px; background: var(--surface2); }
  .serial-item h4 { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--text); }
  .serial-input {
    width: 100%; padding: 7px 10px; margin: 3px 0; border: 1px solid var(--border2);
    border-radius: 5px; font-family: 'DM Mono', monospace; font-size: 12.5px; outline: none;
    transition: border .15s; box-sizing: border-box;
  }
  .serial-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── REMARKS / UTR SIDE BY SIDE ── */
  .remarks-utr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .remarks-input {
    width: 100%; padding: 8px 11px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: inherit; font-size: 12.5px;
    resize: vertical; min-height: 54px; outline: none; transition: border .15s; box-sizing: border-box;
  }
  .remarks-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  /* ── FORM FIELDS ── */
  .form-field { display: flex; flex-direction: column; gap: 4px; }
  .form-label { font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: .4px; }
  .form-input {
    padding: 8px 11px; border: 1px solid var(--border2); border-radius: var(--radius);
    font-family: inherit; font-size: 13px; outline: none; transition: border .15s;
    background: var(--surface); width: 100%; box-sizing: border-box;
  }
  .form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }
  .form-select {
    padding: 8px 11px; border: 1px solid var(--border2); border-radius: var(--radius);
    font-family: inherit; font-size: 13px; outline: none; transition: border .15s;
    background: var(--surface); width: 100%; box-sizing: border-box; cursor: pointer;
  }
  .form-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }
  .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }

  /* ── ADD PRODUCT PANEL ── */
  .add-product-panel {
    border: 1px solid var(--accent-light); border-radius: var(--radius);
    background: var(--accent-light); padding: 14px; margin-top: 8px;
  }
  .add-product-panel h4 { font-size: 12px; font-weight: 600; color: var(--accent-dark); margin: 0 0 10px; text-transform: uppercase; letter-spacing: .4px; }

  /* ── PRODUCT SEARCH ── */
  .product-search-wrap { position: relative; }
  .product-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--surface); border: 1px solid var(--border2);
    border-radius: var(--radius); box-shadow: var(--shadow-md);
    z-index: 9999; max-height: 200px; overflow-y: auto;
  }
  .product-option { padding: 8px 12px; cursor: pointer; font-size: 12.5px; transition: background .1s; border-bottom: 1px solid var(--border); }
  .product-option:last-child { border-bottom: none; }
  .product-option:hover { background: var(--accent-light); }
  .product-option-sku { font-size: 11px; color: var(--text3); font-family: 'DM Mono', monospace; }

  /* ── DELETE ICON ── */
  .del-icon { cursor: pointer; color: var(--text3); font-size: 13px; transition: color .15s; padding: 2px; }
  .del-icon:hover { color: var(--red); }

  /* ── TOAST SYSTEM ── */
  .toast-container {
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    display: flex; flex-direction: column; gap: 8px; pointer-events: none;
  }
  .toast {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; border-radius: var(--radius-lg);
    font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 500;
    min-width: 260px; max-width: 380px; pointer-events: all;
    box-shadow: var(--shadow-xl); animation: toastIn .2s ease;
    border: 1px solid transparent;
  }
  @keyframes toastIn { from { transform: translateX(40px); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes toastOut { from { opacity: 1; transform: none } to { opacity: 0; transform: translateX(40px) } }
  .toast-exit { animation: toastOut .2s ease forwards; }
  .toast-success { background: var(--green-bg); color: #027a48; border-color: #a9efc5; }
  .toast-error   { background: var(--red-bg);   color: #b42318; border-color: #fda29b; }
  .toast-info    { background: var(--accent-light); color: var(--accent-dark); border-color: #b2ccff; }
  .toast-warn    { background: var(--amber-bg); color: #b54708; border-color: #fedf89; }
  .toast-close { margin-left: auto; cursor: pointer; opacity: .6; font-size: 14px; background: none; border: none; color: inherit; padding: 0 2px; }
  .toast-close:hover { opacity: 1; }

  /* ── EMPTY ── */
  .ot-empty { text-align: center; padding: 60px 20px; color: var(--text3); font-size: 14px; }

  /* ── DELHIVERY PUSH MODAL ── */
  .dlv-modal-overlay {
    position: fixed; inset: 0; background: rgba(16,24,40,.55);
    backdrop-filter: blur(3px); display: flex; align-items: center;
    justify-content: center; z-index: 2000; padding: 20px;
    animation: fadeIn .15s ease;
  }
  .dlv-modal {
    background: var(--surface); border-radius: var(--radius-xl);
    width: 100%; max-width: 480px; box-shadow: var(--shadow-xl);
    animation: slideUp .2s ease; overflow: hidden;
  }
  .dlv-modal-header {
    padding: 14px 18px 12px; background: var(--surface2);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .dlv-modal-title { font-size: 14px; font-weight: 600; }
  .dlv-modal-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  .dlv-modal-footer {
    padding: 12px 18px; border-top: 1px solid var(--border);
    background: var(--surface2); display: flex; gap: 8px; justify-content: flex-end;
  }

  /* ── TRACKING MODAL ── */
  .track-modal-overlay {
    position: fixed; inset: 0; background: rgba(16,24,40,.65);
    backdrop-filter: blur(4px); display: flex; align-items: flex-start;
    justify-content: center; z-index: 2000; padding: 30px 16px; overflow-y: auto;
    animation: fadeIn .15s ease;
  }
  .track-modal {
    background: var(--surface); border-radius: var(--radius-xl);
    width: 100%; max-width: 560px; box-shadow: var(--shadow-xl);
    animation: slideUp .2s ease; flex-shrink: 0;
  }
  .track-modal-header {
    padding: 16px 20px 14px; background: var(--surface2);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .track-timeline { padding: 18px; display: flex; flex-direction: column; gap: 0; }
  .track-event {
    display: flex; gap: 14px; padding-bottom: 16px;
    position: relative;
  }
  .track-event::before {
    content: ''; position: absolute; left: 7px; top: 20px;
    width: 2px; bottom: 0; background: var(--border);
  }
  .track-event:last-child::before { display: none; }
  .track-dot {
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--accent); flex-shrink: 0; margin-top: 2px;
    border: 2px solid #fff; box-shadow: 0 0 0 2px var(--accent);
  }
  .track-dot-gray { background: var(--text3); box-shadow: 0 0 0 2px var(--text3); }
  .track-event-content { flex: 1; }
  .track-event-status { font-size: 13px; font-weight: 600; color: var(--text); }
  .track-event-loc { font-size: 12px; color: var(--text2); margin-top: 1px; }
  .track-event-date { font-size: 11px; color: var(--text3); margin-top: 2px; font-family: 'DM Mono', monospace; }
  .track-empty { text-align: center; padding: 40px; color: var(--text3); font-size: 13px; }

  /* ─────────────────────────────────────────────
     POD PRINT STYLES — Isolated iframe approach
     eliminates duplicate-page bug entirely.
     @page size is injected dynamically based on
     the user's A5 / A6 selection.
  ───────────────────────────────────────────── */

  /* Screen preview wrapper */
  .pod-preview-wrap {
    padding: 20px;
    background: #e5e7eb;
    border-radius: 0 0 var(--radius-xl) var(--radius-xl);
    display: flex;
    justify-content: center;
  }

  /* ── POD LABEL — shared screen + print styles ── */
  .pod-label {
    font-family: 'DM Sans', Arial, sans-serif;
    background: #fff;
    color: #000;
    border: 2px solid #000;
    border-radius: 4px;
    box-sizing: border-box;
    line-height: 1.45;
  }

  /* A5 preview: 148×210mm → ~559×793px at 96dpi */
  .pod-label-a5 {
    width: 148mm;
    padding: 8mm;
    font-size: 11.5pt;
  }
  /* A6 preview: 105×148mm → ~397×559px at 96dpi */
  .pod-label-a6 {
    width: 105mm;
    padding: 6mm;
    font-size: 9.5pt;
  }

  /* Size selector pill row */
  .pod-size-selector {
    display: flex; gap: 8px; align-items: center;
  }
  .pod-size-btn {
    padding: 5px 14px; border-radius: 20px; font-size: 12.5px; font-weight: 600;
    cursor: pointer; border: 1.5px solid var(--border2);
    background: var(--surface); color: var(--text2); transition: all .15s;
  }
  .pod-size-btn.active {
    background: var(--accent); color: #fff; border-color: var(--accent);
  }

  /* Header: logo left, order meta right */
  .pod-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #000; padding-bottom: 5mm; margin-bottom: 5mm;
    gap: 8px;
  }
  .pod-logo { max-height: 44px; max-width: 130px; object-fit: contain; }
  .pod-meta-right { text-align: right; }
  .pod-order-id { font-family: 'DM Mono', monospace; font-size: 1.25em; font-weight: 700; }
  .pod-date-line { font-size: 0.78em; color: #555; margin-top: 2px; font-family: 'DM Mono', monospace; }

  /* Barcode area */
  .pod-barcode-area {
    border: 1.5px dashed #999; border-radius: 4px;
    padding: 5px 8px; margin-bottom: 5mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 60px; background: #fafafa;
  }
  .pod-barcode-awb {
    font-family: 'DM Mono', monospace; font-size: 1.1em; font-weight: 700;
    letter-spacing: 2px; margin-top: 3px; text-align: center;
  }
  .pod-barcode-sub {
    font-size: 0.72em; color: #777; margin-top: 2px; text-align: center;
  }
  .pod-barcode-empty-label {
    font-size: 0.75em; color: #bbb; text-align: center;
    text-transform: uppercase; letter-spacing: .6px; padding: 8px 0;
  }
  .pod-barcode-canvas { max-width: 100%; height: auto; }

  .pod-section { margin-bottom: 4mm; }
  .pod-section-title {
    font-size: 0.72em; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: #555; margin-bottom: 2mm;
  }
  .pod-address-box {
    border: 1.5px solid #000; border-radius: 3px; padding: 4px 7px;
    background: #f9f9f9; line-height: 1.6;
  }
  .pod-address-name { font-size: 1.15em; font-weight: 700; }
  .pod-from-box {
    border: 1px solid #888; border-radius: 3px;
    padding: 4px 6px; font-size: 0.88em; line-height: 1.55; background: #f5f5f5;
  }
  .pod-items-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
  .pod-items-table th {
    background: #111; color: #fff; padding: 3px 5px;
    text-align: left; font-size: 0.8em;
  }
  .pod-items-table td { padding: 3px 5px; border-bottom: 1px solid #ddd; }
  .pod-total-row td { border-top: 1.5px solid #000; font-weight: 700; }

  .pod-footer {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-top: 1.5px solid #000; padding-top: 3mm; margin-top: 3mm;
  }
  .pod-footer-left { font-size: 0.88em; line-height: 1.7; }
  .pod-sig-box {
    border: 1px solid #999; border-radius: 3px;
    padding: 14px 28px 5px; text-align: center; font-size: 0.75em; color: #666;
  }
  .pod-fine-print {
    margin-top: 3mm; text-align: center; font-size: 0.7em;
    color: #aaa; border-top: 1px dashed #ccc; padding-top: 3mm;
  }

  /* ── RESPONSIVE ── */
  @media (max-width: 1100px) { .lb-body { grid-template-columns: 1fr; } .lb-panel { max-width: 800px; } }
  @media (max-width: 700px) {
    .lb-info-grid { grid-template-columns: 1fr; }
    .form-grid-2, .form-grid-3, .remarks-utr-row { grid-template-columns: 1fr; }
  }
`;

function injectStyles() {
  if (document.getElementById("ot-styles")) return;
  const s = document.createElement("style");
  s.id = "ot-styles";
  s.textContent = STYLES;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────
   TOAST SYSTEM
───────────────────────────────────────────── */
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

function toast(msg, type = "info", duration = 3500) {
  if (_toastDispatch) _toastDispatch(msg, type, duration);
}
toast.success = (m, d) => toast(m, "success", d);
toast.error = (m, d) => toast(m, "error", d);
toast.warn = (m, d) => toast(m, "warn", d);
toast.info = (m, d) => toast(m, "info", d);

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const fmtCurrency = (v) =>
  v != null
    ? `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
    : "—";

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const fmtDateTime = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function PaymentBadge({ status }) {
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

function DeliveryBadge({ status }) {
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

function FulfillmentBadge({ status }) {
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

function SerialBadge({ status }) {
  const map = {
    complete: ["badge-green", "✓ Complete"],
    partial: ["badge-amber", "Partial"],
    none: ["badge-gray", "No Serials"],
  };
  const [cls, label] = map[status] || ["badge-gray", "—"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function InvoiceCell({ invoiceNumber, orderStatus }) {
  if (orderStatus === "REJECTED")
    return <span className="badge badge-red">NA</span>;
  if (invoiceNumber === "NA")
    return <span className="badge badge-red">NA</span>;
  if (invoiceNumber)
    return <span className="invoice-num">🧾 {invoiceNumber}</span>;
  return <span className="badge badge-gray">Pending</span>;
}

function InvoiceButton({
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

/* ─────────────────────────────────────────────
   REAL BARCODE — uses JsBarcode loaded from CDN
   Renders CODE128 into a canvas element.
   Falls back to text-only if JsBarcode is not
   available (e.g. no internet).
───────────────────────────────────────────── */

// Load JsBarcode once, lazily
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

function BarcodeCanvas({ value, height = 60 }) {
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

/* ─────────────────────────────────────────────
   OFFLINE POD PRINT
   ─ User picks A5 or A6 in our UI first
   ─ We then open a dedicated print window
     (no body visibility hacks → zero duplicate pages)
   ─ Real CODE128 barcode via JsBarcode
───────────────────────────────────────────── */
function OfflinePOD({ data, onClose }) {
  const [paperSize, setPaperSize] = useState("A5"); // "A5" | "A6"
  const printWindowRef = useRef(null);

  if (!data) return null;

  const addr = data.address || {};
  const seller = data.seller || {};
  const items = data.items || [];
  const total = items.reduce((s, i) => s + parseFloat(i.total_price || 0), 0);
  const hasAwb = data.awb_number && data.awb_number !== "To be assigned";
  const handleDownloadPDF = () => {
    const win = window.open("", "_blank");

    if (!win) {
      toast.error("Popup blocked. Please allow popups.");
      return;
    }

    win.document.open();
    win.document.write(buildPrintHtml());
    win.document.close();

    setTimeout(
      () => {
        win.focus();
        win.print(); // user selects "Save as PDF"
      },
      hasAwb ? 800 : 200,
    );
  };

  /* ── Dimensions ── */
  const sizeConfig = {
    A5: {
      w: "148mm",
      h: "210mm",
      pad: "8mm",
      fontSize: "11.5pt",
      barcodeH: 68,
    },
    A6: { w: "105mm", h: "148mm", pad: "6mm", fontSize: "9.5pt", barcodeH: 50 },
  };
  const cfg = sizeConfig[paperSize];

  /* ─────────────────────────────────────────
     Build the full HTML for the print window.
     We inline everything so the popup is
     completely self-contained and only ever
     prints exactly ONE page.
  ───────────────────────────────────────── */
  const buildPrintHtml = () => {
    const itemRows = items
      .map(
        (it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.product_name || ""}</td>
        <td style="text-align:center">${it.quantity}</td>
        <td>${fmtCurrency(it.unit_price)}</td>
        <td>${fmtCurrency(it.total_price)}</td>
      </tr>
    `,
      )
      .join("");

    const totalRow = `
      <tr style="border-top:2px solid #000;font-weight:700">
        <td colspan="3"></td>
        <td><strong>Total</strong></td>
        <td><strong>${fmtCurrency(total)}</strong></td>
      </tr>
    `;

    const logoHtml = `<img src="${logoSrc}" alt="Logo" style="max-height:84px;max-width:170px;object-fit:contain;" />`;

    const barcodeScript = hasAwb
      ? `
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
      <script>
        window.onload = function() {
          try {
            JsBarcode("#awb-barcode", "${data.awb_number}", {
              format: "CODE128",
              width: 2.2,
              height: ${cfg.barcodeH},
              displayValue: false,
              margin: 4,
              background: "#fafafa",
              lineColor: "#000"
            });
          } catch(e) {}
        };
      <\/script>
    `
      : "";

    const barcodeArea = hasAwb
      ? `
      <div class="pod-barcode-area">
        <svg id="awb-barcode"></svg>
        <div class="pod-barcode-awb">${data.awb_number}</div>
      </div>
    `
      : `
      <div class="pod-barcode-area">
        <div class="pod-barcode-empty-label">Stick courier barcode / label here</div>
      </div>
    `;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>POD — ${data.order_id}</title>
  ${barcodeScript}
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');

    @page {
      size: ${cfg.w} ${cfg.h};
      margin: 0;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: ${cfg.w};
      height: ${cfg.h};
      overflow: hidden;
    }

    body {
      font-family: 'DM Sans', Arial, sans-serif;
      font-size: ${cfg.fontSize};
      color: #000;
      background: #fff;
      padding: ${cfg.pad};
      line-height: 1.45;
    }

    .pod-label {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .pod-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 2px solid #000; padding-bottom: 4mm; margin-bottom: 4mm;
      gap: 8px; flex-shrink: 0;
    }
    .pod-meta-right { text-align: right; }
    .pod-order-id { font-family: 'DM Mono', monospace; font-size: 1.3em; font-weight: 700; }
    .pod-date-line { font-size: 0.75em; color: #555; margin-top: 1px; font-family: 'DM Mono', monospace; }

    .pod-barcode-area {
      border: 1.5px dashed #999; border-radius: 4px;
      padding: 4px 6px; margin-bottom: 4mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 50px; background: #fafafa; flex-shrink: 0;
    }
    .pod-barcode-awb {
      font-family: 'DM Mono', monospace; font-size: 1.05em; font-weight: 700;
      letter-spacing: 2px; margin-top: 2px; text-align: center;
    }
    .pod-barcode-sub { font-size: 0.68em; color: #777; margin-top: 1px; }
    .pod-barcode-empty-label {
      font-size: 0.72em; color: #bbb; text-align: center;
      text-transform: uppercase; letter-spacing: .6px; padding: 6px 0;
    }

    svg#awb-barcode { max-width: 100%; height: auto; }

    .pod-section { margin-bottom: 3mm; flex-shrink: 0; }
    .pod-section-title {
      font-size: 0.7em; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; color: #555; margin-bottom: 2mm;
    }
    .pod-address-box {
      border: 1.5px solid #000; border-radius: 3px; padding: 3px 6px;
      background: #f9f9f9; line-height: 1.6;
    }
    .pod-address-name { font-size: 1.1em; font-weight: 700; }
    .pod-from-box {
      border: 1px solid #888; border-radius: 3px;
      padding: 3px 5px; font-size: 0.85em; line-height: 1.5; background: #f5f5f5;
    }

    .pod-items-section { flex: 1; min-height: 0; overflow: hidden; margin-bottom: 3mm; }
    .pod-items-table { width: 100%; border-collapse: collapse; font-size: 0.83em; }
    .pod-items-table th {
      background: #111; color: #fff; padding: 2px 4px;
      text-align: left; font-size: 0.78em;
    }
    .pod-items-table td { padding: 2px 4px; border-bottom: 1px solid #ddd; }
    .pod-total-row td { border-top: 1.5px solid #000; font-weight: 700; }

    .pod-footer {
      display: flex; justify-content: space-between; align-items: flex-end;
      border-top: 1.5px solid #000; padding-top: 3mm;
      flex-shrink: 0;
    }
    .pod-footer-left { font-size: 0.85em; line-height: 1.7; }
    .pod-sig-box {
      border: 1px solid #999; border-radius: 3px;
      padding: 12px 24px 4px; text-align: center; font-size: 0.72em; color: #666;
    }
    .pod-fine-print {
      margin-top: 2mm; text-align: center; font-size: 0.67em;
      color: #aaa; border-top: 1px dashed #ccc; padding-top: 2mm;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div class="pod-label">
    <div class="pod-header">
      ${logoHtml}
      <div class="pod-meta-right">
        <div class="pod-order-id">${data.order_id}</div>
        <div class="pod-date-line">${fmtDate(data.created_at)}
        Status: <strong>${(data.payment_status || "—").toUpperCase()}</strong>
        </div>
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
        <thead>
          <tr><th>#</th><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${itemRows}
          ${totalRow}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
  };

  const handlePrint = () => {
    // Close any previous print window
    if (printWindowRef.current && !printWindowRef.current.closed) {
      printWindowRef.current.close();
    }

    const win = window.open(
      "",
      "_blank",
      `width=700,height=600,scrollbars=no,toolbar=no,menubar=no`,
    );
    if (!win) {
      toast.error("Popup blocked. Please allow popups for this site.");
      return;
    }
    printWindowRef.current = win;

    win.document.open();
    win.document.write(buildPrintHtml());
    win.document.close();

    // Wait for JsBarcode to render (if AWB present), then print
    const doPrint = () => {
      win.focus();
      win.print();
      // Optionally close after print dialog
      win.onafterprint = () => win.close();
    };

    if (hasAwb) {
      // Give JsBarcode ~800ms to load & render
      setTimeout(doPrint, 800);
    } else {
      setTimeout(doPrint, 200);
    }
  };

  /* Screen preview label class */
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
            {/* Paper size selector */}
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
            {/* Header */}
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

            {/* Barcode */}
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

            {/* Deliver To */}
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

            {/* From */}
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

            {/* Items */}
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

            {/* Footer */}
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

/* ─────────────────────────────────────────────
   DELHIVERY PUSH MODAL
───────────────────────────────────────────── */
function DelhiveryPushModal({ order, onClose, onSuccess }) {
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

/* ─────────────────────────────────────────────
   TRACKING MODAL
───────────────────────────────────────────── */
function TrackingModal({ waybill, orderId, onClose, onPrintPOD }) {
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

/* ─────────────────────────────────────────────
   DELIVERY CELL — table row
───────────────────────────────────────────── */
function DeliveryCell({ order, onPushed }) {
  const [showPush, setShowPush] = useState(false);
  const [awb, setAwb] = useState(order.awb_number || "");
  const [showTrack, setShowTrack] = useState(false);
  const [showPOD, setShowPOD] = useState(false);
  const [podData, setPodData] = useState(null);

  const hasAwb = awb && awb !== "To be assigned";

  const handlePrintPOD = async () => {
    try {
      const res = await api.get(
        `/delhivery/pod-data/${encodeURIComponent(order.order_id)}`,
      );
      setPodData(res.data);
      setShowTrack(false);
      setShowPOD(true);
    } catch {
      toast.error("Failed to load POD data");
    }
  };

  return (
    <>
      <div className="delivery-cell" onClick={(e) => e.stopPropagation()}>
        <DeliveryBadge status={order.delivery_status} />
        {hasAwb ? (
          <button
            className="waybill-link"
            onClick={(e) => {
              e.stopPropagation();
              setShowTrack(true);
            }}
          >
            📡 {awb}
          </button>
        ) : (
          <button
            className="push-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowPush(true);
            }}
            disabled={order.order_status === "REJECTED"}
            title="Push to Delhivery"
          >
            🚚 Push
          </button>
        )}
      </div>

      {showPush && (
        <DelhiveryPushModal
          order={order}
          onClose={() => setShowPush(false)}
          onSuccess={(waybill) => {
            setAwb(waybill);
            onPushed && onPushed(order.order_id, waybill);
          }}
        />
      )}

      {showTrack && (
        <TrackingModal
          waybill={awb}
          orderId={order.order_id}
          onClose={() => setShowTrack(false)}
          onPrintPOD={handlePrintPOD}
        />
      )}

      {showPOD && podData && (
        <OfflinePOD data={podData} onClose={() => setShowPOD(false)} />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   ADD ADDRESS FORM
───────────────────────────────────────────── */
function AddAddressForm({ order, onSaved, onCancel }) {
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

/* ─────────────────────────────────────────────
   PRODUCT SEARCH DROPDOWN
───────────────────────────────────────────── */
function ProductSearchInput({
  products,
  value,
  onChange,
  placeholder = "Search product…",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return products.slice(0, 50);
    const q = query.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku_id && p.sku_id.toLowerCase().includes(q)),
      )
      .slice(0, 50);
  }, [products, query]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedProduct = products.find((p) => p.id === value);

  return (
    <div
      className="product-search-wrap"
      ref={wrapRef}
      style={{ position: "relative" }}
    >
      <input
        className="form-input"
        placeholder={placeholder}
        value={open ? query : selectedProduct ? selectedProduct.name : query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChange(null);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        style={{ fontSize: 12.5 }}
      />
      {open && (
        <div
          className="product-dropdown"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 9999,
          }}
        >
          {filtered.length > 0 ? (
            filtered.map((p) => (
              <div
                key={p.id}
                className="product-option"
                onMouseDown={() => {
                  onChange(p);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <div>{p.name}</div>
                {p.sku_id && (
                  <div className="product-option-sku">{p.sku_id}</div>
                )}
              </div>
            ))
          ) : query.length > 0 ? (
            <div
              className="product-option"
              style={{ color: "var(--text3)", cursor: "default" }}
            >
              No products found
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ADD PRODUCT PANEL
───────────────────────────────────────────── */
function AddProductPanel({ orderId, products, onAdded, onCancel }) {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!selectedProduct) {
      toast.warn("Please select a product");
      return;
    }
    const unitPrice = parseFloat(price);
    if (!unitPrice || unitPrice <= 0) {
      toast.warn("Please enter a valid price");
      return;
    }
    if (qty < 1) {
      toast.warn("Quantity must be at least 1");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(
        `/orders/${encodeURIComponent(orderId)}/add-item`,
        {
          product_id: selectedProduct.id,
          quantity: qty,
          unit_price: unitPrice,
        },
      );
      toast.success(`Added ${selectedProduct.name} to order`);
      onAdded(res.data);
    } catch {
      toast.error("Failed to add product. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-product-panel">
      <h4>➕ Add Product to Order</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="form-field">
          <label className="form-label">Product *</label>
          <ProductSearchInput
            products={products}
            value={selectedProduct?.id}
            onChange={(p) => setSelectedProduct(p)}
            placeholder="Search by name or SKU…"
          />
        </div>
        <div className="form-grid-2">
          <div className="form-field">
            <label className="form-label">Quantity *</label>
            <input
              className="form-input"
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value) || 1)}
              style={{ fontSize: 12.5 }}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Unit Price (₹) *</label>
            <input
              className="form-input"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              style={{ fontSize: 12.5 }}
            />
          </div>
        </div>
        {selectedProduct && price > 0 && (
          <div
            style={{ fontSize: 12, color: "var(--text2)", padding: "4px 0" }}
          >
            Line total: <strong>{fmtCurrency(parseFloat(price) * qty)}</strong>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            className="lb-btn lb-btn-secondary lb-btn-sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="lb-btn lb-btn-primary lb-btn-sm"
            onClick={handleAdd}
            disabled={saving || !selectedProduct}
          >
            {saving ? "Adding…" : "Add Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ORDER DETAIL LIGHTBOX
───────────────────────────────────────────── */
function OrderLightbox({
  order,
  details,
  loading,
  onClose,
  onAction,
  invoiceLoading,
}) {
  const [utrOpen, setUtrOpen] = useState(false);
  const [utrValue, setUtrValue] = useState("");
  const [serialOpen, setSerialOpen] = useState(false);
  const [serialItems, setSerialItems] = useState([]);
  const [serialLoading, setSerialLoading] = useState(false);
  const [remarksVal, setRemarksVal] = useState(details?.remarks || "");
  const [remarksEditing, setRemarksEditing] = useState(false);
  const [utrFieldVal, setUtrFieldVal] = useState(
    details?.utr_number || order.utr_number || "",
  );
  const [utrFieldEditing, setUtrFieldEditing] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState(
    order.delivery_status || "NOT_SHIPPED",
  );
  const [localPayStatus, setLocalPayStatus] = useState(order.payment_status);
  const [localOrderStatus, setLocalOrderStatus] = useState(
    order.order_status || "",
  );
  const [confirmReject, setConfirmReject] = useState(false);
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [mobileValue, setMobileValue] = useState("");
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingPrice, setEditingPrice] = useState("");
  const [addressMode, setAddressMode] = useState("view");
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [availableAddresses, setAvailableAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [editingProductItemId, setEditingProductItemId] = useState(null);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProductForEdit, setSelectedProductForEdit] = useState(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState(null);
  const [showPOD, setShowPOD] = useState(false);
  const [podData, setPodData] = useState(null);

  useEffect(() => {
    if (details?.remarks != null) setRemarksVal(details.remarks);
    if (details?.utr_number != null) setUtrFieldVal(details.utr_number || "");
  }, [details]);

  useEffect(() => {
    const cust = order.customer;
    if (cust) {
      setEmailValue(cust.email || "");
      setMobileValue(cust.mobile || "");
    }
  }, [order]);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await api.get("/orders/products/list");
      setAvailableProducts(res.data || []);
    } catch {
      setAvailableProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const loadAddresses = async () => {
    setLoadingAddresses(true);
    try {
      const custType = order.customer_id ? "online" : "offline";
      const custId = order.customer_id || order.offline_customer_id;
      const res = await api.get(
        `/dropdowns/customers/${custType}/${custId}/addresses`,
      );
      setAvailableAddresses(res.data || []);
      setSelectedAddressId(order.address_id);
      setAddressMode("select");
    } catch {
      toast.error("Failed to load addresses");
    } finally {
      setLoadingAddresses(false);
    }
  };

  const saveAddress = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-address`,
        { address_id: selectedAddressId },
      );
      setAddressMode("view");
      toast.success("Delivery address updated");
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update address");
    }
  };

  const handleAddressCreated = async (newAddress) => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-address`,
        { address_id: newAddress.address_id },
      );
      setAddressMode("view");
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.warn(
        "Address created but could not be applied. Please select it manually.",
      );
      setAddressMode("view");
      onAction && onAction(order.order_id, "refresh");
    }
  };

  const saveProduct = async (itemId) => {
    if (!selectedProductForEdit) return;
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-item-product`,
        {
          item_id: itemId,
          product_id: selectedProductForEdit.id,
        },
      );
      toast.success(`Product updated to ${selectedProductForEdit.name}`);
      setEditingProductItemId(null);
      setSelectedProductForEdit(null);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update product");
    }
  };

  const handleDeleteItem = async (itemId) => {
    try {
      await api.delete(
        `/orders/${encodeURIComponent(order.order_id)}/items/${itemId}`,
      );
      toast.success("Item removed from order");
      setConfirmDeleteItemId(null);
      onAction && onAction(order.order_id, "refresh");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to remove item");
      setConfirmDeleteItemId(null);
    }
  };

  const handleItemAdded = () => {
    setShowAddProduct(false);
    onAction && onAction(order.order_id, "refresh");
  };

  const openSerials = async () => {
    setSerialLoading(true);
    try {
      const res = await api.get(
        `/orders/${encodeURIComponent(order.order_id)}/serial_numbers`,
      );
      const normalized = (res.data || []).map((it) => ({
        ...it,
        serials: it.serials?.length ? it.serials : Array(it.quantity).fill(""),
      }));
      setSerialItems(normalized);
      setSerialOpen(true);
    } catch {
      toast.error("Failed to load serial numbers");
    } finally {
      setSerialLoading(false);
    }
  };

  const saveSerials = async () => {
    try {
      await api.post(
        `/orders/${encodeURIComponent(order.order_id)}/serial_numbers/save`,
        { entries: serialItems },
      );
      toast.success("Serial numbers saved");
      setSerialOpen(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to save serial numbers");
    }
  };

  const submitUTR = async () => {
    if (!utrValue.trim()) {
      toast.warn("Enter UTR number");
      return;
    }
    await onAction(order.order_id, "mark-paid-utr", utrValue.trim());
    setLocalPayStatus("paid");
    setUtrOpen(false);
    setUtrValue("");
    onAction && onAction(order.order_id, "refresh");
  };

  const saveUtrField = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-utr`,
        { utr_number: utrFieldVal },
      );
      toast.success("UTR number updated");
      setUtrFieldEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update UTR number");
    }
  };

  const cycleDelivery = async (status) => {
    await onAction(order.order_id, "update-delivery", status);
    setDeliveryStatus(status);
  };

  const handleInvoice = () =>
    onAction && onAction(order.order_id, "create-invoice");

  const saveRemarks = async () => {
    try {
      await onAction(order.order_id, "update-remarks", remarksVal);
      toast.success("Remarks saved");
      setRemarksEditing(false);
    } catch {
      toast.error("Failed to save remarks");
    }
  };

  const saveEmail = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-email`,
        { email: emailValue.trim() },
      );
      toast.success("Email updated");
      setEmailEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update email");
    }
  };

  const saveMobile = async () => {
    try {
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-mobile`,
        { mobile: mobileValue.trim() },
      );
      toast.success("Mobile updated");
      setMobileEditing(false);
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update mobile");
    }
  };

  const saveItemPrice = async (itemId) => {
    try {
      const newPrice = parseFloat(editingPrice);
      if (isNaN(newPrice) || newPrice < 0) {
        toast.warn("Invalid price");
        return;
      }
      await api.put(
        `/orders/${encodeURIComponent(order.order_id)}/update-item-price`,
        { item_id: itemId, unit_price: newPrice },
      );
      toast.success("Price updated");
      setEditingItemId(null);
      setEditingPrice("");
      onAction && onAction(order.order_id, "refresh");
    } catch {
      toast.error("Failed to update item price");
    }
  };

  const handleReject = async () => {
    try {
      await api.put(`/orders/${encodeURIComponent(order.order_id)}/reject`);
      toast.success("Order rejected");
      setLocalOrderStatus("REJECTED");
      setConfirmReject(false);
      onAction && onAction(order.order_id, "refresh");
      onClose();
    } catch {
      toast.error("Failed to reject order");
    }
  };

  const handlePrintOfflinePOD = async () => {
    try {
      const res = await api.get(
        `/delhivery/pod-data/${encodeURIComponent(order.order_id)}`,
      );
      setPodData(res.data);
      setShowPOD(true);
    } catch {
      setPodData({
        order_id: order.order_id,
        created_at: order.created_at,
        items: [],
        address: {},
        seller: {},
      });
      setShowPOD(true);
    }
  };

  const cust = details?.customer || order.customer;
  const currentInvoice = details?.invoice_number ?? order.invoice_number;
  const currentOrderStatus = details?.order_status ?? localOrderStatus;

  return (
    <>
      <div
        className="lb-overlay"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="lb-panel">
          {/* HEADER */}
          <div className="lb-header">
            <div>
              <div className="lb-title">Order Details</div>
              <div className="lb-subtitle">{order.order_id}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <PaymentBadge status={localPayStatus} />
              <DeliveryBadge status={deliveryStatus} />
              {currentOrderStatus === "REJECTED" && (
                <span className="badge badge-red">Rejected</span>
              )}
              {order.awb_number && order.awb_number !== "To be assigned" && (
                <span
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 11,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  AWB: {order.awb_number}
                </span>
              )}
              <button className="lb-close" onClick={onClose}>
                ✕
              </button>
            </div>
          </div>

          <div className="lb-body">
            {/* ── LEFT COLUMN ── */}
            <div className="lb-section">
              <div>
                <div className="lb-section-title">Customer & Order</div>
                <div className="lb-info-grid">
                  <div className="lb-info-card">
                    <div className="lb-info-label">Customer</div>
                    <div className="lb-info-value">{cust?.name || "—"}</div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Mobile</div>
                    <div className="lb-info-value">
                      {mobileEditing ? (
                        <input
                          className="inline-edit-input"
                          value={mobileValue}
                          onChange={(e) => setMobileValue(e.target.value)}
                          onBlur={saveMobile}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveMobile();
                            if (e.key === "Escape") {
                              setMobileEditing(false);
                              setMobileValue(cust?.mobile || "");
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <>
                          <span style={{ fontFamily: "'DM Mono',monospace" }}>
                            {cust?.mobile || "—"}
                          </span>
                          <span
                            className="edit-icon"
                            onClick={() => setMobileEditing(true)}
                            title="Edit mobile"
                          >
                            ✏️
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Email</div>
                    <div className="lb-info-value">
                      {emailEditing ? (
                        <input
                          className="inline-edit-input"
                          type="email"
                          value={emailValue}
                          onChange={(e) => setEmailValue(e.target.value)}
                          onBlur={saveEmail}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEmail();
                            if (e.key === "Escape") {
                              setEmailEditing(false);
                              setEmailValue(cust?.email || "");
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <>
                          <span>{cust?.email || "—"}</span>
                          <span
                            className="edit-icon"
                            onClick={() => setEmailEditing(true)}
                            title="Edit email"
                          >
                            ✏️
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Channel</div>
                    <div className="lb-info-value">{order.channel || "—"}</div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Created</div>
                    <div className="lb-info-value">
                      {fmtDate(order.created_at)}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Amount</div>
                    <div className="lb-info-value">
                      {fmtCurrency(order.total_amount)}
                    </div>
                  </div>
                  <div className="lb-info-card">
                    <div className="lb-info-label">Payment Type</div>
                    <div className="lb-info-value">
                      {order.payment_type || "—"}
                    </div>
                  </div>
                  {details?.fulfillment_status != null && (
                    <div className="lb-info-card">
                      <div className="lb-info-label">Fulfillment</div>
                      <div className="lb-info-value">
                        <FulfillmentBadge status={details.fulfillment_status} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {loading && (
                <div style={{ color: "var(--text3)", fontSize: 12.5 }}>
                  Loading details…
                </div>
              )}

              {/* DELIVERY ADDRESS */}
              {(details?.address || !loading) && (
                <div>
                  <div
                    className="lb-section-title"
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    Delivery Address
                    {addressMode === "view" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <span
                          className="edit-icon"
                          onClick={loadAddresses}
                          title="Change address"
                          style={{ cursor: "pointer" }}
                        >
                          ✏️
                        </span>
                        <button
                          className="lb-btn lb-btn-secondary lb-btn-sm"
                          onClick={() => setAddressMode("add")}
                          style={{ fontSize: 11, padding: "2px 8px" }}
                        >
                          ➕ New
                        </button>
                      </div>
                    )}
                  </div>
                  {addressMode === "view" && details?.address && (
                    <div
                      className="lb-info-card"
                      style={{ lineHeight: 1.6, fontSize: 13 }}
                    >
                      <strong>{details.address.name}</strong> ·{" "}
                      {details.address.mobile}
                      <br />
                      {details.address.address_line}, {details.address.city},{" "}
                      {details.address.state_name} — {details.address.pincode}
                      {details.address.landmark && (
                        <span> ({details.address.landmark})</span>
                      )}
                    </div>
                  )}
                  {addressMode === "select" && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {loadingAddresses ? (
                        <div style={{ color: "var(--text3)", fontSize: 12.5 }}>
                          Loading addresses…
                        </div>
                      ) : (
                        <>
                          <select
                            value={selectedAddressId || ""}
                            onChange={(e) =>
                              setSelectedAddressId(parseInt(e.target.value))
                            }
                            className="form-select"
                          >
                            <option value="">Select Address</option>
                            {availableAddresses.map((addr) => (
                              <option
                                key={addr.address_id}
                                value={addr.address_id}
                              >
                                {addr.label ||
                                  `${addr.address_line}, ${addr.city}`}
                              </option>
                            ))}
                          </select>
                          <div style={{ display: "flex", gap: 7 }}>
                            <button
                              className="lb-btn lb-btn-primary lb-btn-sm"
                              onClick={saveAddress}
                            >
                              Save
                            </button>
                            <button
                              className="lb-btn lb-btn-secondary lb-btn-sm"
                              onClick={() => setAddressMode("add")}
                            >
                              ➕ Add New Instead
                            </button>
                            <button
                              className="lb-btn lb-btn-secondary lb-btn-sm"
                              onClick={() => setAddressMode("view")}
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {addressMode === "add" && (
                    <AddAddressForm
                      order={order}
                      onSaved={handleAddressCreated}
                      onCancel={() => setAddressMode("view")}
                    />
                  )}
                </div>
              )}

              {/* REMARKS + UTR */}
              <div>
                <div className="lb-section-title">Notes</div>
                <div className="remarks-utr-row">
                  <div className="form-field">
                    <label className="form-label">Remarks</label>
                    {remarksEditing ? (
                      <>
                        <textarea
                          className="remarks-input"
                          value={remarksVal}
                          onChange={(e) => setRemarksVal(e.target.value)}
                          placeholder="Add a remark…"
                        />
                        <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
                          <button
                            className="lb-btn lb-btn-primary lb-btn-sm"
                            onClick={saveRemarks}
                          >
                            Save
                          </button>
                          <button
                            className="lb-btn lb-btn-secondary lb-btn-sm"
                            onClick={() => setRemarksEditing(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div
                        onClick={() => setRemarksEditing(true)}
                        style={{
                          padding: "9px 11px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          fontSize: 13,
                          cursor: "pointer",
                          color: remarksVal ? "var(--text)" : "var(--text3)",
                          minHeight: 54,
                        }}
                      >
                        {remarksVal || "Click to add a remark…"}
                      </div>
                    )}
                  </div>
                  <div className="form-field">
                    <label className="form-label">UTR / Ref No.</label>
                    {utrFieldEditing ? (
                      <>
                        <input
                          className="form-input"
                          style={{
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 12.5,
                          }}
                          value={utrFieldVal}
                          onChange={(e) => setUtrFieldVal(e.target.value)}
                          placeholder="Transaction reference…"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveUtrField();
                            if (e.key === "Escape") setUtrFieldEditing(false);
                          }}
                          autoFocus
                        />
                        <div style={{ display: "flex", gap: 7, marginTop: 5 }}>
                          <button
                            className="lb-btn lb-btn-primary lb-btn-sm"
                            onClick={saveUtrField}
                          >
                            Save
                          </button>
                          <button
                            className="lb-btn lb-btn-secondary lb-btn-sm"
                            onClick={() => setUtrFieldEditing(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div
                        onClick={() => setUtrFieldEditing(true)}
                        style={{
                          padding: "9px 11px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                          fontSize: 12.5,
                          cursor: "pointer",
                          fontFamily: "'DM Mono',monospace",
                          color: utrFieldVal ? "var(--green)" : "var(--text3)",
                          minHeight: 54,
                        }}
                      >
                        {utrFieldVal || "Click to add UTR…"}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {localPayStatus !== "paid" && utrOpen && (
                <div className="utr-box">
                  <label>Enter UTR / Transaction Reference Number</label>
                  <div className="utr-input-row">
                    <input
                      className="utr-input"
                      placeholder="e.g. UTR123456789012"
                      value={utrValue}
                      onChange={(e) => setUtrValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitUTR()}
                    />
                    <button
                      className="lb-btn lb-btn-success"
                      onClick={submitUTR}
                    >
                      Mark Paid
                    </button>
                    <button
                      className="lb-btn lb-btn-secondary"
                      onClick={() => setUtrOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── RIGHT COLUMN ── */}
            <div className="lb-section">
              {details?.items?.length > 0 && (
                <div>
                  <div
                    className="lb-section-title"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>Items ({details.items.length})</span>
                    <button
                      className="lb-btn lb-btn-secondary lb-btn-sm"
                      onClick={() => setShowAddProduct((v) => !v)}
                      style={{ fontSize: 11 }}
                    >
                      {showAddProduct ? "✕ Cancel" : "➕ Add Product"}
                    </button>
                  </div>
                  <div className="lb-items-table-wrap">
                    <table className="lb-items-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Qty</th>
                          <th>Unit Price</th>
                          <th>Total</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.items.map((it) => (
                          <tr key={it.item_id} style={{ overflow: "visible" }}>
                            <td
                              style={{
                                overflow: "visible",
                                position: "relative",
                              }}
                            >
                              {editingProductItemId === it.item_id ? (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    alignItems: "center",
                                    overflow: "visible",
                                  }}
                                >
                                  <div
                                    style={{
                                      flex: 1,
                                      position: "relative",
                                      overflow: "visible",
                                    }}
                                  >
                                    <ProductSearchInput
                                      products={availableProducts}
                                      value={selectedProductForEdit?.id}
                                      onChange={(p) =>
                                        setSelectedProductForEdit(p)
                                      }
                                      placeholder="Search product…"
                                    />
                                  </div>
                                  <button
                                    className="lb-btn lb-btn-primary lb-btn-sm"
                                    onClick={() => saveProduct(it.item_id)}
                                    disabled={!selectedProductForEdit}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    className="lb-btn lb-btn-secondary lb-btn-sm"
                                    onClick={() => {
                                      setEditingProductItemId(null);
                                      setSelectedProductForEdit(null);
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <span>{it.product_name}</span>
                                  <span
                                    className="edit-icon"
                                    onClick={() => {
                                      setEditingProductItemId(it.item_id);
                                      setSelectedProductForEdit(null);
                                    }}
                                    title="Edit product"
                                  >
                                    ✏️
                                  </span>
                                </div>
                              )}
                            </td>
                            <td>{it.quantity}</td>
                            <td>
                              {editingItemId === it.item_id ? (
                                <input
                                  className="inline-edit-input"
                                  type="number"
                                  step="0.01"
                                  value={editingPrice}
                                  onChange={(e) =>
                                    setEditingPrice(e.target.value)
                                  }
                                  onBlur={() => saveItemPrice(it.item_id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      saveItemPrice(it.item_id);
                                    if (e.key === "Escape") {
                                      setEditingItemId(null);
                                      setEditingPrice("");
                                    }
                                  }}
                                  autoFocus
                                  style={{ width: "110px" }}
                                />
                              ) : (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <span>{fmtCurrency(it.unit_price)}</span>
                                  <span
                                    className="edit-icon"
                                    onClick={() => {
                                      setEditingItemId(it.item_id);
                                      setEditingPrice(it.unit_price);
                                    }}
                                    title="Edit price"
                                  >
                                    ✏️
                                  </span>
                                </div>
                              )}
                            </td>
                            <td>{fmtCurrency(it.total_price)}</td>
                            <td style={{ width: 32, textAlign: "center" }}>
                              {confirmDeleteItemId === it.item_id ? (
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    className="lb-btn lb-btn-danger lb-btn-sm"
                                    onClick={() => handleDeleteItem(it.item_id)}
                                    style={{ padding: "2px 7px", fontSize: 11 }}
                                  >
                                    Yes
                                  </button>
                                  <button
                                    className="lb-btn lb-btn-secondary lb-btn-sm"
                                    onClick={() => setConfirmDeleteItemId(null)}
                                    style={{ padding: "2px 7px", fontSize: 11 }}
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <span
                                  className="del-icon"
                                  title="Remove item"
                                  onClick={() =>
                                    setConfirmDeleteItemId(it.item_id)
                                  }
                                >
                                  🗑
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {showAddProduct && (
                    <AddProductPanel
                      orderId={order.order_id}
                      products={availableProducts}
                      onAdded={handleItemAdded}
                      onCancel={() => setShowAddProduct(false)}
                    />
                  )}
                </div>
              )}

              {!loading &&
                details &&
                (!details.items || details.items.length === 0) && (
                  <div>
                    <div
                      className="lb-section-title"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>Items</span>
                      <button
                        className="lb-btn lb-btn-secondary lb-btn-sm"
                        onClick={() => setShowAddProduct((v) => !v)}
                        style={{ fontSize: 11 }}
                      >
                        {showAddProduct ? "✕ Cancel" : "➕ Add Product"}
                      </button>
                    </div>
                    {showAddProduct && (
                      <AddProductPanel
                        orderId={order.order_id}
                        products={availableProducts}
                        onAdded={handleItemAdded}
                        onCancel={() => setShowAddProduct(false)}
                      />
                    )}
                  </div>
                )}

              {details?.serial_status && (
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div className="lb-section-title" style={{ marginBottom: 0 }}>
                    Serial Status:
                  </div>
                  <SerialBadge status={details.serial_status} />
                </div>
              )}

              {serialOpen && (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "11px 14px",
                      background: "var(--surface2)",
                      borderBottom: "1px solid var(--border)",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    Assign Serial Numbers
                  </div>
                  <div style={{ padding: 14 }}>
                    {serialItems.map((item) => (
                      <div className="serial-item" key={item.item_id}>
                        <h4>
                          {item.product_name} — Qty {item.quantity}
                        </h4>
                        {item.serials.map((sn, i) => (
                          <input
                            key={`${item.item_id}-${i}`}
                            className="serial-input"
                            type="text"
                            value={sn}
                            placeholder={`Serial ${i + 1}`}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSerialItems((prev) =>
                                prev.map((it) =>
                                  it.item_id === item.item_id
                                    ? {
                                        ...it,
                                        serials: it.serials.map((s, idx) =>
                                          idx === i ? val : s,
                                        ),
                                      }
                                    : it,
                                ),
                              );
                            }}
                          />
                        ))}
                      </div>
                    ))}
                    <div
                      style={{
                        display: "flex",
                        gap: 7,
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        className="lb-btn lb-btn-secondary"
                        onClick={() => setSerialOpen(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="lb-btn lb-btn-primary"
                        onClick={saveSerials}
                      >
                        Save Serials
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── ACTION BAR ── */}
          <div className="lb-actions">
            {localPayStatus !== "paid" ? (
              <button
                className="lb-btn lb-btn-success"
                onClick={() => setUtrOpen((v) => !v)}
              >
                💳 Mark as Paid
              </button>
            ) : (
              <span className="badge badge-green" style={{ fontSize: 11.5 }}>
                ✓ Payment Received
              </span>
            )}
            <select
              value={deliveryStatus}
              onChange={(e) => cycleDelivery(e.target.value)}
              style={{
                padding: "7px 11px",
                border: "1px solid var(--border2)",
                borderRadius: "var(--radius)",
                fontFamily: "inherit",
                fontSize: 12.5,
                background: "var(--surface)",
                cursor: "pointer",
              }}
            >
              <option value="NOT_SHIPPED">Not Shipped</option>
              <option value="SHIPPED">Shipped</option>
              <option value="READY">Ready</option>
              <option value="COMPLETED">Completed</option>
            </select>
            <button
              className="lb-btn lb-btn-secondary"
              onClick={serialOpen ? () => setSerialOpen(false) : openSerials}
              disabled={serialLoading}
            >
              {serialLoading ? "…" : "🔢 Serials"}
            </button>
            <InvoiceButton
              orderId={order.order_id}
              invoiceNumber={order.invoice_number}
              detailsInvoice={currentInvoice}
              onGenerate={handleInvoice}
              loading={invoiceLoading}
              orderStatus={currentOrderStatus}
            />
            <button
              className="lb-btn lb-btn-orange"
              onClick={handlePrintOfflinePOD}
            >
              🖨️ Print POD
            </button>
            <button
              className="lb-btn lb-btn-secondary"
              onClick={handlePrintOfflinePOD} // opens same modal
            >
              ⬇️ Download POD
            </button>
            <div style={{ flex: 1 }} />
            {confirmReject ? (
              <>
                <span style={{ fontSize: 12, color: "var(--red)" }}>
                  Reject this order?
                </span>
                <button className="lb-btn lb-btn-danger" onClick={handleReject}>
                  Yes, Reject
                </button>
                <button
                  className="lb-btn lb-btn-secondary"
                  onClick={() => setConfirmReject(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              currentOrderStatus !== "REJECTED" && (
                <button
                  className="lb-btn lb-btn-danger"
                  onClick={() => setConfirmReject(true)}
                >
                  ⛔ Reject
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {showPOD && podData && (
        <OfflinePOD data={podData} onClose={() => setShowPOD(false)} />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   VIRTUALISED ROW WINDOW
───────────────────────────────────────────── */
const PAGE_SIZE = 200;

function useVirtualRows(rows) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [rows]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting)
          setLimit((l) => Math.min(l + PAGE_SIZE, rows.length));
      },
      { rootMargin: "400px" },
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [rows.length]);

  return {
    visibleRows: rows.slice(0, limit),
    sentinelRef,
    hasMore: limit < rows.length,
  };
}

/* ─────────────────────────────────────────────
   MAIN EXPORT
───────────────────────────────────────────── */
export default function OrdersTable({
  orders = [],
  filters = {},
  onAction,
  onLoadMore,
  hasMore = true,
  isLoadingMore = false,
  invoiceLoading = {},
}) {
  injectStyles();

  const [activeOrder, setActiveOrder] = useState(null);
  const [detailsCache, setDetailsCache] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});
  const [pushedAwbs, setPushedAwbs] = useState({});

  const filtered = useMemo(() => {
    const {
      search = "",
      payment_status = "",
      delivery_status = "",
      channel = "",
      date_from = "",
      date_to = "",
      pending_invoice = false,
    } = filters;
    return orders.filter((o) => {
      const cust = o.customer || {};
      const q = search.toLowerCase().trim();
      if (q) {
        const hay = [
          o.order_id,
          cust.name,
          cust.mobile,
          o.awb_number,
          o.channel,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (
        payment_status &&
        o.payment_status?.toLowerCase() !== payment_status.toLowerCase()
      )
        return false;
      if (
        delivery_status &&
        o.delivery_status?.toUpperCase() !== delivery_status.toUpperCase()
      )
        return false;
      if (channel) {
        const ch = (o.channel || "").trim().toLowerCase();
        const target = channel.toLowerCase();
        if (target === "online") {
          if (!["online", "wix", "website"].includes(ch)) return false;
        } else {
          if (ch !== target) return false;
        }
      }
      if (date_from || date_to) {
        const d = new Date(o.created_at);
        if (date_from && d < new Date(date_from)) return false;
        if (date_to) {
          const end = new Date(date_to);
          end.setHours(23, 59, 59, 999);
          if (d > end) return false;
        }
      }
      if (pending_invoice) {
        const inv = (o.invoice_number || "").trim();
        if (inv && inv !== "") return false;
      }
      return true;
    });
  }, [orders, filters]);

  const enrichedOrders = useMemo(() => {
    if (Object.keys(pushedAwbs).length === 0) return filtered;
    return filtered.map((o) =>
      pushedAwbs[o.order_id]
        ? {
            ...o,
            awb_number: pushedAwbs[o.order_id],
            delivery_status: "SHIPPED",
          }
        : o,
    );
  }, [filtered, pushedAwbs]);

  const deduped = useMemo(() => {
    const seen = new Set();
    return enrichedOrders.filter((o) => {
      if (seen.has(o.order_id)) return false;
      seen.add(o.order_id);
      return true;
    });
  }, [enrichedOrders]);

  const {
    visibleRows,
    sentinelRef,
    hasMore: hasMoreVirtual,
  } = useVirtualRows(deduped);

  const openOrder = useCallback(
    async (order) => {
      setActiveOrder(order);
      const id = order.order_id;
      if (detailsCache[id]) return;
      setLoadingDetails((p) => ({ ...p, [id]: true }));
      try {
        const res = await api.get(`/orders/${encodeURIComponent(id)}/details`);
        setDetailsCache((p) => ({ ...p, [id]: res.data }));
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingDetails((p) => ({ ...p, [id]: false }));
      }
    },
    [detailsCache],
  );

  return (
    <div className="ot-wrap">
      <ToastContainer />

      <div className="ot-table-wrap">
        {deduped.length === 0 ? (
          <div className="ot-empty">
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            No orders match your filters.
          </div>
        ) : (
          <>
            <div className="ot-table-scroll">
              <table className="ot-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Mobile</th>
                    <th className="ot-col-hide-sm">Date</th>
                    <th className="ot-col-hide-sm">Items</th>
                    <th>Amount</th>
                    <th className="ot-col-hide-sm">Channel</th>
                    <th>Payment</th>
                    <th>Delivery</th>
                    <th className="ot-col-hide-sm">Fulfillment</th>
                    <th>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((order) => {
                    const cust = order.customer || {};
                    return (
                      <tr key={order.order_id} onClick={() => openOrder(order)}>
                        <td>
                          <span className="order-id">{order.order_id}</span>
                        </td>
                        <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
                          {cust.name || "—"}
                        </td>
                        <td
                          style={{
                            fontFamily: "'DM Mono',monospace",
                            fontSize: "clamp(10px,0.9vw,12.5px)",
                            color: "var(--text2)",
                          }}
                        >
                          {cust.mobile || "—"}
                        </td>
                        <td
                          className="ot-col-hide-sm"
                          style={{
                            color: "var(--text2)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtDate(order.created_at)}
                        </td>
                        <td
                          className="ot-col-hide-sm"
                          style={{ color: "var(--text2)" }}
                        >
                          {order.total_items ?? "—"}
                        </td>
                        <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                          {fmtCurrency(order.total_amount)}
                        </td>
                        <td className="ot-col-hide-sm">
                          <span
                            className={`badge ${order.channel?.toLowerCase() === "offline" ? "badge-purple" : "badge-blue"}`}
                          >
                            {order.channel || "—"}
                          </span>
                        </td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                            }}
                          >
                            <PaymentBadge status={order.payment_status} />
                            {order.payment_status?.toLowerCase() === "paid" &&
                              order.utr_number && (
                                <span
                                  style={{
                                    fontFamily: "'DM Mono', monospace",
                                    fontSize: 10,
                                    color: "var(--green)",
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {order.utr_number}
                                </span>
                              )}
                          </div>
                        </td>
                        <td>
                          <DeliveryCell
                            order={order}
                            onPushed={(orderId, waybill) => {
                              setPushedAwbs((p) => ({
                                ...p,
                                [orderId]: waybill,
                              }));
                              onAction && onAction(orderId, "refresh");
                            }}
                          />
                        </td>
                        <td className="ot-col-hide-sm">
                          <FulfillmentBadge status={order.fulfillment_status} />
                        </td>
                        <td>
                          <InvoiceCell
                            invoiceNumber={order.invoice_number}
                            orderStatus={order.order_status}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {hasMoreVirtual && (
              <div ref={sentinelRef} className="ot-load-more">
                Loading more rows…
              </div>
            )}
            {!hasMoreVirtual && hasMore && (
              <div className="ot-load-more">
                {isLoadingMore ? "Loading more orders…" : " "}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)" }}>
        Showing {Math.min(visibleRows.length, deduped.length)} of{" "}
        {deduped.length} filtered
        {orders.length !== deduped.length ? ` (${orders.length} total)` : ""}
      </div>

      {activeOrder && (
        <OrderLightbox
          order={activeOrder}
          details={detailsCache[activeOrder.order_id]}
          loading={loadingDetails[activeOrder.order_id]}
          invoiceLoading={invoiceLoading[activeOrder.order_id]}
          onClose={() => setActiveOrder(null)}
          onAction={async (id, action, payload) => {
            if (onAction) await onAction(id, action, payload);
            if (action === "update-remarks") {
              setDetailsCache((p) => ({
                ...p,
                [id]: { ...p[id], remarks: payload },
              }));
            }
            if (action === "refresh") {
              setDetailsCache((p) => {
                const c = { ...p };
                delete c[id];
                return c;
              });
              try {
                const res = await api.get(
                  `/orders/${encodeURIComponent(id)}/details`,
                );
                setDetailsCache((p) => ({ ...p, [id]: res.data }));
              } catch (e) {
                console.error(e);
              }
            }
          }}
        />
      )}
    </div>
  );
}
