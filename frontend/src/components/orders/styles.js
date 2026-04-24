export const STYLES = `
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

  /* ── Table wrapper: no horizontal scroll on 13"+ ── */
  .ot-table-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm);
    width: 100%;
  }
  .ot-table-scroll { width: 100%; }

  /* ── Table: fluid, no min-width ── */
  .ot-table {
    width: 100%; border-collapse: collapse;
    font-size: 12.5px;
    table-layout: fixed;
  }
  .ot-table thead tr { background: var(--surface2); border-bottom: 1px solid var(--border); }
  .ot-table th {
    padding: 9px 10px;
    text-align: left; font-weight: 600;
    font-size: 11px; color: var(--text2);
    letter-spacing: .3px; white-space: nowrap; user-select: none;
    overflow: hidden; text-overflow: ellipsis;
  }
  .ot-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border); vertical-align: middle;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ot-table tbody tr:last-child td { border-bottom: none; }
  .ot-table tbody tr { transition: background .1s; cursor: pointer; }
  .ot-table tbody tr:hover td { background: #fafbff; }

  /* ── Column widths (fixed layout, fluid total) ── */
  .col-orderid   { width: 110px; }
  .col-customer  { width: 13%; }
  .col-mobile    { width: 108px; }
  .col-date      { width: 90px; }
  .col-items     { width: 52px; text-align: center; }
  .col-amount    { width: 88px; }
  .col-channel   { width: 78px; }
  .col-payment   { width: 10%; min-width: 90px; }
  .col-delivery  { width: 17%; min-width: 130px; }
  .col-fulfill   { width: 90px; }
  .col-invoice   { width: 88px; }

  /* Only add horizontal scroll on very small screens */
  @media (max-width: 900px) {
    .ot-table-scroll { overflow-x: auto; }
    .ot-table { table-layout: auto; min-width: 780px; font-size: 11.5px; }
  }

  /* Hide less critical columns at tighter viewports */
  @media (max-width: 1280px) {
    .ot-col-hide-md { display: none !important; }
  }
  @media (max-width: 1100px) {
    .ot-col-hide-sm { display: none !important; }
  }

  .badge {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 8px;
    border-radius: 20px; font-size: 11px;
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
    flex-shrink: 0;
  }

  .order-id { font-family: 'DM Mono', monospace; font-size: 11.5px; color: var(--accent); font-weight: 500; }
  .invoice-num { font-family: 'DM Mono', monospace; font-size: 11px; color: #027a48; font-weight: 500; }
  .ot-load-more { padding: 14px; text-align: center; color: var(--text3); font-size: 13px; }

  .delivery-cell { display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
  .waybill-link {
    font-family: 'DM Mono', monospace;
    font-size: 10.5px;
    color: var(--accent);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    max-width: 100%;
  }
  .waybill-link:hover { color: var(--accent-dark); }
  .push-btn {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 7px;
    border-radius: 20px; font-size: 10.5px; font-weight: 600; cursor: pointer;
    background: var(--accent-light); color: var(--accent-dark);
    border: 1px solid #b2ccff; transition: all .15s; white-space: nowrap;
  }
  .push-btn:hover { background: #dbeafe; }
  .push-btn:disabled { opacity: .5; pointer-events: none; }

  /* ─── Loading skeleton ───────────────────────── */
  .ot-skeleton-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm);
    width: 100%;
  }
  .ot-skeleton-header {
    display: flex; align-items: center; gap: 16px;
    padding: 13px 14px; background: var(--surface2);
    border-bottom: 1px solid var(--border);
  }
  .ot-skeleton-header-cell {
    height: 10px; border-radius: 6px; background: var(--border);
    animation: skshimmer 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .ot-skeleton-row {
    display: flex; align-items: center; gap: 16px;
    padding: 11px 14px; border-bottom: 1px solid var(--border);
  }
  .ot-skeleton-row:last-child { border-bottom: none; }
  .ot-skeleton-cell {
    height: 12px; border-radius: 6px; background: var(--bg);
    animation: skshimmer 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes skshimmer {
    0%   { opacity: 1; }
    50%  { opacity: 0.45; }
    100% { opacity: 1; }
  }
  .ot-skeleton-badge {
    height: 20px; border-radius: 20px; background: var(--bg);
    animation: skshimmer 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .ot-skeleton-loading-bar {
    height: 3px;
    background: #dbeafe;
    position: relative;
    overflow: hidden;
  }
  .ot-skeleton-loading-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    width: 40%;
    background: linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%);
    animation: loadbar 1.6s linear infinite;
    will-change: transform;
  }
  @keyframes loadbar {
    0%   { transform: translateX(-250%); }
    100% { transform: translateX(650%); }
  }
  .ot-skeleton-status {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; font-size: 12.5px; color: var(--text3);
  }
  .ot-skeleton-spinner {
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    animation: spin .7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ─── Lightbox ───────────────────────────────── */
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

  .serial-item { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin-bottom: 10px; background: var(--surface2); }
  .serial-item h4 { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--text); }
  .serial-input {
    width: 100%; padding: 7px 10px; margin: 3px 0; border: 1px solid var(--border2);
    border-radius: 5px; font-family: 'DM Mono', monospace; font-size: 12.5px; outline: none;
    transition: border .15s; box-sizing: border-box;
  }
  .serial-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

  .remarks-utr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .remarks-input {
    width: 100%; padding: 8px 11px; border: 1px solid var(--border2);
    border-radius: var(--radius); font-family: inherit; font-size: 12.5px;
    resize: vertical; min-height: 54px; outline: none; transition: border .15s; box-sizing: border-box;
  }
  .remarks-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(21,112,239,.12); }

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

  .add-product-panel {
    border: 1px solid var(--accent-light); border-radius: var(--radius);
    background: var(--accent-light); padding: 14px; margin-top: 8px;
  }
  .add-product-panel h4 { font-size: 12px; font-weight: 600; color: var(--accent-dark); margin: 0 0 10px; text-transform: uppercase; letter-spacing: .4px; }

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

  .del-icon { cursor: pointer; color: var(--text3); font-size: 13px; transition: color .15s; padding: 2px; }
  .del-icon:hover { color: var(--red); }

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

  .ot-empty { text-align: center; padding: 60px 20px; color: var(--text3); font-size: 14px; }

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

  .pod-preview-wrap {
    padding: 20px;
    background: #e5e7eb;
    border-radius: 0 0 var(--radius-xl) var(--radius-xl);
    display: flex;
    justify-content: center;
  }

  .pod-label {
    font-family: 'DM Sans', Arial, sans-serif;
    background: #fff;
    color: #000;
    border: 2px solid #000;
    border-radius: 4px;
    box-sizing: border-box;
    line-height: 1.45;
  }

  .pod-label-a5 { width: 148mm; padding: 8mm; font-size: 11.5pt; }
  .pod-label-a6 { width: 105mm; padding: 6mm; font-size: 9.5pt; }

  .pod-size-selector { display: flex; gap: 8px; align-items: center; }
  .pod-size-btn {
    padding: 5px 14px; border-radius: 20px; font-size: 12.5px; font-weight: 600;
    cursor: pointer; border: 1.5px solid var(--border2);
    background: var(--surface); color: var(--text2); transition: all .15s;
  }
  .pod-size-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

  .pod-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #000; padding-bottom: 5mm; margin-bottom: 5mm; gap: 8px;
  }
  .pod-logo { max-height: 44px; max-width: 130px; object-fit: contain; }
  .pod-meta-right { text-align: right; }
  .pod-order-id { font-family: 'DM Mono', monospace; font-size: 1.25em; font-weight: 700; }
  .pod-date-line { font-size: 0.78em; color: #555; margin-top: 2px; font-family: 'DM Mono', monospace; }

  .pod-barcode-area {
    border: 1.5px dashed #999; border-radius: 4px;
    padding: 5px 8px; margin-bottom: 5mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 60px; background: #fafafa;
  }
  .pod-barcode-awb { font-family: 'DM Mono', monospace; font-size: 1.1em; font-weight: 700; letter-spacing: 2px; margin-top: 3px; text-align: center; }
  .pod-barcode-sub { font-size: 0.72em; color: #777; margin-top: 2px; text-align: center; }
  .pod-barcode-empty-label { font-size: 0.75em; color: #bbb; text-align: center; text-transform: uppercase; letter-spacing: .6px; padding: 8px 0; }
  .pod-barcode-canvas { max-width: 100%; height: auto; }

  .pod-section { margin-bottom: 4mm; }
  .pod-section-title { font-size: 0.72em; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #555; margin-bottom: 2mm; }
  .pod-address-box { border: 1.5px solid #000; border-radius: 3px; padding: 4px 7px; background: #f9f9f9; line-height: 1.6; }
  .pod-address-name { font-size: 1.15em; font-weight: 700; }
  .pod-from-box { border: 1px solid #888; border-radius: 3px; padding: 4px 6px; font-size: 0.88em; line-height: 1.55; background: #f5f5f5; }
  .pod-items-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
  .pod-items-table th { background: #111; color: #fff; padding: 3px 5px; text-align: left; font-size: 0.8em; }
  .pod-items-table td { padding: 3px 5px; border-bottom: 1px solid #ddd; }
  .pod-total-row td { border-top: 1.5px solid #000; font-weight: 700; }

  .pod-footer {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-top: 1.5px solid #000; padding-top: 3mm; margin-top: 3mm;
  }
  .pod-footer-left { font-size: 0.88em; line-height: 1.7; }
  .pod-sig-box { border: 1px solid #999; border-radius: 3px; padding: 14px 28px 5px; text-align: center; font-size: 0.75em; color: #666; }
  .pod-fine-print { margin-top: 3mm; text-align: center; font-size: 0.7em; color: #aaa; border-top: 1px dashed #ccc; padding-top: 3mm; }

  @media (max-width: 1100px) { .lb-body { grid-template-columns: 1fr; } .lb-panel { max-width: 800px; } }
  @media (max-width: 700px) {
    .lb-info-grid { grid-template-columns: 1fr; }
    .form-grid-2, .form-grid-3, .remarks-utr-row { grid-template-columns: 1fr; }
  }
`;

export function injectStyles() {
  if (document.getElementById("ot-styles")) return;
  const s = document.createElement("style");
  s.id = "ot-styles";
  s.textContent = STYLES;
  document.head.appendChild(s);
}
