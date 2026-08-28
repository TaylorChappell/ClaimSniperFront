const UNREAD_KEY = "cs.tabUnread";
const BASE_ICON = `${import.meta.env.BASE_URL}sniper.png`;
const CHANNEL_NAME = "claim-sniper-tab-notifications";

type TabNotificationDetail = {
  kind?: string;
  title?: string;
  body?: string;
  url?: string;
};

let unread = false;
let dottedIcon: string | null = null;
let channel: BroadcastChannel | null = null;

function faviconLink() {
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  return link;
}

async function buildDottedIcon() {
  if (dottedIcon) return dottedIcon;
  try {
    const image = new Image();
    image.src = BASE_ICON;
    await image.decode();
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return BASE_ICON;
    ctx.drawImage(image, 0, 0, size, size);
    ctx.beginPath();
    ctx.arc(52, 12, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#ff405d";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#07100d";
    ctx.stroke();
    dottedIcon = canvas.toDataURL("image/png");
    return dottedIcon;
  } catch {
    return BASE_ICON;
  }
}

function persist(value: boolean) {
  try {
    localStorage.setItem(UNREAD_KEY, value ? "1" : "0");
  } catch {
    /* storage can be blocked; the in-memory badge still works */
  }
}

function render() {
  const link = faviconLink();
  if (!unread) {
    link.href = BASE_ICON;
    return;
  }
  void buildDottedIcon().then((href) => {
    if (unread) link.href = href;
  });
}

function setUnread(next: boolean, broadcast = true) {
  if (unread === next) return;
  unread = next;
  persist(next);
  render();
  if (broadcast) channel?.postMessage({ unread: next });
}

export function signalTabNotification(detail: TabNotificationDetail = {}) {
  window.dispatchEvent(new CustomEvent("claimsnipe:notification", { detail }));
}

export function clearTabNotifications() {
  setUnread(false);
}

export function initTabNotifications() {
  try {
    unread = localStorage.getItem(UNREAD_KEY) === "1";
  } catch {
    unread = false;
  }

  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (typeof event.data?.unread === "boolean") {
        unread = event.data.unread;
        persist(unread);
        render();
      }
    };
  }

  const mark = () => {
    // A focused visible tab is already showing the in-app toast/nav state. The
    // favicon dot is for notifications that arrive while this tab is elsewhere.
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    setUnread(true);
  };
  window.addEventListener("claimsnipe:notification", mark);
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "claim-sniper-notification") mark();
    if (event.data?.type === "claim-sniper-notification-opened") setUnread(false);
  });

  const clearWhenRead = () => {
    if (document.visibilityState === "visible" && document.hasFocus()) setUnread(false);
  };
  window.addEventListener("focus", clearWhenRead);
  document.addEventListener("visibilitychange", clearWhenRead);
  render();
  clearWhenRead();
}
