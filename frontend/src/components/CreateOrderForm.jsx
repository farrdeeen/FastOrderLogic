import { useForm } from "react-hook-form";
import axios from "axios";

const API_URL = "http://127.0.0.1:8000";

export default function CreateOrderForm({ onOrderCreated }) {
  const { register, handleSubmit, reset } = useForm();

  const onSubmit = async (data) => {
    try {
      data.items = parseInt(data.items);
      data.amount = parseFloat(data.amount);
      await axios.post(`${API_URL}/orders/create`, data);
      alert("✅ Order created successfully!");
      reset();
      onOrderCreated();
    } catch (err) {
      console.error(err);
      alert("❌ Failed to create order");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "0.7rem",
        background: "#f8f8f8",
        padding: "1rem",
        borderRadius: "8px",
        marginBottom: "1.5rem",
      }}
    >
      <input placeholder="Customer Name" {...register("customer", { required: true })} />
      <input placeholder="Mobile" {...register("mobile", { required: true })} />
      <input placeholder="City" {...register("city", { required: true })} />
      <input type="number" placeholder="Items" {...register("items", { required: true })} />
      <input type="number" placeholder="Amount" {...register("amount", { required: true })} />
      <select {...register("channel", { required: true })}>
        <option value="">Select Channel</option>
        <option value="offline">Offline</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="wix">Wix</option>
        <option value="website">Website</option>
      </select>
      <button
        type="submit"
        style={{
          background: "#1e40af",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          padding: "0.5rem 1rem",
          gridColumn: "1 / -1",
        }}
      >
        ➕ Create Order
      </button>
    </form>
  );
}
