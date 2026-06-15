import { useRef, useState } from "react";
import api from "../../api/axiosInstance";
import ProductSearchInput from "./ProductSearchInput";
import { toast } from "./ToastSystem";
import { fmtCurrency } from "./helpers";

export default function AddProductPanel({
  orderId,
  products,
  onAdded,
  onCancel,
}) {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const selectionRequestRef = useRef(0);

  const handleProductChange = async (product) => {
    const requestId = ++selectionRequestRef.current;

    if (!product) {
      setSelectedProduct(null);
      setPrice("");
      return;
    }

    const productId = product.id ?? product.product_id;
    const baseProduct = { ...product, id: productId };
    const listedPrice = product.selling_price ?? product.price ?? product.mrp;

    setSelectedProduct(baseProduct);
    setPrice(
      listedPrice != null && listedPrice !== "" ? String(Number(listedPrice)) : "",
    );

    try {
      const [detailRes, priceRes] = await Promise.allSettled([
        api.get("/dropdowns/products/details", { params: { id: productId } }),
        api.get("/dropdowns/products/get_price", {
          params: { product_id: productId },
        }),
      ]);

      if (selectionRequestRef.current !== requestId) return;

      const detail =
        detailRes.status === "fulfilled" ? (detailRes.value.data ?? {}) : {};
      const priceVal =
        priceRes.status === "fulfilled"
          ? priceRes.value.data?.price
          : undefined;
      const resolvedPrice =
        priceVal != null
          ? Number(priceVal)
          : detail.selling_price != null
            ? Number(detail.selling_price)
            : listedPrice != null
              ? Number(listedPrice)
              : "";

      setSelectedProduct({
        ...baseProduct,
        ...detail,
        id: productId,
        selling_price: resolvedPrice,
      });

      if (resolvedPrice !== "" && Number.isFinite(resolvedPrice)) {
        setPrice(String(resolvedPrice));
      }
    } catch {
      // Keep the selected product usable even if price/detail enrichment fails.
    }
  };

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
            onChange={handleProductChange}
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
