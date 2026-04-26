/**
 * forms/styles.js
 * ─────────────────────────────────────────────────────────────
 * "Command Deck" — a dense, single-screen order entry terminal.
 *
 * Design principles:
 *   - Everything fits on a 13"+ screen without vertical scroll
 *   - Two-column master layout: left = customer+products, right = summary+actions
 *   - Tight 6px base grid, reduced section padding
 *   - DM Sans (clean utilitarian) + DM Mono (numbers/codes)
 *   - Clean light surface with warm undertone, electric-teal accent
 *   - Elevated cards via subtle borders and soft shadows
 */

export const FORM_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

  :root {
    --f-bg:          #f4f3f0;
    --f-surface:     #ffffff;
    --f-surface2:    #f9f8f6;
    --f-surface3:    #f0efe9;
    --f-border:      #e2e0da;
    --f-border2:     #cccac3;
    --f-ink:         #1a1916;
    --f-ink2:        #5a5650;
    --f-ink3:        #9a9790;
    --f-accent:      #007a64;
    --f-accent-lt:   rgba(0,122,100,.08);
    --f-accent-dk:   #006050;
    --f-green:       #15803d;
    --f-green-lt:    rgba(21,128,61,.10);
    --f-red:         #dc2626;
    --f-red-lt:      rgba(220,38,38,.08);
    --f-amber:       #b45309;
    --f-amber-lt:    rgba(180,83,9,.08);
    --f-radius:      5px;
    --f-radius-lg:   8px;
    --f-shadow:      0 1px 3px rgba(0,0,0,.08);
    --f-shadow-md:   0 4px 12px rgba(0,0,0,.10);
    --f-shadow-lg:   0 16px 32px rgba(0,0,0,.14);
    --f-font:        'DM Sans', sans-serif;
    --f-mono:        'DM Mono', monospace;
    --f-transition:  140ms cubic-bezier(.4,0,.2,1);
    /* compact spacing scale */
    --sp-xs: 4px;
    --sp-sm: 8px;
    --sp-md: 12px;
    --sp-lg: 16px;
    --sp-xl: 20px;
  }

  /* ── Root wrapper: two-column master layout ── */
  .f-wrap {
    font-family: var(--f-font);
    color: var(--f-ink);
    background: var(--f-bg);
    height: 100%;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1fr 300px;
    grid-template-rows: auto 1fr;
    gap: 0;
  }

  /* Header bar spanning full width */
  .f-header {
    grid-column: 1 / -1;
    background: var(--f-surface);
    border-bottom: 1px solid var(--f-border);
    padding: 0 var(--sp-lg);
    height: 44px;
    display: flex;
    align-items: center;
    gap: var(--sp-md);
    flex-shrink: 0;
    box-shadow: var(--f-shadow);
  }
  .f-header-title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--f-ink2);
  }
  .f-header-accent {
    color: var(--f-accent);
    font-family: var(--f-mono);
    font-size: 11px;
  }
  .f-header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
  }

  /* ── Left column: scrollable content area ── */
  .f-main {
    overflow: hidden;
    padding: var(--sp-md);
    display: flex;
    flex-direction: column;
    gap: var(--sp-sm);
    scrollbar-width: thin;
    scrollbar-color: var(--f-border2) transparent;
  }
  .f-main::-webkit-scrollbar { width: 4px; }
  .f-main::-webkit-scrollbar-thumb { background: var(--f-border2); border-radius: 2px; }

  /* ── Right column: order rail ── */
  .f-rail {
    border-left: 1px solid var(--f-border);
    background: var(--f-surface);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: -2px 0 8px rgba(0,0,0,.04);
  }
  .f-rail-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-md);
    scrollbar-width: thin;
    scrollbar-color: var(--f-border2) transparent;
  }
  .f-rail-body::-webkit-scrollbar { width: 3px; }
  .f-rail-body::-webkit-scrollbar-thumb { background: var(--f-border2); border-radius: 2px; }
  .f-rail-foot {
    border-top: 1px solid var(--f-border);
    padding: var(--sp-md);
    flex-shrink: 0;
    background: var(--f-surface);
  }

  /* ── Section card ── */
  .f-section {
    background: var(--f-surface);
    border: 1px solid var(--f-border);
    border-radius: var(--f-radius-lg);
    padding: var(--sp-md);
    position: relative;
    box-shadow: var(--f-shadow);
  }

  /* ── Section header ── */
  .f-section-head {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-sm);
    padding-bottom: var(--sp-sm);
    border-bottom: 1px solid var(--f-border);
  }
  .f-section-icon {
    width: 22px; height: 22px;
    border-radius: var(--f-radius);
    background: var(--f-accent-lt);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; flex-shrink: 0;
    color: var(--f-accent);
  }
  .f-section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--f-ink2);
    margin: 0;
  }
  .f-section-badge {
    margin-left: auto;
    font-size: 10px;
    font-family: var(--f-mono);
    color: var(--f-ink3);
    background: var(--f-surface2);
    border: 1px solid var(--f-border);
    border-radius: var(--f-radius);
    padding: 1px 6px;
  }

  /* ── Grid layouts ── */
  .f-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-sm); }
  .f-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--sp-sm); }
  .f-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sp-sm); }
  .f-col-span-2 { grid-column: span 2; }
  .f-col-span-3 { grid-column: span 3; }

  @media (max-width: 900px) {
    .f-wrap { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; }
    .f-rail { border-left: none; border-top: 1px solid var(--f-border); max-height: 280px; }
    .f-grid-2, .f-grid-3, .f-grid-4 { grid-template-columns: 1fr; }
    .f-col-span-2, .f-col-span-3 { grid-column: span 1; }
  }

  /* ── Label / Field ── */
  .f-field { display: flex; flex-direction: column; gap: 3px; }
  .f-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--f-ink3);
  }
  .f-label.required::after {
    content: ' *';
    color: var(--f-red);
  }

  /* ── Inputs ── */
  .f-input, .f-select, .f-textarea {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--f-border2);
    border-radius: var(--f-radius);
    font-family: var(--f-font);
    font-size: 13px;
    color: var(--f-ink);
    background: var(--f-surface);
    outline: none;
    transition: border-color var(--f-transition), box-shadow var(--f-transition);
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
  }
  .f-input:focus, .f-select:focus, .f-textarea:focus {
    border-color: var(--f-accent);
    box-shadow: 0 0 0 2px rgba(0,122,100,.12);
  }
  .f-input:disabled, .f-select:disabled {
    background: var(--f-surface2);
    color: var(--f-ink3);
    cursor: not-allowed;
  }
  .f-input.mono { font-family: var(--f-mono); }
  .f-input.right { text-align: right; }
  .f-input.error { border-color: var(--f-red); }
  .f-input.error:focus { box-shadow: 0 0 0 2px rgba(220,38,38,.12); }

  .f-select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%239a9790' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding-right: 26px;
    cursor: pointer;
  }

  .f-error-msg {
    font-size: 10px;
    color: var(--f-red);
    margin-top: 1px;
  }

  /* ── Buttons ── */
  .f-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    padding: 7px 14px;
    border-radius: var(--f-radius);
    font-family: var(--f-font);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all var(--f-transition);
    white-space: nowrap;
    line-height: 1;
  }
  .f-btn:disabled { opacity: .4; cursor: not-allowed; }

  .f-btn-primary {
    background: var(--f-accent);
    color: #fff;
    border-color: var(--f-accent);
    font-weight: 600;
  }
  .f-btn-primary:hover:not(:disabled) {
    background: var(--f-accent-dk);
    border-color: var(--f-accent-dk);
  }

  .f-btn-secondary {
    background: var(--f-surface2);
    color: var(--f-ink2);
    border-color: var(--f-border2);
  }
  .f-btn-secondary:hover:not(:disabled) {
    background: var(--f-surface3);
    color: var(--f-ink);
    border-color: var(--f-border2);
  }

  .f-btn-ghost {
    background: transparent;
    color: var(--f-accent);
    border-color: transparent;
    padding-left: 6px; padding-right: 6px;
  }
  .f-btn-ghost:hover:not(:disabled) { background: var(--f-accent-lt); }

  .f-btn-danger {
    background: var(--f-red-lt);
    color: var(--f-red);
    border-color: rgba(220,38,38,.2);
  }
  .f-btn-danger:hover:not(:disabled) { background: rgba(220,38,38,.14); }

  .f-btn-sm { padding: 4px 8px; font-size: 11px; }
  .f-btn-lg { padding: 10px 20px; font-size: 13px; font-weight: 600; }
  .f-btn-full { width: 100%; }

  /* ── Product item row (compact) ── */
  .f-product-row {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    gap: 10px;
    align-items: start;
    padding: 10px;
    border: 1px solid var(--f-border);
    border-radius: var(--f-radius-lg);
    background: var(--f-surface2);
    margin-bottom: 6px;
    transition: border-color var(--f-transition);
    animation: f-row-in 180ms ease both;
  }
  .f-product-row:last-child { margin-bottom: 0; }
  .f-product-row:hover { border-color: var(--f-border2); }
  @keyframes f-row-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .f-product-name {
    font-size: 12px; font-weight: 500; color: var(--f-ink);
    margin-bottom: 1px; line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .f-product-meta {
    font-size: 10px; color: var(--f-ink3); font-family: var(--f-mono);
    margin-bottom: 6px;
  }

  .f-product-controls {
    display: flex; gap: 6px; align-items: flex-end; flex-wrap: wrap;
  }
  .f-product-controls .f-field { min-width: 60px; }

  .f-product-actions {
    display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
    flex-shrink: 0;
  }
  .f-product-price {
    font-size: 13px; font-weight: 600; font-family: var(--f-mono); color: var(--f-accent);
    text-align: right;
  }
  .f-product-price-original {
    font-size: 10px; color: var(--f-ink3); text-decoration: line-through;
    font-family: var(--f-mono); text-align: right;
  }

  /* ── Summary rows (in rail) ── */
  .f-summary-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 5px 0;
    font-size: 12px;
    color: var(--f-ink2);
  }
  .f-summary-row + .f-summary-row { border-top: 1px solid var(--f-border); }
  .f-summary-row.total {
    font-size: 15px; font-weight: 600; color: var(--f-ink);
    padding-top: 10px; margin-top: 6px;
    border-top: 1px solid var(--f-accent) !important;
  }
  .f-summary-row .f-mono { font-family: var(--f-mono); }
  .f-summary-total-val { color: var(--f-accent); }

  /* ── Rail section label ── */
  .f-rail-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--f-ink3);
    margin-bottom: var(--sp-sm);
    margin-top: var(--sp-md);
  }
  .f-rail-label:first-child { margin-top: 0; }

  /* ── Customer info card ── */
  .f-cust-card {
    background: var(--f-accent-lt);
    border: 1px solid rgba(0,122,100,.18);
    border-radius: var(--f-radius-lg);
    padding: 10px 12px;
    margin-bottom: var(--sp-sm);
    display: flex; gap: 10px; align-items: flex-start;
  }
  .f-cust-avatar {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--f-accent);
    color: #fff; font-size: 13px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .f-cust-name { font-size: 13px; font-weight: 600; color: var(--f-ink); margin-bottom: 1px; }
  .f-cust-meta { font-size: 11px; color: var(--f-ink2); font-family: var(--f-mono); }

  /* ── Address option ── */
  .f-addr-option {
    padding: 8px 10px;
    border: 1px solid var(--f-border2);
    border-radius: var(--f-radius);
    cursor: pointer;
    margin-bottom: 5px;
    transition: all var(--f-transition);
    font-size: 12px; color: var(--f-ink2);
    background: var(--f-surface);
    line-height: 1.4;
  }
  .f-addr-option:last-child { margin-bottom: 0; }
  .f-addr-option:hover { border-color: var(--f-accent); color: var(--f-ink); }
  .f-addr-option.selected {
    border-color: var(--f-accent);
    background: var(--f-accent-lt);
    color: var(--f-ink);
  }
  .f-addr-option.selected::before {
    content: '✓ ';
    color: var(--f-accent);
    font-weight: 700;
  }
  .f-addr-city { font-family: var(--f-mono); font-size: 10px; color: var(--f-ink3); margin-top: 1px; }

  /* ── Checkbox / Toggle row ── */
  .f-check-row {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px;
    border: 1px solid var(--f-border);
    border-radius: var(--f-radius);
    cursor: pointer;
    transition: all var(--f-transition);
    background: var(--f-surface2);
    user-select: none;
  }
  .f-check-row:hover { border-color: var(--f-border2); }
  .f-check-row.checked { border-color: var(--f-accent); background: var(--f-accent-lt); }

  .f-checkbox {
    width: 14px; height: 14px;
    border: 1.5px solid var(--f-border2);
    border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; transition: all var(--f-transition);
    font-size: 9px; color: transparent;
  }
  .f-check-row.checked .f-checkbox {
    background: var(--f-accent); border-color: var(--f-accent); color: #fff;
  }
  .f-check-label { font-size: 12px; color: var(--f-ink2); font-weight: 500; }
  .f-check-row.checked .f-check-label { color: var(--f-accent); }

  /* ── Modal overlay ── */
  .f-modal-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,.35);
    backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    animation: f-overlay-in 160ms ease both;
  }
  @keyframes f-overlay-in { from { opacity: 0; } to { opacity: 1; } }

  .f-modal {
    background: var(--f-surface);
    border: 1px solid var(--f-border2);
    border-radius: 10px;
    box-shadow: var(--f-shadow-lg);
    width: 100%; max-width: 980px; max-height: 100vh;
    display: flex; flex-direction: column;
    animation: f-modal-in 200ms cubic-bezier(.34,1.56,.64,1) both;
    overflow: hidden;
  }
  @keyframes f-modal-in {
    from { opacity: 0; transform: scale(.95) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .f-modal-lg { max-width: 980px; }

  .f-modal-head {
    padding: 14px 18px;
    border-bottom: 1px solid var(--f-border);
    display: flex; align-items: center; gap: 8px;
    flex-shrink: 0;
    background: var(--f-surface);
  }
  .f-modal-title { font-size: 14px; font-weight: 600; color: var(--f-ink); flex: 1; }
  .f-modal-close {
    width: 24px; height: 24px;
    border-radius: var(--f-radius);
    border: 1px solid var(--f-border2);
    background: var(--f-surface2);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; color: var(--f-ink3);
    transition: all var(--f-transition);
  }
  .f-modal-close:hover { color: var(--f-ink); border-color: var(--f-border2); background: var(--f-surface3); }

  .f-modal-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
  }
  .f-modal-foot {
    padding: 12px 18px;
    border-top: 1px solid var(--f-border);
    display: flex; gap: 8px; justify-content: flex-end;
    flex-shrink: 0;
    background: var(--f-surface2);
  }

  /* ── Browse product card ── */
  .f-browse-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    margin-top: 12px;
  }
  .f-browse-card {
    border: 1px solid var(--f-border);
    border-radius: var(--f-radius-lg);
    padding: 10px;
    cursor: pointer;
    transition: all var(--f-transition);
    background: var(--f-surface2);
    display: flex; flex-direction: column; gap: 6px;
  }
  .f-browse-card:hover {
    border-color: var(--f-accent);
    box-shadow: 0 0 0 1px var(--f-accent);
    transform: translateY(-1px);
  }
  .f-browse-card-img {
    width: 100%; height: 64px;
    object-fit: cover;
    border-radius: var(--f-radius);
    background: var(--f-surface3);
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; color: var(--f-border2);
  }
  .f-browse-card-name { font-size: 12px; font-weight: 500; color: var(--f-ink); line-height: 1.3; }
  .f-browse-card-price { font-size: 12px; font-family: var(--f-mono); color: var(--f-accent); font-weight: 500; }
  .f-browse-card-stock { font-size: 10px; color: var(--f-ink3); font-family: var(--f-mono); }

  /* ── Toast ── */
  .f-toast {
    position: fixed; bottom: 20px; right: 20px; z-index: 2000;
    background: var(--f-surface);
    color: var(--f-ink);
    border: 1px solid var(--f-border2);
    font-size: 12px; font-family: var(--f-font); font-weight: 500;
    padding: 10px 14px;
    border-radius: var(--f-radius-lg);
    box-shadow: var(--f-shadow-lg);
    animation: f-toast-in 220ms cubic-bezier(.34,1.56,.64,1) both;
    display: flex; align-items: center; gap: 8px;
    max-width: 320px;
  }
  .f-toast.success { border-color: rgba(21,128,61,.3); color: var(--f-green); background: var(--f-green-lt); }
  .f-toast.error   { border-color: rgba(220,38,38,.3); color: var(--f-red); background: var(--f-red-lt); }
  @keyframes f-toast-in {
    from { opacity: 0; transform: translateX(16px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* ── Empty state ── */
  .f-empty {
    text-align: center; padding: 20px 12px;
    color: var(--f-ink3); font-size: 12px;
  }
  .f-empty-icon { font-size: 24px; margin-bottom: 6px; }

  /* ── Divider ── */
  .f-divider { height: 1px; background: var(--f-border); margin: 12px 0; }

  /* ── Spinner ── */
  .f-spinner {
    width: 13px; height: 13px;
    border: 2px solid rgba(0,0,0,.12);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: f-spin .65s linear infinite;
    display: inline-block;
    flex-shrink: 0;
  }
  @keyframes f-spin { to { transform: rotate(360deg); } }

  /* ── Qty stepper ── */
  .f-qty-stepper {
    display: flex; align-items: center; gap: 0;
    border: 1px solid var(--f-border2); border-radius: var(--f-radius);
    overflow: hidden; width: fit-content;
  }
  .f-qty-btn {
    width: 26px; height: 28px;
    background: var(--f-surface3); border: none;
    cursor: pointer; font-size: 14px; color: var(--f-ink2);
    display: flex; align-items: center; justify-content: center;
    transition: background var(--f-transition);
    flex-shrink: 0;
  }
  .f-qty-btn:hover { background: var(--f-border); color: var(--f-ink); }
  .f-qty-num {
    width: 36px; text-align: center;
    font-family: var(--f-mono); font-size: 12px; font-weight: 500;
    border: none; outline: none;
    background: var(--f-surface); color: var(--f-ink);
    padding: 0; height: 28px;
    border-left: 1px solid var(--f-border2);
    border-right: 1px solid var(--f-border2);
  }
  .f-qty-num::-webkit-inner-spin-button,
  .f-qty-num::-webkit-outer-spin-button { appearance: none; }

  /* ── Search input within modal ── */
  .f-search-wrap { position: relative; margin-bottom: 12px; }
  .f-search-wrap svg {
    position: absolute; left: 9px; top: 50%;
    transform: translateY(-50%); color: var(--f-ink3);
    pointer-events: none;
  }
  .f-search-input {
    width: 100%; padding: 8px 10px 8px 30px;
    border: 1px solid var(--f-border2); border-radius: var(--f-radius);
    font-family: var(--f-font); font-size: 13px; color: var(--f-ink);
    background: var(--f-surface); outline: none;
    transition: border-color var(--f-transition), box-shadow var(--f-transition);
    box-sizing: border-box;
  }
  .f-search-input:focus {
    border-color: var(--f-accent);
    box-shadow: 0 0 0 2px rgba(0,122,100,.12);
  }

  /* ── Products list scrolls within the section ── */
  .f-products-scroll {
    max-height: calc(100vh - 340px);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--f-border2) transparent;
    padding-right: 2px;
  }
  .f-products-scroll::-webkit-scrollbar { width: 3px; }
  .f-products-scroll::-webkit-scrollbar-thumb { background: var(--f-border2); border-radius: 2px; }

  /* Step badge for section sequencing */
  .f-step-badge {
    width: 18px; height: 18px;
    border-radius: 50%;
    background: var(--f-surface3);
    border: 1px solid var(--f-border2);
    font-size: 10px;
    font-weight: 700;
    color: var(--f-ink3);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    font-family: var(--f-mono);
  }
  .f-step-badge.active {
    background: var(--f-accent);
    border-color: var(--f-accent);
    color: #fff;
  }
  .f-step-badge.done {
    background: var(--f-green-lt);
    border-color: rgba(21,128,61,.3);
    color: var(--f-green);
  }

  /* ── CustomerForm compact layout inside modal ── */
  .f-customer-form-wrap {
    padding: 16px 18px;
  }
  .f-customer-form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .f-customer-form-grid .f-col-full {
    grid-column: 1 / -1;
  }

  /* ═══════════════════════════════════════════════════════════════
     CustomerForm — full-horizontal, no-scroll modal layout
     f-cf-* classes are scoped to CustomerForm only so they don't
     affect any other form that uses the shared f-* design system.
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Outer shell: flex column so the footer stays pinned at the bottom
   * and the body takes all remaining height.
   * The modal body (f-modal-body) gives us a fixed height container;
   * we fill it completely without overflowing.
   */
  .f-cf-wrap {
    font-family: var(--f-font);
    color: var(--f-ink);
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: var(--sp-sm);
    box-sizing: border-box;
  }

  /**
   * Body: side-by-side panels, equal width, no vertical scroll.
   * flex: 1 fills all space between the top of the modal body and
   * the footer; overflow: hidden prevents any bleed-out.
   */
  .f-cf-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-md);
    flex: 1;
    min-height: 0;       /* critical: lets flex children shrink below content size */
    overflow: hidden;
  }

  /**
   * Each panel fills its column and must not scroll — fields are
   * distributed horizontally within the panel's own 3-column grid.
   */
  .f-cf-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;    /* no internal scroll */
    min-height: 0;
  }

  /**
   * 3-column field grid inside each panel.
   * auto-rows: min-content keeps rows as tight as their tallest cell.
   * align-content: start prevents rows from stretching to fill height.
   */
  .f-cf-grid3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--sp-sm);
    align-content: start;
    flex: 1;
    min-height: 0;
  }

  /* span helpers scoped to f-cf-grid3 */
  .f-cf-col-span-2 { grid-column: span 2; }
  .f-cf-col-span-3 { grid-column: span 3; }

  /**
   * Footer: flush to the bottom, never scrolls away.
   */
  .f-cf-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: var(--sp-sm);
    flex-shrink: 0;
  }

  /* ── Responsive: stack panels on narrow modals / mobile ── */
  @media (max-width: 720px) {
    .f-cf-body {
      grid-template-columns: 1fr;
      overflow-y: auto;
    }
    .f-cf-grid3 {
      grid-template-columns: 1fr 1fr;
    }
    .f-cf-col-span-2 { grid-column: span 2; }
    .f-cf-col-span-3 { grid-column: span 2; }
  }

  @media (max-width: 480px) {
    .f-cf-grid3 {
      grid-template-columns: 1fr;
    }
    .f-cf-col-span-2,
    .f-cf-col-span-3 { grid-column: span 1; }
  }
`;

let injected = false;

/** Call once at module level — idempotent. */
export function injectFormStyles() {
  if (injected || document.getElementById("f-styles")) return;
  injected = true;
  const s = document.createElement("style");
  s.id = "f-styles";
  s.textContent = FORM_CSS;
  document.head.appendChild(s);
}

// ─── Shared colour tokens (for programmatic use) ───────────────────────────────
export const COLORS = {
  accent: "#007a64",
  accentLt: "rgba(0,122,100,.08)",
  green: "#15803d",
  red: "#dc2626",
  amber: "#b45309",
  ink: "#1a1916",
  ink2: "#5a5650",
  ink3: "#9a9790",
  border: "#e2e0da",
  surface: "#ffffff",
  surface2: "#f9f8f6",
};
