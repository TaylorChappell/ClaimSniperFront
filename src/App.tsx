import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  getToken,
  setToken,
  type Wallet,
  type Snipe,
  type Stats,
  type AdminSnipe,
  type AdminUser,
  type SocialUser,
  type PublicSnipe,
  type TrendingCoin,
  type ChatMessage,
  type AdminLog,
  type DiscoverCoin,
  type DiscoverMetadata,
  type TakeProfitEntry,
} from "./api";
import { useLeaderPolling } from "./sync";

const BRAND_IMG = `${import.meta.env.BASE_URL}sniper.png`;
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

function initialViewFromUrl(): "dashboard" | "history" | "social" | "discover" | "admin" {
  if (typeof window === "undefined") return "dashboard";
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "history" || view === "social" || view === "discover" || view === "admin"
    ? view
    : "dashboard";
}

function initialSocialTabFromUrl(): "trending" | "traders" | "chat" {
  if (typeof window === "undefined") return "trending";
  const tab = new URLSearchParams(window.location.search).get("socialTab");
  return tab === "traders" || tab === "chat" ? tab : "trending";
}

type ToastKind = "ok" | "err" | "fill";
type Toast = { id: number; text: string; kind: ToastKind };
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(
  () => {},
);
const useToast = () => useContext(ToastCtx);

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
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

  // On load with a stored token, learn paid/admin/username immediately
  // (avoids a pay-screen flash on reload and surfaces admin access).
  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then((m) => {
        setUsername(m.username);
        localStorage.setItem("username", m.username);
        setPaid(m.paid);
        setAdmin(m.admin);
      })
      .catch(() => {});
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
    setToken(null);
    localStorage.removeItem("username");
    setAuthed(false);
    setPaid(false);
    setAdmin(false);
  }

  let screen;
  if (!authed) {
    screen = (
      <Auth
        onAuthed={(u, p, a) => {
          setUsername(u);
          localStorage.setItem("username", u);
          setPaid(p);
          setAdmin(a);
          setAuthed(true);
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
      setToken(res.token);
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
          One-time payment of {price} SOL unlocks the tool for good.
        </p>
        <div className="card">
          <label>Send exactly {price} SOL in a single transaction to:</label>
          <div className="deposit">
            <code>{addr || "…"}</code>
            <button className="ghost" onClick={copy} disabled={!addr}>
              Copy
            </button>
          </div>
          <div className="paystatus">
            <span className="spin dark" />
            <span>
              Waiting for payment… received {received.toFixed(3)} / {price} SOL
            </span>
          </div>
        </div>
        <div className="toggle">
          <a onClick={onLogout}>Sign out</a>
        </div>
      </div>
    </div>
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

  // Single combined fetch, run only by the leader tab (see useLeaderPolling).
  // Fill/TP toasts + sounds fire here, so only the leader tab plays them.
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
          toast(
            `Order filled: ${sn.amountSol} SOL of ${short(sn.mint)}`,
            "fill",
          );
          playChime("fill");
        } else if (prev && prev !== "FAILED" && sn.status === "FAILED") {
          toast(`Snipe failed: ${short(sn.mint)}`, "err");
          playChime("fail");
        }
        const prevTp = prevStatus.current[`tp:${sn.id}`];
        if (prevTp && prevTp !== "SOLD" && sn.tpStatus === "SOLD") {
          toast(
            `Take-profit hit on ${sn.ticker ? "$" + sn.ticker : short(sn.mint)}`,
            "fill",
          );
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

  const { data, refresh } = useLeaderPolling("dash", fetchAll, 30000);
  const wallets = data?.wallets ?? [];
  const snipes = data?.snipes ?? [];
  const stats = data?.stats ?? null;

  const [view, setView] = useState<
    "dashboard" | "history" | "social" | "discover" | "admin"
  >(() => initialViewFromUrl());
  const [menuOpen, setMenuOpen] = useState(false);
  const [dashTab, setDashTab] = useState<"arm" | "snipes" | "wallets">("arm");
  const filled = useMemo(
    () => snipes.filter((s) => s.status === "FILLED"),
    [snipes],
  );
  const go = (v: typeof view) => {
    setView(v);
    setMenuOpen(false);
  };

  // Unread-chat dot on the Social tab.
  const [chatUnread, setChatUnread] = useState(false);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    let stop = false;
    const check = () =>
      api
        .socialChatLatest()
        .then((r) => {
          if (stop || !r.latest) return;
          if (viewRef.current === "social") {
            localStorage.setItem("cs.chatSeen", new Date().toISOString());
            return;
          }
          const seen = localStorage.getItem("cs.chatSeen");
          if (!seen || new Date(r.latest) > new Date(seen)) setChatUnread(true);
        })
        .catch(() => {});
    check();
    const t = setInterval(check, 20000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (view === "social") {
      localStorage.setItem("cs.chatSeen", new Date().toISOString());
      setChatUnread(false);
    }
  }, [view]);

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <img className="logo-img" src={BRAND_IMG} alt="" />
          <b>Claim Sniper</b>
        </div>
        <button
          className="hamburger"
          aria-label="Menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
          {chatUnread && <span className="nav-dot ham-dot" />}
        </button>
        <div className={`who ${menuOpen ? "open" : ""}`}>
          <button
            className={`nav-btn ${view === "dashboard" ? "on" : ""}`}
            onClick={() => go("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={`nav-btn ${view === "discover" ? "on" : ""}`}
            onClick={() => go("discover")}
          >
            Discover
          </button>
          <button
            className={`nav-btn ${view === "history" ? "on" : ""}`}
            onClick={() => go("history")}
          >
            History
          </button>
          <button
            className={`nav-btn ${view === "social" ? "on" : ""}`}
            onClick={() => go("social")}
          >
            Social{chatUnread && <span className="nav-dot" />}
          </button>
          {admin && (
            <button
              className={`nav-btn admin ${view === "admin" ? "on" : ""}`}
              onClick={() => go("admin")}
            >
              Admin
            </button>
          )}
          <span className="user">@{username}</span>
          <button className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      {view === "history" ? (
        <History />
      ) : view === "social" ? (
        <Social
          wallets={wallets}
          onCopied={() => {
            refresh();
            go("dashboard");
          }}
        />
      ) : view === "discover" ? (
        <Discover
          wallets={wallets}
          onSniped={() => {
            refresh();
            go("dashboard");
          }}
        />
      ) : view === "admin" ? (
        <AdminPanel wallets={wallets} />
      ) : (
        <div className="dash">
          <div className="seg dash-tabs">
            <button
              className={`seg-btn ${dashTab === "arm" ? "on" : ""}`}
              onClick={() => setDashTab("arm")}
            >
              Arm snipe
            </button>
            <button
              className={`seg-btn ${dashTab === "snipes" ? "on" : ""}`}
              onClick={() => setDashTab("snipes")}
            >
              Snipes
            </button>
            <button
              className={`seg-btn ${dashTab === "wallets" ? "on" : ""}`}
              onClick={() => setDashTab("wallets")}
            >
              Wallets
            </button>
          </div>
          {dashTab === "arm" ? (
            <div className="rise d1">
              <SnipeForm
                wallets={wallets}
                onCreated={() => {
                  refresh();
                  setDashTab("snipes");
                }}
              />
            </div>
          ) : dashTab === "wallets" ? (
            <>
              <div className="rise d1">
                <ProfitSection stats={stats} />
              </div>
              <div className="rise d2">
                <Wallets wallets={wallets} onChange={refresh} />
              </div>
            </>
          ) : (
            <div className="rise d1">
              <Snipes snipes={snipes} wallets={wallets} onChange={refresh} />
            </div>
          )}
        </div>
      )}
    </div>
  );
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
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  function remove(w: Wallet) {
    if (!confirm(`Remove "${w.name}"? The encrypted key is deleted.`)) return;
    setExiting((s) => new Set(s).add(w.id));
    setTimeout(
      () =>
        api
          .deleteWallet(w.id)
          .then(onChange)
          .catch((e) => toast(e.message, "err")),
      330,
    );
  }

  return (
    <div className="card">
      <h2>Wallets</h2>
      {wallets.length === 0 && (
        <div className="empty">No wallets yet. Add one below.</div>
      )}
      {wallets.map((w) => (
        <div
          className={`wallet ${exiting.has(w.id) ? "exiting" : ""}`}
          key={w.id}
        >
          <div>
            <div className="name">{w.name}</div>
            <div className="pk">{short(w.publicKey)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="bal">{(w.balanceSol ?? 0).toFixed(4)} SOL</div>
            <button
              className="danger"
              title="Remove wallet"
              onClick={() => remove(w)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <label>Wallet name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Main sniper"
      />
      <label>Private key</label>
      <input
        value={pk}
        onChange={(e) => setPk(e.target.value)}
        placeholder="base58 or [12,34,…] array"
        type="password"
      />
      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={add} disabled={busy || !name || !pk}>
        {busy ? <span className="spin" /> : "Add wallet"}
      </button>
      <div className="hint">
        Keys are encrypted (AES-256-GCM) and only decrypted in memory when a
        snipe fires.
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
              <span className="pk">{(w.balanceSol ?? 0).toFixed(3)} SOL</span>
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
  onCreated,
  initialMint,
  mintLocked,
}: {
  wallets: Wallet[];
  onCreated: () => void;
  initialMint?: string;
  mintLocked?: boolean;
}) {
  const toast = useToast();
  const [mint, setMint] = useState(initialMint ?? "");
  const [walletId, setWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("15");
  // Priority + bribe default to the last values used (saved locally).
  const [priority, setPriority] = useState(
    () => localStorage.getItem("cs.priority") ?? "0.0005",
  );
  const [bribe, setBribe] = useState(
    () => localStorage.getItem("cs.bribe") ?? "0",
  );
  const [onlyRedirected, setOnlyRedirected] = useState(false);
  const [watchWallet, setWatchWallet] = useState("");
  const [execMode, setExecMode] = useState<"PUMPPORTAL" | "LOCAL">(
    "PUMPPORTAL",
  );
  const [triggerMode, setTriggerMode] = useState<"CLAIM" | "REDIRECT">("CLAIM");
  const ex = useExit();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function arm() {
    setErr("");
    setBusy(true);
    try {
      localStorage.setItem("cs.priority", priority);
      localStorage.setItem("cs.bribe", bribe);
      await api.createSnipe({
        mint: mint.trim(),
        walletId,
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        priorityFee: Number(priority),
        bribe: Number(bribe),
        execMode,
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
      setAmount("");
      setWatchWallet("");
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ready =
    mint &&
    walletId &&
    Number(amount) > 0 &&
    (!onlyRedirected || watchWallet.trim().length >= 32);

  return (
    <div className="card">
      <h2>Arm a snipe</h2>
      <label>Coin CA (mint)</label>
      <input
        value={mint}
        onChange={(e) => setMint(e.target.value)}
        placeholder="pump.fun mint address"
        readOnly={mintLocked}
      />
      <label>Buy with wallet</label>
      <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
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
          <label>Bribe (SOL)</label>
          <input value={bribe} onChange={(e) => setBribe(e.target.value)} />
        </div>
      </div>
      <ExecModeSelect value={execMode} onChange={setExecMode} />
      <TriggerModeSelect value={triggerMode} onChange={setTriggerMode} />

      <label
        className="switch-row"
        onClick={() => setOnlyRedirected((v) => !v)}
      >
        <span className={`switch ${onlyRedirected ? "on" : ""}`}>
          <span className="knob" />
        </span>
        {triggerMode === "REDIRECT"
          ? "Only a specific wallet"
          : "Only a specific wallet's claims"}
      </label>
      {onlyRedirected ? (
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
          <div className="hint">
            {triggerMode === "REDIRECT"
              ? "Fires when this coin's fee owner is changed to this exact wallet."
              : "Fires only when this exact wallet claims fees for the coin. The deployer's own early claims are ignored."}
          </div>
        </div>
      ) : triggerMode === "REDIRECT" ? (
        <div className="hint">
          Fires when this coin's fee owner is changed to any new wallet.
        </div>
      ) : null}

      <ExitFields ex={ex} />

      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={arm} disabled={busy || !ready}>
        {busy ? <span className="spin" /> : "Confirm & arm snipe"}
      </button>
      <div className="hint">
        {triggerMode === "REDIRECT"
          ? "Fires when this coin's fee owner is changed to any new wallet."
          : "Fires the moment this coin's creator fees are next claimed. Works pre- and post-migration."}
      </div>
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
  const [amount, setAmount] = useState(String(snipe.amountSol));
  const [slippage, setSlippage] = useState(String(snipe.slippagePct));
  const [priority, setPriority] = useState(String(snipe.priorityFee));
  const [bribe, setBribe] = useState(String(snipe.bribe));
  const [redir, setRedir] = useState(snipe.onlyRedirected);
  const [watchWallet, setWatchWallet] = useState(snipe.watchWallet ?? "");
  const [execMode, setExecMode] = useState<"PUMPPORTAL" | "LOCAL">(
    snipe.execMode === "LOCAL" ? "LOCAL" : "PUMPPORTAL",
  );
  const [triggerMode, setTriggerMode] = useState<"CLAIM" | "REDIRECT">(
    snipe.triggerMode === "REDIRECT" ? "REDIRECT" : "CLAIM",
  );
  const ex = useExit(snipe);
  const [busy, setBusy] = useState(false);

  const ready =
    Number(amount) > 0 && (!redir || watchWallet.trim().length >= 32);

  async function save() {
    setBusy(true);
    try {
      await api.editSnipe(snipe.id, {
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        priorityFee: Number(priority),
        bribe: Number(bribe),
        onlyRedirected: redir,
        watchWallet: redir ? watchWallet.trim() : null,
        execMode,
        triggerMode,
        exit: ex.build(),
      });
      toast(armed ? "Snipe updated & re-armed" : "Snipe updated");
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

        {armed ? (
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
            <div className="row">
              <div>
                <label>Priority (SOL)</label>
                <input
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </div>
              <div>
                <label>Bribe (SOL)</label>
                <input
                  value={bribe}
                  onChange={(e) => setBribe(e.target.value)}
                />
              </div>
            </div>
            <ExecModeSelect value={execMode} onChange={setExecMode} />
            <TriggerModeSelect value={triggerMode} onChange={setTriggerMode} />
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
  onChange,
}: {
  snipes: Snipe[];
  wallets: Wallet[];
  onChange: () => void;
}) {
  const toast = useToast();
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Snipe | null>(null);

  function remove(id: string) {
    setExiting((s) => new Set(s).add(id));
    setTimeout(
      () =>
        api
          .cancelSnipe(id)
          .then(onChange)
          .catch((e) => toast(e.message, "err")),
      330,
    );
  }

  return (
    <div className="card">
      <h2>Snipes</h2>
      {snipes.length === 0 && (
        <div className="empty">
          No snipes yet. Arm one with a coin CA, a wallet, and a SOL amount.
        </div>
      )}
      {snipes.map((s) => (
        <div
          className={`snipe ${s.status} ${exiting.has(s.id) ? "exiting" : ""}`}
          key={s.id}
        >
          <div className="head">
            <span className="ticker">
              {s.ticker ? `$${s.ticker}` : short(s.mint)}
              <span
                className={`mode-tag ${s.triggerMode === "REDIRECT" ? "mode-redirect" : "mode-claim"}`}
              >
                {s.triggerMode === "REDIRECT" ? "REDIRECT" : "CLAIM"}
              </span>
            </span>
            <span className={`badge ${s.status}`}>
              {s.status === "ARMED" && <span className="dot" />}
              {s.status}
            </span>
          </div>
          <CopyCA mint={s.mint} className="mint-sub" />
          <div className="meta">
            <span>
              <b>{s.amountSol}</b> SOL
            </span>
            <span>{s.wallet.name}</span>
            <span>slip {s.slippagePct}%</span>
            <span>prio {s.priorityFee}</span>
            {s.bribe > 0 && <span>bribe {s.bribe}</span>}
            {s.watchWallet && (
              <span className="tp-chip">
                {s.triggerMode === "REDIRECT" ? "to " : "watch "}
                {short(s.watchWallet)}
              </span>
            )}
            {s.tpEnabled &&
              s.tpStatus !== "CANCELLED" &&
              takeProfitLabel(s).map((label) => (
                <span className="tp-chip" key={label}>
                  {label}
                </span>
              ))}
            {s.slEnabled && s.tpStatus !== "CANCELLED" && (
              <span className="tp-chip">
                SL{s.slTrailing ? ` trail -${s.slTrailPct}%` : ` -${s.slPct}%`}
              </span>
            )}
            {s.signature && (
              <a
                href={`https://solscan.io/tx/${s.signature}`}
                target="_blank"
                rel="noreferrer"
              >
                view tx ↗
              </a>
            )}
            {s.error && <span style={{ color: "var(--red)" }}>{s.error}</span>}
          </div>
          <div className="snipe-actions">
            <button className="ghost" onClick={() => setEdit(s)}>
              Edit
            </button>
            {s.status === "FILLED" &&
              s.tpStatus === "PENDING" &&
              (s.tpEnabled || s.slEnabled) && (
                <button
                  className="ghost"
                  onClick={() =>
                    api
                      .cancelExit(s.id)
                      .then(onChange)
                      .catch((e) => toast(e.message, "err"))
                  }
                >
                  Cancel TP/SL
                </button>
              )}
            <button className="ghost" onClick={() => remove(s.id)}>
              {s.status === "ARMED" ? "Disarm" : "Remove"}
            </button>
          </div>
        </div>
      ))}
      {edit && (
        <EditSnipeModal
          snipe={edit}
          onClose={() => setEdit(null)}
          onChange={onChange}
        />
      )}
    </div>
  );
}

/* ---------------- notification sound ---------------- */
let _audioCtx: AudioContext | null = null;
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

// Browsers block audio until the user interacts with the page. Call this once
// from a real user gesture so later buy/fail chimes are allowed to play.
export function unlockAudio() {
  ensureCtx();
}

function playChime(kind: "fill" | "fail") {
  try {
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    // fill (a buy landed) = rising bright two-note; fail = descending low two-note.
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

/* ---------------- history (permanent fill history) ---------------- */
function History() {
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
    api
      .historyFills(page, PAGE)
      .then((r) => {
        if (!stop) setData(r);
      })
      .catch(() => {
        if (!stop) setData({ fills: [], total: 0, page, pageSize: PAGE });
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [page]);

  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const fills = data.fills;

  return (
    <div className="discover rise">
      <div className="disc-head">
        <div>
          <h1>Snipe history</h1>
          <p className="sub">Every filled trade from your permanent fill history.</p>
        </div>
        {data.total > 0 && (
          <span className="dim">
            {data.total} fill{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {loading ? (
        <div className="empty">Loading fills…</div>
      ) : fills.length === 0 ? (
        <div className="empty">No filled snipes yet.</div>
      ) : (
        <>
          <div className="hist-list">
            {fills.map((s) => (
              <div className="hist-row" key={s.id}>
                <span className="hist-tk">
                  {s.ticker ? `$${s.ticker}` : short(s.mint)}
                </span>
                <CopyCA mint={s.mint} />
                <span className="hist-amt">{s.amountSol} SOL</span>
                {s.triggerMode === "REDIRECT" && (
                  <span className="tp-chip">redirect</span>
                )}
                {s.soldSol > 0 && (
                  <span className="hist-sold">+{s.soldSol.toFixed(3)} SOL</span>
                )}
                <Pnl net={(s.soldSol ?? 0) - s.amountSol} />
                <span className="hist-date">
                  {new Date(s.filledAt ?? s.createdAt).toLocaleString()}
                </span>
                {s.signature && (
                  <a
                    href={`https://solscan.io/tx/${s.signature}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    tx ↗
                  </a>
                )}
              </div>
            ))}
          </div>
          {data.total > PAGE && (
            <div className="pager">
              <button
                className="ghost mini"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span className="dim">
                Page {page + 1} of {pages}
              </span>
              <button
                className="ghost mini"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- admin panel (MrKnowBody / Rich) ---------------- */
function AdminPanel({ wallets }: { wallets: Wallet[] }) {
  const toast = useToast();
  const [tab, setTab] = useState<"armed" | "users" | "logs" | "notify">(
    "armed",
  );
  const [armed, setArmed] = useState<AdminSnipe[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sel, setSel] = useState<{
    username: string;
    payWallet?: string | null;
    snipes: Snipe[];
    wallets?: { id: string; name: string; publicKey: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copyFrom, setCopyFrom] = useState<AdminSnipe | null>(null);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [logUser, setLogUser] = useState("");
  const [logLevel, setLogLevel] = useState("");

  function reloadArmed() {
    api
      .adminArmed()
      .then((a) => setArmed(a.snipes))
      .catch((e) => toast(e.message, "err"));
  }
  function loadLogs(uid: string, level: string) {
    api
      .adminLogs(uid || undefined, level || undefined)
      .then((r) => setLogs(r.logs))
      .catch((e) => toast(e.message, "err"));
  }

  useEffect(() => {
    Promise.all([api.adminArmed(), api.adminUsers()])
      .then(([a, u]) => {
        setArmed(a.snipes);
        setUsers(u.users);
      })
      .catch((e) => toast(e.message, "err"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "logs") loadLogs(logUser, logLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, logUser, logLevel]);

  async function openUser(u: AdminUser) {
    try {
      setSel(await api.adminUserSnipes(u.id));
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  return (
    <div className="discover rise">
      <div className="disc-head">
        <h1>Admin</h1>
        <p className="sub">All armed snipes and every account.</p>
      </div>

      <div className="seg" style={{ marginBottom: 16 }}>
        <button
          className={`seg-btn ${tab === "armed" ? "on" : ""}`}
          onClick={() => setTab("armed")}
        >
          Armed ({armed.length})
        </button>
        <button
          className={`seg-btn ${tab === "users" ? "on" : ""}`}
          onClick={() => setTab("users")}
        >
          Users ({users.length})
        </button>
        <button
          className={`seg-btn ${tab === "logs" ? "on" : ""}`}
          onClick={() => setTab("logs")}
        >
          Logs
        </button>
        <button
          className={`seg-btn ${tab === "notify" ? "on" : ""}`}
          onClick={() => setTab("notify")}
        >
          Send notification
        </button>
      </div>

      {loading ? (
        <div className="empty">
          <span className="spin dark" /> Loading…
        </div>
      ) : tab === "armed" ? (
        armed.length === 0 ? (
          <div className="empty">Nothing armed right now.</div>
        ) : (
          <div className="admin-list">
            {armed.map((s) => (
              <div className="admin-row" key={s.id}>
                <span className="hist-tk">
                  {s.ticker ? `$${s.ticker}` : short(s.mint)}
                </span>
                <span className="admin-user">@{s.user.username}</span>
                <span>{s.amountSol} SOL</span>
                <span>{s.wallet.name}</span>
                {s.triggerMode === "REDIRECT" && (
                  <span className="tp-chip">redirect</span>
                )}
                {s.watchWallet && (
                  <span className="tp-chip">
                    {s.triggerMode === "REDIRECT" ? "to " : "watch "}
                    {short(s.watchWallet)}
                  </span>
                )}
                {s.tpEnabled &&
                  takeProfitLabel(s)
                    .slice(0, 2)
                    .map((label) => (
                      <span className="tp-chip" key={label}>
                        {label}
                      </span>
                    ))}
                {s.slEnabled && (
                  <span className="tp-chip">
                    SL{s.slTrailing ? " trail" : ""}
                  </span>
                )}
                {s.execMode === "LOCAL" && (
                  <span className="tp-chip">local</span>
                )}
                <CopyCA mint={s.mint} />
                <button className="ghost mini" onClick={() => setCopyFrom(s)}>
                  Copy
                </button>
              </div>
            ))}
          </div>
        )
      ) : tab === "users" ? (
        <div className="admin-list">
          {users.length > 0 && (
            <div className="admin-row total">
              <span className="admin-user">All users</span>
              <span className="hist-date">{users.length} accounts</span>
              <span>
                spent {users.reduce((a, u) => a + u.spentSol, 0).toFixed(3)}
              </span>
              <span>
                made {users.reduce((a, u) => a + u.madeSol, 0).toFixed(3)}
              </span>
              <Pnl net={users.reduce((a, u) => a + u.netSol, 0)} />
            </div>
          )}
          {users.map((u) => (
            <div
              className="admin-row clickable"
              key={u.id}
              onClick={() => openUser(u)}
            >
              <span className="admin-user">@{u.username}</span>
              <span className={`badge ${u.paid ? "FILLED" : "FAILED"}`}>
                {u.paid ? "paid" : "unpaid"}
              </span>
              <span>{u.snipeCount} snipes</span>
              <span className="dim">spent {u.spentSol.toFixed(3)}</span>
              <span className="dim">made {u.madeSol.toFixed(3)}</span>
              <Pnl net={u.netSol} />
              <span className="hist-date">
                {new Date(u.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      ) : tab === "notify" ? (
        <AdminNotificationTester />
      ) : (
        <div className="admin-list">
          <div className="filter-row">
            <select
              value={logUser}
              onChange={(e) => setLogUser(e.target.value)}
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  @{u.username}
                </option>
              ))}
            </select>
            <select
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
            >
              <option value="">All types</option>
              <option value="success">Filled</option>
              <option value="error">Failed</option>
              <option value="info">Messages</option>
            </select>
            <button
              className="ghost mini"
              onClick={() => loadLogs(logUser, logLevel)}
            >
              Refresh
            </button>
          </div>
          {logs.length === 0 && <p className="sub">No logs yet.</p>}
          {logs.map((l) => (
            <div className={`log-row ${l.level}`} key={l.id}>
              <span className="hist-date">
                {new Date(l.createdAt).toLocaleString()}
              </span>
              <span className="admin-user">@{l.username}</span>
              <span className="log-msg">{l.message}</span>
            </div>
          ))}
        </div>
      )}

      {sel && (
        <div className="modal-overlay" onMouseDown={() => setSel(null)}>
          <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
            <h3>@{sel.username}</h3>
            {sel.wallets && sel.wallets.length > 0 && (
              <>
                <p className="modal-sub">Wallets</p>
                <div className="admin-list">
                  {sel.wallets.map((w) => (
                    <div className="admin-row" key={w.id}>
                      <span className="admin-user">{w.name}</span>
                      <CopyAddr address={w.publicKey} />
                    </div>
                  ))}
                  {sel.payWallet && (
                    <div className="admin-row">
                      <span className="dim">deposit</span>
                      <CopyAddr address={sel.payWallet} />
                    </div>
                  )}
                </div>
              </>
            )}
            <p className="modal-sub">{sel.snipes.length} snipe(s)</p>
            <div className="admin-list scroll">
              {sel.snipes.length === 0 ? (
                <div className="empty">No snipes.</div>
              ) : (
                sel.snipes.map((s) => (
                  <div className="admin-row" key={s.id}>
                    <span className="hist-tk">
                      {s.ticker ? `$${s.ticker}` : short(s.mint)}
                    </span>
                    <span className={`badge ${s.status}`}>{s.status}</span>
                    <span>{s.amountSol} SOL</span>
                    {s.tpEnabled &&
                      takeProfitLabel(s)
                        .slice(0, 2)
                        .map((label) => (
                          <span className="tp-chip" key={label}>
                            {label}
                          </span>
                        ))}
                    {s.slEnabled && (
                      <span className="tp-chip">
                        SL{s.slTrailing ? " trail" : ""}
                      </span>
                    )}
                    <CopyCA mint={s.mint} />
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setSel(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {copyFrom && (
        <CopySnipeModal
          source={copyFrom}
          wallets={wallets}
          onClose={() => setCopyFrom(null)}
          onCopied={() => {
            setCopyFrom(null);
            reloadArmed();
          }}
        />
      )}
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
                  percentage of your wallet's current remaining token balance
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

/* ---------------- execution mode selector ---------------- */
function ExecModeSelect({
  value,
  onChange,
}: {
  value: "PUMPPORTAL" | "LOCAL";
  onChange: (v: "PUMPPORTAL" | "LOCAL") => void;
}) {
  return (
    <div className="exec-mode">
      <label>Execution</label>
      <div className="seg">
        <button
          className={value === "PUMPPORTAL" ? "on" : ""}
          onClick={() => onChange("PUMPPORTAL")}
        >
          PumpPortal
        </button>
        <button
          className={value === "LOCAL" ? "on" : ""}
          onClick={() => onChange("LOCAL")}
        >
          Local (beta)
        </button>
      </div>
      {value === "LOCAL" && (
        <div className="hint">
          Builds the buy on our server and sends it straight through Helius (no
          PumpPortal). Faster and removes that dependency, but it is
          experimental and untested, so try a tiny amount first. Take-profit and
          stop-loss sells still use PumpPortal.
        </div>
      )}
    </div>
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
          {source.execMode === "LOCAL" ? "local" : "PumpPortal"}
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
        const status = await api.pushSubscriptionStatus(sub.endpoint).catch(
          () => null,
        );
        if (!stop) setEnabled(!!status?.tradeEnabled);
      } catch {
        if (!stop) setSupported(false);
      }
    }

    load();
    return () => {
      stop = true;
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
      if (sub) await api.updatePushPreferences(sub.endpoint, { tradeEnabled: false });
      setEnabled(false);
      toast("Snipe notifications disabled on this device");
    } catch (e: any) {
      const msg = e?.message ?? "Failed to disable notifications";
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
        const status = await api.pushSubscriptionStatus(sub.endpoint).catch(
          () => null,
        );
        if (!stop) setEnabled(!!status?.chatEnabled);
      } catch {
        if (!stop) setSupported(false);
      }
    }

    load();
    return () => {
      stop = true;
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
      if (sub) await api.updatePushPreferences(sub.endpoint, { chatEnabled: false });
      setEnabled(false);
      toast("Chat notifications disabled on this device");
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

function Social({
  wallets,
  onCopied,
}: {
  wallets: Wallet[];
  onCopied: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"trending" | "traders" | "chat">(() => initialSocialTabFromUrl());
  const [users, setUsers] = useState<SocialUser[]>([]);
  const [trending, setTrending] = useState<TrendingCoin[]>([]);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [copy, setCopy] = useState<{
    mint: string;
    ticker?: string | null;
    triggerMode: "CLAIM" | "REDIRECT";
    source?: PublicSnipe;
  } | null>(null);

  function load() {
    api
      .socialUsers()
      .then((r) => setUsers(r.users))
      .catch(() => {});
    api
      .socialTrending()
      .then((r) => setTrending(r.coins))
      .catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="social">
      <div className="seg dash-tabs">
        <button
          className={`seg-btn ${tab === "trending" ? "on" : ""}`}
          onClick={() => setTab("trending")}
        >
          Trending
        </button>
        <button
          className={`seg-btn ${tab === "traders" ? "on" : ""}`}
          onClick={() => setTab("traders")}
        >
          Traders
        </button>
        <button
          className={`seg-btn ${tab === "chat" ? "on" : ""}`}
          onClick={() => setTab("chat")}
        >
          Chat
        </button>
      </div>

      <NotificationToggle />

      {tab === "trending" ? (
        <div className="card rise d1">
          <h3>Most sniped coins</h3>
          {trending.length === 0 && (
            <p className="sub">
              No active snipes across the platform right now.
            </p>
          )}
          <div className="admin-list">
            {trending.slice(0, 5).map((c) => (
              <div className="admin-row" key={c.mint}>
                <CopyCA mint={c.mint} ticker={c.ticker} />
                <span className="tp-chip">
                  {c.userCount} {c.userCount === 1 ? "user" : "users"}
                </span>
                <span className="dim">{c.snipeCount} snipes</span>
                {c.redirectCount > 0 && (
                  <span className="tp-chip">{c.redirectCount} redirect</span>
                )}
                <button
                  className="ghost mini"
                  onClick={() =>
                    setCopy({
                      mint: c.mint,
                      ticker: c.ticker,
                      triggerMode:
                        c.redirectCount > c.snipeCount - c.redirectCount
                          ? "REDIRECT"
                          : "CLAIM",
                    })
                  }
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : tab === "traders" ? (
        <div className="card rise d1">
          <h3>Traders</h3>
          {users.length === 0 && <p className="sub">No paid traders yet.</p>}
          <div className="admin-list">
            {users.map((u) => (
              <div
                className="admin-row clickable"
                key={u.id}
                onClick={() => setOpenUserId(u.id)}
              >
                <span className="admin-user">@{u.username}</span>
                <span className="dim">{u.filledCount} filled</span>
                <span className="dim">spent {u.spentSol.toFixed(3)}</span>
                <Pnl net={u.netSol} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <ChatBox />
      )}

      {openUserId && (
        <UserSnipesModal
          userId={openUserId}
          onClose={() => setOpenUserId(null)}
          onCopy={(s) =>
            setCopy({
              mint: s.mint,
              ticker: s.ticker,
              triggerMode: s.triggerMode === "REDIRECT" ? "REDIRECT" : "CLAIM",
              source: s,
            })
          }
        />
      )}
      {copy && (
        <CopyPublicModal
          mint={copy.mint}
          ticker={copy.ticker}
          triggerMode={copy.triggerMode}
          source={copy.source}
          wallets={wallets}
          onClose={() => setCopy(null)}
          onCopied={() => {
            setCopy(null);
            toast("Snipe armed from copied coin");
            onCopied();
          }}
        />
      )}
    </div>
  );
}

function ChatBox() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const lastRef = useRef<string | undefined>(undefined);
  const pollingRef = useRef(false);
  const sendingRef = useRef(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      const el = feedRef.current;
      if (!el) return;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    });
  }, []);

  function poll() {
    if (pollingRef.current) return; // never run two polls at once
    pollingRef.current = true;
    api
      .socialChat(lastRef.current)
      .then((r) => {
        if (r.messages.length) {
          setMessages((prev) => {
            // Merge by id so an overlapping/repeated message can never render twice.
            const byId = new Map(prev.map((m) => [m.id, m]));
            for (const m of r.messages) byId.set(m.id, m);
            const merged = [...byId.values()]
              .sort((a, b) =>
                a.createdAt < b.createdAt
                  ? -1
                  : a.createdAt > b.createdAt
                    ? 1
                    : 0,
              )
              .slice(-200);
            lastRef.current = merged.length
              ? merged[merged.length - 1].createdAt
              : lastRef.current;
            return merged;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        pollingRef.current = false;
      });
  }
  useEffect(() => {
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    scrollToBottom(messages.length > 1);
  }, [messages.length, scrollToBottom]);

  async function send() {
    const t = text.trim();
    if (!t || sendingRef.current) return; // block double-send (fast Enter/click)
    sendingRef.current = true;
    setBusy(true);
    try {
      await api.socialSend(t);
      setText("");
      poll();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      sendingRef.current = false;
    }
  }

  return (
    <div className="card rise d1 chat">
      <h3>Chat</h3>
      <ChatNotificationToggle />
      <div className="chat-feed" ref={feedRef}>
        {messages.length === 0 && (
          <p className="sub">No messages yet. Say hi.</p>
        )}
        {messages.map((m) => (
          <div className="chat-msg" key={m.id}>
            <span className="chat-user">@{m.username}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={text}
          maxLength={500}
          placeholder="Message the traders..."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button
          className="primary inline"
          onClick={send}
          disabled={busy || !text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function UserSnipesModal({
  userId,
  onClose,
  onCopy,
}: {
  userId: string;
  onClose: () => void;
  onCopy: (s: PublicSnipe) => void;
}) {
  const [data, setData] = useState<{
    username: string;
    active: PublicSnipe[];
    filled: PublicSnipe[];
  } | null>(null);
  const [tab, setTab] = useState<"active" | "filled">("active");
  const [page, setPage] = useState(0);
  const PAGE = 5;

  useEffect(() => {
    api
      .socialUserSnipes(userId)
      .then(setData)
      .catch(() => {});
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
            <div className="admin-row" key={s.id}>
              <CopyCA mint={s.mint} ticker={s.ticker} />
              <span className="dim">{s.amountSol} SOL</span>
              {s.triggerMode === "REDIRECT" && (
                <span className="tp-chip">redirect</span>
              )}
              {tab === "filled" && <Pnl net={s.soldSol - s.amountSol} />}
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
  const [execMode, setExecMode] = useState<"PUMPPORTAL" | "LOCAL">(
    source?.execMode === "LOCAL" ? "LOCAL" : "PUMPPORTAL",
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
        execMode,
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
            <label>Bribe (SOL)</label>
            <input value={bribe} onChange={(e) => setBribe(e.target.value)} />
          </div>
        </div>
        <ExecModeSelect value={execMode} onChange={setExecMode} />
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

/* ---------------- discover ---------------- */
function compactUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

type DiscoverSort =
  | "mc_desc"
  | "mc_asc"
  | "vol_desc"
  | "vol_asc"
  | "new"
  | "old";
type DiscFilters = {
  mcMin: string;
  mcMax: string;
  volMin: string;
  volMax: string;
  ageMin: string;
  ageMax: string;
};

function Discover({
  wallets,
  onSniped,
}: {
  wallets: Wallet[];
  onSniped: () => void;
}) {
  const [coins, setCoins] = useState<DiscoverCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<DiscoverSort>(
    () => (localStorage.getItem("cs.discSort") as DiscoverSort) || "new",
  );
  const [includeSpecial, setIncludeSpecial] = useState<boolean>(
    () => localStorage.getItem("cs.discIncludeSpecial") === "true",
  );
  const [tab, setTab] = useState<"coins" | "metadata">("coins");
  const [selectedMetaMint, setSelectedMetaMint] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DiscoverMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [snipeMint, setSnipeMint] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE = 20;
  const emptyFilters: DiscFilters = {
    mcMin: "",
    mcMax: "",
    volMin: "",
    volMax: "",
    ageMin: "",
    ageMax: "",
  };
  const loadFilters = (): DiscFilters => {
    try {
      const s = localStorage.getItem("cs.discFilters");
      if (s)
        return { ...emptyFilters, ...(JSON.parse(s) as Partial<DiscFilters>) };
    } catch {
      /* ignore */
    }
    return emptyFilters;
  };
  const [f, setF] = useState<DiscFilters>(loadFilters);
  const [showFilters, setShowFilters] = useState<boolean>(() =>
    Object.values(loadFilters()).some((v) => v.trim() !== ""),
  );
  const setField = (k: keyof DiscFilters, v: string) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const activeFilters = Object.values(f).some((v) => v.trim() !== "");

  useEffect(() => {
    localStorage.setItem("cs.discSort", sort);
  }, [sort]);
  useEffect(() => {
    localStorage.setItem("cs.discFilters", JSON.stringify(f));
  }, [f]);
  useEffect(() => {
    localStorage.setItem("cs.discIncludeSpecial", includeSpecial ? "true" : "false");
  }, [includeSpecial]);

  function hide(mint: string) {
    setCoins((prev) => prev.filter((c) => c.mint !== mint));
    if (selectedMetaMint === mint) {
      setSelectedMetaMint(null);
      setMetadata(null);
    }
    api.discoverHide(mint).catch(() => load());
  }
  function resetHidden() {
    api
      .discoverResetHidden()
      .then(load)
      .catch(() => {});
  }

  function load() {
    setLoading(true);
    api
      .discover(includeSpecial)
      .then((r) => {
        setCoins(r.coins);
        setMsg(
          r.configured ? null : (r.message ?? "Discover is not configured."),
        );
      })
      .catch((e) => setMsg(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeSpecial]);

  useEffect(() => {
    if (tab !== "metadata" || !selectedMetaMint) return;
    setMetadataLoading(true);
    setMetadataError(null);
    api
      .discoverMetadata(selectedMetaMint)
      .then(setMetadata)
      .catch((e) => {
        setMetadata(null);
        setMetadataError(e.message);
      })
      .finally(() => setMetadataLoading(false));
  }, [tab, selectedMetaMint]);

  const sorted = useMemo(() => {
    const numOr = (s: string, d: number) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : d;
    };
    const mcMin = numOr(f.mcMin, -Infinity),
      mcMax = numOr(f.mcMax, Infinity);
    const volMin = numOr(f.volMin, -Infinity),
      volMax = numOr(f.volMax, Infinity);
    const ageMin = numOr(f.ageMin, -Infinity),
      ageMax = numOr(f.ageMax, Infinity); // minutes
    const hasMc = f.mcMin.trim() !== "" || f.mcMax.trim() !== "";
    const hasVol = f.volMin.trim() !== "" || f.volMax.trim() !== "";
    const ageMinutes = (x: DiscoverCoin) =>
      x.createdAt
        ? (Date.now() - new Date(x.createdAt).getTime()) / 60000
        : Infinity;

    const c = coins.filter((x) => {
      if (hasMc) {
        if (x.marketCapUsd == null) return false;
        if (x.marketCapUsd < mcMin || x.marketCapUsd > mcMax) return false;
      }
      if (hasVol) {
        if (x.volumeUsd == null) return false;
        if (x.volumeUsd < volMin || x.volumeUsd > volMax) return false;
      }
      const age = ageMinutes(x);
      if (age < ageMin || age > ageMax) return false;
      return true;
    });

    const mc = (x: DiscoverCoin) => x.marketCapUsd ?? -1;
    const vol = (x: DiscoverCoin) => x.volumeUsd ?? -1;
    const t = (x: DiscoverCoin) =>
      x.createdAt ? new Date(x.createdAt).getTime() : 0;
    switch (sort) {
      case "mc_desc":
        c.sort((a, b) => mc(b) - mc(a));
        break;
      case "mc_asc":
        c.sort((a, b) => mc(a) - mc(b));
        break;
      case "vol_desc":
        c.sort((a, b) => vol(b) - vol(a));
        break;
      case "vol_asc":
        c.sort((a, b) => vol(a) - vol(b));
        break;
      case "new":
        c.sort((a, b) => t(b) - t(a));
        break;
      case "old":
        c.sort((a, b) => t(a) - t(b));
        break;
    }
    return c;
  }, [coins, sort, f]);

  useEffect(() => setPage(0), [sort, f, includeSpecial]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const pageClamped = Math.min(page, pages - 1);
  const visible = sorted.slice(pageClamped * PAGE, pageClamped * PAGE + PAGE);
  const specialCount = coins.filter((c) => c.isLikelyAgent || c.isLikelyCharity).length;
  const metadataCoin = coins.find((c) => c.mint === selectedMetaMint) ?? null;

  return (
    <div className="discover">
      <div className="card">
        <div className="disc-head">
          <div>
            <h2>Discover</h2>
            <div className="hint">
              DB-backed redirect index. This page does not check every token on-chain.
            </div>
          </div>
          <div className="disc-controls">
            <button
              className={`ghost mini ${tab === "coins" ? "on" : ""}`}
              onClick={() => setTab("coins")}
            >
              Coins
            </button>
            <button
              className={`ghost mini ${tab === "metadata" ? "on" : ""}`}
              onClick={() => setTab("metadata")}
            >
              Token metadata
            </button>
            <button className="ghost mini" onClick={resetHidden}>
              Reset hidden
            </button>
            <button
              className={`ghost mini ${activeFilters ? "on" : ""}`}
              onClick={() => setShowFilters((v) => !v)}
            >
              Filters{activeFilters ? " •" : ""}
            </button>
            <button
              className={`ghost mini ${includeSpecial ? "on" : ""}`}
              title="Agent/charity detection is metadata keyword based, not a perfect on-chain flag."
              onClick={() => setIncludeSpecial((v) => !v)}
            >
              {includeSpecial ? "Showing" : "Hiding"} agent/charity
              {specialCount ? ` (${specialCount})` : ""}
            </button>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as DiscoverSort)}
            >
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
              <option value="mc_desc">Market cap: high to low</option>
              <option value="mc_asc">Market cap: low to high</option>
              <option value="vol_desc">Volume: high to low</option>
              <option value="vol_asc">Volume: low to high</option>
            </select>
          </div>
        </div>
        {showFilters && (
          <div className="disc-filters">
            <div className="ff">
              <label>Market cap (USD)</label>
              <div className="ff-pair">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="min"
                  value={f.mcMin}
                  onChange={(e) => setField("mcMin", e.target.value)}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="max"
                  value={f.mcMax}
                  onChange={(e) => setField("mcMax", e.target.value)}
                />
              </div>
            </div>
            <div className="ff">
              <label>Volume (USD)</label>
              <div className="ff-pair">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="min"
                  value={f.volMin}
                  onChange={(e) => setField("volMin", e.target.value)}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="max"
                  value={f.volMax}
                  onChange={(e) => setField("volMax", e.target.value)}
                />
              </div>
            </div>
            <div className="ff">
              <label>Age (minutes)</label>
              <div className="ff-pair">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="min"
                  value={f.ageMin}
                  onChange={(e) => setField("ageMin", e.target.value)}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="max"
                  value={f.ageMax}
                  onChange={(e) => setField("ageMax", e.target.value)}
                />
              </div>
            </div>
            <button
              className="ghost mini"
              disabled={!activeFilters}
              onClick={() => setF(emptyFilters)}
            >
              Clear filters
            </button>
          </div>
        )}

        {tab === "metadata" ? (
          <div className="metadata-tab">
            <div className="meta-toolbar">
              <div className="ff meta-select">
                <label>Token</label>
                <select
                  value={selectedMetaMint ?? ""}
                  onChange={(e) => setSelectedMetaMint(e.target.value || null)}
                >
                  <option value="">Select a redirected token…</option>
                  {coins.map((c) => (
                    <option key={c.mint} value={c.mint}>
                      {c.ticker ? `$${c.ticker}` : short(c.mint)} · {short(c.mint)}
                    </option>
                  ))}
                </select>
              </div>
              {metadataCoin && (
                <button
                  className="primary inline"
                  onClick={() => setSnipeMint(metadataCoin.mint)}
                >
                  Snipe this token
                </button>
              )}
            </div>
            {!selectedMetaMint && (
              <div className="empty">Pick a token to inspect all saved metadata.</div>
            )}
            {selectedMetaMint && metadataLoading && <div className="empty">Loading metadata…</div>}
            {selectedMetaMint && metadataError && <div className="err">{metadataError}</div>}
            {selectedMetaMint && metadata && !metadataLoading && (
              <div className="meta-grid">
                <div className="meta-summary">
                  {metadata.image ? <img className="disc-img" src={metadata.image} alt="" /> : null}
                  <div>
                    <div className="disc-name">
                      <span className="disc-tk">
                        {metadata.ticker ? `$${metadata.ticker}` : short(metadata.mint)}
                      </span>
                      {metadata.isLikelyAgent && <span className="tp-chip">agent?</span>}
                      {metadata.isLikelyCharity && <span className="tp-chip">charity?</span>}
                    </div>
                    <div className="hint">{metadata.name ?? metadata.mint}</div>
                    <CopyCA mint={metadata.mint} />
                  </div>
                </div>
                <div className="meta-kv">
                  <div><span>MC</span><b>{compactUsd(metadata.marketCapUsd)}</b></div>
                  <div><span>Vol 24h</span><b>{compactUsd(metadata.volumeUsd)}</b></div>
                  <div><span>Liquidity</span><b>{compactUsd(metadata.liquidityUsd)}</b></div>
                  <div><span>Price</span><b>{metadata.priceUsd != null ? `$${metadata.priceUsd.toExponential(3)}` : "—"}</b></div>
                  <div><span>Pair</span><b>{metadata.pairDexId ?? "—"}</b></div>
                  <div><span>Market updated</span><b>{metadata.marketDataUpdatedAt ? ago(metadata.marketDataUpdatedAt) : "—"}</b></div>
                  <div><span>Redirect source</span><b>{metadata.source ?? "—"}</b></div>
                  <div><span>Fee owner</span><b>{metadata.creator ? short(metadata.creator) : "—"}</b></div>
                  <div><span>Updated</span><b>{metadata.metadataUpdatedAt ? ago(metadata.metadataUpdatedAt) : "—"}</b></div>
                  <div><span>Classification</span><b>{metadata.classificationReason ?? "none"}</b></div>
                </div>
                <pre className="debug-out meta-json">
                  {JSON.stringify(metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <>
            {loading && <div className="empty">Loading…</div>}
            {!loading && msg && <div className="empty">{msg}</div>}
            {!loading && !msg && coins.length === 0 && (
              <div className="empty">
                No redirected coins yet. This list fills live as coins have their
                fees redirected to another wallet.
              </div>
            )}
            {!loading && !msg && coins.length > 0 && sorted.length === 0 && (
              <div className="empty">No coins match your filters.</div>
            )}
            <div className="disc-list">
              {visible.map((c) => (
                <div className="disc-row" key={c.mint}>
                  <div className="disc-coin">
                    {c.image ? (
                      <img
                        className="disc-img"
                        src={c.image}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="disc-img placeholder" />
                    )}
                    <div className="disc-id">
                      <div className="disc-name">
                        <span className="disc-tk">
                          {c.ticker ? `$${c.ticker}` : short(c.mint)}
                        </span>
                        {c.creator && (
                          <span
                            className="tp-chip"
                            title={`Fees redirected to ${c.creator}`}
                          >
                            → {short(c.creator)}
                          </span>
                        )}
                        {c.isLikelyAgent && (
                          <span className="tp-chip" title={c.classificationReason ?? "Metadata matched agent keywords"}>
                            agent?
                          </span>
                        )}
                        {c.isLikelyCharity && (
                          <span className="tp-chip" title={c.classificationReason ?? "Metadata matched charity keywords"}>
                            charity?
                          </span>
                        )}
                        {c.migrated && <span className="tp-chip">migrated</span>}
                      </div>
                      <CopyCA mint={c.mint} />
                    </div>
                  </div>
                  <div className="disc-stats">
                    <div className="disc-stat">
                      <span>MC</span>
                      <b>{compactUsd(c.marketCapUsd)}</b>
                    </div>
                    <div className="disc-stat">
                      <span>Vol</span>
                      <b>{compactUsd(c.volumeUsd)}</b>
                    </div>
                    <div className="disc-stat">
                      <span>Liq</span>
                      <b>{compactUsd(c.liquidityUsd)}</b>
                    </div>
                    <div className="disc-stat">
                      <span>Age</span>
                      <b>{ago(c.createdAt)}</b>
                    </div>
                  </div>
                  <button
                    className="ghost mini"
                    onClick={() => {
                      setSelectedMetaMint(c.mint);
                      setTab("metadata");
                    }}
                  >
                    Meta
                  </button>
                  <button
                    className="primary inline disc-snipe"
                    onClick={() => setSnipeMint(c.mint)}
                  >
                    Snipe
                  </button>
                  <button
                    className="disc-hide"
                    title="Hide from my list"
                    onClick={() => hide(c.mint)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {sorted.length > PAGE && (
              <div className="pager">
                <button
                  className="ghost mini"
                  disabled={pageClamped === 0}
                  onClick={() => setPage(pageClamped - 1)}
                >
                  Previous
                </button>
                <span className="dim">
                  Page {pageClamped + 1} of {pages} · {sorted.length} coins
                </span>
                <button
                  className="ghost mini"
                  disabled={pageClamped >= pages - 1}
                  onClick={() => setPage(pageClamped + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {snipeMint && (
        <div className="modal-overlay" onMouseDown={() => setSnipeMint(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <SnipeForm
              wallets={wallets}
              initialMint={snipeMint}
              mintLocked
              onCreated={() => {
                setSnipeMint(null);
                onSniped();
              }}
            />
            <div className="modal-actions">
              <button className="ghost" onClick={() => setSnipeMint(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
