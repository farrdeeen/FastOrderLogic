# backend/utils/file_db.py
import json, os
from threading import Lock
from datetime import datetime

DATA_FILE = os.path.join("data", "orders.json")
_lock = Lock()

def _ensure_file():
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump({"orders": []}, f)

def read_data():
    _ensure_file()
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {"orders": []}

def write_data(data):
    _ensure_file()
    with _lock:
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, DATA_FILE)

def add_order(order_dict):
    data = read_data()
    data["orders"].append(order_dict)
    write_data(data)
    return order_dict

def update_order(order_id, updates):
    data = read_data()
    for order in data["orders"]:
        if order["order_id"] == order_id:
            order.update(updates)
            write_data(data)
            return order
    return None

def get_orders():
    return read_data().get("orders", [])
