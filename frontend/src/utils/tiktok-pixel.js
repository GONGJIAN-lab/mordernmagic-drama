/**
 * TikTok Pixel 工具
 * - initTikTokPixel(pixelId): 加载 ttq 脚本
 * - trackEvent(name, data): 上报事件
 * - trackCompletePayment({value, currency, content_name}): 付费完成事件
 */
let pixelId = null;

export function initTikTokPixel(id) {
  pixelId = id;
  if (!id || typeof window === "undefined") return;

  !function (w, d, t) {
    w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
    ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
    for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
    ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
    ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
    ttq.load(e); ttq.page();
  }(window, document, 'ttq');

  if (id) window.ttq?.load(id);
}

export function trackEvent(name, data = {}) {
  if (typeof window !== "undefined" && window.ttq) {
    window.ttq.track(name, data);
  }
}

export function trackCompletePayment({ value, currency = "USD", contentName, contentId }) {
  trackEvent("CompletePayment", {
    value: Number(value),
    currency,
    content_name: contentName,
    content_id: contentId,
  });
}
