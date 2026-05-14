import { useCallback, useEffect, useRef } from "react";
import { fetchRecentUserMessages, getChatWsUrl } from "./chatApi";
import {
  ensureChatPushSubscription,
  registerChatNotificationWorker,
} from "./pushNotifications";

function claimNotificationKey(key) {
  if (typeof window === "undefined") return true;
  if (!window.__folChatNotificationKeys) {
    window.__folChatNotificationKeys = new Set();
  }
  const seen = window.__folChatNotificationKeys;
  if (seen.has(key)) return false;
  if (seen.size > 500) seen.clear();
  seen.add(key);
  return true;
}

export default function ChatNotificationListener() {
  const wsRef = useRef(null);
  const wsReconnectRef = useRef(null);
  const lastUserMessageIdRef = useRef(null);
  const workerRegistrationRef = useRef(null);

  useEffect(() => {
    registerChatNotificationWorker()
      .then(({ supported, registration }) => {
        if (!supported) return;
        workerRegistrationRef.current = registration;
        if ("Notification" in window && Notification.permission === "granted") {
          ensureChatPushSubscription({ prompt: false }).catch(() => {
            window.__folPushSubscribed = false;
            window.dispatchEvent(
              new CustomEvent("chat:push-subscription-changed", {
                detail: { subscribed: false },
              }),
            );
          });
        }
      })
      .catch(() => {
        workerRegistrationRef.current = null;
      });
  }, []);

  const showBrowserNotification = useCallback(
    async ({ sessionId, name, phone, body, key, conversation }) => {
      if (typeof window === "undefined") return;
      if (window.__folPushSubscribed) return;
      if (!("Notification" in window) || Notification.permission !== "granted")
        return;
      if (
        document.visibilityState === "visible" &&
        Number(window.__folActiveChatId || 0) === Number(sessionId)
      )
        return;

      const notifyKey = key || `${sessionId}:${body || ""}`;
      if (!claimNotificationKey(notifyKey)) return;

      const titleName = name || phone || "Customer";
      const options = {
        body: body || "New WhatsApp message",
        tag: `chat-${sessionId}`,
        renotify: true,
        data: { sessionId, conversation, url: window.location.origin },
      };

      const registration = workerRegistrationRef.current;
      if (registration?.showNotification) {
        try {
          await registration.showNotification(`New message from ${titleName}`, options);
          return;
        } catch {
          // Fall back to the page Notification constructor below.
        }
      }

      let notification;
      try {
        notification = new Notification(`New message from ${titleName}`, options);
      } catch {
        return;
      }

      notification.onclick = () => {
        window.focus();
        if (conversation) {
          window.dispatchEvent(
            new CustomEvent("chat:open-session", { detail: conversation }),
          );
        }
        notification.close();
      };
    },
    [],
  );

  useEffect(() => {
    let stopped = false;

    const connect = () => {
      if (stopped || typeof WebSocket === "undefined") return;
      const ws = new WebSocket(getChatWsUrl());
      wsRef.current = ws;

      ws.onmessage = (event) => {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (payload.type !== "chat_changed") return;
        window.dispatchEvent(
          new CustomEvent("chat:changed", { detail: payload }),
        );
        if (payload.action === "message" && payload.sender === "user") {
          window.dispatchEvent(
            new CustomEvent("chat:user-message", { detail: payload }),
          );
          showBrowserNotification({
            sessionId: payload.session_id,
            body: payload.message || "New WhatsApp message",
            key: payload.message_id
              ? `msg:${payload.message_id}`
              : `ws:${payload.session_id}:${payload.updated_at}`,
          });
          if (payload.message_id) {
            lastUserMessageIdRef.current = Math.max(
              Number(lastUserMessageIdRef.current || 0),
              Number(payload.message_id),
            );
          }
        }
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (stopped) return;
        wsReconnectRef.current = window.setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (wsReconnectRef.current) {
        window.clearTimeout(wsReconnectRef.current);
        wsReconnectRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [showBrowserNotification]);

  useEffect(() => {
    let stopped = false;
    let pollTimer = null;

    const seedLatestMessageId = async () => {
      try {
        const rows = await fetchRecentUserMessages({ latest: true, limit: 1 });
        if (!stopped) lastUserMessageIdRef.current = rows[0]?.id || 0;
      } catch {
        // Websocket may still work; keep this component silent.
      }
    };

    const pollRecentMessages = async () => {
      if (stopped || lastUserMessageIdRef.current === null) return;
      try {
        const rows = await fetchRecentUserMessages({
          afterId: lastUserMessageIdRef.current,
          limit: 50,
        });
        rows.forEach((row) => {
          lastUserMessageIdRef.current = Math.max(
            Number(lastUserMessageIdRef.current || 0),
            Number(row.id || 0),
          );
          const payload = {
            type: "chat_changed",
            action: "message",
            session_id: row.session_id,
            message_id: row.id,
            sender: "user",
            message: row.message,
            updated_at: row.timestamp,
          };
          showBrowserNotification({
            sessionId: row.session_id,
            name: row.conversation?.wa_contact_name,
            phone: row.conversation?.phone_number,
            body: row.message || "New WhatsApp message",
            key: `msg:${row.id}`,
            conversation: row.conversation,
          });
          window.dispatchEvent(
            new CustomEvent("chat:user-message", { detail: payload }),
          );
          window.dispatchEvent(
            new CustomEvent("chat:changed", { detail: payload }),
          );
        });
      } catch {
        // Keep polling alive across transient auth/network failures.
      }
    };

    seedLatestMessageId().finally(() => {
      if (stopped) return;
      pollTimer = window.setInterval(pollRecentMessages, 15000);
    });

    return () => {
      stopped = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [showBrowserNotification]);

  return null;
}
