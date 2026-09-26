/* 桌面通知（Web Push）：註冊 service worker、訂閱 / 取消訂閱，網頁關著也能收到 */
(() => {
  if (window.PushNotify) return;
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const b64ToBytes = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  async function registration() { return navigator.serviceWorker.getRegistration("/") || navigator.serviceWorker.register("/sw.js", { scope: "/" }); }
  async function current() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration("/"); if (!reg) return null;
    return reg.pushManager.getSubscription();
  }
  async function state() {
    if (!supported()) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    return (await current()) ? "on" : "off";
  }
  async function enable(kinds) {
    if (!supported()) throw new Error(App.t("nt.unsupported"));
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(App.t("nt.denied"));
    const reg = await registration(); await navigator.serviceWorker.ready;
    const { key } = await App.api("/api/push/key", { quiet: true });
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(App.t("nt.timeout"))), 20000))]);
    await App.api("/api/push/subscribe", { method: "POST", body: { ...sub.toJSON(), kinds } });
    App.store.set("push.kinds", kinds);
    return sub;
  }
  async function disable() {
    const sub = await current(); if (!sub) return;
    try { await App.api("/api/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }); } catch { /* 略過 */ }
    await sub.unsubscribe();
  }
  const kinds = () => App.store.get("push.kinds", App.me && App.me.level >= 1 ? ["tickets", "replies"] : ["replies"]);
  // 權限還在但訂閱已過期時，自動重新訂閱
  async function refresh() { try { if ((await state()) === "on") await enable(kinds()); } catch { /* 略過 */ } }
  window.PushNotify = { supported, state, enable, disable, kinds, refresh, test: () => App.api("/api/push/test", { method: "POST" }) };
})();
