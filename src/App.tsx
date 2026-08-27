import {
  type MouseEvent as ReactMouseEvent,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  type Wallet,
  type Snipe,
  type Stats,
  type AdminSnipe,
  type AdminUser,
  type SocialUser,
  type CopyTrade,
  type PublicSnipe,
  type TrendingCoin,
  type ChatMessage,
  type AdminOverview,
  type AdminComputeTuning,
  type AdminRpcUsage,
  type AdminRecord,
  type AdminUserDetail,
  type AdminSnipeDebug,
  type ClaimScannerResult,
  type ClaimScannerCoin,
  type TakeProfitEntry,
  type Profile,
  type TradingPlatform,
  type LiveMarketCapSnapshot,
  type DiscoverCoin,
  type DiscoveryRedirect,
  type DiscoveryFeed,
  type DiscoverMetadata,
  type AdminFeatureState,
} from "./api";
import { useLeaderPolling } from "./sync";
import { EMOJIS } from "./emojiData";

const BRAND_IMG = `${import.meta.env.BASE_URL}sniper.png`;
const SNIPE_SOUND = `${import.meta.env.BASE_URL}sniper.mp3`;
const DEFAULT_CHAT_COLOR = "#20e070";
const DEFAULT_PLATFORM: TradingPlatform = "AXIOM";
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function formatSolBalance(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const decimals = Math.abs(value) >= 100 ? 3
    : Math.abs(value) >= 1 ? 4
      : Math.abs(value) >= 0.001 ? 6
        : 9;
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function totalWalletBalance(wallets: Wallet[]) {
  const known = wallets
    .map((wallet) => wallet.balanceSol)
    .filter((value): value is number => value != null && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function formatMarketCapValue(value: number | null | undefined, suffix = "") {
  if (value == null || !Number.isFinite(value)) return null;
  return `${compactNumber.format(value)}${suffix}`;
}

function snipeMarketCapLabel(s: Pick<Snipe | PublicSnipe, "liveMarketCapUsd">) {
  const usd = formatMarketCapValue(s.liveMarketCapUsd, "");
  return usd ? `$${usd}` : "—";
}

function marketCapInputToNumber(value: string): number | null {
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function marketCapFilterLabel(s: Pick<Snipe, "mcMinUsd" | "mcMaxUsd">) {
  const min = s.mcMinUsd ?? null;
  const max = s.mcMaxUsd ?? null;
  if (min == null && max == null) return null;
  if (min != null && max != null) return `MC ${snipeMarketCapLabel({ liveMarketCapUsd: min })}–${snipeMarketCapLabel({ liveMarketCapUsd: max })}`;
  if (min != null) return `MC ≥ ${snipeMarketCapLabel({ liveMarketCapUsd: min })}`;
  return `MC ≤ ${snipeMarketCapLabel({ liveMarketCapUsd: max })}`;
}

function mergeLiveMarketCaps(snipes: Snipe[], caps: Record<string, LiveMarketCapSnapshot | null>) {
  if (!Object.keys(caps).length) return snipes;
  return snipes.map((s) => {
    const cap = caps[s.mint];
    if (!cap) return s;
    return {
      ...s,
      liveMarketCapSol: cap.marketCapSol,
      liveMarketCapUsd: cap.marketCapUsd,
      livePriceSol: cap.priceSol,
      livePriceUsd: cap.priceUsd,
      liveMarketCapUpdatedAt: cap.updatedAt,
      liveMarketCapSource: cap.source,
    };
  });
}
function defaultProfile(username: string, admin = false): Profile {
  return {
    username,
    paid: true,
    admin,
    whitelisted: false,
    subscriptionExpiresAt: null,
    avatarDataUrl: null,
    chatColor: DEFAULT_CHAT_COLOR,
    tradingPlatform: DEFAULT_PLATFORM,
  };
}

type TradeOpenTarget = {
  mint: string;
  pairAddress?: string | null;
  pairUrl?: string | null;
  ticker?: string | null;
};

type AppView = "dashboard" | "discovery" | "history" | "social" | "claims" | "settings" | "admin";
type DashTab = "arm" | "snipes" | "wallets";
type SocialTab = "trending" | "traders" | "chat";
type AdminTab = "overview" | "snipes" | "users" | "compute" | "rpc" | "records" | "notify";
type PresetSlot = "1" | "2" | "3";
type ArmSnipePreset = {
  walletId: string;
  amount: string;
  slippage: string;
  adaptiveSlippage: boolean;
  maxSlippage: string;
  maxBuyRetries: string;
  priority: string;
  bribe: string;
  mcMinUsd: string;
  mcMaxUsd: string;
  onlyRedirected: boolean;
  watchWallet: string;
  triggerMode: "CLAIM" | "REDIRECT";
  exit: ExitPresetDraft;
};

const NAV_VIEW_KEY = "cs.nav.view";
const NAV_DASH_TAB_KEY = "cs.nav.dashboardTab";
const NAV_SOCIAL_TAB_KEY = "cs.nav.socialTab";
const NAV_ADMIN_TAB_KEY = "cs.nav.adminTab";
const ARM_PRESETS_KEY = "cs.armSnipePresets";

function readSavedChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = localStorage.getItem(key) as T | null;
    return saved && allowed.includes(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function saveChoice(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore storage errors */
  }
}

function readArmPresets(): Partial<Record<PresetSlot, ArmSnipePreset>> {
  try {
    const raw = localStorage.getItem(ARM_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeArmPreset(slot: PresetSlot, preset: ArmSnipePreset) {
  const next = { ...readArmPresets(), [slot]: preset };
  localStorage.setItem(ARM_PRESETS_KEY, JSON.stringify(next));
  return next;
}

function presetFingerprint(preset?: Partial<ArmSnipePreset> | null) {
  const exit = (preset?.exit ?? {}) as Partial<ExitPresetDraft>;
  return JSON.stringify({
    walletId: preset?.walletId ?? "",
    amount: preset?.amount ?? "",
    slippage: preset?.slippage ?? "15",
    adaptiveSlippage: preset?.adaptiveSlippage ?? true,
    maxSlippage: preset?.maxSlippage ?? "30",
    maxBuyRetries: preset?.maxBuyRetries ?? "2",
    priority: preset?.priority ?? "0.0005",
    bribe: preset?.bribe ?? "0",
    mcMinUsd: preset?.mcMinUsd ?? "",
    mcMaxUsd: preset?.mcMaxUsd ?? "",
    onlyRedirected: !!preset?.onlyRedirected,
    watchWallet: preset?.watchWallet ?? "",
    triggerMode: preset?.triggerMode === "REDIRECT" ? "REDIRECT" : "CLAIM",
    exit: {
      tpOn: !!exit.tpOn,
      tpTrail: !!exit.tpTrail,
      takeProfits: (exit.takeProfits ?? []).slice(0, 3).map((tp) => ({
        multiplier: tp.multiplier ?? "",
        sellPct: tp.sellPct ?? "",
        slippagePct: tp.slippagePct ?? "",
      })),
      tpTrailPct: exit.tpTrailPct ?? "20",
      slOn: !!exit.slOn,
      slTrail: !!exit.slTrail,
      slPct: exit.slPct ?? "30",
      slTrailPct: exit.slTrailPct ?? "20",
      slSlip: exit.slSlip ?? "25",
    },
  });
}

function presetsEqual(a?: Partial<ArmSnipePreset> | null, b?: Partial<ArmSnipePreset> | null) {
  return presetFingerprint(a) === presetFingerprint(b);
}

function tradingPlatformLabel(platform: TradingPlatform) {
  if (platform === "GMGN") return "GMGN";
  if (platform === "TERMINAL") return "Terminal";
  return "Axiom";
}

function tradingPlatformUrl(platform: TradingPlatform, token: TradeOpenTarget) {
  const mint = token.mint?.trim();
  const pair = token.pairAddress?.trim();

  if (platform === "GMGN") {
    return mint ? `https://gmgn.ai/sol/token/${mint}` : null;
  }

  if (platform === "TERMINAL") {
    return pair ? `https://trade.padre.gg/trade/solana/${pair}` : null;
  }

  // Axiom's current SOL token route accepts the mint directly, including
  // bonding-curve Pump coins, so Discovery does not need to resolve a pair first.
  return mint ? `https://axiom.trade/t/${mint}` : pair ? `https://axiom.trade/meme/${pair}` : null;
}

async function openInTradingPlatform(
  platform: TradingPlatform,
  token: TradeOpenTarget,
  toast?: (text: string, kind?: ToastKind) => void,
) {
  const mint = token.mint?.trim();
  let target: TradeOpenTarget = token;
  let url = tradingPlatformUrl(platform, target);

  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  // GMGN opens directly from the mint. Axiom/Terminal need a pair address.
  // Open a blank tab immediately so the browser does not block the popup while
  // the backend resolves/caches the pair address.
  if (platform !== "GMGN" && mint) {
    const pending = window.open("about:blank", "_blank");
    toast?.(`Resolving ${tradingPlatformLabel(platform)} pair…`);

    try {
      const market = await api.resolveTokenMarket(mint);
      target = {
        ...target,
        pairAddress: market.pairAddress,
        pairUrl: market.pairUrl,
        ticker: target.ticker ?? market.ticker,
      };
      url = tradingPlatformUrl(platform, target);
    } catch {
      pending?.close();
      toast?.(
        `${tradingPlatformLabel(platform)} pair is not indexed yet. Try GMGN for now, or try again in a minute.`,
        "err",
      );
      return;
    }

    if (url) {
      if (pending) pending.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    pending?.close();
  }

  toast?.(
    `${tradingPlatformLabel(platform)} needs a pair address for this token, but it has not been indexed yet. Try GMGN for now.`,
    "err",
  );
}

function isInteractiveClick(e: ReactMouseEvent<HTMLElement>) {
  const el = e.target as HTMLElement | null;
  return !!el?.closest("button,a,input,select,textarea,label");
}

function initialViewFromUrl(): AppView {
  if (typeof window === "undefined") return "dashboard";
  const view = new URLSearchParams(window.location.search).get("view");
  if (
    view === "history" ||
    view === "discovery" ||
    view === "social" ||
    view === "claims" ||
    view === "settings" ||
    view === "admin"
  ) {
    return view;
  }
  return readSavedChoice<AppView>(
    NAV_VIEW_KEY,
    ["dashboard", "discovery", "history", "social", "claims", "settings", "admin"],
    "dashboard",
  );
}

function initialDashTabFromStorage(): DashTab {
  // The dashboard now always opens on the unified Snipes list. Arm and Wallets
  // are still addressable through explicit routes from their new buttons.
  return "snipes";
}

function initialSocialTabFromUrl(): SocialTab {
  if (typeof window === "undefined") return "trending";
  const tab = new URLSearchParams(window.location.search).get("socialTab");
  if (tab === "traders" || tab === "chat") return tab;
  return readSavedChoice<SocialTab>(
    NAV_SOCIAL_TAB_KEY,
    ["trending", "traders", "chat"],
    "trending",
  );
}

function initialDashTabFromUrl(): DashTab {
  if (typeof window === "undefined") return "snipes";
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (tab === "arm" || tab === "snipes" || tab === "wallets") return tab;
  return initialDashTabFromStorage();
}

function initialAdminTabFromStorage(): AdminTab {
  if (typeof window === "undefined") return "overview";
  const saved = localStorage.getItem(NAV_ADMIN_TAB_KEY);
  if (saved === "armed") return "snipes";
  if (saved === "logs") return "records";
  if (["overview", "snipes", "users", "compute", "rpc", "records", "notify"].includes(saved ?? "")) return saved as AdminTab;
  return "overview";
}

function updateRoute(params: Record<string, string | null>, replace = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (replace) history.replaceState({}, "", next);
  else history.pushState({}, "", next);
}

function InfoTip({ text }: { text: string }) {
  return <span className="info-tip" tabIndex={0} aria-label={text}>?<span>{text}</span></span>;
}

function friendlyError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("insufficient") && m.includes("sol")) return "Insufficient SOL. Add funds to the selected wallet or lower the buy amount/fees.";
  if (m.includes("invalid") && (m.includes("mint") || m.includes("address"))) return "That coin address looks invalid. Check the full Pump mint address and try again.";
  if (m.includes("already") && (m.includes("trigger") || m.includes("execut"))) return "This snipe is already executing and can no longer be changed safely.";
  if (m.includes("conflict")) return "This snipe changed state while you were editing it. Refresh and check its current status.";
  return message;
}

function snipeUiState(s: Snipe) {
  if (s.status === "FAILED") return { label: "FAILED", tone: "FAILED", group: "failed" as const, glow: "failed" as const };
  if (s.status === "CANCELLED") return { label: "CANCELLED", tone: "CANCELLED", group: "finished" as const, glow: "finished" as const };
  if (s.status === "TRIGGERED") return { label: "BUYING", tone: "TRIGGERED", group: "active" as const, glow: "active" as const };
  if (s.status === "ARMED") return { label: "ARMED", tone: "ARMED", group: "active" as const, glow: "active" as const };
  if (s.status === "PAUSED") return { label: "PAUSED", tone: "PAUSED", group: "active" as const, glow: "active" as const };
  const exitDone = s.tpStatus === "SOLD" || s.tpStatus === "STOPPED";
  if (s.status === "FILLED" && !exitDone)
    return { label: "POSITION OPEN", tone: "OPEN", group: "positions" as const, glow: "open" as const };
  return { label: "CLOSED", tone: "CLOSED", group: "finished" as const, glow: "finished" as const };
}

type ToastKind = "ok" | "err" | "fill";
type Toast = { id: number; text: string; kind: ToastKind };
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(
  () => {},
);
const useToast = () => useContext(ToastCtx);

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [paid, setPaid] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [username, setUsername] = useState(
    localStorage.getItem("username") ?? "",
  );
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Unlock audio on the first user gesture so buy/fail chimes can play later.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Always ask the server on startup. The session JWT lives only in an HttpOnly
  // cookie and is never exposed to JavaScript.
  useEffect(() => {
    api.me()
      .then((m) => {
        setUsername(m.username);
        localStorage.setItem("username", m.username);
        setPaid(m.paid);
        setAdmin(m.admin);
        setAuthed(true);
      })
      .catch(() => {
        setAuthed(false);
      })
      .finally(() => setSessionReady(true));
  }, []);

  const push = (text: string, kind: ToastKind = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      kind === "fill" ? 5000 : 3800,
    );
  };

  function logout() {
    void api.logout().catch(() => {});
    localStorage.removeItem("username");
    setAuthed(false);
    setPaid(false);
    setAdmin(false);
  }

  let screen;
  if (!sessionReady) {
    screen = <div className="wrap" />;
  } else if (!authed) {
    screen = (
      <Auth
        onAuthed={(u, p, a) => {
          setUsername(u);
          localStorage.setItem("username", u);
          setPaid(p);
          setAdmin(a);
          setAuthed(true);
          setSessionReady(true);
        }}
      />
    );
  } else if (!paid) {
    screen = <PayScreen onPaid={() => setPaid(true)} onLogout={logout} />;
  } else {
    screen = <Dashboard username={username} admin={admin} onLogout={logout} />;
  }

  return (
    <ToastCtx.Provider value={push}>
      {screen}
      <div className="toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind === "err" ? "err" : t.kind === "fill" ? "fill" : ""}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- auth ---------------- */
function Auth({
  onAuthed,
}: {
  onAuthed: (u: string, paid: boolean, admin: boolean) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const res = await (mode === "login" ? api.login : api.register)(u, p);
      onAuthed(res.username, res.paid, res.admin);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <div className="auth rise">
        <img className="auth-logo-img" src={BRAND_IMG} alt="Claim Sniper" />
        <h1>Claim Sniper</h1>
        <p className="sub">
          {mode === "login"
            ? "Sign in to your account."
            : "Create an account to get started."}
        </p>
        <div className="card">
          <label>Username</label>
          <input
            value={u}
            onChange={(e) => setU(e.target.value)}
            autoComplete="username"
          />
          <label>Password</label>
          <input
            type="password"
            value={p}
            onChange={(e) => setP(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
          />
          {err && <div className="err">{err}</div>}
          <button
            className="primary"
            onClick={submit}
            disabled={busy || !u || !p}
          >
            {busy ? (
              <span className="spin" />
            ) : mode === "login" ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </button>
        </div>
        <div className="toggle">
          {mode === "login" ? (
            <span>
              No account? <a onClick={() => setMode("register")}>Create one</a>
            </span>
          ) : (
            <span>
              Have an account? <a onClick={() => setMode("login")}>Sign in</a>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- paywall ---------------- */
function PayScreen({
  onPaid,
  onLogout,
}: {
  onPaid: () => void;
  onLogout: () => void;
}) {
  const toast = useToast();
  const [addr, setAddr] = useState("");
  const [price, setPrice] = useState(2);
  const [received, setReceived] = useState(0);
  const [subscriptionDays, setSubscriptionDays] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const s = await api.billingStatus();
        if (stop) return;
        if (s.paid) return onPaid();
        setAddr(s.depositAddress ?? "");
        setPrice(s.priceSol ?? 2);
        setReceived(s.receivedSol ?? 0);
        setSubscriptionDays(s.subscriptionDays ?? 30);
        setMsg(s.message ?? null);
      } catch {
        /* keep polling */
      }
    };
    poll();
    const t = setInterval(poll, 6000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  function copy() {
    navigator.clipboard.writeText(addr).then(() => toast("Address copied"));
  }

  return (
    <div className="wrap">
      <div className="auth rise">
        <img className="auth-logo-img" src={BRAND_IMG} alt="Claim Sniper" />
        <h1>Unlock Claim Sniper</h1>
        <p className="sub">
          Monthly access costs {price} SOL every {subscriptionDays} days.
        </p>
        <div className="card">
          <label>Send exactly {price} SOL in a single transaction to renew access:</label>
          <div className="deposit">
            <code>{addr || "…"}</code>
            <button className="ghost" onClick={copy} disabled={!addr}>
              Copy
            </button>
          </div>
          <div className="paystatus">
            <span className="spin dark" />
            <span>
              Waiting for monthly payment… received {received.toFixed(3)} / {price} SOL
            </span>
          </div>
          {msg && <div className="hint">{msg}</div>}
        </div>
        <div className="toggle">
          <a onClick={onLogout}>Sign out</a>
        </div>
      </div>
    </div>
  );
}

function AvatarBubble({
  username,
  avatarDataUrl,
  size = "md",
}: {
  username: string;
  avatarDataUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const letter = username.trim().slice(0, 1).toUpperCase() || "?";
  return avatarDataUrl ? (
    <img
      className={`avatar ${size}`}
      src={avatarDataUrl}
      alt={`${username} avatar`}
    />
  ) : (
    <div className={`avatar ${size} avatar-fallback`}>{letter}</div>
  );
}

function ProfileMenu({
  profile,
  openSettings,
  openWallets,
  onLogout,
}: {
  profile: Profile;
  openSettings: () => void;
  openWallets: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="profile-menu" ref={wrapRef}>
      <button
        className={`profile-trigger ${open ? "on" : ""}`}
        aria-label="Profile menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="profile-trigger-name"
          style={{ color: profile.chatColor }}
        >
          @{profile.username}
        </span>
        <AvatarBubble
          username={profile.username}
          avatarDataUrl={profile.avatarDataUrl}
        />
      </button>
      {open && (
        <div className="profile-dropdown">
          <div className="profile-card-head">
            <AvatarBubble
              username={profile.username}
              avatarDataUrl={profile.avatarDataUrl}
              size="lg"
            />
            <div>
              <div
                className="profile-name"
                style={{ color: profile.chatColor }}
              >
                @{profile.username}
              </div>
              <div className="profile-platform">
                {platformLabel(profile.tradingPlatform)}
              </div>
            </div>
          </div>
          <button
            className="profile-row"
            onClick={() => {
              setOpen(false);
              openSettings();
            }}
          >
            <span>⚙</span>
            <b>Settings</b>
            <em>›</em>
          </button>
          <button
            className="profile-row"
            onClick={() => {
              setOpen(false);
              openWallets();
            }}
          >
            <span className="profile-row-icon"><AppIcon name="wallet" /></span>
            <b>Wallets</b>
            <em>›</em>
          </button>
          <button className="profile-row danger" onClick={onLogout}>
            <span>↪</span>
            <b>Log out</b>
          </button>
        </div>
      )}
    </div>
  );
}

const PLATFORMS: { id: TradingPlatform; label: string; icon: string }[] = [
  { id: "AXIOM", label: "Axiom", icon: "/Axiom.png" },
  { id: "GMGN", label: "GMGN", icon: "/GMGN.png" },
  { id: "TERMINAL", label: "Terminal", icon: "/Terminal.png" },
];

function platformLabel(platform: TradingPlatform | string | null | undefined) {
  return PLATFORMS.find((p) => p.id === platform)?.label ?? "Axiom";
}

function SettingsPage({
  profile,
  onUpdated,
}: {
  profile: Profile;
  onUpdated: (profile: Profile) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(
    profile.avatarDataUrl ?? null,
  );
  const [chatColor, setChatColor] = useState(
    profile.chatColor || DEFAULT_CHAT_COLOR,
  );
  const [tradingPlatform, setTradingPlatform] = useState<TradingPlatform>(
    profile.tradingPlatform || DEFAULT_PLATFORM,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAvatarDataUrl(profile.avatarDataUrl ?? null);
    setChatColor(profile.chatColor || DEFAULT_CHAT_COLOR);
    setTradingPlatform(profile.tradingPlatform || DEFAULT_PLATFORM);
  }, [profile.avatarDataUrl, profile.chatColor, profile.tradingPlatform]);

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Upload an image file", "err");
      return;
    }
    try {
      const data = await resizeAvatar(file);
      setAvatarDataUrl(data);
    } catch (e: any) {
      toast(e?.message ?? "Could not read avatar", "err");
    }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await api.updateProfile({
        avatarDataUrl,
        chatColor,
        tradingPlatform,
      });
      onUpdated(res.profile);
      toast("Settings saved");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page rise d1">
      <div className="card settings-card">
        <h2>Settings</h2>
        <div className="settings-profile-row">
          <button
            className="avatar-edit"
            onClick={() => fileRef.current?.click()}
          >
            <AvatarBubble
              username={profile.username}
              avatarDataUrl={avatarDataUrl}
              size="lg"
            />
            <span className="avatar-edit-icon">✎</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => pickAvatar(e.target.files?.[0])}
          />
          <div className="settings-identity">
            <div className="settings-name-line">
              <span style={{ color: chatColor }}>@{profile.username}</span>
              <label className="mini-color" title="Chat name colour">
                <input
                  type="color"
                  value={chatColor}
                  onChange={(e) => setChatColor(e.target.value)}
                />
                <span
                  className="mini-color-swatch"
                  style={{ background: chatColor }}
                />
              </label>
            </div>
            <div className="hint">
              Your avatar and name colour show in chat. Max profile picture upload is 2MB.
            </div>
          </div>
        </div>

        <div className="settings-section">
          <label>Trading platform of choice</label>
          <div className="platform-grid">
            {PLATFORMS.map((platform) => (
              <button
                key={platform.id}
                className={`platform-card ${tradingPlatform === platform.id ? "on" : ""}`}
                onClick={() => setTradingPlatform(platform.id)}
              >
                <span className="platform-icon">
                  <img src={platform.icon} alt="" />
                </span>
                <b>{platform.label}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section notifications-settings">
          <label>Notifications</label>
          <div className="hint">
            Manage browser alerts for this device. Notification permissions and
            subscriptions are per browser, so enable them again on each desktop,
            phone, or tablet you use.
          </div>
          <NotificationDeviceControl />
          <AlertSoundToggle />
          <NotificationToggle />
          <ChatNotificationToggle />
          <MobileNotificationGuide />
        </div>

        <button className="primary" onClick={save} disabled={busy}>
          {busy ? <span className="spin" /> : "Save settings"}
        </button>
      </div>
    </div>
  );
}

function normalizeHexInput(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{0,6}$/i.test(trimmed)) return trimmed;
  if (/^[0-9a-f]{0,6}$/i.test(trimmed)) return `#${trimmed}`;
  return DEFAULT_CHAT_COLOR;
}

function resizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Pick an image file"));
    if (file.size > AVATAR_IMAGE_MAX_RAW_BYTES) return reject(new Error("Profile picture is too large. Max upload is 2MB."));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read avatar"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load avatar image"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Could not process avatar"));
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (size - w) / 2;
        const y = (size - h) / 2;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, x, y, w, h);
        let quality = 0.86;
        let data = canvas.toDataURL("image/webp", quality);
        while (data.length > 260_000 && quality > 0.48) {
          quality -= 0.08;
          data = canvas.toDataURL("image/webp", quality);
        }
        if (data.length > 260_000) return reject(new Error("Profile picture is still too large after compression"));
        resolve(data);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}


type IconName =
  | "clock"
  | "smile"
  | "hand"
  | "leaf"
  | "food"
  | "activity"
  | "bulb"
  | "heart"
  | "paperclip"
  | "image"
  | "reply"
  | "reaction"
  | "pause"
  | "play"
  | "send"
  | "wallet"
  | "close";

function AppIcon({ name, className }: { name: IconName; className?: string }) {
  const common = {
    className: className ? `ui-icon ${className}` : "ui-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "clock":
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
    case "smile":
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M9 10h.01" /><path d="M15 10h.01" /><path d="M8.8 14.2c1.7 1.8 4.7 1.8 6.4 0" /></svg>;
    case "hand":
      return <svg {...common}><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M14 10V7a1.5 1.5 0 0 1 3 0v6" /><path d="M8 11.5 6.4 10A1.5 1.5 0 0 0 4 11.2c0 .4.1.8.4 1.1l4.1 5.2A6 6 0 0 0 13.2 20H14a5 5 0 0 0 5-5v-2" /></svg>;
    case "leaf":
      return <svg {...common}><path d="M5 19c7-1 12-6 14-14-8 2-13 7-14 14Z" /><path d="M5 19c2-4 5-7 9-9" /></svg>;
    case "food":
      return <svg {...common}><path d="M7 3v8" /><path d="M5 3v4a2 2 0 0 0 4 0V3" /><path d="M7 11v10" /><path d="M17 3v18" /><path d="M14 8c0-3 1.3-5 3-5" /></svg>;
    case "activity":
      return <svg {...common}><path d="M4 14c2-6 5-6 8 0s6 6 8 0" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="7" r="2" /></svg>;
    case "bulb":
      return <svg {...common}><path d="M9 18h6" /><path d="M10 22h4" /><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-.9.6-1.5 1.5-1.5 2.5h-4c0-1-.6-1.9-1.5-2.5Z" /></svg>;
    case "heart":
      return <svg {...common}><path d="M20.8 8.6c0 5.3-8.8 10-8.8 10s-8.8-4.7-8.8-10A4.6 4.6 0 0 1 12 5.9a4.6 4.6 0 0 1 8.8 2.7Z" /></svg>;
    case "paperclip":
    case "image":
      return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="m7 17 4.2-4.2a1.6 1.6 0 0 1 2.3 0L18 17" /><path d="m13.5 14.5 1.2-1.2a1.6 1.6 0 0 1 2.3 0L20 16.3" /></svg>;
    case "reply":
      return <svg {...common}><path d="m10 8-5 4 5 4" /><path d="M5 12h9a5 5 0 0 1 5 5v1" /></svg>;
    case "reaction":
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M8 10h.01" /><path d="M15.5 9.5h.01" /><path d="M8.5 14.5c1.8 1.6 4.2 1.9 6.8.2" /><path d="M18 5l1.2-2" /><path d="M20 7l2-.6" /></svg>;
    case "pause":
      return <svg {...common}><path d="M9 6v12" /><path d="M15 6v12" /></svg>;
    case "play":
      return <svg {...common}><path d="m8 5 11 7-11 7V5Z" /></svg>;
    case "send":
      return <svg {...common}><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7Z" /></svg>;
    case "wallet":
      return <svg {...common}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v11H6.5A2.5 2.5 0 0 1 4 15.5v-8Z" /><path d="M4 8h13" /><path d="M15 11h5v4h-5a2 2 0 0 1 0-4Z" /></svg>;
    case "close":
      return <svg {...common}><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>;
    default:
      return null;
  }
}

type EmojiCategory = {
  id: string;
  icon: IconName;
  label: string;
  emojis: string[];
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "recent",
    icon: "clock",
    label: "Recent",
    emojis: [],
  },
  {
    id: "smileys",
    icon: "smile",
    label: "Smileys",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
      "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️",
      "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓",
      "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵",
      "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "☠️", "👽",
      "👾", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾",
    ],
  },
  {
    id: "people",
    icon: "hand",
    label: "People",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍",
      "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂",
      "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀", "👁️", "👅", "👄", "💋", "🩸", "👶", "🧒", "👦", "👧", "🧑", "👱", "👨",
      "🧔", "👩", "🧓", "👴", "👵", "🙍", "🙎", "🙅", "🙆", "💁", "🙋", "🧏", "🙇", "🤦", "🤷", "👮", "🕵️", "💂", "🥷", "👷",
      "🤴", "👸", "👳", "👲", "🧕", "🤵", "👰", "🤰", "🤱", "👼", "🎅", "🤶", "🦸", "🦹", "🧙", "🧚", "🧛", "🧜", "🧝", "🧞",
      "🧟", "💆", "💇", "🚶", "🏃", "💃", "🕺", "🕴️", "👯", "🧖", "🧗", "🤺", "🏇", "⛷️", "🏂", "🏌️", "🏄", "🚣", "🏊", "⛹️",
      "🏋️", "🚴", "🚵", "🤸", "🤼", "🤽", "🤾", "🤹", "🧘", "🛀", "🛌",
    ],
  },
  {
    id: "nature",
    icon: "leaf",
    label: "Animals & Nature",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊",
      "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛", "🦋", "🐌",
      "🐞", "🐜", "🪰", "🪲", "🪳", "🦟", "🦗", "🕷️", "🕸️", "🦂", "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀",
      "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🦣", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒",
      "🦘", "🦬", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🦙", "🐐", "🦌", "🐕", "🐩", "🦮", "🐕‍🦺", "🐈", "🐈‍⬛", "🪶", "🐓",
      "🦃", "🦤", "🦚", "🦜", "🦢", "🦩", "🕊️", "🐇", "🦝", "🦨", "🦡", "🦫", "🦦", "🦥", "🐁", "🐀", "🐿️", "🦔", "🌵", "🎄",
      "🌲", "🌳", "🌴", "🪵", "🌱", "🌿", "☘️", "🍀", "🎍", "🪴", "🎋", "🍃", "🍂", "🍁", "🍄", "🐚", "🪨", "🌾", "💐", "🌷",
      "🌹", "🥀", "🌺", "🌸", "🌼", "🌻", "🌞", "🌝", "🌛", "🌜", "🌚", "🌕", "🌖", "🌗", "🌘", "🌑", "🌒", "🌓", "🌔", "🌙",
      "🌎", "🌍", "🌏", "🪐", "💫", "⭐", "🌟", "✨", "⚡", "☄️", "💥", "🔥", "🌪️", "🌈", "☀️", "🌤️", "⛅", "🌦️", "🌧️", "⛈️",
      "🌩️", "🌨️", "❄️", "☃️", "⛄", "🌬️", "💨", "💧", "💦", "☔", "☂️", "🌊", "🌫️",
    ],
  },
  {
    id: "food",
    icon: "food",
    label: "Food & Drink",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑",
      "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳",
      "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🦴", "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗",
      "🥘", "🫕", "🥫", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡",
      "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "🥛", "🍼", "☕",
      "🫖", "🍵", "🧃", "🥤", "🧋", "🍶", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🧉", "🍾", "🧊", "🥄", "🍴", "🍽️", "🥣",
      "🥡", "🥢", "🧂",
    ],
  },
  {
    id: "activity",
    icon: "activity",
    label: "Activity",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳",
      "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "⛹️",
      "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🤽", "🚣", "🧗", "🚵", "🚴", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️",
      "🎫", "🎟️", "🎪", "🤹", "🎭", "🩰", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁", "🪘", "🎷", "🎺", "🪗", "🎸", "🪕", "🎻",
      "🎲", "♟️", "🎯", "🎳", "🎮", "🎰", "🧩",
    ],
  },
  {
    id: "objects",
    icon: "bulb",
    label: "Objects",
    emojis: [
      "⌚", "📱", "📲", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️", "🗜️", "💽", "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥",
      "📽️", "🎞️", "📞", "☎️", "📟", "📠", "📺", "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛", "⏳", "📡", "🔋",
      "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🛢️", "💸", "💵", "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜", "🧰", "🪛",
      "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🪚", "🔩", "⚙️", "🪤", "🧱", "⛓️", "🧲", "🔫", "💣", "🧨", "🪓", "🔪", "🗡️", "⚔️", "🛡️",
      "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮", "📿", "🧿", "💈", "⚗️", "🔭", "🔬", "🕳️", "🩹", "🩺", "💊", "💉", "🩸", "🧬", "🦠",
      "🧫", "🧪", "🌡️", "🧹", "🪠", "🧺", "🧻", "🚽", "🚰", "🚿", "🛁", "🛀", "🧼", "🪥", "🪒", "🧽", "🪣", "🧴", "🛎️", "🔑",
      "🗝️", "🚪", "🪑", "🛋️", "🛏️", "🛌", "🧸", "🖼️", "🛍️", "🛒", "🎁", "🎈", "🎏", "🎀", "🪄", "🪅", "🎊", "🎉", "🎎", "🏮",
      "🎐", "🧧", "✉️", "📩", "📨", "📧", "💌", "📥", "📤", "📦", "🏷️", "🪧", "📪", "📫", "📬", "📭", "📮", "📯", "📜", "📃",
      "📄", "📑", "🧾", "📊", "📈", "📉", "🗒️", "🗓️", "📆", "📅", "🗑️", "📇", "🗃️", "🗳️", "🗄️", "📋", "📁", "📂", "🗂️", "🗞️",
      "📰", "📓", "📔", "📒", "📕", "📗", "📘", "📙", "📚", "📖", "🔖", "🧷", "🔗", "📎", "🖇️", "📐", "📏", "🧮", "📌", "📍",
      "✂️", "🖊️", "🖋️", "✒️", "🖌️", "🖍️", "📝", "✏️", "🔍", "🔎", "🔏", "🔐", "🔒", "🔓",
    ],
  },
  {
    id: "symbols",
    icon: "heart",
    label: "Symbols",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️",
      "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐",
      "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮", "🉐", "㊙️",
      "㊗️", "🈴", "🈵", "🈹", "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️", "🆘", "❌", "⭕", "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️",
      "🚷", "🚯", "🚳", "🚱", "🔞", "📵", "🚭", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔅", "🔆", "〽️", "⚠️", "🚸", "🔱", "⚜️",
      "🔰", "♻️", "✅", "🈯", "💹", "❇️", "✳️", "❎", "🌐", "💠", "Ⓜ️", "🌀", "💤", "🏧", "🚾", "♿", "🅿️", "🛗", "🈳", "🈂️",
      "🛂", "🛃", "🛄", "🛅", "🚹", "🚺", "🚼", "⚧️", "🚻", "🚮", "🎦", "📶", "🈁", "🔣", "ℹ️", "🔤", "🔡", "🔠", "🆖", "🆗",
      "🆙", "🆒", "🆕", "🆓", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "🔢", "▶️", "⏸️", "⏯️", "⏹️",
      "⏺️", "⏭️", "⏮️", "⏩", "⏪", "⏫", "⏬", "◀️", "🔼", "🔽", "➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "↙️", "↖️", "↕️", "↔️",
      "🔄", "🔃", "🎵", "🎶", "➕", "➖", "➗", "✖️", "🟰", "♾️", "💲", "💱", "™️", "©️", "®️", "〰️", "➰", "➿", "🔚", "🔙",
      "🔛", "🔝", "🔜", "✔️", "☑️", "🔘", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🟤", "🔺", "🔻", "🔸", "🔹", "🔶",
      "🔷", "🔳", "🔲", "▪️", "▫️", "◾", "◽", "◼️", "◻️", "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⬛", "⬜", "🟫",
    ],
  },
];

const DEFAULT_REACTION_EMOJIS = ["👍", "🔥", "😂", "💎", "🚀", "👀", "❤️", "🤝"];
const EMOJI_STORAGE_KEY = "cs.chat.recentEmojis";
const CHAT_IMAGE_MAX_RAW_BYTES = 5 * 1024 * 1024;
const AVATAR_IMAGE_MAX_RAW_BYTES = 2 * 1024 * 1024;

function allEmojiList() {
  return EMOJI_CATEGORIES.flatMap((c) => c.emojis);
}

function readRecentEmojis() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMOJI_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string").slice(0, 40) : [];
  } catch {
    return [];
  }
}

function rememberEmoji(emoji: string) {
  try {
    const recent = [emoji, ...readRecentEmojis().filter((e) => e !== emoji)].slice(0, 40);
    localStorage.setItem(EMOJI_STORAGE_KEY, JSON.stringify(recent));
    return recent;
  } catch {
    return [emoji];
  }
}

function resizeChatImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Pick an image file"));
    if (file.size > CHAT_IMAGE_MAX_RAW_BYTES) return reject(new Error("Image is too large. Max upload is 5MB."));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Could not process image"));
        ctx.drawImage(img, 0, 0, w, h);

        let quality = 0.82;
        let data = canvas.toDataURL("image/webp", quality);
        while (data.length > 820_000 && quality > 0.45) {
          quality -= 0.08;
          data = canvas.toDataURL("image/webp", quality);
        }
        if (data.length > 820_000) return reject(new Error("Image is still too large after compression"));
        resolve(data);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function chatStamp(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function chatTokenLabel(m: ChatMessage | { tokenMint?: string | null; tokenTicker?: string | null }) {
  if (!m.tokenMint) return null;
  return m.tokenTicker ? `$${m.tokenTicker}` : short(m.tokenMint);
}

function ChatTokenButton({
  message,
  tradingPlatform,
}: {
  message: ChatMessage;
  tradingPlatform: TradingPlatform;
}) {
  const toast = useToast();
  if (!message.tokenMint) return null;
  const label = chatTokenLabel(message) ?? short(message.tokenMint);
  return (
    <button
      className="chat-token-pill"
      type="button"
      title={`Open ${message.tokenMint} in ${tradingPlatformLabel(tradingPlatform)}`}
      onClick={() =>
        openInTradingPlatform(
          tradingPlatform,
          {
            mint: message.tokenMint!,
            ticker: message.tokenTicker,
            pairAddress: message.tokenPairAddress,
            pairUrl: message.tokenPairUrl,
          },
          toast,
        )
      }
    >
      {label}
    </button>
  );
}

function ChatTextContent({
  message,
  tradingPlatform,
}: {
  message: ChatMessage;
  tradingPlatform: TradingPlatform;
}) {
  const text = message.text || "";
  if (!text && message.tokenMint) return <ChatTokenButton message={message} tradingPlatform={tradingPlatform} />;
  if (!message.tokenMint || !text.includes(message.tokenMint)) {
    return (
      <>
        {text && <span>{text}</span>}
        {message.tokenMint && <ChatTokenButton message={message} tradingPlatform={tradingPlatform} />}
      </>
    );
  }

  const parts = text.split(message.tokenMint);
  return (
    <>
      {parts.map((part, idx) => (
        <span key={idx}>
          {part}
          {idx < parts.length - 1 && <ChatTokenButton message={message} tradingPlatform={tradingPlatform} />}
        </span>
      ))}
    </>
  );
}

function ChatAvatar({ message }: { message: ChatMessage }) {
  return (
    <AvatarBubble
      username={message.username}
      avatarDataUrl={message.avatarDataUrl}
      size="sm"
    />
  );
}

/* ---------------- dashboard ---------------- */
function Dashboard({
  username,
  admin,
  onLogout,
}: {
  username: string;
  admin: boolean;
  onLogout: () => void;
}) {
  const toast = useToast();
  const prevStatus = useRef<Record<string, string>>({});
  const initialized = useRef(false);

  const fetchAll = useCallback(async () => {
    const [w, s, st] = await Promise.all([
      api.walletsWithBalances(),
      api.snipes(),
      api.stats(),
    ]);
    const list = s.snipes;
    if (initialized.current) {
      for (const sn of list) {
        const prev = prevStatus.current[sn.id];
        if (prev && prev !== "FILLED" && sn.status === "FILLED") {
          toast(`Order filled: ${sn.amountSol} SOL of ${short(sn.mint)}`, "fill");
          playChime("fill");
        } else if (prev && prev !== "FAILED" && sn.status === "FAILED") {
          toast(`Snipe failed: ${short(sn.mint)}`, "err");
          playChime("fail");
        }
        const prevTp = prevStatus.current[`tp:${sn.id}`];
        if (prevTp && prevTp !== "SOLD" && sn.tpStatus === "SOLD") {
          toast(`Take-profit hit on ${sn.ticker ? "$" + sn.ticker : short(sn.mint)}`, "fill");
          playChime("fill");
        }
      }
    }
    const map: Record<string, string> = {};
    for (const sn of list) {
      map[sn.id] = sn.status;
      map[`tp:${sn.id}`] = sn.tpStatus;
    }
    prevStatus.current = map;
    initialized.current = true;
    return { wallets: w.wallets, snipes: list, stats: st };
  }, [toast]);

  const { data, refresh, error: dashboardError } = useLeaderPolling("dash", fetchAll, 30000, username);
  const { data: discoveryStatus } = useLeaderPolling(
    "discovery-status",
    () => api.discoveryStatus(),
    30000,
    username,
  );
  const { data: marketCapData } = useLeaderPolling(
    "snipe-market-caps",
    () => api.snipeMarketCaps(),
    5000,
    username,
  );
  const wallets = data?.wallets ?? [];
  const snipes = useMemo(
    () => mergeLiveMarketCaps(data?.snipes ?? [], marketCapData?.caps ?? {}),
    [data?.snipes, marketCapData?.caps],
  );
  const stats = data?.stats ?? null;
  const pausedSnipes = useMemo(() => snipes.filter((s) => s.status === "PAUSED"), [snipes]);

  const [view, setView] = useState<AppView>(() => initialViewFromUrl());
  const [dashTab, setDashTabState] = useState<DashTab>(() => initialDashTabFromUrl());
  const [profile, setProfile] = useState<Profile>(() => defaultProfile(username, admin));
  const [armPrefill, setArmPrefill] = useState<{ mint: string; watchWallet: string } | null>(null);

  useEffect(() => {
    let stop = false;
    api.profile().then((r) => {
      if (stop) return;
      setProfile(r.profile);
      localStorage.setItem("username", r.profile.username);
    }).catch(() => {});
    return () => { stop = true; };
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const setDashTab = useCallback((tab: DashTab, push = true) => {
    setView("dashboard");
    setMenuOpen(false);
    setDashTabState(tab);
    saveChoice(NAV_DASH_TAB_KEY, tab);
    saveChoice(NAV_VIEW_KEY, "dashboard");
    updateRoute({ view: null, tab: tab === "snipes" ? null : tab, socialTab: null, scan: null }, !push);
  }, []);

  const go = useCallback((v: AppView, push = true) => {
    setView(v);
    setMenuOpen(false);
    saveChoice(NAV_VIEW_KEY, v);
    if (v === "dashboard") {
      setDashTabState("snipes");
      saveChoice(NAV_DASH_TAB_KEY, "snipes");
    }
    updateRoute({
      view: v === "dashboard" ? null : v,
      tab: null,
      socialTab: v === "social" ? new URLSearchParams(location.search).get("socialTab") : null,
      scan: v === "claims" ? new URLSearchParams(location.search).get("scan") : null,
    }, !push);
  }, []);

  const [discoveryOverride, setDiscoveryOverride] = useState<boolean | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled;
      if (typeof enabled === "boolean") setDiscoveryOverride(enabled);
    };
    window.addEventListener("claimsnipe:discovery-feature", handler as EventListener);
    return () => window.removeEventListener("claimsnipe:discovery-feature", handler as EventListener);
  }, []);
  useEffect(() => {
    if (discoveryStatus?.enabled != null) setDiscoveryOverride(null);
  }, [discoveryStatus?.enabled]);
  const discoveryOn = discoveryOverride ?? discoveryStatus?.enabled === true;
  const armFromDiscovery = useCallback((coin: DiscoverCoin, redirect: DiscoveryRedirect) => {
    setArmPrefill({ mint: coin.mint, watchWallet: redirect.wallet });
    setDashTab("arm");
    toast(`Ready to arm ${coin.ticker ? "$" + coin.ticker : short(coin.mint)} against ${short(redirect.wallet)}`);
  }, [setDashTab, toast]);

  useEffect(() => {
    if (discoveryStatus && !discoveryStatus.enabled && view === "discovery") {
      go("dashboard", false);
    }
  }, [discoveryStatus?.enabled, view, go]);

  useEffect(() => {
    const pop = () => {
      setView(initialViewFromUrl());
      setDashTabState(initialDashTabFromUrl());
      setMenuOpen(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  // Power-user shortcuts: A = arm, S = snipes, W = wallets, / focuses the CA field.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
      if (e.key === "/") {
        e.preventDefault();
        setDashTab("arm");
        requestAnimationFrame(() => document.getElementById("snipe-mint")?.focus());
      } else if (e.key.toLowerCase() === "a") setDashTab("arm");
      else if (e.key.toLowerCase() === "s") setDashTab("snipes");
      else if (e.key.toLowerCase() === "w") setDashTab("wallets");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, setDashTab]);

  useEffect(() => {
    saveChoice(NAV_VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    saveChoice(NAV_DASH_TAB_KEY, dashTab);
  }, [dashTab]);

  // Unread-chat dot on the Social tab.
  const [chatUnread, setChatUnread] = useState(false);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    let stop = false;
    const check = () => api.socialChatLatest().then((r) => {
      if (stop || !r.latest) return;
      if (viewRef.current === "social") {
        localStorage.setItem("cs.chatSeen", new Date().toISOString());
        return;
      }
      const seen = localStorage.getItem("cs.chatSeen");
      if (!seen || new Date(r.latest) > new Date(seen)) setChatUnread(true);
    }).catch(() => {});
    check();
    const t = setInterval(check, 20000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  useEffect(() => {
    if (view === "social") {
      localStorage.setItem("cs.chatSeen", new Date().toISOString());
      setChatUnread(false);
    }
  }, [view]);

  const activeCount = snipes.filter((s) => s.status === "ARMED" || s.status === "TRIGGERED").length;
  const openCount = snipes.filter((s) => snipeUiState(s).group === "positions").length;
  const totalBalance = totalWalletBalance(wallets);

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <img className="logo-img" src={BRAND_IMG} alt="" />
          <div><b>Claim Sniper</b><span className="brand-status">{activeCount > 0 ? `${activeCount} armed` : "ready"}</span></div>
        </div>
        <div className="top-actions">
          <button
            className={`hamburger ${menuOpen ? "open" : ""}`}
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
            {chatUnread && <span className="nav-dot ham-dot" />}
          </button>
          {menuOpen && (
            <button
              className="nav-backdrop"
              aria-label="Close navigation"
              onClick={() => setMenuOpen(false)}
            />
          )}
          <div className={`who ${menuOpen ? "open" : ""}`}>
            <button className={`nav-btn ${view === "dashboard" ? "on" : ""}`} onClick={() => go("dashboard")}>Sniper</button>
            {discoveryOn && <button className={`nav-btn ${view === "discovery" ? "on" : ""}`} onClick={() => go("discovery")}>Discover</button>}
            <button className={`nav-btn ${view === "history" ? "on" : ""}`} onClick={() => go("history")}>History</button>
            <button className={`nav-btn ${view === "claims" ? "on" : ""}`} onClick={() => go("claims")}>Claim Scanner</button>
            <button className={`nav-btn ${view === "social" ? "on" : ""}`} onClick={() => go("social")}>Social{chatUnread && <span className="nav-dot" />}</button>
            {admin && <button className={`nav-btn admin ${view === "admin" ? "on" : ""}`} onClick={() => go("admin")}>Admin</button>}
          </div>
          <ProfileMenu
            profile={profile}
            openSettings={() => go("settings")}
            openWallets={() => setDashTab("wallets")}
            onLogout={onLogout}
          />
        </div>
      </div>

      {view === "history" ? <History tradingPlatform={profile.tradingPlatform} />
      : view === "discovery" ? <Discovery tradingPlatform={profile.tradingPlatform} onArm={armFromDiscovery} />
      : view === "claims" ? <ClaimScanner wallets={wallets} tradingPlatform={profile.tradingPlatform} />
      : view === "social" ? <Social wallets={wallets} tradingPlatform={profile.tradingPlatform} currentUsername={profile.username} onCopied={() => { refresh(); setDashTab("snipes"); }} />
      : view === "settings" ? <SettingsPage profile={profile} onUpdated={(next) => { setProfile(next); localStorage.setItem("username", next.username); }} />
      : view === "admin" ? <AdminPanel wallets={wallets} />
      : (
        <div className="dash">
          {!data && dashboardError ? (
            <div className="card dashboard-load-error rise">
              <div className="eyebrow">Unable to load dashboard</div>
              <h2>Session or API connection failed</h2>
              <p className="sub">{dashboardError}</p>
              <div className="row-actions">
                <button className="primary" onClick={refresh}>Retry</button>
                <button className="ghost" onClick={onLogout}>Sign in again</button>
              </div>
            </div>
          ) : !data ? <DashboardSkeleton /> : <DashboardOverview active={activeCount} open={openCount} balance={totalBalance} stats={stats} />}
          {pausedSnipes.length > 0 && (
            <div className="global-pause-bar">
              <strong>Snipes paused</strong>
              <span>{pausedSnipes.length} snipe{pausedSnipes.length === 1 ? "" : "s"} will not fire until unpaused.</span>
            </div>
          )}
          {dashTab === "arm" ? (
            <div className="rise d1">
              {data && wallets.length === 0 ? (
                <NoWalletOnboarding onAdd={() => setDashTab("wallets")} />
              ) : (
                <SnipeForm
                  key={armPrefill ? `discovery-${armPrefill.mint}-${armPrefill.watchWallet}` : "arm-default"}
                  wallets={wallets}
                  snipes={snipes}
                  initialMint={armPrefill?.mint}
                  initialWatchWallet={armPrefill?.watchWallet}
                  initialOnlyRedirected={Boolean(armPrefill)}
                  onBack={() => {
                    setArmPrefill(null);
                    setDashTab("snipes");
                  }}
                  onCreated={() => {
                    setArmPrefill(null);
                    refresh();
                    setTimeout(refresh, 6000);
                    setTimeout(refresh, 20000);
                    setTimeout(refresh, 45000);
                    setDashTab("snipes");
                  }}
                />
              )}
            </div>
          ) : dashTab === "wallets" ? (
            <div className="rise d1"><Wallets wallets={wallets} onChange={refresh} /></div>
          ) : (
            <div className="rise d1"><Snipes snipes={snipes} tradingPlatform={profile.tradingPlatform} onArm={() => setDashTab("arm")} onChange={refresh} /></div>
          )}
        </div>
      )}

    </div>
  );
}

function DashboardOverview({ active, open, balance, stats }: { active: number; open: number; balance: number | null; stats: Stats | null }) {
  const net = stats?.netSol ?? 0;
  return <div className="overview-strip rise">
    <div><span>Active snipes</span><strong>{active}</strong></div>
    <div><span>Open positions</span><strong>{open}</strong></div>
    <div><span>Wallet balance</span><strong>{formatSolBalance(balance)} SOL</strong></div>
    <div><span>Realized P&amp;L</span><strong className={net >= 0 ? "green" : "red"}>{net >= 0 ? "+" : ""}{net.toFixed(3)} SOL</strong></div>
  </div>;
}

function DashboardSkeleton() {
  return <div className="overview-strip skeleton-strip" aria-label="Loading dashboard">
    {[0,1,2,3].map((n) => <div key={n}><span className="skeleton-line sm" /><strong className="skeleton-line" /></div>)}
  </div>;
}

function NoWalletOnboarding({ onAdd }: { onAdd: () => void }) {
  return <div className="card onboarding-card">
    <div className="onboarding-icon">▰</div>
    <h1>Add a trading wallet first</h1>
    <p>Claim Sniper needs a funded wallet before a snipe can be armed. Add one, then you’ll come straight back here to configure the trade.</p>
    <button className="primary inline" onClick={onAdd}>Add wallet</button>
  </div>;
}

/* ---------------- profit ---------------- */
function ProfitSection({ stats }: { stats: Stats | null }) {
  const net = stats?.netSol ?? 0;
  return (
    <div className="card">
      <h2>Real profit</h2>
      <div className="stats">
        <Stat
          label="Spent"
          value={`${(stats?.spentSol ?? 0).toFixed(3)} SOL`}
        />
        <Stat
          label="Realized"
          value={`${(stats?.madeSol ?? 0).toFixed(3)} SOL`}
          accent="green"
        />
        <Stat
          label="Net"
          value={`${net >= 0 ? "+" : ""}${net.toFixed(3)} SOL`}
          accent={net >= 0 ? "green" : "red"}
        />
        <Stat label="Days active" value={`${stats?.daysActive ?? 0}`} />
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "red";
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

/* ---------------- wallets ---------------- */
function Wallets({
  wallets,
  onChange,
}: {
  wallets: Wallet[];
  onChange: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [pk, setPk] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  async function add() {
    setErr("");
    setBusy(true);
    try {
      await api.addWallet(name.trim(), pk.trim());
      toast(`Wallet "${name.trim()}" added`);
      setName("");
      setPk("");
      onChange();
    } catch (e: any) {
      setErr(friendlyError(e.message));
    } finally {
      setBusy(false);
    }
  }
  function remove(w: Wallet) {
    if (!confirm(`Remove "${w.name}"? This permanently deletes its encrypted key from Claim Sniper.`)) return;
    setExiting((s) => new Set(s).add(w.id));
    setTimeout(() => api.deleteWallet(w.id).then(onChange).catch((e) => {
      setExiting((set) => { const next = new Set(set); next.delete(w.id); return next; });
      toast(friendlyError(e.message), "err");
    }), 330);
  }
  async function copyAddress(w: Wallet) {
    await navigator.clipboard.writeText(w.publicKey);
    toast(`${w.name} address copied`);
  }

  const total = totalWalletBalance(wallets);

  return (
    <div className="wallet-page-grid">
      <div className="card wallet-list-card">
        <div className="section-heading">
          <div><h2>Trading wallets</h2><p>{wallets.length} connected · {formatSolBalance(total)} SOL total</p></div>
        </div>
        {wallets.length === 0 && <div className="empty">No wallets yet. Add your first wallet using the form.</div>}
        {wallets.map((w) => (
          <div className={`wallet wallet-polished ${exiting.has(w.id) ? "exiting" : ""}`} key={w.id}>
            <div className="wallet-main">
              <div className="wallet-balance">{formatSolBalance(w.balanceSol)} <small>SOL</small></div>
              <div className="name">{w.name}</div>
              <div className="pk">{short(w.publicKey)}</div>
            </div>
            <div className="wallet-actions">
              <button className="ghost" onClick={() => void copyAddress(w)}>Copy address</button>
              <button className="danger" title="Remove wallet" onClick={() => remove(w)}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card wallet-add-card">
        <h2>Add wallet</h2>
        <p className="section-copy">Import a wallet that Claim Sniper can use for automated buys and exits.</p>
        <label>Wallet name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main sniper" />
        <label>Private key</label>
        <input value={pk} onChange={(e) => setPk(e.target.value)} placeholder="base58 or [12,34,…] array" type="password" />
        {err && <div className="err">{err}</div>}
        <button className="primary" onClick={add} disabled={busy || !name || !pk}>{busy ? <span className="spin" /> : "Add wallet"}</button>
        <div className="hint secure-hint">Keys are encrypted with AES-256-GCM and only decrypted in memory when a snipe needs to sign.</div>
      </div>
    </div>
  );
}

/* ---------------- wallet select ---------------- */
function WalletSelect({
  wallets,
  value,
  onChange,
}: {
  wallets: Wallet[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = wallets.find((w) => w.id === value);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = useMemo(
    () =>
      wallets.filter(
        (w) =>
          w.name.toLowerCase().includes(q.toLowerCase()) ||
          w.publicKey.toLowerCase().includes(q.toLowerCase()),
      ),
    [wallets, q],
  );

  return (
    <div className="combo" ref={ref}>
      <input
        value={open ? q : selected ? selected.name : ""}
        placeholder="Search wallets…"
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <div className="menu">
          {filtered.length === 0 && <div className="opt">No matches</div>}
          {filtered.map((w) => (
            <div
              key={w.id}
              className="opt"
              onClick={() => {
                onChange(w.id);
                setOpen(false);
              }}
            >
              <span>{w.name}</span>
              <span className="pk">{formatSolBalance(w.balanceSol)} SOL</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- snipe form ---------------- */
function SnipeForm({
  wallets,
  snipes = [],
  onCreated,
  onBack,
  initialMint,
  initialWatchWallet,
  initialOnlyRedirected,
  mintLocked,
}: {
  wallets: Wallet[];
  snipes?: Snipe[];
  onCreated: () => void;
  onBack: () => void;
  initialMint?: string;
  initialWatchWallet?: string;
  initialOnlyRedirected?: boolean;
  mintLocked?: boolean;
}) {
  const toast = useToast();
  const [mint, setMint] = useState(initialMint ?? "");
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("15");
  const [adaptiveSlippage, setAdaptiveSlippage] = useState(true);
  const [maxSlippage, setMaxSlippage] = useState("30");
  const [maxBuyRetries, setMaxBuyRetries] = useState("2");
  // Priority + bribe default to the last values used (saved locally).
  const [priority, setPriority] = useState(
    () => localStorage.getItem("cs.priority") ?? "0.0005",
  );
  const [bribe, setBribe] = useState(
    () => localStorage.getItem("cs.bribe") ?? "0",
  );
  const [mcMinUsd, setMcMinUsd] = useState("");
  const [mcMaxUsd, setMcMaxUsd] = useState("");
  const [onlyRedirected, setOnlyRedirected] = useState(initialOnlyRedirected ?? false);
  const [watchWallet, setWatchWallet] = useState(initialWatchWallet ?? "");
  const [triggerMode, setTriggerMode] = useState<"CLAIM" | "REDIRECT">("CLAIM");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const ex = useExit();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [activePreset, setActivePreset] = useState<PresetSlot | null>(null);
  const [presetBaseline, setPresetBaseline] = useState<ArmSnipePreset | null>(
    null,
  );
  const [presets, setPresets] = useState<Partial<Record<PresetSlot, ArmSnipePreset>>>(() =>
    readArmPresets(),
  );

  function buildPreset(): ArmSnipePreset {
    return {
      walletId,
      amount,
      slippage,
      adaptiveSlippage,
      maxSlippage,
      maxBuyRetries,
      priority,
      bribe,
      mcMinUsd,
      mcMaxUsd,
      onlyRedirected,
      watchWallet,
      triggerMode,
      exit: ex.snapshot(),
    };
  }

  function applyPreset(preset: ArmSnipePreset) {
    setWalletId(preset.walletId ?? "");
    setAmount(preset.amount ?? "");
    setSlippage(preset.slippage ?? "15");
    setAdaptiveSlippage(preset.adaptiveSlippage ?? true);
    setMaxSlippage(preset.maxSlippage ?? "30");
    setMaxBuyRetries(preset.maxBuyRetries ?? "2");
    setPriority(preset.priority ?? "0.0005");
    setBribe(preset.bribe ?? "0");
    setMcMinUsd(preset.mcMinUsd ?? "");
    setMcMaxUsd(preset.mcMaxUsd ?? "");
    setOnlyRedirected(!!preset.onlyRedirected);
    setWatchWallet(preset.watchWallet ?? "");
    setTriggerMode(preset.triggerMode === "REDIRECT" ? "REDIRECT" : "CLAIM");
    ex.applyPreset(preset.exit);
  }

  function handlePreset(slot: PresetSlot) {
    if (activePreset === slot) {
      const current = buildPreset();
      if (!presetBaseline || presetsEqual(current, presetBaseline)) return;

      const next = writeArmPreset(slot, current);
      setPresets(next);
      setPresetBaseline(current);
      toast(`Preset ${slot} saved`);
      return;
    }

    setActivePreset(slot);
    const preset = presets[slot];
    if (preset) {
      applyPreset(preset);
      setPresetBaseline(preset);
      toast(`Preset ${slot} loaded`);
    } else {
      setPresetBaseline(buildPreset());
      toast(`Preset ${slot} selected. Change options, then press Save.`);
    }
  }

  const activePresetDirty =
    !!activePreset && !!presetBaseline && !presetsEqual(buildPreset(), presetBaseline);

  useEffect(() => {
    if (!walletId && wallets.length === 1) setWalletId(wallets[0].id);
  }, [wallets, walletId]);

  async function arm() {
    setErr("");
    setBusy(true);
    try {
      localStorage.setItem("cs.priority", priority);
      localStorage.setItem("cs.bribe", bribe);
      saveChoice("cs.execMode", "LOCAL");
      await api.createSnipe({
        mint: mint.trim(),
        walletId,
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        adaptiveSlippage,
        maxSlippagePct: adaptiveSlippage ? Number(maxSlippage) : Number(slippage),
        maxBuyRetries: adaptiveSlippage ? Number(maxBuyRetries) : 0,
        priorityFee: Number(priority),
        bribe: Number(bribe),
        mcMinUsd: marketCapInputToNumber(mcMinUsd),
        mcMaxUsd: marketCapInputToNumber(mcMaxUsd),
        execMode: "LOCAL",
        triggerMode,
        onlyRedirected,
        watchWallet: onlyRedirected ? watchWallet.trim() : null,
        exit: ex.build(),
      });
      toast(
        triggerMode === "REDIRECT"
          ? "Snipe armed, watching for the fee redirect"
          : "Snipe armed, watching for the fee claim",
      );
      setMint("");
      if (!activePreset) {
        setAmount("");
        setWatchWallet("");
      }
      onCreated();
    } catch (e: any) {
      setErr(friendlyError(e.message));
    } finally { setBusy(false); }
  }

  const mcMinNumber = marketCapInputToNumber(mcMinUsd);
  const mcMaxNumber = marketCapInputToNumber(mcMaxUsd);
  const mcMinInvalid = mcMinUsd.trim().length > 0 && mcMinNumber == null;
  const mcMaxInvalid = mcMaxUsd.trim().length > 0 && mcMaxNumber == null;
  const mcRangeInvalid = mcMinNumber != null && mcMaxNumber != null && mcMinNumber > mcMaxNumber;
  const mcFilterInvalid = mcMinInvalid || mcMaxInvalid || mcRangeInvalid;
  const baseSlipNumber = Number(slippage);
  const maxSlipNumber = Number(maxSlippage);
  const retryCountNumber = Number(maxBuyRetries);
  const adaptiveInvalid = adaptiveSlippage && (
    !Number.isFinite(maxSlipNumber) ||
    maxSlipNumber < baseSlipNumber ||
    maxSlipNumber > 100 ||
    !Number.isInteger(retryCountNumber) ||
    retryCountNumber < 0 ||
    retryCountNumber > 3
  );
  const duplicateMintSnipes = useMemo(() => {
    const clean = mint.trim();
    if (!clean) return [] as Snipe[];
    return snipes.filter((s) => s.mint === clean && ["ARMED", "PAUSED", "TRIGGERED"].includes(s.status));
  }, [mint, snipes]);

  const selectedWallet = wallets.find((w) => w.id === walletId);
  const ready = !!mint.trim() && !!walletId && Number(amount) > 0 && Number(slippage) > 0 && !mcFilterInvalid && !adaptiveInvalid && (!onlyRedirected || watchWallet.trim().length >= 32);
  const fees = Math.max(0, Number(priority) || 0) + Math.max(0, Number(bribe) || 0);
  const needed = Math.max(0, Number(amount) || 0) + fees;
  const insufficient = !!selectedWallet && selectedWallet.balanceSol != null && needed > 0 && selectedWallet.balanceSol < needed;
  const triggerSummary = triggerMode === "REDIRECT"
    ? onlyRedirected ? `when fees are redirected to ${watchWallet ? short(watchWallet) : "the selected wallet"}` : "when the creator fee recipient changes"
    : onlyRedirected ? `when ${watchWallet ? short(watchWallet) : "the selected wallet"} claims creator fees` : "when creator fees are claimed";
  const tpSummary = ex.tpOn ? (ex.tpTrail ? `Trailing TP from ${ex.takeProfits[0]?.multiplier || "?"}×` : ex.takeProfits.map((tp) => `${tp.sellPct || "?"}% at ${tp.multiplier || "?"}×`).join(" · ")) : "Off";
  const slSummary = ex.slOn ? (ex.slTrail ? `Trail -${ex.slTrailPct || "?"}%` : `-${ex.slPct || "?"}%`) : "Off";
  const mcSummary = mcMinNumber != null || mcMaxNumber != null
    ? mcMinNumber != null && mcMaxNumber != null
      ? `$${compactNumber.format(mcMinNumber)} – $${compactNumber.format(mcMaxNumber)}`
      : mcMinNumber != null ? `≥ $${compactNumber.format(mcMinNumber)}` : `≤ $${compactNumber.format(mcMaxNumber!)}`
    : "Off";

  return (
    <div className="arm-layout">
      <div className="card arm-card">
        <div className="section-heading form-head">
          <div><h2>Arm a snipe</h2><p>Set the coin, funding wallet and exact event that should trigger the buy.</p></div>
          <div className="form-head-actions">
            <button type="button" className="ghost arm-back-btn" onClick={onBack}>← Snipes</button>
            <div className="preset-actions" aria-label="Snipe presets">
              {(["1", "2", "3"] as PresetSlot[]).map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className={`preset-btn ${activePreset === slot ? "on" : ""} ${activePreset === slot && activePresetDirty ? "dirty" : ""} ${presets[slot] ? "saved" : ""}`}
                  onClick={() => handlePreset(slot)}
                  title={activePreset === slot ? (activePresetDirty ? `Save current options to preset ${slot}` : `Preset ${slot} is selected`) : (presets[slot] ? `Load preset ${slot}` : `Select preset ${slot}`)}
                >
                  {activePreset === slot && activePresetDirty ? "Save" : `Preset ${slot}`}
                </button>
              ))}
            </div>
            <span className="shortcut-hint">Press / to focus CA</span>
          </div>
        </div>

        <div className="form-step"><span>1</span><strong>Trade</strong></div>
        <label>Coin CA (mint)</label>
        <input id="snipe-mint" value={mint} onChange={(e) => setMint(e.target.value)} placeholder="pump.fun mint address" readOnly={mintLocked} />
        {duplicateMintSnipes.length > 0 && (
          <div className="duplicate-mint-warning">
            <strong>Duplicate mint warning</strong>
            <span>You already have {duplicateMintSnipes.length} active snipe{duplicateMintSnipes.length === 1 ? "" : "s"} on this CA.</span>
          </div>
        )}
        <label>Buy with wallet</label>
        <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
        <label>Amount (SOL)</label>
        <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0.5" />
        {selectedWallet && <div className={`field-balance ${insufficient ? "bad" : ""}`}>{selectedWallet.name}: {formatSolBalance(selectedWallet.balanceSol)} SOL available</div>}

        <div className="form-step"><span>2</span><strong>Trigger</strong></div>
        <TriggerModeSelect value={triggerMode} onChange={setTriggerMode} />
        <div className="trigger-explain processed-detection">
          <strong>Processed · exact signer</strong>
          <span>Prepares immediately, then buys only when this coin and the configured signing wallet both match.</span>
        </div>
        <div className="trigger-explain">
          <strong>{triggerMode === "REDIRECT" ? "Fee Redirect" : "Fee Claim"}</strong>
          <span>{triggerMode === "REDIRECT" ? "Buy when the creator fee recipient changes." : "Buy the moment this coin's creator fees are claimed."}</span>
        </div>
        <label className="switch-row" onClick={() => setOnlyRedirected((v) => !v)}>
          <span className={`switch ${onlyRedirected ? "on" : ""}`}><span className="knob" /></span>
          {triggerMode === "REDIRECT" ? "Only if redirected to a specific wallet" : "Only when a specific wallet claims"}
        </label>
        {onlyRedirected && <div className="tp-fields compact-fields">
          <label>{triggerMode === "REDIRECT" ? "Target fee wallet" : "Claimer wallet"}</label>
          <input value={watchWallet} onChange={(e) => setWatchWallet(e.target.value)} placeholder="Solana wallet address" />
          <div className="hint">{triggerMode === "REDIRECT" ? "The buy fires only when the fee owner becomes this exact wallet." : "Claims from other wallets are ignored."}</div>
        </div>}

        <button type="button" className={`disclosure ${advancedOpen ? "open" : ""}`} onClick={() => setAdvancedOpen((v) => !v)}>
          <span><strong>Advanced execution</strong><small>Adaptive slippage, priority and execution provider</small></span><b>⌄</b>
        </button>
        {advancedOpen && <div className="disclosure-body">
          <div className="row">
            <div><label>Slippage % <InfoTip text="Maximum price movement allowed while the buy is executing." /></label><input value={slippage} onChange={(e) => setSlippage(e.target.value)} /></div>
            <div><label>Priority fee (SOL) <InfoTip text="Extra network priority fee used to improve inclusion speed." /></label><input value={priority} onChange={(e) => setPriority(e.target.value)} /></div>
          </div>
          <div className="adaptive-slip-box">
            <label className="switch-row" onClick={() => setAdaptiveSlippage((v) => !v)}>
              <span className={`switch ${adaptiveSlippage ? "on" : ""}`}><span className="knob" /></span>
              <span><strong>Adaptive slippage recovery</strong><small>Rebuild and retry only confirmed price/slippage failures.</small></span>
            </label>
            {adaptiveSlippage && (
              <>
                <div className="row">
                  <div><label>Maximum slippage % <InfoTip text="Hard ceiling. ClaimSniper will never retry above this tolerance." /></label><input value={maxSlippage} inputMode="decimal" onChange={(e) => setMaxSlippage(e.target.value)} /></div>
                  <div><label>Retry attempts <InfoTip text="Extra attempts after the first. Every retry uses a fresh quote, blockhash and transaction." /></label><input value={maxBuyRetries} inputMode="numeric" onChange={(e) => setMaxBuyRetries(e.target.value)} /></div>
                </div>
                <div className={`hint ${adaptiveInvalid ? "err-text" : ""}`}>
                  {adaptiveInvalid ? "Maximum slippage must be at least the base slippage (max 100%), with 0–3 retries." : `Starts at ${Number(slippage) || 0}% and can step up to ${Number(maxSlippage) || 0}% only after a confirmed slippage revert.`}
                </div>
              </>
            )}
          </div>
          <label>Landing tip / extra priority (SOL) <InfoTip text="For direct local execution this can be sent as a real Helius Sender landing tip when Sender is enabled. Otherwise it remains additional compute priority. Keep it low." /></label>
          <input value={bribe} onChange={(e) => setBribe(e.target.value)} />
          <div className="market-filter-box compact">
            <div className="market-filter-head"><strong>Market cap filter</strong><span>Optional</span></div>
            <div className="row">
              <div><label>Min MC $ <InfoTip text="Block the buy if live USD market cap is below this value." /></label><input value={mcMinUsd} onChange={(e) => setMcMinUsd(e.target.value)} placeholder="5000" /></div>
              <div><label>Max MC $ <InfoTip text="Block the buy if live USD market cap is above this value." /></label><input value={mcMaxUsd} onChange={(e) => setMcMaxUsd(e.target.value)} placeholder="25000" /></div>
            </div>
            <div className={`hint ${mcFilterInvalid ? "err-text" : ""}`}>
              {mcMinInvalid || mcMaxInvalid ? "Enter valid numbers for the market-cap filter." : mcRangeInvalid ? "Minimum MC cannot be higher than maximum MC." : "Checked before the first buy and again before every adaptive retry, so the sniper never chases above your Max MC."}
            </div>
          </div>
        </div>}

        <button type="button" className={`disclosure ${exitOpen ? "open" : ""}`} onClick={() => setExitOpen((v) => !v)}>
          <span><strong>Exit strategy</strong><small>{ex.tpOn || ex.slOn ? `${ex.tpOn ? "TP on" : "TP off"} · ${ex.slOn ? "SL on" : "SL off"}` : "Optional take profit and stop loss"}</small></span><b>⌄</b>
        </button>
        {exitOpen && <div className="disclosure-body exit-disclosure"><ExitFields ex={ex} /></div>}

        {err && <div className="err actionable-error"><strong>Couldn't arm snipe</strong><span>{err}</span></div>}
      </div>

      <aside className="snipe-summary card">
        <div className="summary-kicker">Snipe summary</div>
        <h3>{mint.trim() ? short(mint.trim()) : "New snipe"}</h3>
        <div className="summary-line"><span>Buy</span><strong>{Number(amount) > 0 ? `${amount} SOL` : "Not set"}</strong></div>
        <div className="summary-line"><span>Wallet</span><strong>{selectedWallet?.name ?? "Not selected"}</strong></div>
        <div className="summary-block"><span>Trigger</span><p>{triggerSummary}</p></div>
        <div className="summary-line"><span>Take profit</span><strong>{tpSummary}</strong></div>
        <div className="summary-line"><span>Stop loss</span><strong>{slSummary}</strong></div>
        <div className="summary-line"><span>Detection</span><strong>Processed · exact signer</strong></div>
        <div className="summary-line"><span>Execution</span><strong>Local</strong></div>
        <div className="summary-line"><span>Slippage</span><strong>{adaptiveSlippage ? `${slippage}% → max ${maxSlippage}% · ${maxBuyRetries} retries` : `${slippage}% fixed`}</strong></div>
        <div className="summary-line"><span>Market cap</span><strong>{mcSummary}</strong></div>
        <div className="summary-cost"><span>Configured buy + priority</span><strong>≈ {needed.toFixed(4)} SOL</strong></div>
        {insufficient && <div className="summary-warning">Selected wallet may not have enough SOL for this configuration.</div>}
        <button className="primary" onClick={arm} disabled={busy || !ready || insufficient}>{busy ? <span className="spin" /> : "Arm snipe"}</button>
        <p className="summary-foot">The buy is submitted immediately after the configured trigger is detected.</p>
      </aside>
    </div>
  );
}

/* ---------------- take-profit modal ---------------- */
function EditSnipeModal({
  snipe,
  onClose,
  onChange,
}: {
  snipe: Snipe;
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const armed = snipe.status === "ARMED";
  const editableLiveConfig = snipe.status === "ARMED" || snipe.status === "PAUSED";
  const [amount, setAmount] = useState(String(snipe.amountSol));
  const [slippage, setSlippage] = useState(String(snipe.slippagePct));
  const [adaptiveSlippage, setAdaptiveSlippage] = useState(snipe.adaptiveSlippage !== false);
  const [maxSlippage, setMaxSlippage] = useState(String(snipe.maxSlippagePct ?? Math.max(30, snipe.slippagePct)));
  const [maxBuyRetries, setMaxBuyRetries] = useState(String(snipe.maxBuyRetries ?? 2));
  const [priority, setPriority] = useState(String(snipe.priorityFee));
  const [bribe, setBribe] = useState(String(snipe.bribe));
  const [mcMinUsd, setMcMinUsd] = useState(snipe.mcMinUsd == null ? "" : String(snipe.mcMinUsd));
  const [mcMaxUsd, setMcMaxUsd] = useState(snipe.mcMaxUsd == null ? "" : String(snipe.mcMaxUsd));
  const [redir, setRedir] = useState(snipe.onlyRedirected);
  const [watchWallet, setWatchWallet] = useState(snipe.watchWallet ?? "");
  const [triggerMode, setTriggerMode] = useState<"CLAIM" | "REDIRECT">(
    snipe.triggerMode === "REDIRECT" ? "REDIRECT" : "CLAIM",
  );
  const ex = useExit(snipe);
  const [busy, setBusy] = useState(false);

  const mcMinNumber = marketCapInputToNumber(mcMinUsd);
  const mcMaxNumber = marketCapInputToNumber(mcMaxUsd);
  const mcMinInvalid = mcMinUsd.trim().length > 0 && mcMinNumber == null;
  const mcMaxInvalid = mcMaxUsd.trim().length > 0 && mcMaxNumber == null;
  const mcRangeInvalid =
    mcMinNumber != null && mcMaxNumber != null && mcMinNumber > mcMaxNumber;
  const mcFilterInvalid = mcMinInvalid || mcMaxInvalid || mcRangeInvalid;
  const maxSlipNumber = Number(maxSlippage);
  const retryCountNumber = Number(maxBuyRetries);
  const adaptiveInvalid = adaptiveSlippage && (
    !Number.isFinite(maxSlipNumber) ||
    maxSlipNumber < Number(slippage) ||
    maxSlipNumber > 100 ||
    !Number.isInteger(retryCountNumber) || retryCountNumber < 0 || retryCountNumber > 3
  );
  const ready =
    Number(amount) > 0 && Number(slippage) > 0 && !mcFilterInvalid && !adaptiveInvalid && (!redir || watchWallet.trim().length >= 32);

  async function save() {
    setBusy(true);
    try {
      await api.editSnipe(snipe.id, {
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        adaptiveSlippage,
        maxSlippagePct: adaptiveSlippage ? Number(maxSlippage) : Number(slippage),
        maxBuyRetries: adaptiveSlippage ? Number(maxBuyRetries) : 0,
        priorityFee: Number(priority),
        bribe: Number(bribe),
        mcMinUsd: marketCapInputToNumber(mcMinUsd),
        mcMaxUsd: marketCapInputToNumber(mcMaxUsd),
        onlyRedirected: redir,
        watchWallet: redir ? watchWallet.trim() : null,
        execMode: "LOCAL",
        triggerMode,
        exit: ex.build(),
      });
      toast(armed ? "Snipe updated & re-armed" : snipe.status === "PAUSED" ? "Paused snipe updated" : "Snipe updated");
      onChange();
      onClose();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Edit {snipe.ticker ? `$${snipe.ticker}` : "snipe"}</h3>
        <p className="modal-sub">
          {short(snipe.mint)} · {snipe.status.toLowerCase()}
        </p>

        {editableLiveConfig ? (
          <>
            <div className="row">
              <div>
                <label>Amount (SOL)</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label>Slippage %</label>
                <input
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                />
              </div>
            </div>
            <div className="adaptive-slip-box modal-adaptive">
              <label className="switch-row" onClick={() => setAdaptiveSlippage((v) => !v)}>
                <span className={`switch ${adaptiveSlippage ? "on" : ""}`}><span className="knob" /></span>
                <span><strong>Adaptive slippage recovery</strong><small>Retry confirmed slippage failures with a fresh transaction.</small></span>
              </label>
              {adaptiveSlippage && <div className="row">
                <div><label>Maximum slippage %</label><input value={maxSlippage} onChange={(e) => setMaxSlippage(e.target.value)} /></div>
                <div><label>Retry attempts</label><input value={maxBuyRetries} onChange={(e) => setMaxBuyRetries(e.target.value)} /></div>
              </div>}
              {adaptiveInvalid && <div className="hint err-text">Max slippage must be ≥ base slippage, with 0–3 retries.</div>}
            </div>
            <div className="row">
              <div>
                <label>Priority (SOL)</label>
                <input
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </div>
              <div>
                <label>Landing tip (SOL)</label>
                <input
                  value={bribe}
                  onChange={(e) => setBribe(e.target.value)}
                />
              </div>
            </div>
            <div className="market-filter-box compact">
              <div className="market-filter-head">
                <strong>Market cap filter</strong>
                <span>Optional</span>
              </div>
              <div className="row">
                <div>
                  <label>Min MC $</label>
                  <input
                    value={mcMinUsd}
                    onChange={(e) => setMcMinUsd(e.target.value)}
                    placeholder="5000"
                  />
                </div>
                <div>
                  <label>Max MC $</label>
                  <input
                    value={mcMaxUsd}
                    onChange={(e) => setMcMaxUsd(e.target.value)}
                    placeholder="25000"
                  />
                </div>
              </div>
              {mcFilterInvalid && (
                <div className="hint err-text">
                  {mcMinInvalid || mcMaxInvalid
                    ? "Enter valid numbers for the MC filter."
                    : "Minimum MC cannot be higher than maximum MC."}
                </div>
              )}
            </div>

            <TriggerModeSelect value={triggerMode} onChange={setTriggerMode} />
            <div className="trigger-explain processed-detection">
              <strong>Processed · exact signer</strong>
              <span>Detection is fixed to the lowest-latency strict wallet-and-coin match.</span>
            </div>
            <label className="switch-row" onClick={() => setRedir((v) => !v)}>
              <span className={`switch ${redir ? "on" : ""}`}>
                <span className="knob" />
              </span>
              {triggerMode === "REDIRECT"
                ? "Only a specific wallet"
                : "Only a specific wallet's claims"}
            </label>
            {redir ? (
              <div className="tp-fields">
                <label>
                  {triggerMode === "REDIRECT"
                    ? "Wallet fees get redirected to"
                    : "Wallet to watch"}
                </label>
                <input
                  value={watchWallet}
                  onChange={(e) => setWatchWallet(e.target.value)}
                  placeholder={
                    triggerMode === "REDIRECT"
                      ? "any wallet address"
                      : "claimer wallet address"
                  }
                />
              </div>
            ) : triggerMode === "REDIRECT" ? (
              <div className="hint">
                Fires when this coin's fee owner is changed to any new wallet.
              </div>
            ) : null}
          </>
        ) : (
          <p className="modal-sub" style={{ marginTop: -4 }}>
            This snipe already filled. Only the exit strategy can be changed.
          </p>
        )}

        <ExitFields ex={ex} />

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="primary inline"
            onClick={save}
            disabled={busy || !ready}
          >
            {busy ? <span className="spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- snipes ---------------- */
function Snipes({
  snipes,
  tradingPlatform,
  onArm,
  onChange,
}: {
  snipes: Snipe[];
  tradingPlatform: TradingPlatform;
  onArm: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Snipe | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [discardBusy, setDiscardBusy] = useState<Set<string>>(new Set());
  const armedCount = snipes.filter((s) => s.status === "ARMED").length;
  const pausedCount = snipes.filter((s) => s.status === "PAUSED").length;
  const canTogglePause = armedCount > 0 || pausedCount > 0;
  const pauseMode: "pause" | "unpause" = armedCount > 0 ? "pause" : "unpause";
  const previousMarketCaps = useRef<Record<string, number>>({});
  const [marketCapChanges, setMarketCapChanges] = useState<Record<string, { delta: number; pct: number }>>({});

  useEffect(() => {
    setMarketCapChanges((current) => {
      let changed = false;
      const next = { ...current };
      const seen = new Set<string>();

      for (const s of snipes) {
        seen.add(s.id);
        const value = s.liveMarketCapUsd;
        if (value == null || !Number.isFinite(value)) continue;
        const previous = previousMarketCaps.current[s.id];
        if (previous != null && previous > 0 && previous !== value) {
          next[s.id] = {
            delta: value - previous,
            pct: ((value - previous) / previous) * 100,
          };
          changed = true;
        }
        previousMarketCaps.current[s.id] = value;
      }

      for (const id of Object.keys(next)) {
        if (!seen.has(id)) {
          delete next[id];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [snipes]);

  async function togglePauseAll() {
    if (!canTogglePause || pauseBusy) return;
    setPauseBusy(true);
    try {
      if (pauseMode === "pause") {
        const res = await api.pauseAllSnipes();
        toast(
          `Paused ${res.paused} active snipe${res.paused === 1 ? "" : "s"}`,
        );
      } else {
        const res = await api.unpauseAllSnipes();
        toast(
          `Unpaused ${res.unpaused} snipe${res.unpaused === 1 ? "" : "s"}`,
        );
      }
      onChange();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setPauseBusy(false);
    }
  }

  const [pauseOneBusy, setPauseOneBusy] = useState<Set<string>>(new Set());

  const [details, setDetails] = useState<Set<string>>(new Set());

  async function disarm(snipe: Snipe) {
    if (snipe.status !== "ARMED" && snipe.status !== "PAUSED") return;
    setDiscardBusy((current) => new Set(current).add(snipe.id));
    try {
      await api.cancelSnipe(snipe.id);
      toast("Snipe disarmed");
      onChange();
    } catch (e: any) {
      toast(friendlyError(e.message), "err");
      onChange();
    } finally {
      setDiscardBusy((current) => {
        const next = new Set(current);
        next.delete(snipe.id);
        return next;
      });
    }
  }

  async function discard(snipe: Snipe) {
    const ui = snipeUiState(snipe);
    if (ui.group === "active" || discardBusy.has(snipe.id)) return;
    if (snipe.tpStatus === "SELLING") {
      toast("This position is selling and cannot be discarded yet.", "err");
      return;
    }

    const isOpenPosition = ui.group === "positions";
    if (isOpenPosition && !confirm("Discard this open position? This cancels its TP and SL. Your tokens stay in the wallet and the trade remains in History.")) return;

    setDiscardBusy((current) => new Set(current).add(snipe.id));
    try {
      if (isOpenPosition && snipe.tpStatus !== "CANCELLED") {
        await api.cancelExit(snipe.id);
      }
      await api.discardSnipe(snipe.id);
      setExiting((current) => new Set(current).add(snipe.id));
      toast(isOpenPosition ? "Position discarded and TP/SL cancelled" : "Snipe discarded");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
      onChange();
    } catch (e: any) {
      toast(friendlyError(e.message), "err");
      onChange();
    } finally {
      setDiscardBusy((current) => {
        const next = new Set(current);
        next.delete(snipe.id);
        return next;
      });
    }
  }

  async function toggleOnePause(snipe: Snipe) {
    if (snipe.status !== "ARMED" && snipe.status !== "PAUSED") return;
    setPauseOneBusy((current) => new Set(current).add(snipe.id));
    try {
      if (snipe.status === "ARMED") {
        await api.pauseSnipe(snipe.id);
        toast("Snipe paused");
      } else {
        await api.unpauseSnipe(snipe.id);
        toast("Snipe unpaused");
      }
      onChange();
    } catch (e: any) {
      toast(friendlyError(e.message), "err");
      onChange();
    } finally {
      setPauseOneBusy((current) => {
        const next = new Set(current);
        next.delete(snipe.id);
        return next;
      });
    }
  }

  return (
    <div className="card snipes-card">
      <div className="section-heading snipes-top">
        <div><h2>Snipes</h2><p>Monitor what the bot is watching, buying and managing.</p></div>
        <div className="snipes-head-actions">
          <button className="arm-plus-btn" onClick={onArm} title="Arm a new snipe" aria-label="Arm a new snipe">
            <span aria-hidden="true">+</span><b>New snipe</b>
          </button>
          <button
            className="pause-all-btn"
            onClick={togglePauseAll}
            disabled={!canTogglePause || pauseBusy}
            title={pauseMode === "pause" ? "Pause every armed snipe so they do not fire" : "Unpause every paused snipe and arm them again"}
          >
            {pauseBusy ? <span className="spin" /> : <><span className="pause-icon" aria-hidden="true"><AppIcon name={pauseMode === "pause" ? "pause" : "play"} /></span>{pauseMode === "pause" ? "Pause All" : "Unpause All"}</>}
          </button>
        </div>
      </div>

      {snipes.length === 0 && <div className="empty filter-empty">No snipes yet. Press + to arm one with a coin CA, wallet and SOL amount.</div>}

      {snipes.map((s) => {
        const ui = snipeUiState(s);
        const open = details.has(s.id);
        return <div className={`snipe snipe-clean ${ui.tone} snipe-status-${ui.glow} ${exiting.has(s.id) ? "exiting" : ""}`} key={s.id}>
          <div className="head">
            <div className="snipe-title-block">
              <span className="ticker">{s.ticker ? `$${s.ticker}` : short(s.mint)}</span>
              <span className={`mode-tag ${s.triggerMode === "REDIRECT" ? "mode-redirect" : "mode-claim"}`}>{s.triggerMode === "REDIRECT" ? "Fee redirect" : "Fee claim"}</span>
              {s.copySourceSnipeId && <span className="mode-tag mode-copy">Copy · @{s.copyLeaderUsername ?? "trader"}</span>}
            </div>
            <div className="snipe-status-cluster">
              <span className={`market-cap-value ${s.liveMarketCapUsd == null ? "loading" : ""}`} title={s.liveMarketCapUpdatedAt ? `Market cap updated ${new Date(s.liveMarketCapUpdatedAt).toLocaleTimeString()} from ${s.liveMarketCapSource ?? "live feed"}` : "Waiting for live Pump market-cap update"}>
                <span className="market-cap-label">Market Cap</span>
                <span>{snipeMarketCapLabel(s)}</span>
                {marketCapChanges[s.id] && <b className={`mc-change ${marketCapChanges[s.id].delta >= 0 ? "up" : "down"}`}>{marketCapChanges[s.id].delta >= 0 ? "▲" : "▼"} {Math.abs(marketCapChanges[s.id].pct).toFixed(1)}%</b>}
              </span>
              <span className={`badge ${ui.tone}`}>{ui.tone === "ARMED" && <span className="dot" />}{ui.label}</span>
            </div>
          </div>

          <div className="snipe-core">
            <div><span>Amount</span><strong>{s.amountSol} SOL</strong></div>
            <div><span>Wallet</span><strong>{s.wallet.name}</strong></div>
            <div><span>Exit</span><strong>{s.tpEnabled || s.slEnabled ? `${s.tpEnabled ? "TP" : ""}${s.tpEnabled && s.slEnabled ? " + " : ""}${s.slEnabled ? "SL" : ""}` : "Manual"}</strong></div>
          </div>

          {(s.tpEnabled || s.slEnabled || s.watchWallet || marketCapFilterLabel(s)) && <div className="exit-chips">
            {s.watchWallet && <span>{s.triggerMode === "REDIRECT" ? "Target" : "Watch"} {short(s.watchWallet)}</span>}
            {marketCapFilterLabel(s) && <span>{marketCapFilterLabel(s)}</span>}
            {s.tpEnabled && s.tpStatus !== "CANCELLED" && takeProfitLabel(s).map((label) => <span key={label}>{label}</span>)}
            {s.slEnabled && s.tpStatus !== "CANCELLED" && <span>SL {s.slTrailing ? `trail -${s.slTrailPct}%` : `-${s.slPct}%`}</span>}
          </div>}

          {s.claimCheckStatus === "CLAIMED" && <div className="claim-warning">
            <strong>Already claimed</strong>
            <span>This wallet already claimed fees for this CA{s.claimCheckClaimedAt ? ` on ${new Date(s.claimCheckClaimedAt).toLocaleString()}` : ""}.</span>
            {s.claimCheckWallet && <code>{short(s.claimCheckWallet)}</code>}
            {s.claimCheckTx && <a href={`https://solscan.io/tx/${s.claimCheckTx}`} target="_blank" rel="noreferrer">View claim ↗</a>}
          </div>}
          {s.claimCheckStatus === "CHECKING" && <div className="claim-checking">Checking this wallet&apos;s previous transactions for old claims…</div>}
          {s.claimCheckStatus === "FAILED" && s.claimCheckError && <div className="claim-checking err-text">Claim-history check failed: {s.claimCheckError}</div>}
          {s.error && <div className={s.status === "FAILED" ? "failed-reason" : "inline-snipe-error"}>{s.status === "FAILED" && <strong>Failed reason</strong>}<span>{friendlyError(s.error)}</span></div>}

          {open && <div className="snipe-details">
            <div><span>CA</span><CopyCA mint={s.mint} ticker={s.ticker} className="mint-sub" /></div>
            <div><span>Slippage</span><strong>{s.adaptiveSlippage !== false ? `${s.slippagePct}% → max ${s.maxSlippagePct ?? s.slippagePct}%` : `${s.slippagePct}% fixed`}</strong></div>
            {s.adaptiveSlippage !== false && <div><span>Slippage recovery</span><strong>{s.maxBuyRetries ?? 2} retries{s.buyAttempts && s.buyAttempts > 1 ? ` · used ${s.buyAttempts}` : ""}</strong></div>}
            {s.finalSlippagePct != null && s.buyAttempts && s.buyAttempts > 1 && <div><span>Last attempt</span><strong>{s.finalSlippagePct}% slippage</strong></div>}
            <div><span>Priority</span><strong>{s.priorityFee} SOL</strong></div>
            <div><span>Extra priority</span><strong>{s.bribe} SOL</strong></div>
            <div><span>Execution</span><strong>Local</strong></div>
            <div><span>Detection</span><strong>Processed · exact signer</strong></div>
            {s.claimCheckInstruction && <div><span>Claim check</span><strong>{s.claimCheckInstruction}</strong></div>}
            {s.signature && <div><span>Entry transaction</span><a href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">Solscan ↗</a></div>}
          </div>}

          <div className="snipe-actions clean-actions">
            <button className="ghost" onClick={() => setDetails((set) => { const next = new Set(set); next.has(s.id) ? next.delete(s.id) : next.add(s.id); return next; })}>{open ? "Hide details" : "Details"}</button>
            <button className="ghost" onClick={() => void openInTradingPlatform(tradingPlatform, s, toast)}>Open ↗</button>
            {s.copySourceSnipeId ? <button className="ghost" disabled title="Managed by Copy Trading">Managed</button> : <button className="ghost" onClick={() => setEdit(s)}>Edit</button>}
            {s.status === "FILLED" && s.tpStatus === "PENDING" && (s.tpEnabled || s.slEnabled) && <button className="warning-btn" onClick={() => api.cancelExit(s.id).then(onChange).catch((e) => toast(friendlyError(e.message), "err"))}>Cancel TP/SL</button>}
            {(s.status === "ARMED" || s.status === "PAUSED") && <button className="snipe-pause-one" onClick={() => toggleOnePause(s)} disabled={pauseOneBusy.has(s.id)} title={s.status === "ARMED" ? "Pause this snipe" : "Unpause this snipe"} aria-label={s.status === "ARMED" ? "Pause this snipe" : "Unpause this snipe"}>{pauseOneBusy.has(s.id) ? <span className="spin" /> : <AppIcon name={s.status === "ARMED" ? "pause" : "play"} />}</button>}
            {(s.status === "ARMED" || s.status === "PAUSED") ? <button className="warning-btn" onClick={() => void disarm(s)} disabled={discardBusy.has(s.id)}>{discardBusy.has(s.id) ? <span className="spin" /> : "Disarm"}</button> : s.status === "TRIGGERED" ? <button className="warning-btn" disabled>Buying…</button> : <button className="danger" onClick={() => void discard(s)} disabled={discardBusy.has(s.id) || s.tpStatus === "SELLING"}>{discardBusy.has(s.id) ? <span className="spin" /> : s.tpStatus === "SELLING" ? "Exit selling…" : "Discard"}</button>}
          </div>
        </div>;
      })}
      {edit && <EditSnipeModal snipe={edit} onClose={() => setEdit(null)} onChange={onChange} />}
    </div>
  );
}

/* ---------------- notification sound ---------------- */
const ALERT_SOUND_KEY = "cs.alertSoundEnabled";
let _audioCtx: AudioContext | null = null;
let _snipeAudio: HTMLAudioElement | null = null;

function alertSoundEnabled() {
  try {
    return localStorage.getItem(ALERT_SOUND_KEY) === "true";
  } catch {
    return false;
  }
}

function setAlertSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ALERT_SOUND_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore storage errors */
  }
}

function ensureSnipeAudio(): HTMLAudioElement | null {
  try {
    if (typeof Audio === "undefined") return null;
    _snipeAudio = _snipeAudio || new Audio(SNIPE_SOUND);
    _snipeAudio.preload = "auto";
    _snipeAudio.volume = 0.85;
    return _snipeAudio;
  } catch {
    return null;
  }
}

function ensureCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = _audioCtx || new Ctx();
    if (_audioCtx.state === "suspended") void _audioCtx.resume();
    return _audioCtx;
  } catch {
    return null;
  }
}

async function resumeAudioContext() {
  const ctx = ensureCtx();
  if (!ctx) throw new Error("This browser does not support alert sounds.");
  if (ctx.state === "suspended") await ctx.resume();
  if (ctx.state !== "running")
    throw new Error("Browser blocked sound. Click Enable alert sounds again.");
  return ctx;
}

// Browsers block audio until the user interacts with the page. Call this once
// from a real user gesture so later buy/fail chimes are allowed to play.
export function unlockAudio() {
  ensureCtx();
  ensureSnipeAudio()?.load();
}

async function enableAlertSound() {
  await resumeAudioContext();
  setAlertSoundEnabled(true);
  await playSnipeSound(true);
}

function disableAlertSound() {
  setAlertSoundEnabled(false);
}

async function playSnipeSound(force = false) {
  if (!force && !alertSoundEnabled()) return;
  try {
    const audio = ensureSnipeAudio();
    if (!audio) throw new Error("no audio element");
    audio.currentTime = 0;
    await audio.play();
  } catch {
    playTone("fill", true);
  }
}

function playTone(kind: "fill" | "fail", force = false) {
  if (!force && !alertSoundEnabled()) return;
  try {
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + 0.01;
    // Fill fallback = rising bright two-note; fail = descending low two-note.
    const notes = kind === "fill" ? [660, 990] : [300, 160];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const t = now + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  } catch {
    /* audio unavailable — ignore */
  }
}

function playChime(kind: "fill" | "fail", force = false) {
  if (!force && !alertSoundEnabled()) return;
  if (kind === "fill") {
    void playSnipeSound(force);
    return;
  }
  playTone("fail", force);
}


/* ---------------- Pump fee-sharing claim scanner (read-only) ---------------- */
function ClaimScanner({ wallets, tradingPlatform }: { wallets: Wallet[]; tradingPlatform: TradingPlatform }) {
  const toast = useToast();
  const initial = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("scan") ?? "" : "";
  const [address, setAddress] = useState(initial);
  const [result, setResult] = useState<ClaimScannerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"claimable" | "share" | "name">("claimable");
  const [onlyClaimable, setOnlyClaimable] = useState(false);
  const [visible, setVisible] = useState(25);
  const requestSeq = useRef(0);
  const scannedInitial = useRef(false);

  const scan = useCallback(async (value?: string, pushRoute = true) => {
    const wallet = (value ?? address).trim();
    if (!wallet) {
      setError("Enter a Solana wallet address to scan.");
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");
    setResult(null);
    setVisible(25);
    setFilter("");
    if (pushRoute) updateRoute({ view: "claims", scan: wallet, tab: null, socialTab: null });
    try {
      const data = await api.claimScanner(wallet);
      if (requestSeq.current !== seq) return;
      setAddress(data.wallet);
      setResult(data);
    } catch (e: any) {
      if (requestSeq.current !== seq) return;
      setError(friendlyError(e?.message ?? "Scan failed"));
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (scannedInitial.current || !initial) return;
    scannedInitial.current = true;
    void scan(initial, false);
  }, [initial, scan]);

  useEffect(() => {
    const pop = () => {
      const next = new URLSearchParams(window.location.search).get("scan") ?? "";
      if (next && next !== address) {
        setAddress(next);
        void scan(next, false);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [address, scan]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let next = result?.coins.filter((coin) => {
      if (onlyClaimable && coin.claimableSol <= 0) return false;
      if (!q) return true;
      return [coin.symbol, coin.name, coin.mint].some((v) => v?.toLowerCase().includes(q));
    }) ?? [];
    next = [...next];
    if (sort === "share") next.sort((a, b) => b.sharePct - a.sharePct || b.claimableSol - a.claimableSol);
    else if (sort === "name") next.sort((a, b) => (a.symbol || a.name || a.mint).localeCompare(b.symbol || b.name || b.mint));
    else next.sort((a, b) => b.claimableSol - a.claimableSol || b.sharePct - a.sharePct);
    return next;
  }, [result, filter, sort, onlyClaimable]);

  async function copy(text: string, label = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      toast("Could not copy to clipboard", "err");
    }
  }

  const totalSol = result?.totalClaimable.sol ?? 0;
  const totalUsd = result?.totalClaimable.usd;
  const scannedAt = result ? new Date(result.fetchedAt) : null;

  return (
    <div className="claim-scanner rise">
      <div className="page-intro claim-intro">
        <div>
          <span className="page-kicker">Claim Scanner</span>
          <h1>Claim Scanner</h1>
          <p>Scan any Solana wallet to see the Pump.fun coins sharing creator fees with it and how much is currently unclaimed. Claim Sniper never connects, signs, or claims for the scanned wallet.</p>
        </div>
        {result && <span className="scan-freshness">{result.cached ? "Cached" : "Live"} · {scannedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>

      <div className="card claim-search-card">
        <label className="claim-search-label" htmlFor="claim-wallet">Wallet to scan</label>
        <form className="claim-search-row" onSubmit={(e) => { e.preventDefault(); void scan(); }}>
          <input
            id="claim-wallet"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter a Solana wallet address…"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="primary claim-scan-btn" type="submit" disabled={loading || !address.trim()}>
            {loading ? <><span className="tiny-spinner" />Scanning…</> : "Scan wallet"}
          </button>
        </form>
        {wallets.length > 0 && (
          <div className="claim-wallet-shortcuts">
            <span>Your wallets</span>
            <div>
              {wallets.slice(0, 5).map((w) => (
                <button key={w.id} className="wallet-shortcut" onClick={() => { setAddress(w.publicKey); void scan(w.publicKey); }}>
                  <strong>{w.name}</strong><small>{short(w.publicKey)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <div className="error-box claim-error"><strong>Scan failed</strong><span>{error}</span></div>}

      {loading ? (
        <ClaimScannerSkeleton />
      ) : result ? (
        <>
          <div className="claim-stats">
            <div className="claim-stat-card">
              <span>Fee-sharing coins</span>
              <strong>{result.coinCount.toLocaleString()}</strong>
              <small>{result.claimableCoinCount.toLocaleString()} with fees in the live vault estimate</small>
            </div>
            <div className="claim-stat-card claim-total-card">
              <span>Total claimable</span>
              <strong>{totalSol.toLocaleString(undefined, { maximumFractionDigits: 6 })} <em>SOL</em></strong>
              <small>{totalUsd != null ? `≈ $${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Pump-reported unclaimed balance"}</small>
            </div>
          </div>

          {result.coinsTruncated && <div className="warning-box">This wallet has more than 2,000 fee-sharing relationships. The list was capped to protect performance.</div>}

          <div className="card claim-results-card">
            <div className="claim-results-head">
              <div><h2>Coins sharing fees</h2><p>Sorted by the wallet&apos;s estimated currently claimable share.</p></div>
              <span className="result-count">{rows.length} result{rows.length === 1 ? "" : "s"}</span>
            </div>
            <div className="claim-toolbar">
              <div className="claim-filter"><span>⌕</span><input value={filter} onChange={(e) => { setFilter(e.target.value); setVisible(25); }} placeholder="Filter by coin, ticker, or CA…" /></div>
              <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort claim scanner results">
                <option value="claimable">Highest claimable</option>
                <option value="share">Highest share</option>
                <option value="name">Name / ticker</option>
              </select>
              <label className="claim-only-toggle"><input type="checkbox" checked={onlyClaimable} onChange={(e) => { setOnlyClaimable(e.target.checked); setVisible(25); }} /><span>Only claimable</span></label>
            </div>

            {rows.length === 0 ? (
              <div className="claim-empty">{result.coins.length === 0 ? "No Pump.fun fee-sharing relationships were found for this wallet." : "No coins match these filters."}</div>
            ) : (
              <div className="claim-list">
                {rows.slice(0, visible).map((coin) => (
                  <ClaimCoinRow key={coin.mint} coin={coin} tradingPlatform={tradingPlatform} onCopy={copy} />
                ))}
              </div>
            )}
            {visible < rows.length && <button className="claim-load-more" onClick={() => setVisible((n) => Math.min(rows.length, n + 25))}>Show 25 more <span>{visible} / {rows.length}</span></button>}
          </div>

          <div className={`claim-method-note ${result.perCoinEstimate.differsFromPumpTotal ? "notice" : ""}`}>
            <span>i</span>
            <p><strong>The headline total comes directly from Pump&apos;s wallet-level fee-sharing total.</strong> Per-coin values are read-only live estimates from each coin&apos;s Pump and PumpSwap creator vaults multiplied by this wallet&apos;s share. They can differ briefly while fees are being swept/distributed.</p>
          </div>
        </>
      ) : (
        <div className="claim-start-state">
          <div className="claim-start-icon">⌕</div>
          <h2>Inspect any wallet</h2>
          <p>Paste a Solana address above to load its Pump.fun fee-sharing relationships and unclaimed creator rewards.</p>
        </div>
      )}
    </div>
  );
}

function ClaimCoinRow({ coin, tradingPlatform, onCopy }: { coin: ClaimScannerCoin; tradingPlatform: TradingPlatform; onCopy: (text: string, label?: string) => void }) {
  const toast = useToast();
  const [imageFailed, setImageFailed] = useState(false);
  const label = coin.symbol ? `$${coin.symbol}` : coin.name || short(coin.mint);
  return (
    <div className="claim-coin-row">
      <div className="claim-coin-identity">
        <div className="claim-coin-img">
          {coin.image && !imageFailed ? <img src={coin.image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <span>{(coin.symbol || coin.name || "?").slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="claim-coin-copy">
          <div className="claim-coin-title"><strong>{label}</strong>{coin.name && coin.symbol && <span>{coin.name}</span>}<i>{coin.isAdmin ? "ADMIN" : "SHAREHOLDER"}</i></div>
          <button className="claim-ca" onClick={() => onCopy(coin.mint, "CA copied")} title="Copy contract address">{short(coin.mint)} <span>⧉</span></button>
        </div>
      </div>
      <div className="claim-share"><span>Share</span><strong>{coin.sharePct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</strong></div>
      <div className="claim-amount">
        <strong>{coin.claimableSol > 0 ? coin.claimableSol.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0"} <em>SOL</em></strong>
        <span>{coin.claimableUsd != null && coin.claimableSol > 0 ? `≈ $${coin.claimableUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "No pending fees detected"}</span>
      </div>
      <button className="ghost mini claim-open" onClick={() => void openInTradingPlatform(tradingPlatform, coin, toast)}>Open ↗</button>
    </div>
  );
}

function ClaimScannerSkeleton() {
  return <div className="claim-scanner-loading">
    <div className="claim-stats">
      {[0, 1, 2].map((n) => <div className="claim-stat-card" key={n}><span className="skeleton-line sm"/><strong className="skeleton-line"/><small className="skeleton-line sm"/></div>)}
    </div>
    <div className="card claim-results-card">
      <div className="claim-results-head"><div><span className="skeleton-line"/><span className="skeleton-line sm"/></div></div>
      <div className="claim-list">{Array.from({ length: 7 }).map((_, i) => <div className="claim-coin-row claim-row-skeleton" key={i}><span className="skeleton-orb"/><span className="skeleton-line"/><span className="skeleton-line sm"/><span className="skeleton-line"/></div>)}</div>
    </div>
  </div>;
}


/* ---------------- redirect discovery ---------------- */
function discoveryUsd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  return `$${compactNumber.format(value)}`;
}

function discoveryAge(value?: string | null) {
  if (!value) return "—";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 0) return "now";
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function discoverySocialHref(kind: "twitter" | "telegram" | "website", value?: string | null) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : kind === "twitter"
      ? `https://x.com/${raw.replace(/^@/, "")}`
      : kind === "telegram"
        ? `https://t.me/${raw.replace(/^@/, "")}`
        : `https://${raw}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

type DiscoveryColumnKey = "new" | "trending" | "graduated";

function Discovery({
  tradingPlatform,
  onArm,
}: {
  tradingPlatform: TradingPlatform;
  onArm: (coin: DiscoverCoin, redirect: DiscoveryRedirect) => void;
}) {
  const toast = useToast();
  const [feed, setFeed] = useState<DiscoveryFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [minMc, setMinMc] = useState("");
  const [maxMc, setMaxMc] = useState("");
  const [fullRedirectOnly, setFullRedirectOnly] = useState(false);
  const [hiddenLocal, setHiddenLocal] = useState<Set<string>>(() => new Set());
  const [detailMint, setDetailMint] = useState<string | null>(null);
  const [detail, setDetail] = useState<DiscoverMetadata | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [hiding, setHiding] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await api.discover();
      setFeed(next);
      setError("");
    } catch (e: any) {
      setError(friendlyError(e?.message ?? "Discovery failed to load"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!detailMint) {
      setDetail(null);
      return;
    }
    let stop = false;
    setDetailBusy(true);
    api.discoverMetadata(detailMint)
      .then((res) => { if (!stop) setDetail(res); })
      .catch((e: any) => { if (!stop) toast(friendlyError(e?.message ?? "Could not load token details"), "err"); })
      .finally(() => { if (!stop) setDetailBusy(false); });
    return () => { stop = true; };
  }, [detailMint, toast]);

  const minMcValue = marketCapInputToNumber(minMc);
  const maxMcValue = marketCapInputToNumber(maxMc);
  const filterCoin = useCallback((coin: DiscoverCoin) => {
    if (hiddenLocal.has(coin.mint)) return false;
    const q = query.trim().toLowerCase();
    if (q && ![coin.ticker, coin.name, coin.mint, coin.originalCreator, ...coin.redirects.map((r) => r.wallet)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))) return false;
    if (minMcValue != null && (coin.marketCapUsd ?? 0) < minMcValue) return false;
    if (maxMcValue != null && (coin.marketCapUsd == null || coin.marketCapUsd > maxMcValue)) return false;
    if (fullRedirectOnly && coin.totalRedirectSharePct < 99.99) return false;
    return true;
  }, [hiddenLocal, query, minMcValue, maxMcValue, fullRedirectOnly]);

  const columns = useMemo(() => {
    const empty = { new: [], trending: [], graduated: [] } as Record<DiscoveryColumnKey, DiscoverCoin[]>;
    if (!feed) return empty;
    return {
      new: feed.columns.new.filter(filterCoin),
      trending: feed.columns.trending.filter(filterCoin),
      graduated: feed.columns.graduated.filter(filterCoin),
    };
  }, [feed, filterCoin]);

  async function hideCoin(mint: string) {
    if (hiding.has(mint)) return;
    setHiding((prev) => new Set(prev).add(mint));
    setHiddenLocal((prev) => new Set(prev).add(mint));
    try {
      await api.discoverHide(mint);
      toast("Hidden from Discovery");
      if (detailMint === mint) setDetailMint(null);
    } catch (e: any) {
      setHiddenLocal((prev) => {
        const next = new Set(prev);
        next.delete(mint);
        return next;
      });
      toast(friendlyError(e?.message ?? "Could not hide coin"), "err");
    } finally {
      setHiding((prev) => {
        const next = new Set(prev);
        next.delete(mint);
        return next;
      });
    }
  }

  async function restoreHidden() {
    try {
      const res = await api.discoverResetHidden();
      setHiddenLocal(new Set());
      await load(true);
      toast(res.restored ? `Restored ${res.restored} hidden coin${res.restored === 1 ? "" : "s"}` : "Nothing hidden");
    } catch (e: any) {
      toast(friendlyError(e?.message ?? "Could not restore hidden coins"), "err");
    }
  }

  if (loading && !feed) return <DiscoverySkeleton />;
  if (error && !feed) {
    return <div className="discovery-page rise"><div className="card discovery-error"><h2>Discovery could not load</h2><p>{error}</p><button className="primary" onClick={() => void load()}>Retry</button></div></div>;
  }
  if (feed && !feed.enabled) {
    return <div className="discovery-page rise"><div className="card discovery-error"><h2>Discovery is off</h2><p>An admin has disabled the redirect indexer.</p></div></div>;
  }

  const streamOk = Boolean(feed?.index.connected);
  const visibleCount = columns.new.length + columns.trending.length + columns.graduated.length;

  return (
    <div className="discovery-page rise">
      <div className="discovery-head">
        <div>
          <div className="discovery-eyebrow"><i className={streamOk ? "live" : "degraded"} /> REDIRECT DISCOVERY</div>
          <h1>Unclaimed fee redirects</h1>
          <p>Coins whose creator fees moved to another wallet and have not been claimed by that redirected wallet.</p>
        </div>
        <div className="discovery-head-status">
          <span className={streamOk ? "ok" : "warn"}>{streamOk ? "Index live" : "Index reconnecting"}</span>
          <small>{feed?.index.subscribedWallets ?? 0} unclaimed wallet{(feed?.index.subscribedWallets ?? 0) === 1 ? "" : "s"} watched</small>
          <small>DB indexed · no chain queries from this page</small>
        </div>
      </div>

      <div className="discovery-toolbar">
        <div className="discovery-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ticker, CA, creator or redirect wallet…" /></div>
        <div className="discovery-filter"><span>Min MC</span><input inputMode="decimal" value={minMc} onChange={(e) => setMinMc(e.target.value)} placeholder="e.g. 10k" /></div>
        <div className="discovery-filter"><span>Max MC</span><input inputMode="decimal" value={maxMc} onChange={(e) => setMaxMc(e.target.value)} placeholder="e.g. 500k" /></div>
        <button className={`discovery-filter-toggle ${fullRedirectOnly ? "on" : ""}`} onClick={() => setFullRedirectOnly((v) => !v)}><span className={`switch ${fullRedirectOnly ? "on" : ""}`}><span className="knob" /></span>100% redirects</button>
        <button className="ghost mini" onClick={() => void restoreHidden()}>Restore hidden{feed?.hiddenCount ? ` (${feed.hiddenCount})` : ""}</button>
        <button className="ghost mini" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div className="discovery-summary-strip">
        <span><b>{feed?.counts.total ?? 0}</b> unclaimed</span>
        <span><b>{feed?.counts.new ?? 0}</b> bonding</span>
        <span><b>{feed?.counts.graduated ?? 0}</b> graduated</span>
        <span><b>{visibleCount}</b> cards shown</span>
        {feed?.index.lastRedirectAt && <span>last redirect <b>{discoveryAge(feed.index.lastRedirectAt)}</b> ago</span>}
        {feed?.index.lastClaimAt && <span>last claim removal <b>{discoveryAge(feed.index.lastClaimAt)}</b> ago</span>}
      </div>

      <div className="discovery-columns">
        <DiscoveryColumn title="New" subtitle="Newest fee redirects" coins={columns.new} tone="new" tradingPlatform={tradingPlatform} onHide={hideCoin} onArm={onArm} onDetail={setDetailMint} hiding={hiding} />
        <DiscoveryColumn title="Trending" subtitle="Volume, activity + recency" coins={columns.trending} tone="trending" tradingPlatform={tradingPlatform} onHide={hideCoin} onArm={onArm} onDetail={setDetailMint} hiding={hiding} />
        <DiscoveryColumn title="Graduated" subtitle="Redirected coins on AMM" coins={columns.graduated} tone="graduated" tradingPlatform={tradingPlatform} onHide={hideCoin} onArm={onArm} onDetail={setDetailMint} hiding={hiding} />
      </div>

      {detailMint && (
        <DiscoveryDetailModal
          coin={detail}
          loading={detailBusy}
          tradingPlatform={tradingPlatform}
          onClose={() => setDetailMint(null)}
          onHide={hideCoin}
          onArm={onArm}
        />
      )}
    </div>
  );
}

function DiscoveryColumn({
  title,
  subtitle,
  coins,
  tone,
  tradingPlatform,
  onHide,
  onArm,
  onDetail,
  hiding,
}: {
  title: string;
  subtitle: string;
  coins: DiscoverCoin[];
  tone: DiscoveryColumnKey;
  tradingPlatform: TradingPlatform;
  onHide: (mint: string) => void;
  onArm: (coin: DiscoverCoin, redirect: DiscoveryRedirect) => void;
  onDetail: (mint: string) => void;
  hiding: Set<string>;
}) {
  return (
    <section className={`discovery-column ${tone}`}>
      <header><div><h2>{title}</h2><span>{subtitle}</span></div><b>{coins.length}</b></header>
      <div className="discovery-column-scroll">
        {coins.length === 0 ? <div className="discovery-column-empty">Nothing matching your filters.</div> : coins.map((coin) => (
          <DiscoveryCoinCard key={`${tone}-${coin.mint}`} coin={coin} tradingPlatform={tradingPlatform} onHide={onHide} onArm={onArm} onDetail={onDetail} hiding={hiding.has(coin.mint)} />
        ))}
      </div>
    </section>
  );
}

function DiscoveryCoinCard({
  coin,
  tradingPlatform,
  onHide,
  onArm,
  onDetail,
  hiding,
}: {
  coin: DiscoverCoin;
  tradingPlatform: TradingPlatform;
  onHide: (mint: string) => void;
  onArm: (coin: DiscoverCoin, redirect: DiscoveryRedirect) => void;
  onDetail: (mint: string) => void;
  hiding: boolean;
}) {
  const toast = useToast();
  const [imageFailed, setImageFailed] = useState(false);
  const [dragX, setDragX] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const primaryRedirect = coin.redirects[0];
  const staleMarket = !coin.marketDataUpdatedAt || Date.now() - new Date(coin.marketDataUpdatedAt).getTime() > 5 * 60_000;

  return (
    <div className={`discovery-swipe-wrap ${dragX < -36 ? "revealing" : ""}`}>
      <button className="discovery-swipe-hide" onClick={() => onHide(coin.mint)}>Hide</button>
      <article
        className={`discovery-coin-card ${hiding ? "hiding" : ""}`}
        style={{ transform: `translateX(${dragX}px)` }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchMove={(e) => {
          const start = touchStart.current;
          const t = e.touches[0];
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          if (Math.abs(dx) <= Math.abs(dy)) return;
          if (dx < 0) {
            e.preventDefault();
            setDragX(Math.max(-96, dx));
          }
        }}
        onTouchEnd={() => {
          if (dragX <= -70) onHide(coin.mint);
          setDragX(0);
          touchStart.current = null;
        }}
        onClick={() => onDetail(coin.mint)}
      >
        <div className="discovery-card-top">
          <div className="discovery-token-id">
            <div className="discovery-token-img">
              {coin.image && !imageFailed ? <img src={coin.image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <span>{(coin.ticker || coin.name || "?").slice(0, 1).toUpperCase()}</span>}
            </div>
            <div><strong>{coin.ticker ? `$${coin.ticker}` : short(coin.mint)}</strong><span>{coin.name || "Pump.fun token"}</span></div>
          </div>
          <div className="discovery-age"><b>{discoveryAge(coin.redirectedAt)}</b><span>redirect</span></div>
        </div>

        <div className="discovery-badges">
          <span className={coin.graduated ? "graduated" : "bonding"}>{coin.graduated ? "Graduated" : "Bonding"}</span>
          {coin.totalRedirectSharePct >= 99.99 && <span>100% fees</span>}
          {coin.redirects.length > 1 && <span>{coin.redirects.length} wallets</span>}
          {coin.isLikelyAgent && <span className="flag">Agent?</span>}
          {coin.isLikelyCharity && <span className="flag">Charity?</span>}
        </div>

        <div className="discovery-market-grid">
          <div><span>MC</span><b>{discoveryUsd(coin.marketCapUsd)}</b></div>
          <div><span>Vol 1h</span><b>{discoveryUsd(coin.volume1hUsd)}</b></div>
          <div><span>Vol 24h</span><b>{discoveryUsd(coin.volumeUsd)}</b></div>
          <div><span>Liq</span><b>{discoveryUsd(coin.liquidityUsd)}</b></div>
        </div>

        {primaryRedirect && <div className="discovery-redirect-line"><span>{primaryRedirect.sharePct.toLocaleString(undefined, { maximumFractionDigits: 2 })}% →</span><code>{short(primaryRedirect.wallet)}</code><em>unclaimed</em></div>}
        <div className="discovery-card-meta"><span>Token {discoveryAge(coin.tokenCreatedAt)} old</span><span>{coin.replyCount ?? 0} replies</span>{staleMarket && <span className="stale">MC stale</span>}</div>

        <div className="discovery-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="trade-open" onClick={() => void openInTradingPlatform(tradingPlatform, coin, toast)}>Open {tradingPlatformLabel(tradingPlatform)} ↗</button>
          {primaryRedirect && <button className="arm-quick" onClick={() => onArm(coin, primaryRedirect)}>Arm</button>}
          <CopyCA mint={coin.mint} />
          <button className="hide-quick" onClick={() => onHide(coin.mint)}>Hide</button>
        </div>
      </article>
    </div>
  );
}

function DiscoveryDetailModal({
  coin,
  loading,
  tradingPlatform,
  onClose,
  onHide,
  onArm,
}: {
  coin: DiscoverMetadata | null;
  loading: boolean;
  tradingPlatform: TradingPlatform;
  onClose: () => void;
  onHide: (mint: string) => void;
  onArm: (coin: DiscoverCoin, redirect: DiscoveryRedirect) => void;
}) {
  const toast = useToast();
  if (loading && !coin) return <div className="modal-overlay" onMouseDown={onClose}><div className="modal discovery-detail-modal" onMouseDown={(e) => e.stopPropagation()}><div className="admin-loading"><span className="spin dark" /> Loading coin details…</div></div></div>;
  if (!coin) return null;
  const twitter = discoverySocialHref("twitter", coin.twitter);
  const telegram = discoverySocialHref("telegram", coin.telegram);
  const website = discoverySocialHref("website", coin.website);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal discovery-detail-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="discovery-detail-head">
          <div><span className="discovery-detail-kicker">Redirected · unclaimed</span><h2>{coin.ticker ? `$${coin.ticker}` : coin.name || short(coin.mint)}</h2><p>{coin.name && coin.ticker ? coin.name : "Pump.fun token"}</p></div>
          <button className="ghost mini" onClick={onClose}>Close</button>
        </div>
        <div className="discovery-detail-stats">
          <div><span>Market cap</span><b>{discoveryUsd(coin.marketCapUsd)}</b></div>
          <div><span>Price</span><b>{coin.priceUsd != null ? `$${coin.priceUsd.toLocaleString(undefined, { maximumSignificantDigits: 6 })}` : "—"}</b></div>
          <div><span>1h volume</span><b>{discoveryUsd(coin.volume1hUsd)}</b></div>
          <div><span>24h volume</span><b>{discoveryUsd(coin.volumeUsd)}</b></div>
          <div><span>Liquidity</span><b>{discoveryUsd(coin.liquidityUsd)}</b></div>
          <div><span>Replies</span><b>{coin.replyCount ?? "—"}</b></div>
          <div><span>Status</span><b>{coin.graduated ? "Graduated" : "Bonding curve"}</b></div>
          <div><span>Redirected</span><b>{coin.totalRedirectSharePct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</b></div>
        </div>

        <div className="discovery-detail-section">
          <div className="discovery-detail-section-head"><h3>Fee redirect</h3><span>{discoveryAge(coin.redirectedAt)} ago</span></div>
          {coin.originalCreator && <div className="discovery-origin"><span>Original creator</span><CopyAddr address={coin.originalCreator} /></div>}
          <div className="discovery-redirect-list">
            {coin.redirects.map((r) => <div className="discovery-redirect-row" key={`${r.wallet}-${r.redirectSignature}`}>
              <div><strong>{r.sharePct.toLocaleString(undefined, { maximumFractionDigits: 2 })}% share</strong><CopyAddr address={r.wallet} /></div>
              <span>Unclaimed since {new Date(r.redirectedAt).toLocaleString()}</span>
              <div><a href={`https://solscan.io/tx/${r.redirectSignature}`} target="_blank" rel="noreferrer">Redirect tx ↗</a><button className="primary mini" onClick={() => onArm(coin, r)}>Arm this wallet</button></div>
            </div>)}
          </div>
        </div>

        <div className="discovery-detail-section">
          <div className="discovery-detail-section-head"><h3>Token</h3><CopyCA mint={coin.mint} ticker={coin.ticker} /></div>
          <div className="discovery-token-links">
            <button className="primary" onClick={() => void openInTradingPlatform(tradingPlatform, coin, toast)}>Open in {tradingPlatformLabel(tradingPlatform)} ↗</button>
            <a className="ghost-link" href={`https://pump.fun/coin/${coin.mint}`} target="_blank" rel="noreferrer">Pump.fun ↗</a>
            <a className="ghost-link" href={`https://solscan.io/token/${coin.mint}`} target="_blank" rel="noreferrer">Solscan ↗</a>
            {coin.pairUrl && <a className="ghost-link" href={coin.pairUrl} target="_blank" rel="noreferrer">DexScreener ↗</a>}
            {twitter && <a className="ghost-link" href={twitter} target="_blank" rel="noreferrer">X ↗</a>}
            {telegram && <a className="ghost-link" href={telegram} target="_blank" rel="noreferrer">Telegram ↗</a>}
            {website && <a className="ghost-link" href={website} target="_blank" rel="noreferrer">Website ↗</a>}
          </div>
          <div className="discovery-detail-foot"><span>Created {discoveryAge(coin.tokenCreatedAt)} ago</span><span>Market data {coin.marketDataUpdatedAt ? `${discoveryAge(coin.marketDataUpdatedAt)} ago` : "pending"}</span>{coin.pairDexId && <span>DEX {coin.pairDexId}</span>}<span>Trend score {coin.trendScore.toFixed(1)}</span></div>
        </div>

        {coin.history.length > coin.redirects.length && <details className="discovery-history"><summary>Redirect history ({coin.history.length})</summary><div>{coin.history.slice(0, 20).map((h, i) => <div key={`${h.wallet}-${h.epoch}-${i}`}><span>Epoch {h.epoch}</span><code>{short(h.wallet)}</code><b>{h.sharePct}%</b><em>{h.claimedAt ? `claimed ${discoveryAge(h.claimedAt)} ago` : h.active ? "active" : "replaced"}</em></div>)}</div></details>}

        <div className="modal-actions"><button className="ghost danger-text" onClick={() => onHide(coin.mint)}>Hide coin</button><button className="ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function DiscoverySkeleton() {
  return <div className="discovery-page rise"><div className="discovery-head"><div><div className="skeleton-line sm"/><div className="skeleton-line"/><div className="skeleton-line sm"/></div></div><div className="discovery-columns">{[0, 1, 2].map((c) => <section className="discovery-column" key={c}><header><div><span className="skeleton-line"/><span className="skeleton-line sm"/></div></header><div className="discovery-column-scroll">{[0, 1, 2, 3].map((n) => <div className="discovery-coin-card discovery-card-skeleton" key={n}><span className="skeleton-line"/><span className="skeleton-line sm"/><span className="skeleton-line"/></div>)}</div></section>)}</div></div>;
}

/* ---------------- history (permanent fill history) ---------------- */
function History({ tradingPlatform }: { tradingPlatform: TradingPlatform }) {
  const toast = useToast();
  const PAGE = 10;
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    fills: PublicSnipe[];
    total: number;
    page: number;
    pageSize: number;
  }>({ fills: [], total: 0, page: 0, pageSize: PAGE });

  useEffect(() => {
    let stop = false;
    setLoading(true);
    api.historyFills(page, PAGE)
      .then((r) => { if (!stop) setData(r); })
      .catch(() => { if (!stop) setData({ fills: [], total: 0, page, pageSize: PAGE }); })
      .finally(() => { if (!stop) setLoading(false); });
    return () => { stop = true; };
  }, [page]);

  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const fills = data.fills;

  return (
    <div className="discover rise history-page">
      <div className="page-intro history-intro">
        <div><span className="page-kicker">Trading record</span><h1>Snipe history</h1><p>Permanent record of filled buys and realized exits.</p></div>
        {data.total > 0 && <span className="dim">{data.total} fill{data.total === 1 ? "" : "s"}</span>}
      </div>
      {loading ? (
        <div className="card history-skeleton">{Array.from({ length: 6 }).map((_, i) => <div className="hist-skeleton-row" key={i}><span className="skeleton-line sm"/><span className="skeleton-line"/><span className="skeleton-line sm"/></div>)}</div>
      ) : fills.length === 0 ? (
        <div className="empty">No filled snipes yet.</div>
      ) : (
        <>
          <div className="hist-list">
            {fills.map((s) => (
              <div className="hist-row history-clean" key={s.id}>
                <div className="hist-coin"><span className="hist-tk">{s.ticker ? `$${s.ticker}` : short(s.mint)}</span><CopyCA mint={s.mint} /></div>
                <span className="hist-amt">{s.amountSol} SOL</span>
                {s.triggerMode === "REDIRECT" && <span className="tp-chip">redirect</span>}
                {s.soldSol > 0 && <span className="hist-sold">+{s.soldSol.toFixed(3)} SOL</span>}
                <Pnl net={(s.soldSol ?? 0) - s.amountSol} />
                <span className="hist-date">{new Date(s.filledAt ?? s.createdAt).toLocaleString()}</span>
                <div className="history-actions">
                  {s.signature && <a className="ghost-link" href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">Tx ↗</a>}
                  <button className="ghost mini" onClick={() => void openInTradingPlatform(tradingPlatform, s, toast)}>Open ↗</button>
                </div>
              </div>
            ))}
          </div>
          {data.total > PAGE && <div className="pager">
            <button className="ghost mini" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
            <span className="dim">Page {page + 1} of {pages}</span>
            <button className="ghost mini" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Next</button>
          </div>}
        </>
      )}
    </div>
  );
}

/* ---------------- admin operations console ---------------- */
function adminAgo(value?: string | null) {
  if (!value) return "never";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function adminDurationMs(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function adminUptime(seconds?: number | null) {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}


function rpcCredits(n?: number | null) {
  const value = Number(n ?? 0);
  if (value < 1000) return value.toFixed(value < 10 ? 2 : 0);
  return compactNumber.format(value);
}

function rpcBytes(n?: number | null) {
  const value = Number(n ?? 0);
  if (value < 1000) return `${Math.round(value)} B`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)} KB`;
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)} MB`;
}

function AdminRpcUsageView({
  usage,
  range,
  onRange,
  onRefresh,
}: {
  usage: AdminRpcUsage | null;
  range: "1h" | "24h" | "month";
  onRange: (r: "1h" | "24h" | "month") => void;
  onRefresh: () => void;
}) {
  const subs = usage?.subsystems ?? [];
  const discovery = subs.filter((x) => x.name.startsWith("discovery-")).reduce((a, x) => ({ credits: a.credits + x.credits, requests: a.requests + x.requests, bytes: a.bytes + x.bytes }), { credits: 0, requests: 0, bytes: 0 });
  const claim = subs.filter((x) => x.name.startsWith("claim-") || x.name === "fee-share-index").reduce((a, x) => ({ credits: a.credits + x.credits, requests: a.requests + x.requests }), { credits: 0, requests: 0 });
  const trading = subs.filter((x) => x.name.startsWith("execution-") || x.name.startsWith("transaction-") || x.name === "tp-sl-market").reduce((a, x) => ({ credits: a.credits + x.credits, requests: a.requests + x.requests }), { credits: 0, requests: 0 });
  const maxTimeline = Math.max(1, ...(usage?.timeline ?? []).map((x) => x.credits));

  return (
    <div className="admin-section rpc-usage-page">
      <div className="admin-record-info rpc-usage-head">
        <div>
          <strong>RPC Usage</strong>
          <p>App-side Helius credit estimate grouped by the ClaimSniper subsystem that caused it. Opening this page only reads Postgres.</p>
        </div>
        <div className="admin-row-actions rpc-range-actions">
          {(["1h", "24h", "month"] as const).map((r) => <button key={r} className={`ghost mini ${range === r ? "on" : ""}`} onClick={() => onRange(r)}>{r === "month" ? "This month" : r}</button>)}
          <button className="ghost mini" onClick={onRefresh}>Refresh</button>
        </div>
      </div>

      {!usage ? <div className="admin-loading"><span className="spin dark" /> Loading RPC usage…</div> : <>
        <div className="admin-metric-grid rpc-metrics">
          <div className="admin-metric"><span>Estimated Helius credits</span><strong>{rpcCredits(usage.total.estimatedHeliusCredits)}</strong><small>{usage.total.requests.toLocaleString()} HTTP calls / WSS events</small></div>
          <div className="admin-metric"><span>Discovery</span><strong>{rpcCredits(discovery.credits)}</strong><small>{discovery.requests.toLocaleString()} events/calls · {rpcBytes(discovery.bytes)} streamed</small></div>
          <div className="admin-metric"><span>Claim detection</span><strong>{rpcCredits(claim.credits)}</strong><small>{claim.requests.toLocaleString()} events/calls</small></div>
          <div className="admin-metric"><span>Trading / confirms</span><strong>{rpcCredits(trading.credits)}</strong><small>{trading.requests.toLocaleString()} calls/events</small></div>
          <div className="admin-metric"><span>WSS streamed</span><strong>{usage.total.streamedMb.toFixed(2)} MB</strong><small>estimated uncompressed app payload</small></div>
          <div className="admin-metric"><span>Errors</span><strong className={usage.total.errors ? "red" : ""}>{usage.total.errors.toLocaleString()}</strong><small>avg HTTP latency {Math.round(usage.total.avgLatencyMs)}ms</small></div>
        </div>

        <section className="admin-card rpc-budget-card">
          <div className="admin-card-head"><div><h3>Monthly Helius allowance</h3><p>Local estimate. Use the Helius dashboard as the billing source of truth.</p></div><strong>{usage.budget.usedPct.toFixed(2)}%</strong></div>
          <div className="rpc-budget-track"><span style={{ width: `${Math.max(0.4, usage.budget.usedPct)}%` }} /></div>
          <div className="rpc-budget-meta"><span>{rpcCredits(usage.budget.estimatedUsedThisMonth)} used</span><span>{rpcCredits(usage.budget.estimatedRemaining)} remaining</span><span>{rpcCredits(usage.budget.monthlyCredits)} monthly</span></div>
        </section>

        <div className="admin-grid-two rpc-grid">
          <section className="admin-card">
            <div className="admin-card-head"><div><h3>Top consumers</h3><p>Sorted by estimated Helius credits.</p></div></div>
            <div className="rpc-table-wrap"><table className="rpc-table"><thead><tr><th>Subsystem</th><th>Credits</th><th>Share</th><th>Calls/events</th><th>WSS</th><th>Errors</th></tr></thead><tbody>
              {!subs.length ? <tr><td colSpan={6} className="dim">No usage recorded for this range yet.</td></tr> : subs.map((x) => <tr key={x.name} className={x.name.startsWith("discovery-") ? "discovery-row" : ""}><td><strong>{x.name}</strong></td><td>{rpcCredits(x.credits)}</td><td>{x.sharePct.toFixed(1)}%</td><td>{x.requests.toLocaleString()}</td><td>{rpcBytes(x.bytes)}</td><td className={x.errors ? "red" : ""}>{x.errors}</td></tr>)}
            </tbody></table></div>
          </section>

          <section className="admin-card">
            <div className="admin-card-head"><div><h3>Providers</h3><p>Only Helius traffic contributes estimated credits; fallback providers are still counted.</p></div></div>
            <div className="admin-kv-list rpc-provider-list">
              {!usage.providers.length ? <div><span>No provider activity yet</span><b>—</b></div> : usage.providers.map((p) => <div key={p.name}><span><b>{p.name}</b><small>{p.requests.toLocaleString()} calls/events · {rpcBytes(p.bytes)}</small></span><strong>{rpcCredits(p.credits)} cr</strong></div>)}
            </div>
          </section>
        </div>

        <section className="admin-card">
          <div className="admin-card-head"><div><h3>Usage over time</h3><p>Five-minute buckets. Spikes make it easy to spot a runaway poller or subscription.</p></div></div>
          <div className="rpc-timeline" title="Estimated credits per five-minute bucket">
            {(usage.timeline.length ? usage.timeline : [{ at: new Date().toISOString(), credits: 0, requests: 0, bytes: 0, errors: 0 }]).map((x) => <div key={x.at} className="rpc-timeline-col" title={`${new Date(x.at).toLocaleString()} · ${rpcCredits(x.credits)} credits · ${x.requests} calls/events`}><span style={{ height: `${Math.max(3, (x.credits / maxTimeline) * 100)}%` }} /><i /></div>)}
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-card-head"><div><h3>Most expensive methods</h3><p>Use this to find the exact call or stream responsible for usage.</p></div></div>
          <div className="rpc-table-wrap"><table className="rpc-table"><thead><tr><th>Subsystem</th><th>Method</th><th>Type</th><th>Credits</th><th>Calls/events</th><th>Avg latency</th><th>Errors</th></tr></thead><tbody>
            {usage.methods.map((x, i) => <tr key={`${x.subsystem}-${x.method}-${x.kind}-${i}`}><td>{x.subsystem}</td><td><code>{x.method}</code></td><td><span className={`rpc-kind ${x.kind}`}>{x.kind.toUpperCase()}</span></td><td>{rpcCredits(x.credits)}</td><td>{x.requests.toLocaleString()}</td><td>{x.kind === "http" ? `${Math.round(x.avgLatencyMs)}ms` : "—"}</td><td className={x.errors ? "red" : ""}>{x.errors}</td></tr>)}
          </tbody></table></div>
        </section>

        <div className="rpc-estimate-note"><strong>How this works</strong><span>{usage.estimateNotice} WSS usage is estimated from payload bytes seen by this backend. It does not make any extra Solana/Helius requests to calculate these numbers.</span></div>
      </>}
    </div>
  );
}

function computeUnits(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value).toLocaleString()} CU`;
}

function AdminComputeTuningView({
  tuning,
  busy,
  onRefresh,
  onApply,
  onReset,
}: {
  tuning: AdminComputeTuning | null;
  busy: boolean;
  onRefresh: () => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <div className="admin-section compute-tuning-page">
      <div className="admin-record-info">
        <div>
          <strong>LOCAL compute tuning</strong>
          <p>Confirmed fills are sampled after execution. Recommendations stay separate for Pump/PumpSwap and ATA-existing/ATA-create branches.</p>
        </div>
        <div className="admin-row-actions">
          <button className="ghost mini" onClick={onRefresh} disabled={busy}>Refresh</button>
          <button className="ghost mini" onClick={onReset} disabled={busy || !tuning?.activeOverrides}>Reset defaults</button>
          <button className="primary mini" onClick={onApply} disabled={busy || !tuning?.readyProfiles}>{busy ? "Applying…" : "Apply safe recommendations"}</button>
        </div>
      </div>

      {!tuning ? <div className="admin-loading"><span className="spin dark" /> Loading compute telemetry…</div> : <>
        <div className="admin-metric-grid compute-metrics">
          <div className="admin-metric"><span>Profiles ready</span><strong>{tuning.readyProfiles}/4</strong><small>{tuning.requiredSamples} fills required per profile</small></div>
          <div className="admin-metric"><span>Runtime overrides</span><strong>{tuning.activeOverrides}</strong><small>cached in memory · no hot-path DB read</small></div>
          <div className="admin-metric"><span>Candidate starts</span><strong>{tuning.candidateSamples}</strong><small>visible early, not yet applicable</small></div>
          <div className="admin-metric"><span>Telemetry</span><strong>{tuning.enabled ? "ON" : "OFF"}</strong><small>confirmed LOCAL buys only</small></div>
        </div>

        <section className="admin-card compute-policy-note">
          <div><strong>Guarded tuning</strong><span>Each suggested limit covers the larger of p95 + 20%, the worst fill + 12%, or the worst fill + 15k CU, rounded up to 10k. Lower limits are never applied automatically.</span></div>
          <div><strong>Why four profiles?</strong><span>Creating an associated token account consumes materially more compute. Mixing it with the common ATA-existing path either wastes priority or risks failed first buys.</span></div>
        </section>

        <section className="admin-card">
          <div className="admin-card-head"><div><h3>Observed compute</h3><p>Applying updates all ready rows at once. Existing environment defaults remain the fallback.</p></div><span className="admin-updated">{adminAgo(tuning.generatedAt)}</span></div>
          <div className="rpc-table-wrap"><table className="rpc-table compute-table"><thead><tr><th>Execution profile</th><th>Status</th><th>Samples</th><th>p50</th><th>p95</th><th>Worst</th><th>Current limit</th><th>Suggested</th><th>Worst headroom</th></tr></thead><tbody>
            {tuning.profiles.map((row) => (
              <tr key={row.profile}>
                <td><strong>{row.label}</strong><small>{row.profile}</small></td>
                <td><span className={`compute-status ${row.status}`}>{row.status === "raise-needed" ? "RAISE NEEDED" : row.status.toUpperCase()}</span></td>
                <td>{row.sampleCount}/{tuning.requiredSamples}</td>
                <td>{computeUnits(row.p50Consumed)}</td>
                <td>{computeUnits(row.p95Consumed)}</td>
                <td>{computeUnits(row.maxConsumed)}</td>
                <td><strong>{computeUnits(row.activeLimit)}</strong>{row.approvedLimit != null && <small>approved override</small>}</td>
                <td className={row.canApply ? "green" : ""}>{computeUnits(row.recommendedLimit)}</td>
                <td className={(row.headroomPct ?? 100) < 12 ? "red" : ""}>{row.headroomPct == null ? "—" : `${row.headroomPct.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      </>}
    </div>
  );
}

function AdminPanel({ wallets }: { wallets: Wallet[] }) {
  const toast = useToast();
  const [tab, setTab] = useState<AdminTab>(() => initialAdminTabFromStorage());
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [snipes, setSnipes] = useState<AdminSnipe[]>([]);
  const [snipeTotal, setSnipeTotal] = useState(0);
  const [snipePage, setSnipePage] = useState(0);
  const [snipeLoading, setSnipeLoading] = useState(false);
  const snipeRequestSeq = useRef(0);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [records, setRecords] = useState<AdminRecord[]>([]);
  const [rpcUsage, setRpcUsage] = useState<AdminRpcUsage | null>(null);
  const [computeTuning, setComputeTuning] = useState<AdminComputeTuning | null>(null);
  const [computeBusy, setComputeBusy] = useState(false);
  const [rpcRange, setRpcRange] = useState<"1h" | "24h" | "month">("24h");
  const [features, setFeatures] = useState<AdminFeatureState | null>(null);
  const [featureBusy, setFeatureBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copyFrom, setCopyFrom] = useState<AdminSnipe | null>(null);
  const [snipeDebug, setSnipeDebug] = useState<AdminSnipeDebug | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const [snipeQuery, setSnipeQuery] = useState("");
  const [snipeStatus, setSnipeStatus] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [recordQuery, setRecordQuery] = useState("");
  const [recordType, setRecordType] = useState("");
  const [recordLevel, setRecordLevel] = useState("");
  const [recordUser, setRecordUser] = useState("");

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      setOverview(await api.adminOverview());
    } catch (e: any) {
      if (!quiet) toast(e.message, "err");
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, [toast]);

  const loadFeatures = useCallback(async (quiet = false) => {
    try {
      setFeatures(await api.adminFeatures());
    } catch (e: any) {
      if (!quiet) toast(e.message, "err");
    }
  }, [toast]);

  const loadSnipes = useCallback(async (page: number, quiet = false) => {
    const requestSeq = ++snipeRequestSeq.current;
    if (!quiet) setSnipeLoading(true);
    try {
      const res = await api.adminSnipes({
        status: snipeStatus || undefined,
        q: snipeQuery.trim() || undefined,
        page,
        pageSize: 25,
      });
      if (requestSeq !== snipeRequestSeq.current) return;
      setSnipes(res.snipes);
      setSnipeTotal(res.total);
      setSnipePage(res.page);
    } catch (e: any) {
      if (!quiet) toast(e.message, "err");
    } finally {
      if (!quiet && requestSeq === snipeRequestSeq.current) setSnipeLoading(false);
    }
  }, [snipeStatus, snipeQuery, toast]);

  const loadUsers = useCallback(async (quiet = false) => {
    try {
      const res = await api.adminUsers();
      setUsers(res.users);
    } catch (e: any) {
      if (!quiet) toast(e.message, "err");
    }
  }, [toast]);

  const loadRpcUsage = useCallback(async (quiet = false) => {
    try {
      setRpcUsage(await api.adminRpcUsage(rpcRange));
    } catch (e: any) {
      if (!quiet) toast(e.message, "err");
    }
  }, [rpcRange, toast]);

  const loadComputeTuning = useCallback(async (quiet = false) => {
    if (!quiet) setComputeBusy(true);
    try {
      setComputeTuning(await api.adminComputeTuning());
    } catch (e: any) {
      if (!quiet) toast(e.message, "err");
    } finally {
      if (!quiet) setComputeBusy(false);
    }
  }, [toast]);

  const loadRecords = useCallback(async (quiet = false) => {
    try {
      const res = await api.adminRecords({
        userId: recordUser || undefined,
        type: recordType || undefined,
        level: recordLevel || undefined,
        q: recordQuery.trim() || undefined,
        limit: 250,
      });
      setRecords(res.records);
    } catch (e: any) {
      if (!quiet) toast(e.message, "err");
    }
  }, [recordUser, recordType, recordLevel, recordQuery, toast]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadOverview(true),
      loadUsers(true),
      loadFeatures(true),
      ...(tab === "snipes" ? [loadSnipes(snipePage, true)] : []),
    ]);
    if (tab === "records") await loadRecords(true);
    if (tab === "rpc") await loadRpcUsage(true);
    if (tab === "compute") await loadComputeTuning(true);
    setRefreshing(false);
  }, [loadOverview, loadSnipes, loadUsers, loadFeatures, loadRecords, loadRpcUsage, loadComputeTuning, tab, snipePage]);

  useEffect(() => {
    Promise.all([api.adminOverview(), api.adminUsers(), api.adminFeatures()])
      .then(([o, u, f]) => {
        setOverview(o);
        setUsers(u.users);
        setFeatures(f);
      })
      .catch((e) => toast(e.message, "err"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveChoice(NAV_ADMIN_TAB_KEY, tab);
  }, [tab]);

  useEffect(() => {
    if (tab !== "snipes") return;
    const timer = window.setTimeout(() => void loadSnipes(snipePage), 220);
    return () => window.clearTimeout(timer);
  }, [tab, snipePage, loadSnipes]);

  useEffect(() => {
    if (tab !== "records") return;
    const timer = window.setTimeout(() => void loadRecords(true), 220);
    return () => window.clearTimeout(timer);
  }, [tab, loadRecords]);

  useEffect(() => {
    if (tab !== "rpc") return;
    void loadRpcUsage(true);
  }, [tab, rpcRange, loadRpcUsage]);

  useEffect(() => {
    if (tab !== "compute") return;
    void loadComputeTuning(true);
  }, [tab, loadComputeTuning]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadOverview(true);
      if (tab === "snipes") void loadSnipes(snipePage, true);
      if (tab === "rpc") void loadRpcUsage(true);
      if (tab === "compute") void loadComputeTuning(true);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [tab, snipePage, loadOverview, loadSnipes, loadRpcUsage, loadComputeTuning]);

  async function applyComputeTuning() {
    if (computeBusy) return;
    setComputeBusy(true);
    try {
      const res = await api.adminApplyComputeTuning();
      setComputeTuning(res.tuning);
      toast(`Applied compute limits for ${res.tuning.readyProfiles} profile${res.tuning.readyProfiles === 1 ? "" : "s"}`);
      void loadOverview(true);
    } catch (e: any) {
      toast(friendlyError(e?.message ?? "Could not apply compute limits"), "err");
    } finally {
      setComputeBusy(false);
    }
  }

  async function resetComputeTuning() {
    if (computeBusy || !computeTuning?.activeOverrides) return;
    if (!window.confirm("Reset every approved LOCAL compute override to the environment defaults? Telemetry samples will be kept.")) return;
    setComputeBusy(true);
    try {
      const res = await api.adminResetComputeTuning();
      setComputeTuning(res.tuning);
      toast("Compute limits reset to environment defaults");
      void loadOverview(true);
    } catch (e: any) {
      toast(friendlyError(e?.message ?? "Could not reset compute limits"), "err");
    } finally {
      setComputeBusy(false);
    }
  }

  async function toggleDiscoveryFeature() {
    if (!features?.discovery.available || featureBusy) return;
    const next = !features.discovery.enabled;
    setFeatureBusy(true);
    try {
      const res = await api.adminSetDiscovery(next);
      setFeatures({ discovery: res.discovery });
      window.dispatchEvent(new CustomEvent("claimsnipe:discovery-feature", { detail: { enabled: res.discovery.enabled } }));
      toast(`Discovery ${res.discovery.enabled ? "enabled" : "disabled"}`);
      void loadOverview(true);
    } catch (e: any) {
      toast(friendlyError(e?.message ?? "Could not change Discovery"), "err");
    } finally {
      setFeatureBusy(false);
    }
  }

  async function openSnipe(id: string) {
    setDetailBusy(true);
    try {
      setSnipeDebug(await api.adminSnipeDebug(id));
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setDetailBusy(false);
    }
  }

  async function openUser(u: AdminUser) {
    setDetailBusy(true);
    try {
      setUserDetail(await api.adminUserDetail(u.id));
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setDetailBusy(false);
    }
  }

  async function togglePriority(u: AdminUser) {
    try {
      const next = !u.priorityTx;
      const res = await api.adminSetUserPriority(u.id, next);
      setUsers((list) => list.map((x) => x.id === u.id ? { ...x, priorityTx: res.user.priorityTx } : x));
      toast(`${res.user.priorityTx ? "Enabled" : "Disabled"} priority for @${u.username}`);
      void loadOverview(true);
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function toggleWhitelist(u: AdminUser) {
    try {
      const next = !u.whitelist;
      const res = await api.adminSetUserWhitelist(u.id, next);
      setUsers((list) => list.map((x) => x.id === u.id ? {
        ...x,
        whitelist: res.user.whitelist,
        paid: res.user.paid,
        subscriptionExpiresAt: res.user.subscriptionExpiresAt ?? null,
      } : x));
      toast(`${res.user.whitelist ? "Whitelisted" : "Removed whitelist from"} @${u.username}`);
      void loadOverview(true);
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  const visibleUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, userQuery]);

  function jumpToSnipes(status = "") {
    setSnipeStatus(status);
    setSnipePage(0);
    setTab("snipes");
  }

  const health = overview?.health;
  const queuePct = health ? Math.min(100, (health.queue.queued / Math.max(1, health.queue.maxDepth)) * 100) : 0;

  return (
    <div className="admin-console rise">
      <div className="admin-console-head">
        <div>
          <div className="admin-eyebrow">OPERATIONS</div>
          <h1>Admin</h1>
          <p className="sub">Live system health, users, execution state and debugging records.</p>
        </div>
        <div className="admin-head-actions">
          {overview && (
            <span className={`admin-health-pill ${overview.health.overall}`}>
              <i /> {overview.health.overall === "healthy" ? "Systems healthy" : "System degraded"}
            </span>
          )}
          <button className="ghost mini" onClick={() => void refreshAll()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="admin-tabs">
        {([
          ["overview", "Overview"],
          ["snipes", `Snipes${overview ? ` (${overview.snipes.armed + overview.snipes.paused + overview.snipes.triggered})` : ""}`],
          ["users", `Users${users.length ? ` (${users.length})` : ""}`],
          ["compute", "Compute"],
          ["rpc", "RPC Usage"],
          ["records", "Records"],
          ["notify", "Notification"],
        ] as [AdminTab, string][]).map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="admin-loading"><span className="spin dark" /> Loading admin data…</div>
      ) : tab === "overview" ? (
        <div className="admin-overview">
          <div className="admin-metric-grid">
            <button className="admin-metric" onClick={() => setTab("users")}>
              <span>Active users</span><strong>{overview?.users.active ?? 0}</strong><small>{overview?.users.total ?? 0} total · +{overview?.users.new24h ?? 0} today</small>
            </button>
            <button className="admin-metric" onClick={() => jumpToSnipes("ARMED")}>
              <span>Armed</span><strong>{overview?.snipes.armed ?? 0}</strong><small>{overview?.snipes.paused ?? 0} paused</small>
            </button>
            <button className="admin-metric" onClick={() => jumpToSnipes("TRIGGERED")}>
              <span>Executing</span><strong>{overview?.snipes.triggered ?? 0}</strong><small>{health?.engine.currentlyFiring ?? 0} in-process</small>
            </button>
            <button className="admin-metric" onClick={() => jumpToSnipes("FILLED")}>
              <span>Fills · 24h</span><strong>{overview?.snipes.fills24h ?? 0}</strong><small>{(overview?.snipes.buyVolume24hSol ?? 0).toFixed(2)} SOL bought</small>
            </button>
            <button className="admin-metric warn" onClick={() => jumpToSnipes("FAILED")}>
              <span>Failures · 24h</span><strong>{overview?.snipes.failures24h ?? 0}</strong><small>{overview?.snipes.recoveredRetries24h ?? 0} slippage retries recovered</small>
            </button>
            <div className="admin-metric">
              <span>Open positions</span><strong>{overview?.positions.open ?? 0}</strong><small>{(overview?.snipes.soldVolume24hSol ?? 0).toFixed(2)} SOL sold · 24h</small>
            </div>
            <div className="admin-metric">
              <span>Trigger → fill</span><strong>{adminDurationMs(overview?.snipes.avgTriggerToFillMs)}</strong><small>average confirmed fill · 24h</small>
            </div>
            <div className="admin-metric">
              <span>TX queue</span><strong>{health?.queue.queued ?? 0}</strong><small>{health?.queue.limitPerSecond ?? 0}/s limit · {health?.queue.priorityQueued ?? 0} priority</small>
            </div>
          </div>

          <section className={`admin-feature-control ${features?.discovery.enabled ? "enabled" : "disabled"}`}>
            <div className="admin-feature-main">
              <div>
                <span className="admin-feature-kicker">FEATURE CONTROL</span>
                <h3>Redirect Discovery</h3>
                <p>Event-driven redirect index. Turning this off stops the filtered SharingConfig watcher, Helius claim stream and background enrichment, and hides Discovery from users. Page views never trigger Solana RPC work or a historical chain scan.</p>
              </div>
              <button
                type="button"
                className="admin-feature-switch"
                aria-pressed={Boolean(features?.discovery.enabled)}
                onClick={() => void toggleDiscoveryFeature()}
                disabled={!features?.discovery.available || featureBusy}
              >
                <span className={`switch ${features?.discovery.enabled ? "on" : ""}`}><span className="knob" /></span>
                <b>{featureBusy ? "Changing…" : features?.discovery.enabled ? "Enabled" : "Disabled"}</b>
              </button>
            </div>
            <div className="admin-feature-stats">
              <span>Redirect feed <b>{(features?.discovery.runtime?.subscriptions ?? 0) > 0 ? "live" : features?.discovery.enabled ? "starting" : "off"}</b></span>
              <span>Unclaimed wallets <b>{features?.discovery.runtime?.claimStream?.subscribedWallets ?? 0}</b></span>
              <span>Filtered WSS <b>{features?.discovery.runtime?.claimStream?.connected ? "connected" : features?.discovery.enabled ? "reconnecting" : "off"}</b></span>
              <span>Redirects indexed <b>{features?.discovery.runtime?.redirectsIndexed ?? 0}</b></span>
              <span>Claims removed <b>{features?.discovery.runtime?.claimStream?.redirectsMarkedClaimed ?? 0}</b></span>
              <span>Enrichment queue <b>{features?.discovery.runtime?.marketQueueDepth ?? 0}</b></span>
              <span>Solana RPC reads <b>{features?.discovery.runtime?.redirectRpcReads ?? 0}</b></span>
              <span>Page-triggered RPC <b>{features?.discovery.runtime?.pageTriggeredRpcReads ?? 0}</b></span>
            </div>
            {features?.discovery.runtime?.lastError && <div className="admin-feature-error">{features.discovery.runtime.lastError}</div>}
            {features?.discovery.runtime?.claimStream?.lastError && <div className="admin-feature-error">Claim stream: {features.discovery.runtime.claimStream.lastError}</div>}
          </section>

          <div className="admin-dashboard-grid">
            <section className="admin-card admin-services">
              <div className="admin-card-head"><div><h3>System health</h3><p>Live checks from this backend instance.</p></div><span className="admin-updated">{overview ? adminAgo(overview.generatedAt) : "—"}</span></div>
              <AdminServiceRow name="PostgreSQL" ok={health?.database.ok ?? false} value={health ? `${health.database.latencyMs}ms` : "—"} detail={health?.database.error ?? "query responsive"} />
              <AdminServiceRow name="Solana RPC" ok={health?.rpc.ok ?? false} value={health ? `${health.rpc.latencyMs}ms` : "—"} detail={health?.rpc.slot ? `slot ${health.rpc.slot.toLocaleString()}` : health?.rpc.error ?? "unavailable"} />
              <AdminServiceRow
                name="Global program firehose"
                ok={!health?.engine.globalClaimFeed?.enabled || (!!health?.engine.globalClaimFeed?.connected && !health?.engine.globalClaimFeed?.reconnecting)}
                value={!health?.engine.globalClaimFeed?.enabled ? "removed" : health?.engine.globalClaimFeed?.reconnecting ? "reconnecting" : health?.engine.globalClaimFeed?.connected ? "connected" : "offline"}
                detail={health?.engine.globalClaimFeed?.enabled ? `${health.engine.globalClaimFeed.endpointCount} RPC route${health.engine.globalClaimFeed.endpointCount === 1 ? "" : "s"} · ${health.engine.globalClaimFeed.claimSignals} claim signals · ${health.engine.globalClaimFeed.reconnects} reconnects` : "zero global Pump/PumpSwap subscriptions"}
              />
              <AdminServiceRow
                name="Wallet-filtered claim feed"
                ok={!health?.engine.fullTransactionFeed?.enabled || !health.engine.fullTransactionFeed.watchedWallets || Boolean(health.engine.fullTransactionFeed.connected)}
                value={!health?.engine.fullTransactionFeed?.enabled ? "disabled" : health.engine.fullTransactionFeed.connected ? "connected" : health.engine.fullTransactionFeed.watchedWallets ? "fallback active" : "idle"}
                detail={health?.engine.fullTransactionFeed?.enabled ? `${health.engine.fullTransactionFeed.watchedWallets} wallet filters · ${health.engine.fullTransactionFeed.claimFrames} full frames · ${health.engine.fullTransactionFeed.reconnects} reconnects` : "targeted processed log recovery remains active"}
              />
              <AdminServiceRow name="Market-cap feed" ok={health?.marketFeed.ok ?? false} value={health?.marketFeed.connected ? "connected" : (health?.marketFeed.subscribed ? "offline" : "idle")} detail={`${health?.marketFeed.subscribed ?? 0} subscribed · ${health?.marketFeed.cached ?? 0} cached`} />
              <AdminServiceRow name="Redirect radar" ok={!health?.radar.enabled || (health?.radar.subscriptions ?? 0) > 0} value={health?.radar.enabled ? `${health.radar.subscriptions} live` : "disabled"} detail={`${health?.radar.inFlight ?? 0} processing · ${health?.radar.marketQueueDepth ?? 0} enrichment queue`} />
              <div className="admin-queue-block">
                <div><span>Transaction queue</span><b>{health?.queue.queued ?? 0}/{health?.queue.maxDepth ?? 0}</b></div>
                <div className="admin-progress"><i style={{ width: `${queuePct}%` }} /></div>
                <small>{health?.queue.draining ? "Draining now" : "Idle"} · expires after {health ? adminDurationMs(health.queue.maxWaitMs) : "—"}</small>
              </div>
            </section>

            <section className="admin-card">
              <div className="admin-card-head"><div><h3>Execution engine</h3><p>Watchers and reconciliation state.</p></div></div>
              <div className="admin-kv-grid">
                <div><span>Creator watchers</span><b>{health?.engine.creatorSubscriptions ?? 0}</b></div>
                <div><span>Snipe bindings</span><b>{health?.engine.creatorSnipeBindings ?? 0}</b></div>
                <div><span>Redirect watchers</span><b>{health?.engine.redirectSubscriptions ?? 0}</b></div>
                <div><span>Arming now</span><b>{health?.engine.armingInFlight ?? 0}</b></div>
                <div><span>Prepared plans</span><b>{health?.engine.preparedExecutionPlans ?? 0}</b></div>
                <div><span>Claim work</span><b>{health?.engine.claimProcessingInFlight ?? 0}</b></div>
                <div><span>Buy reconcile</span><b className={(health?.engine.buyReconciliationsPending ?? 0) ? "amber" : ""}>{health?.engine.buyReconciliationsPending ?? 0}</b></div>
                <div><span>Wallet watchers</span><b>{health?.balances.subscriptions ?? 0}</b></div>
                <div><span>Processed creator watchers</span><b>{health?.engine.processedCreatorSubscriptions ?? 0}</b></div>
                <div><span>Processed redirect watchers</span><b>{health?.engine.processedRedirectSubscriptions ?? 0}</b></div>
                <div><span>Backfills</span><b>{health?.engine.backfillRuns ?? 0}</b></div>
                <div><span>Recovered sigs</span><b>{health?.engine.backfilledSignatures ?? 0}</b></div>
              </div>
              <div className="admin-engine-last">
                <span>Last claim <b>{adminAgo(health?.engine.lastClaimAt)}</b></span>
                <span>Last trigger <b>{adminAgo(health?.engine.lastTriggerAt)}</b></span>
                <span>Last fill <b>{adminAgo(health?.engine.lastFillAt)}</b></span>
              </div>
              <div className="admin-kv-list">
                {Object.entries(health?.engine.latency ?? {}).map(([name, metric]) => (
                  <div key={name}><span>{name}</span><b>{metric.p50Ms ?? "—"} / {metric.p95Ms ?? "—"} ms</b></div>
                ))}
              </div>
              <div className="admin-server-strip">
                <div><span>Uptime</span><b>{adminUptime(health?.process.uptimeSeconds)}</b></div>
                <div><span>RAM</span><b>{health?.process.rssMb ?? 0} MB</b></div>
                <div><span>Heap</span><b>{health?.process.heapUsedMb ?? 0}/{health?.process.heapTotalMb ?? 0} MB</b></div>
                <div><span>Node</span><b>{health?.process.node ?? "—"}</b></div>
              </div>
            </section>

            <section className="admin-card admin-failures">
              <div className="admin-card-head"><div><h3>Recent failures</h3><p>Newest execution errors across all users.</p></div><button className="ghost mini" onClick={() => { setRecordLevel("error"); setTab("records"); }}>All errors</button></div>
              {!overview?.recentFailures.length ? <div className="admin-empty-mini">No recent failures.</div> : overview.recentFailures.map((f) => (
                <button className="admin-failure-row" key={f.id} onClick={() => f.snipeId && void openSnipe(f.snipeId)} disabled={!f.snipeId}>
                  <div><b>@{f.username}</b><span>{adminAgo(f.createdAt)}</span></div>
                  <p>{f.message}</p>
                </button>
              ))}
            </section>

            <section className="admin-card">
              <div className="admin-card-head"><div><h3>Account / service activity</h3><p>Useful operational totals.</p></div></div>
              <div className="admin-kv-list">
                <div><span>Whitelisted users</span><b>{overview?.users.whitelisted ?? 0}</b></div>
                <div><span>Priority users</span><b>{overview?.users.priority ?? 0}</b></div>
                <div><span>Social messages · 24h</span><b>{overview?.social.messages24h ?? 0}</b></div>
                <div><span>Billing pending</span><b>{overview?.billing.PENDING ?? 0}</b></div>
                <div><span>Billing failed</span><b className={(overview?.billing.FAILED ?? 0) ? "red" : ""}>{overview?.billing.FAILED ?? 0}</b></div>
                <div><span>Market enrich queue</span><b>{health?.radar.marketQueueDepth ?? 0}</b></div>
              </div>
            </section>
          </div>
        </div>
      ) : tab === "snipes" ? (
        <div className="admin-section">
          <div className="admin-toolbar">
            <div className="admin-search"><span>⌕</span><input value={snipeQuery} onChange={(e) => { setSnipeQuery(e.target.value); setSnipePage(0); }} placeholder="Search ticker, CA, user, wallet, signature or error…" /></div>
            <select value={snipeStatus} onChange={(e) => { setSnipeStatus(e.target.value); setSnipePage(0); }}>
              <option value="">All statuses</option><option>ARMED</option><option>PAUSED</option><option>TRIGGERED</option><option>FILLED</option><option>FAILED</option><option>CANCELLED</option>
            </select>
            <button className="ghost mini" onClick={() => void loadSnipes(snipePage)} disabled={snipeLoading}>{snipeTotal} total · {snipeLoading ? "Loading…" : "Refresh"}</button>
          </div>
          <div className="admin-snipe-list">
            {snipeLoading ? <div className="admin-loading"><span className="spin dark" /> Loading page…</div> : !snipes.length ? <div className="empty">No matching snipes.</div> : snipes.map((s) => (
              <div className={`admin-snipe-row ${s.status.toLowerCase()}`} key={s.id} onClick={() => void openSnipe(s.id)}>
                <div className="admin-snipe-main">
                  <div className="admin-snipe-title"><strong>{s.ticker ? `$${s.ticker}` : short(s.mint)}</strong><span className={`badge ${s.status}`}>{s.status}</span>{s.discardedAt && <span className="admin-discarded-chip">DISCARDED</span>}<span className="admin-user">@{s.user.username}</span></div>
                  <div className="admin-snipe-meta">
                    <span><b>{s.amountSol}</b> SOL</span>
                    <span>{s.wallet.name}</span>
                    <span>{s.triggerMode === "REDIRECT" ? "Redirect" : "Claim"}</span>
                    <span>Local</span>
                    <span>MC {s.liveMarketCapUsd != null ? `$${compactNumber.format(s.liveMarketCapUsd)}` : "—"}</span>
                    <span>{s.buyAttempts || 0} attempt{s.buyAttempts === 1 ? "" : "s"} · {s.finalSlippagePct ?? s.slippagePct}%</span>
                    {s.triggerToFillMs != null && <span>fill {adminDurationMs(s.triggerToFillMs)}</span>}
                  </div>
                  {s.position && <div className="admin-position-line"><span>{s.position.status} position</span><span>{s.position.realizedSol.toFixed(4)} SOL realized</span><Pnl net={s.position.realizedProfitSol} /></div>}
                  {s.error && <div className="admin-error-preview">{s.error}</div>}
                </div>
                <div className="admin-row-actions" onClick={(e) => e.stopPropagation()}>
                  <CopyCA mint={s.mint} />
                  <button className="ghost mini" onClick={() => void openSnipe(s.id)}>Debug</button>
                  <button className="ghost mini" onClick={() => setCopyFrom(s)}>Copy</button>
                </div>
              </div>
            ))}
          </div>
          {snipeTotal > 25 && <div className="pager">
            <button className="ghost mini" disabled={snipePage === 0 || snipeLoading} onClick={() => setSnipePage((p) => Math.max(0, p - 1))}>Previous</button>
            <span className="dim">Page {snipePage + 1} of {Math.max(1, Math.ceil(snipeTotal / 25))} · {snipeTotal} snipes</span>
            <button className="ghost mini" disabled={snipePage >= Math.ceil(snipeTotal / 25) - 1 || snipeLoading} onClick={() => setSnipePage((p) => p + 1)}>Next</button>
          </div>}
        </div>
      ) : tab === "users" ? (
        <div className="admin-section">
          <div className="admin-toolbar">
            <div className="admin-search"><span>⌕</span><input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search username…" /></div>
            <button className="ghost mini" onClick={() => void loadUsers()}>{visibleUsers.length} shown · Refresh</button>
          </div>
          <div className="admin-user-summary">
            <span><b>{users.length}</b> accounts</span><span><b>{users.filter((u) => u.paid).length}</b> active</span><span><b>{users.filter((u) => u.whitelist).length}</b> whitelisted</span><span><b>{users.filter((u) => u.priorityTx).length}</b> priority</span><span><b>{users.reduce((a, u) => a + u.spentSol, 0).toFixed(2)}</b> SOL spent</span><span><Pnl net={users.reduce((a, u) => a + u.netSol, 0)} /></span>
          </div>
          <div className="admin-user-list">
            {visibleUsers.map((u) => (
              <div className="admin-user-row" key={u.id} onClick={() => void openUser(u)}>
                <div className="admin-user-main">
                  <div><strong>@{u.username}</strong><span className={`badge ${u.paid ? "FILLED" : "FAILED"}`}>{u.whitelist ? "WHITELIST" : u.paid ? "ACTIVE" : "EXPIRED"}</span>{u.priorityTx && <span className="admin-priority-chip">PRIORITY</span>}</div>
                  <p>{u.activeSnipeCount ?? 0} active · {u.openPositionCount ?? 0} positions · {u.failedSnipeCount ?? 0} failed · {u.walletCount} wallets · last {adminAgo(u.lastActivityAt)}</p>
                </div>
                <div className="admin-user-pnl"><span>spent {u.spentSol.toFixed(3)}</span><span>made {u.madeSol.toFixed(3)}</span><Pnl net={u.netSol} /></div>
                <div className="admin-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button className={`ghost mini ${u.whitelist ? "on" : ""}`} onClick={() => void toggleWhitelist(u)}>{u.whitelist ? "Whitelist on" : "Whitelist"}</button>
                  <button className={`ghost mini ${u.priorityTx ? "on" : ""}`} onClick={() => void togglePriority(u)}>{u.priorityTx ? "Priority on" : "Priority"}</button>
                  <button className="ghost mini" onClick={() => void openUser(u)}>Inspect</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : tab === "compute" ? (
        <AdminComputeTuningView tuning={computeTuning} busy={computeBusy} onRefresh={() => void loadComputeTuning()} onApply={() => void applyComputeTuning()} onReset={() => void resetComputeTuning()} />
      ) : tab === "rpc" ? (
        <AdminRpcUsageView usage={rpcUsage} range={rpcRange} onRange={setRpcRange} onRefresh={() => void loadRpcUsage()} />
      ) : tab === "records" ? (
        <div className="admin-section">
          <div className="admin-record-info"><div><strong>Activity records</strong><p>Snipe lifecycle, on-chain position events and billing records in one timeline.</p></div><div className="admin-row-actions"><button className="ghost mini" onClick={() => { const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `claimsniper-admin-records-${new Date().toISOString().replace(/[:.]/g, "-")}.json`; a.click(); URL.revokeObjectURL(url); }}>Export JSON</button><button className="ghost mini" onClick={() => void loadRecords()}>Refresh</button></div></div>
          <div className="admin-toolbar admin-record-toolbar">
            <div className="admin-search"><span>⌕</span><input value={recordQuery} onChange={(e) => setRecordQuery(e.target.value)} placeholder="Search user, ticker, CA, signature, snipe ID or error…" /></div>
            <select value={recordType} onChange={(e) => setRecordType(e.target.value)}><option value="">All sources</option><option value="snipe">Snipe</option><option value="position">Position</option><option value="billing">Billing</option></select>
            <select value={recordLevel} onChange={(e) => setRecordLevel(e.target.value)}><option value="">All levels</option><option value="error">Errors</option><option value="success">Success</option><option value="info">Info</option></select>
            <select value={recordUser} onChange={(e) => setRecordUser(e.target.value)}><option value="">All users</option>{users.map((u) => <option key={u.id} value={u.id}>@{u.username}</option>)}</select>
          </div>
          <div className="admin-record-list">
            {!records.length ? <div className="empty">No matching records.</div> : records.map((r) => (
              <div className={`admin-record-row ${r.level}`} key={r.id}>
                <div className="admin-record-time"><b>{new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</b><span>{new Date(r.createdAt).toLocaleDateString()}</span></div>
                <div className="admin-record-body">
                  <div className="admin-record-top"><span className={`admin-source ${r.type}`}>{r.type}</span><span className="admin-event">{r.event}</span><span className="admin-user">@{r.username}</span>{r.ticker && <strong>${r.ticker}</strong>}{r.status && <span className="dim">{r.status}</span>}</div>
                  <p>{r.message}</p>
                  <div className="admin-record-links">
                    {r.snipeId && <button onClick={() => void openSnipe(r.snipeId!)}>snipe {short(r.snipeId)}</button>}
                    {r.mint && <button onClick={() => navigator.clipboard.writeText(r.mint!)}>CA {short(r.mint)}</button>}
                    {r.signature && <a href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer">tx {short(r.signature)} ↗</a>}
                  </div>
                  {r.details && <details><summary>Technical details</summary><pre>{JSON.stringify(r.details, null, 2)}</pre></details>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <AdminNotificationTester />
      )}

      {detailBusy && <div className="admin-detail-loading"><span className="spin dark" /> Loading details…</div>}
      {snipeDebug && <AdminSnipeDebugModal data={snipeDebug} onClose={() => setSnipeDebug(null)} />}
      {userDetail && <AdminUserDetailModal data={userDetail} onClose={() => setUserDetail(null)} onOpenSnipe={(id) => { setUserDetail(null); void openSnipe(id); }} />}

      {copyFrom && (
        <CopySnipeModal source={copyFrom} wallets={wallets} onClose={() => setCopyFrom(null)} onCopied={() => { setCopyFrom(null); void loadSnipes(snipePage); void loadOverview(true); }} />
      )}
    </div>
  );
}

function AdminServiceRow({ name, ok, value, detail }: { name: string; ok: boolean; value: string; detail: string }) {
  return <div className="admin-service-row"><i className={ok ? "ok" : "bad"} /><div><b>{name}</b><span>{detail}</span></div><strong>{value}</strong></div>;
}

function AdminSnipeDebugModal({ data, onClose }: { data: AdminSnipeDebug; onClose: () => void }) {
  const s = data.snipe;
  const timeline = [
    ["Created", s.createdAt],
    ["Triggered", s.triggeredAt],
    ["Filled", s.filledAt],
    ["Discarded", s.discardedAt],
    ["Exit submitted", s.exitSubmittedAt],
  ].filter((x) => x[1]) as [string, string][];
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal admin-debug-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="admin-modal-head"><div><span className="admin-eyebrow">SNIPE DEBUG</span><h3>{s.ticker ? `$${s.ticker}` : short(s.mint)}</h3><p>@{s.user.username} · {s.wallet.name}</p></div><button className="ghost mini" onClick={onClose}>Close</button></div>
        <div className="admin-debug-status"><span className={`badge ${s.status}`}>{s.status}</span>{s.discardedAt && <span className="admin-discarded-chip">DISCARDED</span>}<span>{s.amountSol} SOL</span><span>{s.triggerMode}</span><span>LOCAL</span><span>MC {s.liveMarketCapUsd != null ? `$${compactNumber.format(s.liveMarketCapUsd)}` : "—"}</span></div>
        <div className="admin-timeline">{timeline.map(([label, value], i) => <div key={label}><i className={i === timeline.length - 1 ? "last" : ""} /><span>{label}</span><b>{new Date(value).toLocaleString()}</b>{i > 0 && <small>+{adminDurationMs(new Date(value).getTime() - new Date(timeline[i - 1][1]).getTime())}</small>}</div>)}</div>
        <div className="admin-debug-grid">
          <section><h4>Execution</h4><AdminDebugKV k="Snipe ID" v={s.id} mono /><AdminDebugKV k="Wallet" v={`${s.wallet.name} · ${s.wallet.publicKey}`} mono /><AdminDebugKV k="Amount" v={`${s.amountSol} SOL`} /><AdminDebugKV k="Base slippage" v={`${s.slippagePct}%`} /><AdminDebugKV k="Adaptive" v={s.adaptiveSlippage === false ? "Off" : `On · max ${s.maxSlippagePct ?? "—"}%`} /><AdminDebugKV k="Buy attempts" v={`${s.buyAttempts ?? 0} / ${(s.maxBuyRetries ?? 0) + 1}`} /><AdminDebugKV k="Final slippage" v={s.finalSlippagePct != null ? `${s.finalSlippagePct}%` : "—"} /><AdminDebugKV k="Priority / tip" v={`${s.priorityFee} / ${s.bribe} SOL`} /><AdminDebugKV k="Trigger → fill" v={adminDurationMs(s.triggerToFillMs)} /></section>
          <section><h4>Trigger / filters</h4><AdminDebugKV k="Mode" v={s.triggerMode ?? "CLAIM"} /><AdminDebugKV k="Claim detection" v="PROCESSED · signer/social proof" /><AdminDebugKV k="Watch wallet" v={s.watchWallet ?? "default creator"} mono /><AdminDebugKV k="MC min" v={s.mcMinUsd != null ? `$${compactNumber.format(s.mcMinUsd)}` : "none"} /><AdminDebugKV k="MC max" v={s.mcMaxUsd != null ? `$${compactNumber.format(s.mcMaxUsd)}` : "none"} /><AdminDebugKV k="Claim check" v={s.claimCheckStatus ?? "—"} /><AdminDebugKV k="Claim signer" v={s.claimCheckSigner ? "yes" : s.claimCheckInstruction?.startsWith("claim_social_fee_pda") ? "protocol-authorized social claim" : "no"} /><AdminDebugKV k="Claim tx" v={s.claimCheckTx ?? "—"} mono /></section>
          <section><h4>Exit / position</h4><AdminDebugKV k="TP status" v={s.tpStatus ?? "NONE"} /><AdminDebugKV k="Exit kind" v={s.exitKind ?? "—"} /><AdminDebugKV k="Entry MC" v={s.entryMcSol != null ? `${s.entryMcSol.toFixed(2)} SOL` : "—"} /><AdminDebugKV k="Peak MC" v={s.peakMcSol != null ? `${s.peakMcSol.toFixed(2)} SOL` : "—"} /><AdminDebugKV k="Position" v={data.position?.status ?? "none"} /><AdminDebugKV k="Realized" v={data.position ? `${data.position.realizedSol.toFixed(6)} SOL` : "—"} /><AdminDebugKV k="Realized P&L" v={data.position ? `${data.position.realizedProfitSol >= 0 ? "+" : ""}${data.position.realizedProfitSol.toFixed(6)} SOL` : "—"} /></section>
        </div>
        <div className="admin-debug-signatures"><div><span>Buy transaction</span>{s.signature ? <a href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">{s.signature} ↗</a> : <b>none</b>}</div>{s.tpSignature && <div><span>Exit transaction</span><a href={`https://solscan.io/tx/${s.tpSignature}`} target="_blank" rel="noreferrer">{s.tpSignature} ↗</a></div>}</div>
        {s.error && <div className="admin-debug-error"><strong>Latest error</strong><pre>{s.error}</pre></div>}
        {data.position?.events?.length ? <section className="admin-debug-events"><h4>On-chain position events</h4>{data.position.events.map((e) => <div key={e.id}><span className="admin-event">{e.kind}</span><a href={`https://solscan.io/tx/${e.signature}`} target="_blank" rel="noreferrer">{short(e.signature)} ↗</a><span>{e.solChange >= 0 ? "+" : ""}{e.solChange.toFixed(6)} SOL</span><Pnl net={e.realizedProfitSol} /><time>{new Date(e.createdAt).toLocaleString()}</time></div>)}</section> : null}
        <section className="admin-debug-events"><h4>Lifecycle records</h4>{!data.logs.length ? <p className="sub">No lifecycle records for this snipe.</p> : data.logs.map((l) => <div key={l.id} className={l.level}><span className="admin-event">{l.level}</span><p>{l.message}</p><time>{new Date(l.createdAt).toLocaleString()}</time></div>)}</section>
        <div className="modal-actions"><CopyCA mint={s.mint} /><button className="ghost" onClick={() => void navigator.clipboard.writeText(JSON.stringify(data, null, 2))}>Copy debug JSON</button><button className="ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

function AdminDebugKV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return <div className="admin-debug-kv"><span>{k}</span><b className={mono ? "mono" : ""} title={v}>{v}</b></div>;
}

function AdminUserDetailModal({ data, onClose, onOpenSnipe }: { data: AdminUserDetail; onClose: () => void; onOpenSnipe: (id: string) => void }) {
  const u = data.user;
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal admin-user-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="admin-modal-head"><div><span className="admin-eyebrow">USER INSPECTOR</span><h3>@{u.username}</h3><p>Joined {new Date(u.createdAt).toLocaleDateString()} · {u.tradingPlatform ?? "AXIOM"}</p></div><button className="ghost mini" onClick={onClose}>Close</button></div>
        <div className="admin-user-detail-metrics"><div><span>Active snipes</span><b>{data.summary.activeSnipes}</b></div><div><span>Open positions</span><b>{data.summary.openPositions}</b></div><div><span>Failed snipes</span><b>{data.summary.failedSnipes}</b></div><div><span>Fills</span><b>{data.summary.fills}</b></div><div><span>Spent</span><b>{data.summary.spentSol.toFixed(3)} SOL</b></div><div><span>Realized P&L</span><Pnl net={data.summary.realizedProfitSol} /></div></div>
        <div className="admin-account-strip"><span className={`badge ${u.paid ? "FILLED" : "FAILED"}`}>{u.whitelist ? "WHITELIST" : u.paid ? "ACTIVE" : "EXPIRED"}</span>{u.priorityTx && <span className="admin-priority-chip">PRIORITY TX</span>}<span>{u.subscriptionExpiresAt ? `Subscription ${new Date(u.subscriptionExpiresAt).toLocaleDateString()}` : "No subscription expiry"}</span><span>{u._count?.pushSubscriptions ?? 0} push device(s)</span><span>{u._count?.messages ?? 0} chat messages</span></div>
        <div className="admin-user-detail-grid">
          <section><h4>Wallets</h4>{data.wallets.map((w) => <div className="admin-wallet-detail" key={w.id}><div><b>{w.name}</b><span>{w.publicKey}</span></div><CopyAddr address={w.publicKey} /></div>)}{u.payWallet && <div className="admin-wallet-detail"><div><b>Billing deposit</b><span>{u.payWallet}</span></div><CopyAddr address={u.payWallet} /></div>}</section>
          <section><h4>Billing</h4>{!data.billing.length ? <p className="sub">No billing records.</p> : data.billing.slice(0, 8).map((b) => <div className="admin-billing-detail" key={b.id}><span className={`admin-event ${b.status === "FAILED" ? "red" : ""}`}>{b.status}</span><div><b>{b.sol.toFixed(5)} SOL · {b.periods} period(s)</b><span>{new Date(b.createdAt).toLocaleString()}</span>{b.error && <em>{b.error}</em>}</div></div>)}</section>
        </div>
        <section className="admin-user-snipes"><h4>Recent snipes</h4><div>{!data.snipes.length ? <p className="sub">No snipes.</p> : data.snipes.slice(0, 30).map((s) => <button key={s.id} onClick={() => onOpenSnipe(s.id)}><strong>{s.ticker ? `$${s.ticker}` : short(s.mint)}</strong><span className={`badge ${s.status}`}>{s.status}</span><span>{s.amountSol} SOL</span><span>{adminAgo(s.createdAt)}</span></button>)}</div></section>
        <section className="admin-user-snipes"><h4>Open / recent positions</h4><div>{!data.positions.length ? <p className="sub">No positions.</p> : data.positions.slice(0, 20).map((p) => <button key={p.id} onClick={() => p.snipeId && onOpenSnipe(p.snipeId)} disabled={!p.snipeId}><strong>{p.ticker ? `$${p.ticker}` : short(p.mint)}</strong><span>{p.status}</span><span>{p.buySol.toFixed(3)} SOL entry</span><Pnl net={p.realizedProfitSol} /></button>)}</div></section>
        <section className="admin-user-log-mini"><h4>Recent activity</h4>{data.logs.slice(0, 12).map((l) => <div key={l.id} className={l.level}><span>{new Date(l.createdAt).toLocaleString()}</span><p>{l.message}</p></div>)}</section>
        <div className="modal-actions"><button className="ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}


function AdminNotificationTester() {
  const toast = useToast();
  const [title, setTitle] = useState("Claim Sniper test");
  const [body, setBody] = useState(
    "This is a test notification from the admin panel.",
  );
  const [url, setUrl] = useState("/");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{
    total: number;
    sent: number;
    failed: number;
    removed: number;
  } | null>(null);

  async function send() {
    setBusy(true);
    setLast(null);
    try {
      const res = await api.adminSendNotification(title, body, url || "/");
      setLast(res);
      toast(
        `Notification sent to ${res.sent}/${res.total} device(s)`,
        res.sent > 0 ? "fill" : "ok",
      );
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-notify-card">
      <h3>Send test notification</h3>
      <p className="sub">
        Sends a browser push notification to every device that has enabled
        notifications.
      </p>

      <label>Title</label>
      <input
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
      />

      <label>Message</label>
      <textarea
        value={body}
        maxLength={240}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
      />

      <label>Open URL</label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="/"
      />
      <div className="hint">
        Use / for the app home, or a relative path if you add one later.
      </div>

      <button
        className="primary inline"
        onClick={send}
        disabled={busy || !title.trim() || !body.trim()}
      >
        {busy ? <span className="spin" /> : "Send notification"}
      </button>

      {last && (
        <div className="notify-result">
          <span>devices: {last.total}</span>
          <span>sent: {last.sent}</span>
          <span>failed: {last.failed}</span>
          <span>removed: {last.removed}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- copyable CA ---------------- */
function CopyAddr({ address }: { address: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="ca-copy"
      title="Copy wallet address"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard
          .writeText(address)
          .then(() => toast("Address copied"));
      }}
    >
      <code>{short(address)}</code>
      <span className="copy">copy</span>
    </button>
  );
}

function CopyCA({
  mint,
  ticker,
  className,
}: {
  mint: string;
  ticker?: string | null;
  className?: string;
}) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={`ca-copy ${className ?? ""}`}
      title="Copy contract address"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(mint).then(() => toast("CA copied"));
      }}
    >
      {ticker ? <strong className="ca-ticker">${ticker}</strong> : null}
      <code>{short(mint)}</code>
      <span className="copy">copy CA</span>
    </button>
  );
}

/* ---------------- shared exit strategy (TP + stop loss) ---------------- */
type TpDraft = { multiplier: string; sellPct: string; slippagePct: string };
type ExitPresetDraft = {
  tpOn: boolean;
  tpTrail: boolean;
  takeProfits: TpDraft[];
  tpTrailPct: string;
  slOn: boolean;
  slTrail: boolean;
  slPct: string;
  slTrailPct: string;
  slSlip: string;
};

function snipeTakeProfits(
  s: Partial<Snipe> | Partial<PublicSnipe>,
): TakeProfitEntry[] {
  const rows = Array.isArray((s as any).takeProfits)
    ? ((s as any).takeProfits as TakeProfitEntry[])
    : [];
  if (rows.length)
    return rows.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (s.tpEnabled && s.tpMultiplier != null && s.tpSellPct != null) {
    return [
      {
        id: "legacy",
        index: 0,
        multiplier: Number(s.tpMultiplier),
        sellPct: Number(s.tpSellPct),
        slippagePct: Number(s.tpSlippagePct ?? 20),
        status: s.tpStatus ?? "PENDING",
      },
    ];
  }
  return [];
}

function takeProfitLabel(s: Partial<Snipe> | Partial<PublicSnipe>) {
  const rows = snipeTakeProfits(s);
  if (!rows.length)
    return s.tpEnabled && s.tpMultiplier != null
      ? [`TP ${s.tpMultiplier}× · ${s.tpSellPct ?? "?"}%`]
      : [];
  return rows
    .slice(0, 3)
    .map(
      (tp, i) =>
        `TP${rows.length > 1 ? ` #${i + 1}` : ""} ${tp.multiplier}× · ${tp.sellPct}% · ${tp.status?.toLowerCase?.() ?? "pending"}`,
    );
}

function initialTpDrafts(initial?: Partial<Snipe>): TpDraft[] {
  const rows = initial
    ? snipeTakeProfits(initial).filter((tp) => tp.status !== "CANCELLED")
    : [];
  if (rows.length) {
    return rows.slice(0, 3).map((tp) => ({
      multiplier: String(tp.multiplier ?? 2),
      sellPct: String(tp.sellPct ?? 100),
      slippagePct: String(tp.slippagePct ?? 20),
    }));
  }
  return [{ multiplier: "2", sellPct: "100", slippagePct: "20" }];
}

function useExit(initial?: Partial<Snipe>) {
  const [tpOn, setTpOn] = useState(
    initial ? !!initial.tpEnabled && initial.tpStatus !== "CANCELLED" : false,
  );
  const [tpTrail, setTpTrail] = useState(!!initial?.tpTrailing);
  const [takeProfits, setTakeProfits] = useState<TpDraft[]>(() =>
    initialTpDrafts(initial),
  );
  const [tpTrailPct, setTpTrailPct] = useState(
    String(initial?.tpTrailPct ?? 20),
  );
  const [slOn, setSlOn] = useState(!!initial?.slEnabled);
  const [slTrail, setSlTrail] = useState(!!initial?.slTrailing);
  const [slPct, setSlPct] = useState(String(initial?.slPct ?? 30));
  const [slTrailPct, setSlTrailPct] = useState(
    String(initial?.slTrailPct ?? 20),
  );
  const [slSlip, setSlSlip] = useState(String(initial?.slSlippagePct ?? 25));

  const addTakeProfit = () => {
    setTakeProfits((rows) => {
      if (rows.length >= 3) return rows;
      const last = rows[rows.length - 1] ?? {
        multiplier: "2",
        sellPct: "100",
        slippagePct: "20",
      };
      const nextMult = Number(last.multiplier);
      return [
        ...rows,
        {
          multiplier: Number.isFinite(nextMult)
            ? String(Math.max(1.01, nextMult + 1))
            : "3",
          sellPct: "50",
          slippagePct: last.slippagePct || "20",
        },
      ];
    });
  };

  const removeTakeProfit = (index: number) => {
    setTakeProfits((rows) =>
      rows.length <= 1 ? rows : rows.filter((_, i) => i !== index),
    );
  };

  const updateTakeProfit = (
    index: number,
    key: keyof TpDraft,
    value: string,
  ) => {
    setTakeProfits((rows) =>
      rows.map((tp, i) => (i === index ? { ...tp, [key]: value } : tp)),
    );
  };

  const snapshot = (): ExitPresetDraft => ({
    tpOn,
    tpTrail,
    takeProfits: takeProfits.slice(0, 3).map((tp) => ({ ...tp })),
    tpTrailPct,
    slOn,
    slTrail,
    slPct,
    slTrailPct,
    slSlip,
  });

  const applyPreset = (preset?: ExitPresetDraft) => {
    if (!preset) return;
    setTpOn(!!preset.tpOn);
    setTpTrail(!!preset.tpTrail);
    setTakeProfits(
      preset.takeProfits?.length
        ? preset.takeProfits.slice(0, 3).map((tp) => ({ ...tp }))
        : initialTpDrafts(),
    );
    setTpTrailPct(preset.tpTrailPct ?? "20");
    setSlOn(!!preset.slOn);
    setSlTrail(!!preset.slTrail);
    setSlPct(preset.slPct ?? "30");
    setSlTrailPct(preset.slTrailPct ?? "20");
    setSlSlip(preset.slSlip ?? "25");
  };

  const build = () => {
    const cleanTakeProfits = takeProfits.slice(0, 3).map((tp) => ({
      multiplier: Number(tp.multiplier),
      sellPct: Number(tp.sellPct),
      slippagePct: Number(tp.slippagePct),
    }));
    const first = cleanTakeProfits[0];
    return {
      tpEnabled: tpOn,
      // Fixed TP mode uses the ladder. Trailing TP mode uses the legacy scalar
      // fields below because it is one activation point + one trailing sell rule.
      takeProfits: tpOn && !tpTrail ? cleanTakeProfits : [],
      tpMultiplier: first?.multiplier ?? 2,
      tpSellPct: first?.sellPct ?? 100,
      tpSlippagePct: first?.slippagePct ?? 20,
      tpTrailing: tpOn ? tpTrail : false,
      // Do not send 0 for this when trailing is disabled. The backend validates
      // tpTrailPct as min 0.1 whenever the field exists. This affects both the
      // normal Arm button and social copy trade, because both call ex.build().
      ...(tpOn && tpTrail ? { tpTrailPct: Number(tpTrailPct) } : {}),
      slEnabled: slOn,
      ...(slOn
        ? {
            slPct: Number(slPct),
            slTrailing: slTrail,
            slTrailPct: Number(slTrailPct),
            slSlippagePct: Number(slSlip),
          }
        : { slTrailing: false }),
    };
  };

  return {
    tpOn,
    setTpOn,
    tpTrail,
    setTpTrail,
    takeProfits,
    addTakeProfit,
    removeTakeProfit,
    updateTakeProfit,
    tpTrailPct,
    setTpTrailPct,
    slOn,
    setSlOn,
    slTrail,
    setSlTrail,
    slPct,
    setSlPct,
    slTrailPct,
    setSlTrailPct,
    slSlip,
    setSlSlip,
    snapshot,
    applyPreset,
    build,
  };
}

function ExitFields({ ex }: { ex: ReturnType<typeof useExit> }) {
  const trailTp = ex.takeProfits[0] ?? {
    multiplier: "2",
    sellPct: "100",
    slippagePct: "20",
  };

  return (
    <>
      <div className={`tp-box ${ex.tpOn ? "on" : ""}`}>
        <label className="switch-row" onClick={() => ex.setTpOn((v) => !v)}>
          <span className={`switch ${ex.tpOn ? "on" : ""}`}>
            <span className="knob" />
          </span>
          Take profit
        </label>
        {ex.tpOn && (
          <div className="tp-fields">
            <label
              className="switch-row sub"
              onClick={() => ex.setTpTrail((v) => !v)}
            >
              <span className={`switch ${ex.tpTrail ? "on" : ""}`}>
                <span className="knob" />
              </span>
              Trailing
            </label>

            {ex.tpTrail ? (
              <>
                <div className="row">
                  <div>
                    <label>Activate at MC ×</label>
                    <input
                      value={trailTp.multiplier}
                      onChange={(e) =>
                        ex.updateTakeProfit(0, "multiplier", e.target.value)
                      }
                      placeholder="2"
                    />
                  </div>
                  <div>
                    <label>Sell %</label>
                    <input
                      value={trailTp.sellPct}
                      onChange={(e) =>
                        ex.updateTakeProfit(0, "sellPct", e.target.value)
                      }
                      placeholder="100"
                    />
                  </div>
                  <div>
                    <label>Trail drop %</label>
                    <input
                      value={ex.tpTrailPct}
                      onChange={(e) => ex.setTpTrailPct(e.target.value)}
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <label>Slippage %</label>
                    <input
                      value={trailTp.slippagePct}
                      onChange={(e) =>
                        ex.updateTakeProfit(0, "slippagePct", e.target.value)
                      }
                      placeholder="20"
                    />
                  </div>
                </div>
                <div className="hint">
                  After MC hits {trailTp.multiplier || "?"}× entry, it tracks
                  the peak and sells {trailTp.sellPct || "?"}% when MC drops{" "}
                  {ex.tpTrailPct || "?"}% from that peak.
                </div>
              </>
            ) : (
              <>
                <div className="tp-ladder">
                  {ex.takeProfits.map((tp, index) => (
                    <div className="tp-entry" key={index}>
                      <div className="tp-entry-head">
                        <strong>Take profit {index + 1}</strong>
                        {ex.takeProfits.length > 1 && (
                          <button
                            type="button"
                            className="ghost mini"
                            onClick={() => ex.removeTakeProfit(index)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="row">
                        <div>
                          <label>Sell at MC ×</label>
                          <input
                            value={tp.multiplier}
                            onChange={(e) =>
                              ex.updateTakeProfit(
                                index,
                                "multiplier",
                                e.target.value,
                              )
                            }
                            placeholder="2"
                          />
                        </div>
                        <div>
                          <label>Sell %</label>
                          <input
                            value={tp.sellPct}
                            onChange={(e) =>
                              ex.updateTakeProfit(
                                index,
                                "sellPct",
                                e.target.value,
                              )
                            }
                            placeholder="50"
                          />
                        </div>
                        <div>
                          <label>Slippage %</label>
                          <input
                            value={tp.slippagePct}
                            onChange={(e) =>
                              ex.updateTakeProfit(
                                index,
                                "slippagePct",
                                e.target.value,
                              )
                            }
                            placeholder="20"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="tp-add-wrap">
                  <button
                    type="button"
                    className="tp-add"
                    onClick={ex.addTakeProfit}
                    disabled={ex.takeProfits.length >= 3}
                  >
                    + Add another take profit
                    <span>{ex.takeProfits.length}/3</span>
                  </button>
                </div>
                <div className="hint">
                  Add up to 3 take-profit entries. Each entry sells its
                  percentage of this snipe's remaining token position
                  when that MC multiple is reached.
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className={`tp-box ${ex.slOn ? "on" : ""}`}>
        <label className="switch-row" onClick={() => ex.setSlOn((v) => !v)}>
          <span className={`switch ${ex.slOn ? "on" : ""}`}>
            <span className="knob" />
          </span>
          Stop loss
        </label>
        {ex.slOn && (
          <div className="tp-fields">
            <label
              className="switch-row sub"
              onClick={() => ex.setSlTrail((v) => !v)}
            >
              <span className={`switch ${ex.slTrail ? "on" : ""}`}>
                <span className="knob" />
              </span>
              Trailing
            </label>
            <div className="row">
              {ex.slTrail ? (
                <div>
                  <label>Trail drop %</label>
                  <input
                    value={ex.slTrailPct}
                    onChange={(e) => ex.setSlTrailPct(e.target.value)}
                  />
                </div>
              ) : (
                <div>
                  <label>Stop if down %</label>
                  <input
                    value={ex.slPct}
                    onChange={(e) => ex.setSlPct(e.target.value)}
                  />
                </div>
              )}
              <div>
                <label>Slippage %</label>
                <input
                  value={ex.slSlip}
                  onChange={(e) => ex.setSlSlip(e.target.value)}
                />
              </div>
            </div>
            <div className="hint">
              {ex.slTrail
                ? `Sells everything if market cap drops ${ex.slTrailPct || "?"}% from its peak since entry.`
                : `Sells everything if market cap falls ${ex.slPct || "?"}% below your entry.`}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- admin copy-snipe modal ---------------- */
function CopySnipeModal({
  source,
  wallets,
  onClose,
  onCopied,
}: {
  source: AdminSnipe;
  wallets: Wallet[];
  onClose: () => void;
  onCopied: () => void;
}) {
  const toast = useToast();
  const [walletId, setWalletId] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await api.adminCopySnipe(source.id, walletId);
      toast(
        `Copied ${source.ticker ? `$${source.ticker}` : short(source.mint)} into your account`,
        "fill",
      );
      onCopied();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Copy {source.ticker ? `$${source.ticker}` : "snipe"}</h3>
        <p className="modal-sub">
          from @{source.user.username} · {source.amountSol} SOL ·{" "}
          local
          {source.watchWallet ? ` · watch ${short(source.watchWallet)}` : ""}
        </p>
        <p className="modal-sub" style={{ marginTop: -4 }}>
          Arms an identical snipe (same mint, sizing, fees, exit strategy) on
          your own account with the wallet you pick.
        </p>
        <label>Buy with wallet</label>
        <WalletSelect
          wallets={wallets}
          value={walletId}
          onChange={setWalletId}
        />
        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary inline"
            onClick={go}
            disabled={busy || !walletId}
          >
            {busy ? <span className="spin" /> : "Copy & arm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- pnl chip ---------------- */
function Pnl({ net }: { net: number }) {
  const cls = net > 0 ? "pos" : net < 0 ? "neg" : "flat";
  return (
    <span className={`pnl ${cls}`}>
      {net >= 0 ? "+" : ""}
      {net.toFixed(3)} SOL
    </span>
  );
}

/* ---------------- trigger mode selector ---------------- */
function TriggerModeSelect({
  value,
  onChange,
}: {
  value: "CLAIM" | "REDIRECT";
  onChange: (v: "CLAIM" | "REDIRECT") => void;
}) {
  return (
    <div className="exec-mode">
      <label>Trigger</label>
      <div className="seg">
        <button
          className={value === "CLAIM" ? "on" : ""}
          onClick={() => onChange("CLAIM")}
        >
          On fee claim
        </button>
        <button
          className={value === "REDIRECT" ? "on" : ""}
          onClick={() => onChange("REDIRECT")}
        >
          On fee redirect
        </button>
      </div>
      {value === "CLAIM" && (
        <div className="hint">
          Snipes when the coin&rsquo;s creator fees are claimed (optionally only
          when a specific wallet claims).
        </div>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = `${base64}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function pushSubscriptionPayload(sub: PushSubscription) {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
    throw new Error("Browser returned an invalid push subscription");
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };
}

async function getPushRegistration() {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    throw new Error("This browser does not support web push notifications");
  }
  return navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}

async function ensurePushSubscription() {
  const keyInfo = await api.pushPublicKey();
  if (!keyInfo.configured || !keyInfo.publicKey)
    throw new Error("Notifications are not configured on the server yet");

  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Notification permission was not granted");

  const reg = await getPushRegistration();
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyInfo.publicKey),
    }));

  return sub;
}

/* ---------------- social ---------------- */

type BrowserPushPermission = NotificationPermission | "unsupported";

function pushPermissionText(permission: BrowserPushPermission) {
  if (permission === "granted") return "Allowed";
  if (permission === "denied") return "Blocked";
  if (permission === "unsupported") return "Not supported";
  return "Not asked yet";
}

function pushPermissionHelp(
  permission: BrowserPushPermission,
  subscribed: boolean,
) {
  if (permission === "unsupported") {
    return "This browser does not support web push. On iPhone/iPad, install Claim Sniper to the Home Screen using Safari first.";
  }
  if (permission === "denied") {
    return "Notifications are blocked in your browser. Use the padlock/site settings, or your phone/browser notification settings, then come back and allow this device.";
  }
  if (permission === "granted" && subscribed) {
    return "This device is allowed and registered. Choose which alerts you want below.";
  }
  if (permission === "granted") {
    return "Browser permission is allowed, but this device is not registered yet. Click Allow this device to subscribe it.";
  }
  return "Click Allow this device to show the browser permission popup, then choose which alerts you want below.";
}

function NotificationDeviceControl() {
  const toast = useToast();
  const [supported, setSupported] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [permission, setPermission] = useState<BrowserPushPermission>(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const canUse =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!canUse) {
      setSupported(false);
      setPermission("unsupported");
      setSubscribed(false);
      return;
    }

    setSupported(true);
    setPermission(Notification.permission);

    try {
      const keyInfo = await api.pushPublicKey();
      setConfigured(keyInfo.configured && !!keyInfo.publicKey);

      if (!keyInfo.configured || !keyInfo.publicKey) {
        setSubscribed(false);
        return;
      }

      const reg = await getPushRegistration();
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    } catch {
      setConfigured(false);
      setSubscribed(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("cs:push-changed", refresh);
    return () => window.removeEventListener("cs:push-changed", refresh);
  }, [load]);

  async function allowDevice() {
    setErr("");
    setBusy(true);
    try {
      const keyInfo = await api.pushPublicKey();
      if (!keyInfo.configured || !keyInfo.publicKey)
        throw new Error("Notifications are not configured on the server yet");

      const requested = await Notification.requestPermission();
      setPermission(requested);
      if (requested !== "granted")
        throw new Error("Notification permission was not granted");

      const reg = await getPushRegistration();
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyInfo.publicKey),
        }));

      if (!existing) {
        await api.savePushSubscription(pushSubscriptionPayload(sub), {
          tradeEnabled: false,
          chatEnabled: false,
        });
      } else {
        const status = await api
          .pushSubscriptionStatus(existing.endpoint)
          .catch(() => null);
        if (!status) {
          await api.savePushSubscription(pushSubscriptionPayload(existing), {
            tradeEnabled: false,
            chatEnabled: false,
          });
        }
      }

      setSubscribed(true);
      toast(
        "This device can now receive notifications. Choose your alerts below.",
      );
      window.dispatchEvent(new Event("cs:push-changed"));
    } catch (e: any) {
      const msg = e?.message ?? "Failed to allow notifications on this device";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice() {
    setErr("");
    setBusy(true);
    try {
      const reg = await getPushRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.deletePushSubscription(sub.endpoint).catch(() => null);
        await sub.unsubscribe().catch(() => false);
      }
      setSubscribed(false);
      toast("Notifications removed from this device");
      window.dispatchEvent(new Event("cs:push-changed"));
    } catch (e: any) {
      const msg = e?.message ?? "Failed to remove this device";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  const showAllowDevice =
    supported &&
    configured &&
    permission !== "denied" &&
    (permission !== "granted" || !subscribed);
  const showRemoveDevice = subscribed;

  return (
    <div className="notify-device-card">
      <div className="notify-device-head">
        <div>
          <div className="notify-title">Device permission</div>
          <div className="notify-sub">
            Allow or remove browser notifications on this exact device/browser.
          </div>
        </div>
        <div
          className={`permission-pill ${permission === "granted" && subscribed ? "ok" : permission === "denied" ? "bad" : "warn"}`}
        >
          {pushPermissionText(permission)}
          {permission === "granted"
            ? subscribed
              ? " · subscribed"
              : " · not subscribed"
            : ""}
        </div>
      </div>
      <div className="notify-sub notify-help">
        {configured
          ? pushPermissionHelp(permission, subscribed)
          : "Server VAPID keys are missing, so users cannot subscribe for notifications yet."}
      </div>
      {err && <div className="err mini-err">{err}</div>}
      {(showAllowDevice || showRemoveDevice) && (
        <div className="notify-actions row-actions">
          {showAllowDevice && (
            <button
              className="primary inline"
              onClick={allowDevice}
              disabled={busy}
            >
              {busy ? <span className="spin" /> : "Allow this device"}
            </button>
          )}
          {showRemoveDevice && (
            <button
              className="ghost inline"
              onClick={removeDevice}
              disabled={busy || !supported}
            >
              Remove this device
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AlertSoundToggle() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(() => alertSoundEnabled());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function enable() {
    setErr("");
    setBusy(true);
    try {
      await enableAlertSound();
      setEnabled(true);
      toast("Alert sounds enabled on this device");
    } catch (e: any) {
      const msg = e?.message ?? "Failed to enable alert sounds";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  function disable() {
    disableAlertSound();
    setEnabled(false);
    toast("Alert sounds disabled on this device");
  }

  function test() {
    playChime("fill", true);
  }

  return (
    <div className="notify-row">
      <div>
        <div className="notify-title">Alert sounds</div>
        <div className="notify-sub">
          Plays a sound for fills/fails while Claim Sniper is open in another
          tab or window. It will not work after the tab is closed.
        </div>
        {err && <div className="err mini-err">{err}</div>}
      </div>
      <div className="notify-actions">
        <button
          className={`${enabled ? "ghost" : "primary"} inline`}
          onClick={enabled ? disable : enable}
          disabled={busy}
        >
          {busy ? (
            <span className="spin" />
          ) : enabled ? (
            "Disable sounds"
          ) : (
            "Enable sounds"
          )}
        </button>
        {enabled && (
          <button className="ghost inline" onClick={test} disabled={busy}>
            Test sound
          </button>
        )}
      </div>
    </div>
  );
}

function NotificationToggle() {
  const toast = useToast();
  const [supported, setSupported] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;

    async function load() {
      const canUse =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!canUse) {
        if (!stop) setSupported(false);
        return;
      }

      try {
        const [keyInfo, reg] = await Promise.all([
          api.pushPublicKey(),
          getPushRegistration(),
        ]);
        const sub = await reg.pushManager.getSubscription();
        if (stop) return;
        setConfigured(keyInfo.configured && !!keyInfo.publicKey);
        if (!sub) {
          setEnabled(false);
          return;
        }
        const status = await api
          .pushSubscriptionStatus(sub.endpoint)
          .catch(() => null);
        if (!stop) setEnabled(!!status?.tradeEnabled);
      } catch {
        if (!stop) setSupported(false);
      }
    }

    load();
    const refresh = () => void load();
    window.addEventListener("cs:push-changed", refresh);
    return () => {
      stop = true;
      window.removeEventListener("cs:push-changed", refresh);
    };
  }, []);

  async function enable() {
    setErr("");
    setBusy(true);
    try {
      const sub = await ensurePushSubscription();
      await api.savePushSubscription(pushSubscriptionPayload(sub), {
        tradeEnabled: true,
      });
      setEnabled(true);
      toast("Snipe notifications enabled on this device");
      window.dispatchEvent(new Event("cs:push-changed"));
    } catch (e: any) {
      const msg = e?.message ?? "Failed to enable notifications";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setErr("");
    setBusy(true);
    try {
      const reg = await getPushRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub)
        await api.updatePushPreferences(sub.endpoint, { tradeEnabled: false });
      setEnabled(false);
      toast("Snipe notifications disabled on this device");
      window.dispatchEvent(new Event("cs:push-changed"));
    } catch (e: any) {
      const msg = e?.message ?? "Failed to disable notifications";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setErr("");
    setBusy(true);
    try {
      const res = await api.pushTest();
      toast(
        res.sent > 0 ? "Test notification sent" : "No subscribed devices found",
        res.sent > 0 ? "ok" : "err",
      );
    } catch (e: any) {
      const msg = e?.message ?? "Failed to send test notification";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notify-row">
      <div>
        <div className="notify-title">Snipe alerts</div>
        <div className="notify-sub">
          {supported
            ? configured
              ? "Get a notification on this device when one of your snipes fills or fails."
              : "Server VAPID keys are missing, so notifications are currently off."
            : "This browser does not support web push. On iPhone, install the site to your Home Screen first."}
        </div>
        {err && <div className="err mini-err">{err}</div>}
      </div>
      <div className="notify-actions">
        <button
          className={`${enabled ? "ghost" : "primary"} inline`}
          onClick={enabled ? disable : enable}
          disabled={busy || !supported || !configured}
        >
          {busy ? (
            <span className="spin" />
          ) : enabled ? (
            "Disable snipe alerts"
          ) : (
            "Enable snipe alerts"
          )}
        </button>
        {enabled && (
          <button className="ghost inline" onClick={sendTest} disabled={busy}>
            Send test
          </button>
        )}
      </div>
    </div>
  );
}

function ChatNotificationToggle() {
  const toast = useToast();
  const [supported, setSupported] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;

    async function load() {
      const canUse =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!canUse) {
        if (!stop) setSupported(false);
        return;
      }

      try {
        const [keyInfo, reg] = await Promise.all([
          api.pushPublicKey(),
          getPushRegistration(),
        ]);
        const sub = await reg.pushManager.getSubscription();
        if (stop) return;
        setConfigured(keyInfo.configured && !!keyInfo.publicKey);
        if (!sub) {
          setEnabled(false);
          return;
        }
        const status = await api
          .pushSubscriptionStatus(sub.endpoint)
          .catch(() => null);
        if (!stop) setEnabled(!!status?.chatEnabled);
      } catch {
        if (!stop) setSupported(false);
      }
    }

    load();
    const refresh = () => void load();
    window.addEventListener("cs:push-changed", refresh);
    return () => {
      stop = true;
      window.removeEventListener("cs:push-changed", refresh);
    };
  }, []);

  async function enable() {
    setErr("");
    setBusy(true);
    try {
      const sub = await ensurePushSubscription();
      await api.savePushSubscription(pushSubscriptionPayload(sub), {
        chatEnabled: true,
      });
      setEnabled(true);
      toast("Chat notifications enabled on this device");
      window.dispatchEvent(new Event("cs:push-changed"));
    } catch (e: any) {
      const msg = e?.message ?? "Failed to enable chat notifications";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setErr("");
    setBusy(true);
    try {
      const reg = await getPushRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub)
        await api.updatePushPreferences(sub.endpoint, { chatEnabled: false });
      setEnabled(false);
      toast("Chat notifications disabled on this device");
      window.dispatchEvent(new Event("cs:push-changed"));
    } catch (e: any) {
      const msg = e?.message ?? "Failed to disable chat notifications";
      setErr(msg);
      toast(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notify-row chat-notify-row">
      <div>
        <div className="notify-title">Chat notifications</div>
        <div className="notify-sub">
          {supported
            ? configured
              ? "Get a notification on this device when another trader sends a chat message."
              : "Server VAPID keys are missing, so chat notifications are currently off."
            : "This browser does not support web push. On iPhone, install the site to your Home Screen first."}
        </div>
        {err && <div className="err mini-err">{err}</div>}
      </div>
      <button
        className={`${enabled ? "ghost" : "primary"} inline`}
        onClick={enabled ? disable : enable}
        disabled={busy || !supported || !configured}
      >
        {busy ? (
          <span className="spin" />
        ) : enabled ? (
          "Disable chat alerts"
        ) : (
          "Enable chat alerts"
        )}
      </button>
    </div>
  );
}

function MobileNotificationGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="phone-guide">
      <button
        type="button"
        className="phone-guide-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div>
          <div className="notify-title">Phone notifications</div>
          <div className="notify-sub">
            Use these steps on each phone you want alerts on. Phone
            notifications are still browser notifications, so the site needs
            permission on that device too.
          </div>
        </div>
        <span className={`phone-guide-arrow ${open ? "open" : ""}`}>⌄</span>
      </button>

      {open && (
        <div className="phone-guide-body">
          <div className="phone-guide-grid">
            <div className="phone-guide-card">
              <h3>iPhone / iPad</h3>
              <ol>
                <li>
                  Open <b>claimsniper.fun</b> in <b>Safari</b>.
                </li>
                <li>
                  Tap <b>Share</b>, then <b>Add to Home Screen</b>.
                </li>
                <li>Open Claim Sniper from the Home Screen icon.</li>
                <li>
                  Go to <b>Settings → Notifications</b> in Claim Sniper.
                </li>
                <li>
                  Tap <b>Allow this device</b> and accept the iOS notification
                  prompt.
                </li>
                <li>
                  Enable <b>Snipe alerts</b> and/or <b>Chat notifications</b>.
                </li>
              </ol>
              <div className="notify-sub">
                If you accidentally block it, check iOS Settings →
                Notifications, then reopen the Home Screen app.
              </div>
            </div>
            <div className="phone-guide-card">
              <h3>Android</h3>
              <ol>
                <li>
                  Open <b>claimsniper.fun</b> in <b>Chrome</b>.
                </li>
                <li>
                  Go to <b>Settings → Notifications</b> in Claim Sniper.
                </li>
                <li>
                  Tap <b>Allow this device</b> and accept the browser
                  notification prompt.
                </li>
                <li>
                  Enable <b>Snipe alerts</b> and/or <b>Chat notifications</b>.
                </li>
                <li>
                  If nothing appears, open Chrome site settings for Claim Sniper
                  and set Notifications to <b>Allow</b>.
                </li>
                <li>
                  Also check Android Settings → Apps → Chrome → Notifications.
                </li>
              </ol>
            </div>
          </div>
          <div className="phone-note">
            Tip: keep the browser installed and notifications allowed in the
            phone OS. Private/incognito browsing will not keep a reliable push
            subscription.
          </div>
        </div>
      )}
    </div>
  );
}

function Social({
  wallets,
  tradingPlatform,
  currentUsername,
  onCopied,
}: {
  wallets: Wallet[];
  tradingPlatform: TradingPlatform;
  currentUsername: string;
  onCopied: () => void;
}) {
  const toast = useToast();

  const [tab, setTabState] = useState<"trending" | "traders" | "chat">(() => initialSocialTabFromUrl());
  const setTab = (next: "trending" | "traders" | "chat") => {
    setTabState(next);
    localStorage.setItem("cs.socialTab", next);
    updateRoute({ view: "social", socialTab: next === "trending" ? null : next, tab: null });
  };
  useEffect(() => {
    const pop = () => setTabState(initialSocialTabFromUrl());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const [users, setUsers] = useState<SocialUser[]>([]);
  const [trending, setTrending] = useState<TrendingCoin[]>([]);
  const [copyTrades, setCopyTrades] = useState<CopyTrade[]>([]);
  const [copyTrader, setCopyTrader] = useState<SocialUser | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [copy, setCopy] = useState<{
    mint: string;
    ticker?: string | null;
    triggerMode: "CLAIM" | "REDIRECT";
    source?: PublicSnipe;
  } | null>(null);

  function load() {
    api.socialUsers().then((r) => setUsers(r.users)).catch(() => {});
    api.socialTrending().then((r) => setTrending(r.coins)).catch(() => {});
    api.copyTrades().then((r) => setCopyTrades(r.copyTrades)).catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    saveChoice(NAV_SOCIAL_TAB_KEY, tab);
  }, [tab]);

  useEffect(() => {
    document.body.classList.toggle("chat-view-active", tab === "chat");
    return () => document.body.classList.remove("chat-view-active");
  }, [tab]);

  return (
    <div className={`social ${tab === "chat" ? "social-chat-mode" : ""}`}>
      <div className="page-intro">
        <div><span className="page-kicker">Community</span><h1>Social</h1><p>See what traders are watching, compare activity, and talk without leaving Claim Sniper.</p></div>
      </div>
      <div className="seg dash-tabs social-tabs">
        <button className={`seg-btn ${tab === "trending" ? "on" : ""}`} onClick={() => setTab("trending")}>Trending</button>
        <button className={`seg-btn ${tab === "traders" ? "on" : ""}`} onClick={() => setTab("traders")}>Traders</button>
        <button className={`seg-btn ${tab === "chat" ? "on" : ""}`} onClick={() => setTab("chat")}>Chat</button>
      </div>

      {tab === "trending" ? (
        <div className="card rise d1 social-card">
          <div className="section-heading"><div><h2>Most sniped coins</h2><p>Coins with the most active interest across Claim Sniper.</p></div></div>
          {trending.length === 0 && <p className="sub">No active snipes across the platform right now.</p>}
          <div className="trending-list">
            {trending.slice(0, 8).map((c, i) => (
              <div className="trending-row" key={c.mint}>
                <span className="trend-rank">{String(i + 1).padStart(2, '0')}</span>
                <div className="trend-coin"><strong>{c.ticker ? `$${c.ticker}` : short(c.mint)}</strong><CopyCA mint={c.mint} /></div>
                <div className="trend-metric"><strong>{c.userCount}</strong><span>{c.userCount === 1 ? "trader" : "traders"}</span></div>
                <div className="trend-metric"><strong>{c.snipeCount}</strong><span>snipes</span></div>
                {c.redirectCount > 0 && <span className="tp-chip">{c.redirectCount} redirect</span>}
                <button className="ghost mini" onClick={() => setCopy({ mint: c.mint, ticker: c.ticker, triggerMode: c.redirectCount > c.snipeCount - c.redirectCount ? "REDIRECT" : "CLAIM" })}>Copy</button>
              </div>
            ))}
          </div>
        </div>
      ) : tab === "traders" ? (
        <div className="card rise d1 social-card">
          <div className="section-heading"><div><h2>Traders</h2><p>Browse public trading activity and inspect shared snipes.</p></div></div>
          {copyTrades.length > 0 && (
            <div className="copytrade-active-strip">
              <div><strong>Copy trading</strong><span>{copyTrades.filter((c) => c.enabled).length} trader{copyTrades.filter((c) => c.enabled).length === 1 ? "" : "s"} active</span></div>
              <div className="copytrade-active-list">
                {copyTrades.slice(0, 5).map((c) => (
                  <button key={c.id} className={`copytrade-chip ${c.enabled ? "on" : ""}`} onClick={() => { const u = users.find((x) => x.id === c.leaderUserId); if (u) setCopyTrader(u); }}>
                    <span>{c.enabled ? "●" : "○"}</span>@{c.leader?.username ?? "trader"}<small>{c.activeMirrors} live</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {users.length === 0 && <p className="sub">No paid traders yet.</p>}
          <div className="trader-grid">
            {users.map((u) => {
              const followed = copyTrades.find((c) => c.leaderUserId === u.id);
              const isSelf = u.username.toLowerCase() === currentUsername.toLowerCase();
              return (
                <div className={`trader-card ${followed?.enabled ? "copying" : ""}`} key={u.id}>
                  <button className="trader-card-main" onClick={() => setOpenUserId(u.id)}>
                    <AvatarBubble username={u.username} avatarDataUrl={u.avatarDataUrl ?? null} size="sm" />
                    <div className="trader-main"><strong>@{u.username}</strong><span>{u.filledCount} filled · {u.snipeCount} snipes</span></div>
                    <Pnl net={u.netSol} />
                  </button>
                  <button className={`copytrade-action ${followed?.enabled ? "on" : ""}`} disabled={isSelf} onClick={() => !isSelf && setCopyTrader(u)}>
                    {isSelf ? "You" : followed?.enabled ? "Copying" : "Copy trade"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ChatBox tradingPlatform={tradingPlatform} />
      )}

      {copyTrader && <CopyTraderModal trader={copyTrader} wallets={wallets} existing={copyTrades.find((c) => c.leaderUserId === copyTrader.id) ?? null} onClose={() => setCopyTrader(null)} onChanged={() => { load(); onCopied(); }} />}
      {openUserId && <UserSnipesModal userId={openUserId} tradingPlatform={tradingPlatform} onClose={() => setOpenUserId(null)} onCopy={(s) => setCopy({ mint: s.mint, ticker: s.ticker, triggerMode: s.triggerMode === "REDIRECT" ? "REDIRECT" : "CLAIM", source: s })} />}
      {copy && <CopyPublicModal mint={copy.mint} ticker={copy.ticker} triggerMode={copy.triggerMode} source={copy.source} wallets={wallets} onClose={() => setCopy(null)} onCopied={() => { setCopy(null); toast("Snipe armed from copied coin"); onCopied(); }} />}
    </div>
  );
}

function chatDayLabel(value: string) {
  const d = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (day === today) return "Today";
  if (day === today - 86400000) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

const CHAT_PAGE_SIZE = 20;

function ChatBox({ tradingPlatform }: { tradingPlatform: TradingPlatform }) {
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [newWhileUp, setNewWhileUp] = useState(0);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState("smileys");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => readRecentEmojis());
  const [reactingTo, setReactingTo] = useState<ChatMessage | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastRef = useRef<ChatMessage | null>(null);
  const firstRef = useRef<ChatMessage | null>(null);
  const pollingRef = useRef(false);
  const olderRef = useRef(false);
  const sendingRef = useRef(false);
  const initializedRef = useRef(false);
  const initialBottomPinRef = useRef(false);
  const initialBottomPinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const mergeMessages = useCallback((prev: ChatMessage[], incoming: ChatMessage[]) => {
    const byId = new Map(prev.map((m) => [m.id, m]));
    for (const m of incoming) byId.set(m.id, m);
    const merged = [...byId.values()].sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
    );
    firstRef.current = merged[0] ?? null;
    lastRef.current = merged[merged.length - 1] ?? null;
    return merged;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const apply = () => {
      const el = feedRef.current;
      if (!el) return;
      const top = Math.max(0, el.scrollHeight - el.clientHeight);
      if (smooth) el.scrollTo({ top, behavior: "smooth" });
      else el.scrollTop = top;
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
      setNewWhileUp(0);
    };

    // One frame is not enough when chat images/fonts are still settling.
    // Apply twice so the initial viewport lands on the real final bottom.
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  }, []);

  const settleInitialBottom = useCallback(() => {
    initialBottomPinRef.current = true;
    scrollToBottom(false);

    // Data-URL images can decode after React has committed. Keep the initial
    // viewport pinned briefly, then release it so normal user scrolling wins.
    const delays = [60, 180, 420, 850, 1500, 2400];
    for (const delay of delays) {
      setTimeout(() => {
        if (initialBottomPinRef.current) scrollToBottom(false);
      }, delay);
    }
    if (initialBottomPinTimerRef.current) clearTimeout(initialBottomPinTimerRef.current);
    initialBottomPinTimerRef.current = setTimeout(() => {
      initialBottomPinRef.current = false;
      initialBottomPinTimerRef.current = null;
    }, 2600);
  }, [scrollToBottom]);

  const loadInitial = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const r = await api.socialChat({ limit: CHAT_PAGE_SIZE });
      setMessages((prev) => mergeMessages(prev, r.messages));
      setHasMore(r.hasMore);
      initializedRef.current = true;
      settleInitialBottom();
    } catch { /* keep last good state */ }
    finally { pollingRef.current = false; }
  }, [mergeMessages, settleInitialBottom]);

  const pollNew = useCallback(async () => {
    if (!initializedRef.current) return void loadInitial();
    if (pollingRef.current) return;
    pollingRef.current = true;
    const el = feedRef.current;
    const wasNearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 110;
    try {
      const last = lastRef.current;
      const r = await api.socialChat(last ? { after: last.createdAt, afterId: last.id, limit: CHAT_PAGE_SIZE } : { limit: CHAT_PAGE_SIZE });
      if (r.messages.length) {
        setMessages((prev) => mergeMessages(prev, r.messages));
        if (wasNearBottom) scrollToBottom(true);
        else setNewWhileUp((n) => n + r.messages.length);
      }
      if (r.hasMore) setTimeout(() => void pollNew(), 0);
    } catch { /* keep last good page */ }
    finally { pollingRef.current = false; }
  }, [loadInitial, mergeMessages, scrollToBottom]);

  const loadOlder = useCallback(async () => {
    if (olderRef.current || !hasMore || !firstRef.current) return;
    olderRef.current = true;
    setLoadingOlder(true);
    const el = feedRef.current;
    const oldHeight = el?.scrollHeight ?? 0;
    const cursor = firstRef.current;
    try {
      const r = await api.socialChat({ before: cursor.createdAt, beforeId: cursor.id, limit: CHAT_PAGE_SIZE });
      setMessages((prev) => mergeMessages(prev, r.messages));
      setHasMore(r.hasMore);
      requestAnimationFrame(() => {
        const feed = feedRef.current;
        if (feed) feed.scrollTop += feed.scrollHeight - oldHeight;
      });
    } catch { /* keep current page */ }
    finally { olderRef.current = false; setLoadingOlder(false); }
  }, [hasMore, mergeMessages]);

  useEffect(() => {
    void loadInitial();
    const timer = setInterval(() => void pollNew(), 5000);
    return () => {
      clearInterval(timer);
      if (initialBottomPinTimerRef.current) clearTimeout(initialBottomPinTimerRef.current);
      initialBottomPinRef.current = false;
    };
  }, [loadInitial, pollNew]);

  // Pin after React has committed the initial batch, not just after the API
  // request resolves. This closes the render-timing gap that could leave chat
  // a few messages above the real bottom.
  useLayoutEffect(() => {
    if (initializedRef.current && initialBottomPinRef.current) scrollToBottom(false);
  }, [messages, scrollToBottom]);

  // Mobile viewport changes, fonts and decoded images can alter the feed height
  // after the first render. Keep following those changes until the initial pin
  // settles; scrolling up manually immediately releases the pin.
  useEffect(() => {
    const content = feedRef.current?.querySelector<HTMLElement>(".chat-feed-content");
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (initialBottomPinRef.current) scrollToBottom(false);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  const emojiOptions = useMemo(() => {
    const q = emojiSearch.trim().toLowerCase().replace(/[_-]+/g, " ");
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      const aliases = new Map(EMOJIS.map((entry) => [entry.emoji, entry]));
      return EMOJI_CATEGORIES
        .filter((c) => c.id !== "recent")
        .flatMap((c) => c.emojis.map((emoji) => ({ emoji, category: c.label, meta: aliases.get(emoji) })))
        .filter(({ emoji, category, meta }) => {
          const hay = `${emoji} ${category} ${meta?.name ?? ""} ${meta?.aliases.join(" ") ?? ""} ${meta?.category ?? ""}`.toLowerCase();
          return words.every((word) => hay.includes(word));
        })
        .map((entry) => entry.emoji)
        .filter((emoji, index, list) => list.indexOf(emoji) === index);
    }
    if (emojiCategory === "recent") {
      return recentEmojis.length ? recentEmojis : DEFAULT_REACTION_EMOJIS;
    }
    return EMOJI_CATEGORIES.find((c) => c.id === emojiCategory)?.emojis ?? allEmojiList();
  }, [emojiCategory, emojiSearch, recentEmojis]);

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    const nextRecent = rememberEmoji(emoji);
    setRecentEmojis(nextRecent);
    if (!input) {
      setText((v) => `${v}${emoji}`);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + emoji.length;
      input.setSelectionRange(pos, pos);
    });
  }

  function closeEmojiPanel() {
    setEmojiOpen(false);
    setReactingTo(null);
    setEmojiSearch("");
  }

  async function chooseEmoji(emoji: string) {
    const nextRecent = rememberEmoji(emoji);
    setRecentEmojis(nextRecent);
    if (reactingTo) {
      await react(reactingTo, emoji);
      closeEmojiPanel();
      return;
    }
    insertEmoji(emoji);
  }

  async function pickImage(file?: File | null) {
    if (!file) return;
    try {
      const data = await resizeChatImage(file);
      setImageDataUrl(data);
    } catch (e: any) {
      toast(e?.message ?? "Could not attach image", "err");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    const image = files.find((file) => file.type.startsWith("image/"));
    if (!image) return;

    e.preventDefault();
    void pickImage(image);
  }

  async function send() {
    const t = text.trim();
    if ((!t && !imageDataUrl) || sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true);
    try {
      const r = await api.socialSend({
        text: t,
        imageDataUrl,
        replyToId: replyTo?.id ?? null,
      });
      setText("");
      setImageDataUrl(null);
      setReplyTo(null);
      closeEmojiPanel();
      setMessages((prev) => mergeMessages(prev, [r.message]));
      scrollToBottom(true);
    } catch (e: any) {
      toast(e?.message ?? "Failed to send message", "err");
    } finally {
      setBusy(false);
      sendingRef.current = false;
    }
  }

  async function react(message: ChatMessage, emoji: string) {
    try {
      const r = await api.socialReact(message.id, emoji);
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, reactions: r.reactions } : m)),
      );
    } catch (e: any) {
      toast(e?.message ?? "Failed to react", "err");
    }
  }

  return (
    <div className="card rise d1 chat telegram-chat chat-polished">
      <div className="chat-head"><div><h2>Trader chat</h2><p>Live community chat · newest messages load first</p></div><span className="live-pill"><i /> Live</span></div>
      <div className="chat-feed-wrap">
        <div className="chat-feed telegram-feed" ref={feedRef} onScroll={(e) => {
          const el = e.currentTarget;
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (distanceFromBottom > 120) initialBottomPinRef.current = false;
          if (el.scrollTop <= 40) void loadOlder();
          if (distanceFromBottom < 80) setNewWhileUp(0);
        }}>
          <div className="chat-feed-content">
          {loadingOlder && <div className="chat-loading"><span className="spin" /> Loading earlier messages…</div>}
          {!loadingOlder && hasMore && <p className="sub chat-history-hint">Scroll up for earlier messages</p>}
          {messages.length === 0 && <p className="sub">No messages yet. Say hi.</p>}
          {messages.map((m, index) => (
            <div className="chat-message-group" key={m.id}>
              {(index === 0 || chatDayLabel(messages[index - 1].createdAt) !== chatDayLabel(m.createdAt)) && <div className="chat-day"><span>{chatDayLabel(m.createdAt)}</span></div>}
              <div className="chat-msg telegram-msg">
            <ChatAvatar message={m} />
            <div className="chat-stack">
              <div className="chat-bubble telegram-bubble">
                <div className="chat-meta-line">
                  <span
                    className="chat-user"
                    style={{ color: m.chatColor || DEFAULT_CHAT_COLOR }}
                  >
                    @{m.username}
                  </span>
                  <span className="chat-time">{chatStamp(m.createdAt)}</span>
                </div>
                {m.replyTo && (
                  <button
                    className="chat-reply-preview"
                    type="button"
                    onClick={() => setReplyTo(null)}
                    title="Reply context"
                  >
                    <b>@{m.replyTo.username}</b>
                    <span>
                      {m.replyTo.text || (m.replyTo.imageDataUrl ? "Image" : chatTokenLabel(m.replyTo) ?? "Message")}
                    </span>
                  </button>
                )}
                {m.imageDataUrl && (
                  <img className="chat-image" src={m.imageDataUrl} alt="chat upload" onLoad={() => { if (initialBottomPinRef.current) scrollToBottom(false); }} />
                )}
                <span className="chat-text">
                  <ChatTextContent message={m} tradingPlatform={tradingPlatform} />
                </span>
                <div className="chat-actions-row">
                  <button className="chat-action" type="button" onClick={() => setReplyTo(m)}>
                    <AppIcon name="reply" />
                    <span>Reply</span>
                  </button>
                  <span className="chat-action-sep">·</span>
                  <button
                    className="chat-action"
                    type="button"
                    onClick={() => {
                      setReactingTo(m);
                      setEmojiOpen(true);
                      setEmojiCategory("recent");
                    }}
                  >
                    <AppIcon name="reaction" />
                    <span>React</span>
                  </button>
                </div>
              </div>
              {!!m.reactions?.length && (
                <div className="chat-reactions">
                  {m.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      className={r.reacted ? "on" : ""}
                      type="button"
                      onClick={() => react(m, r.emoji)}
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                </div>
              )}
            </div>
              </div>
            </div>
          ))}
          <div className="chat-bottom-anchor" ref={bottomRef} aria-hidden="true" />
          </div>
        </div>
        {newWhileUp > 0 && <button className="new-messages-btn" onClick={() => scrollToBottom(true)}>↓ {newWhileUp} new {newWhileUp === 1 ? "message" : "messages"}</button>}
      </div>

      {replyTo && (
        <div className="chat-compose-context">
          <div>
            <b>Replying to @{replyTo.username}</b>
            <span>{replyTo.text || (replyTo.imageDataUrl ? "Image" : chatTokenLabel(replyTo) ?? "Message")}</span>
          </div>
          <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><AppIcon name="close" /></button>
        </div>
      )}
      {imageDataUrl && (
        <div className="chat-image-preview">
          <img src={imageDataUrl} alt="upload preview" />
          <button type="button" onClick={() => setImageDataUrl(null)}>Remove</button>
        </div>
      )}
      {emojiOpen && (
        <div className="chat-emoji-panel telegram-emoji-panel">
          <div className="emoji-panel-head">
            <div>
              <b>{reactingTo ? `Reacting to @${reactingTo.username}` : "Emoji"}</b>
              <span>{reactingTo ? "Pick any emoji reaction" : "Search or browse the full emoji keyboard"}</span>
            </div>
            <button type="button" className="emoji-close" onClick={closeEmojiPanel} aria-label="Close emoji keyboard"><AppIcon name="close" /></button>
          </div>
          <input
            className="emoji-search"
            value={emojiSearch}
            placeholder="Search emoji"
            onChange={(e) => setEmojiSearch(e.target.value)}
          />
          <div className="emoji-tabs" role="tablist" aria-label="Emoji categories">
            {EMOJI_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                className={emojiCategory === category.id ? "on" : ""}
                title={category.label}
                onClick={() => {
                  setEmojiCategory(category.id);
                  setEmojiSearch("");
                }}
              >
                <AppIcon name={category.icon} />
              </button>
            ))}
          </div>
          <div className="emoji-grid" role="listbox">
            {emojiOptions.map((emoji, i) => (
              <button key={`${emoji}-${i}`} type="button" onClick={() => void chooseEmoji(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="chat-input telegram-input sticky-composer">
        <input
          ref={inputRef}
          value={text}
          maxLength={500}
          placeholder="Message the traders..."
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send();
          }}
        />
        <button
          className="chat-tool"
          type="button"
          onClick={() => {
            setReactingTo(null);
            setEmojiOpen((v) => !v);
          }}
          title="Emoji"
          aria-label="Open emoji keyboard"
        >
          <AppIcon name="smile" />
        </button>
        <button
          className="chat-tool"
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Upload image"
          aria-label="Attach image"
        >
          <AppIcon name="image" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <button
          className="primary inline send-btn"
          onClick={send}
          disabled={busy || (!text.trim() && !imageDataUrl)}
          title="Send"
          aria-label="Send message"
        >
          {busy ? <span className="spin" /> : <AppIcon name="send" />}
        </button>
      </div>
    </div>
  );
}

function CopyTraderModal({
  trader,
  wallets,
  existing,
  onClose,
  onChanged,
}: {
  trader: SocialUser;
  wallets: Wallet[];
  existing: CopyTrade | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [walletId, setWalletId] = useState(existing?.walletId ?? wallets[0]?.id ?? "");
  const [syncExisting, setSyncExisting] = useState(true);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!walletId) return toast("Add a wallet before enabling copy trading", "err");
    setBusy(true);
    try {
      if (existing) {
        await api.updateCopyTrade(existing.id, {
          walletId,
          enabled: true,
          syncExisting,
        });
        toast(`Copy trading @${trader.username} updated`);
      } else {
        const result = await api.startCopyTrade({
          leaderUserId: trader.id,
          walletId,
          syncExisting,
        });
        toast(result.synced > 0
          ? `Copying @${trader.username} · ${result.synced} active snipe${result.synced === 1 ? "" : "s"} mirrored`
          : `Now copy trading @${trader.username}`);
      }
      onChanged();
      onClose();
    } catch (e: any) {
      toast(friendlyError(e.message), "err");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!existing) return;
    setBusy(true);
    try {
      const result = await api.deleteCopyTrade(existing.id);
      toast(`Stopped copy trading @${trader.username}${result.cancelled ? ` · ${result.cancelled} pending copied snipe${result.cancelled === 1 ? "" : "s"} disarmed` : ""}${result.inFlight ? ` · ${result.inFlight} already buying left untouched` : ""}`);
      onChanged();
      onClose();
    } catch (e: any) {
      toast(friendlyError(e.message), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal copytrader-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="copytrader-head">
          <AvatarBubble username={trader.username} avatarDataUrl={trader.avatarDataUrl ?? null} size="md" />
          <div><span className="page-kicker">Copy trader</span><h3>@{trader.username}</h3><p>Mirror this trader&apos;s original snipe actions automatically.</p></div>
          {existing?.enabled && <span className="copytrade-live"><i /> Active</span>}
        </div>

        <div className="copytrader-summary">
          <div><span>Trader activity</span><strong>{trader.snipeCount} snipes</strong></div>
          <div><span>Filled</span><strong>{trader.filledCount}</strong></div>
          <div><span>Net P&amp;L</span><Pnl net={trader.netSol} /></div>
        </div>

        <div className="copytrader-explainer">
          <strong>What gets mirrored</strong>
          <p>When @{trader.username} arms, edits, pauses, unpauses or disarms an original snipe, Claim Sniper mirrors that action for you server-side.</p>
          <div className="copytrader-settings-grid">
            <span>Amount</span><span>Trigger</span><span>Slippage</span><span>Priority / tip</span><span>MC limits</span><span>TP / SL</span><span>Execution mode</span><span>Watched wallet</span>
          </div>
        </div>

        <label>Use your wallet</label>
        {wallets.length ? (
          <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
        ) : (
          <div className="warning-box">You need to add a trading wallet before you can copy a trader.</div>
        )}
        <p className="copytrader-wallet-note">All settings are mirrored from the trader, but transactions are signed only by your selected wallet. Their private key is never involved.</p>

        <label className="copytrader-check">
          <input type="checkbox" checked={syncExisting} onChange={(e) => setSyncExisting(e.target.checked)} />
          <span><strong>Mirror currently active snipes</strong><small>Also copy the trader&apos;s ARMED or PAUSED original snipes immediately.</small></span>
        </label>

        <div className="copytrader-safety">
          <span>↳</span>
          <p>Copied snipes never cascade into another copy trader, so copy loops cannot form. If one of your copied snipes is already buying when the trader disarms, it will not be force-cancelled mid-transaction.</p>
        </div>

        <div className="modal-actions copytrader-actions">
          {existing && <button className="danger" disabled={busy} onClick={stop}>Stop copying</button>}
          <button className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !walletId} onClick={save}>{busy ? <span className="spin" /> : existing ? "Save copy trader" : "Start copy trading"}</button>
        </div>
      </div>
    </div>
  );
}

function UserSnipesModal({
  userId,
  tradingPlatform,
  onClose,
  onCopy,
}: {
  userId: string;
  tradingPlatform: TradingPlatform;
  onClose: () => void;
  onCopy: (s: PublicSnipe) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<{
    username: string;
    active: PublicSnipe[];
    filled: PublicSnipe[];
  } | null>(null);
  const [tab, setTab] = useState<"active" | "filled">("active");
  const [page, setPage] = useState(0);
  const PAGE = 5;

  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .socialUserSnipes(userId)
        .then((r) => {
          if (alive) setData(r);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [userId]);
  useEffect(() => setPage(0), [tab]);

  const all = data ? (tab === "active" ? data.active : data.filled) : [];
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const rows = all.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h3>@{data?.username ?? "..."}</h3>
        <div className="seg">
          <button
            className={`seg-btn ${tab === "active" ? "on" : ""}`}
            onClick={() => setTab("active")}
          >
            Active ({data?.active.length ?? 0})
          </button>
          <button
            className={`seg-btn ${tab === "filled" ? "on" : ""}`}
            onClick={() => setTab("filled")}
          >
            Filled ({data?.filled.length ?? 0})
          </button>
        </div>
        <div className="admin-list">
          {rows.length === 0 && <p className="sub">Nothing here.</p>}
          {rows.map((s) => (
            <div className="admin-row trader-coin-row" key={s.id}>
              <CopyCA mint={s.mint} ticker={s.ticker} />
              {tab === "active" && (
                <span
                  className={`trader-market-cap ${s.liveMarketCapUsd == null ? "loading" : ""}`}
                  title={
                    s.liveMarketCapUpdatedAt
                      ? `Market cap updated ${new Date(s.liveMarketCapUpdatedAt).toLocaleTimeString()} from ${s.liveMarketCapSource ?? "live feed"}`
                      : "Waiting for live Pump market-cap update"
                  }
                >
                  <em>Market Cap</em>
                  <b>{snipeMarketCapLabel(s)}</b>
                </span>
              )}
              <span className="dim">{s.amountSol} SOL</span>
              {s.triggerMode === "REDIRECT" && (
                <span className="tp-chip">redirect</span>
              )}
              {tab === "filled" && <Pnl net={s.soldSol - s.amountSol} />}
              <button
                className="ghost mini"
                onClick={() => openInTradingPlatform(tradingPlatform, s, toast)}
              >
                View
              </button>
              <button className="ghost mini" onClick={() => onCopy(s)}>
                Copy
              </button>
            </div>
          ))}
        </div>
        {all.length > PAGE && (
          <div className="pager">
            <button
              className="ghost mini"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="dim">
              Page {page + 1} of {pages}
            </span>
            <button
              className="ghost mini"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyPublicModal({
  mint,
  ticker,
  triggerMode,
  source,
  wallets,
  onClose,
  onCopied,
}: {
  mint: string;
  ticker?: string | null;
  triggerMode: "CLAIM" | "REDIRECT";
  source?: PublicSnipe;
  wallets: Wallet[];
  onClose: () => void;
  onCopied: () => void;
}) {
  const toast = useToast();
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState(
    source?.amountSol != null ? String(source.amountSol) : "",
  );
  const [slippage, setSlippage] = useState(
    source?.slippagePct != null ? String(source.slippagePct) : "15",
  );
  const [priority, setPriority] = useState(
    source?.priorityFee != null
      ? String(source.priorityFee)
      : (localStorage.getItem("cs.priority") ?? "0.0005"),
  );
  const [bribe, setBribe] = useState(
    source?.bribe != null
      ? String(source.bribe)
      : (localStorage.getItem("cs.bribe") ?? "0"),
  );
  const [onlyWallet, setOnlyWallet] = useState(!!source?.watchWallet);
  const [watchWallet, setWatchWallet] = useState(source?.watchWallet ?? "");
  const ex = useExit(source as Partial<Snipe> | undefined);
  const [busy, setBusy] = useState(false);

  const ready =
    walletId &&
    Number(amount) > 0 &&
    (!onlyWallet || watchWallet.trim().length >= 32);

  async function go() {
    setBusy(true);
    try {
      localStorage.setItem("cs.priority", priority);
      localStorage.setItem("cs.bribe", bribe);
      await api.createSnipe({
        mint,
        walletId,
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        priorityFee: Number(priority),
        bribe: Number(bribe),
        execMode: "LOCAL",
        triggerMode,
        onlyRedirected: onlyWallet,
        watchWallet: onlyWallet ? watchWallet.trim() : null,
        exit: ex.build(),
      });
      onCopied();
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Copy {ticker ? `$${ticker}` : "coin"}</h3>
        <div className="copy-locked">
          <div>
            <label>Coin (locked)</label>
            <CopyCA mint={mint} ticker={ticker} />
          </div>
          <span className="tp-chip">
            {triggerMode === "REDIRECT" ? "redirect snipe" : "claim snipe"}
          </span>
        </div>
        <label>Buy with wallet</label>
        <WalletSelect
          wallets={wallets}
          value={walletId}
          onChange={setWalletId}
        />
        <div className="row">
          <div>
            <label>Amount (SOL)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.5"
            />
          </div>
          <div>
            <label>Slippage %</label>
            <input
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div>
            <label>Priority (SOL)</label>
            <input
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </div>
          <div>
            <label>Landing tip (SOL)</label>
            <input value={bribe} onChange={(e) => setBribe(e.target.value)} />
          </div>
        </div>
        <div className="trigger-explain processed-detection">
          <strong>Processed · exact signer</strong>
          <span>Detection is fixed to the strict processed pipeline.</span>
        </div>
        <label className="switch-row" onClick={() => setOnlyWallet((v) => !v)}>
          <span className={`switch ${onlyWallet ? "on" : ""}`}>
            <span className="knob" />
          </span>
          {triggerMode === "REDIRECT"
            ? "Only a specific wallet"
            : "Only a specific wallet's claims"}
        </label>
        {onlyWallet && (
          <div className="tp-fields">
            <label>
              {triggerMode === "REDIRECT"
                ? "Wallet fees get redirected to"
                : "Wallet to watch"}
            </label>
            <input
              value={watchWallet}
              onChange={(e) => setWatchWallet(e.target.value)}
              placeholder={
                triggerMode === "REDIRECT"
                  ? "any wallet address"
                  : "claimer wallet address"
              }
            />
          </div>
        )}
        <ExitFields ex={ex} />
        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary inline"
            onClick={go}
            disabled={busy || !ready}
          >
            {busy ? <span className="spin" /> : "Arm snipe"}
          </button>
        </div>
      </div>
    </div>
  );
}
