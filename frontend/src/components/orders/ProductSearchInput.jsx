import { useState, useRef, useEffect, useMemo } from "react";

export default function ProductSearchInput({
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
