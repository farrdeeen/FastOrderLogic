import api from "../api/axiosInstance";

const SW_PATH = "/chat-notifications-sw.js";

function isSecureContextForPush() {
  return (
    window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

export function isIosDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandaloneApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

function setPushSubscribed(value) {
  window.__folPushSubscribed = Boolean(value);
  window.dispatchEvent(
    new CustomEvent("chat:push-subscription-changed", {
      detail: { subscribed: Boolean(value) },
    }),
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferEquals(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function registerChatNotificationWorker() {
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "service_worker_unsupported" };
  }
  if (!isSecureContextForPush()) {
    return { supported: false, reason: "insecure_context" };
  }

  const registration = await navigator.serviceWorker.register(SW_PATH);
  await registration.update();
  if (navigator.serviceWorker.ready) {
    await navigator.serviceWorker.ready;
  }
  return { supported: true, registration };
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";

  return new Promise((resolve) => {
    const request = Notification.requestPermission((permission) => {
      if (permission) resolve(permission);
    });
    if (request?.then) request.then(resolve);
  });
}

export async function ensureChatPushSubscription({ prompt = false } = {}) {
  if (!("Notification" in window)) {
    return { ok: false, permission: "unsupported", reason: "notification_unsupported" };
  }
  if (!("PushManager" in window)) {
    return { ok: false, permission: Notification.permission, reason: "push_unsupported" };
  }

  const worker = await registerChatNotificationWorker();
  if (!worker.supported) {
    return { ok: false, permission: Notification.permission, reason: worker.reason };
  }

  let permission = Notification.permission;
  if (prompt) {
    permission = await requestNotificationPermission();
  }
  if (permission !== "granted") {
    setPushSubscribed(false);
    return { ok: false, permission, reason: "permission_not_granted" };
  }

  const keyRes = await api.get("/notifications/web-push-key");
  const publicKey = keyRes.data?.public_key;
  if (!keyRes.data?.server_ready || !publicKey) {
    setPushSubscribed(false);
    return {
      ok: false,
      permission,
      reason: keyRes.data?.dependency_ready === false
        ? "pywebpush_missing"
        : "server_not_configured",
    };
  }

  const registration = worker.registration;
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (
    subscription &&
    subscription.options?.applicationServerKey &&
    !arrayBufferEquals(subscription.options.applicationServerKey, applicationServerKey)
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const subscriptionJson = subscription.toJSON();
  await api.post("/notifications/subscribe", {
    endpoint: subscriptionJson.endpoint,
    keys: subscriptionJson.keys,
    platform: isIosDevice() ? "ios" : "web",
    user_agent: navigator.userAgent,
  });

  setPushSubscribed(true);
  return { ok: true, permission, subscription };
}

export function pushFailureMessage(reason) {
  if (reason === "server_not_configured") {
    return "Web Push is not configured on the server. Set WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT.";
  }
  if (reason === "pywebpush_missing") {
    return "Server dependency pywebpush is not installed. Install backend requirements and restart Gunicorn.";
  }
  if (reason === "push_unsupported") {
    return "This browser does not support Web Push. On iPhone, add the site to Home Screen and open it from that icon.";
  }
  if (reason === "insecure_context") {
    return "Notifications require HTTPS.";
  }
  return "Notifications could not be enabled on this device.";
}
