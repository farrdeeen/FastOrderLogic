import { useState } from "react";
import api from "../../api/axiosInstance";
import { DeliveryBadge } from "./Badges";
import DelhiveryPushModal from "./DelhiveryPushModal";
import TrackingModal from "./TrackingModal";
import OfflinePOD from "./OfflinePOD";
import { toast } from "./ToastSystem";

export default function DeliveryCell({ order, onPushed }) {
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
