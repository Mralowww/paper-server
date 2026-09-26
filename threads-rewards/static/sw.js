/* 鋸齒 SMP 推播通知（網頁關閉時也會收到） */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "鋸齒 SMP", {
    body: d.body || "", tag: d.tag, renotify: !!d.tag, icon: "/static/img/icon-256.png", badge: "/static/img/icon-64.png",
    data: { url: d.url || "/" }, requireInteraction: /客服單/.test(d.title || ""),
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = wins.find((w) => w.url.split("#")[0] === url.split("#")[0]);
    if (same) { await same.focus(); if (same.url !== url) same.navigate(url); return; }
    const any = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (any) { await any.focus(); return any.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
