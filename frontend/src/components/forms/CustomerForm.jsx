import { useState } from "react";
import axios from "axios";
import {
  Grid,
  TextField,
  MenuItem,
  Button,
  Typography,
  Box,
} from "@mui/material";

const API_URL = import.meta.env.VITE_API_URL;

export default function CustomerForm({ onClose, onSuccess, states }) {
  const [form, setForm] = useState({
    name: "",
    mobile: "",
    email: "",
    gst_number: "",
    customer_type: "online",
    address_line: "",
    locality: "",
    city: "",
    state_id: "",
    pincode: "",
    landmark: "",
    alternate_phone: "",
    address_type: "home",
  });

  const update = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name || !form.mobile) {
      alert("Name and Mobile are required");
      return;
    }

    try {
      await axios.post(`${API_URL}/customers/create`, form);
      alert("Customer added successfully!");
      onSuccess();
    } catch (err) {
      console.error(err);
      alert("Error adding customer");
    }
  };

  return (
    <Box sx={{ mt: 1 }}>
      {/* CUSTOMER DETAILS */}
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
        Customer Details
      </Typography>

      {/* WRAP ALL CUSTOMER FIELDS IN ONE GRID */}
      <Grid container spacing={2}>
        {/* Name full width */}
        <Grid item xs={12} sm={4}>
          <TextField
            label="Name"
            fullWidth
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="Mobile"
            fullWidth
            value={form.mobile}
            onChange={(e) => update("mobile", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="Customer Type"
            select
            fullWidth
            value={form.customer_type}
            onChange={(e) => update("customer_type", e.target.value)}
          >
            <MenuItem value="online">Online Customer</MenuItem>
            <MenuItem value="offline">Offline Customer</MenuItem>
          </TextField>
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="Email"
            fullWidth
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="GST Number (optional)"
            fullWidth
            value={form.gst_number}
            onChange={(e) =>
              update("gst_number", e.target.value.toUpperCase())
            }
          />
        </Grid>

        <Grid item xs={12} sm={4} /> {/* placeholder to keep alignment */}
      </Grid>

      {/* ADDRESS DETAILS */}
      <Typography variant="h6" sx={{ mt: 4, mb: 2, fontWeight: 600 }}>
        Address Details
      </Typography>

      {/* WRAP ALL ADDRESS FIELDS IN ONE GRID */}
      <Grid container spacing={2}>
        {/* FULL WIDTH ADDRESS LINE */}
        <Grid item xs={12}>
          <TextField
            label="Address Line"
            fullWidth
            value={form.address_line}
            onChange={(e) => update("address_line", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="Locality"
            fullWidth
            value={form.locality}
            onChange={(e) => update("locality", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="City"
            fullWidth
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="State"
            select
            fullWidth
            value={form.state_id}
            onChange={(e) => update("state_id", e.target.value)}
          >
            {states.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="Pincode"
            fullWidth
            value={form.pincode}
            onChange={(e) => update("pincode", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="Landmark"
            fullWidth
            value={form.landmark}
            onChange={(e) => update("landmark", e.target.value)}
          />
        </Grid>

        <Grid item xs={12} sm={4}>
          <TextField
            label="Alternate Phone"
            fullWidth
            value={form.alternate_phone}
            onChange={(e) => update("alternate_phone", e.target.value)}
          />
        </Grid>

        {/* Address Type aligned properly */}
        <Grid item xs={12} sm={4}>
          <TextField
            label="Address Type"
            select
            fullWidth
            value={form.address_type}
            onChange={(e) => update("address_type", e.target.value)}
          >
            <MenuItem value="home">Home</MenuItem>
            <MenuItem value="office">Office</MenuItem>
          </TextField>
        </Grid>
      </Grid>

      {/* BUTTONS */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          mt: 4,
          gap: 2,
        }}
      >
        <Button variant="outlined" onClick={onClose}>
          Cancel
        </Button>

        <Button variant="contained" onClick={handleSubmit}>
          Save
        </Button>
      </Box>
    </Box>
  );
}
