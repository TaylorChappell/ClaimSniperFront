import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, type Wallet, type Snipe, type Stats, type TakeProfit, type DiscoverCoin } from './api';
import { useLeaderPolling } from './sync';

const BRAND_IMG = `${import.meta.env.BASE_URL}sniper.png`;
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

type ToastKind = 'ok' | 'err' | 'fill';
type Toast = { id: number; text: string; kind: ToastKind };
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
const useToast = () => useContext(ToastCtx);

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [paid, setPaid] = useState(false);
  const [username, setUsername] = useState(localStorage.getItem('username') ?? '');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (text: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'fill' ? 5000 : 3800);
  };

  function logout() {
    setToken(null);
    localStorage.removeItem('username');
    setAuthed(false);
    setPaid(false);
  }

  let screen;
  if (!authed) {
    screen = (
      <Auth
        onAuthed={(u, p) => {
          setUsername(u);
          localStorage.setItem('username', u);
          setPaid(p);
          setAuthed(true);
        }}
      />
    );
  } else if (!paid) {
    screen = <PayScreen onPaid={() => setPaid(true)} onLogout={logout} />;
  } else {
    screen = <Dashboard username={username} onLogout={logout} />;
  }

  return (
    <ToastCtx.Provider value={push}>
      {screen}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'fill' ? 'fill' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- auth ---------------- */
function Auth({ onAuthed }: { onAuthed: (u: string, paid: boolean) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      const res = await (mode === 'login' ? api.login : api.register)(u, p);
      setToken(res.token);
      onAuthed(res.username, res.paid);
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
        <p className="sub">{mode === 'login' ? 'Sign in to your account.' : 'Create an account to get started.'}</p>
        <div className="card">
          <label>Username</label>
          <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" />
          <label>Password</label>
          <input
            type="password"
            value={p}
            onChange={(e) => setP(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {err && <div className="err">{err}</div>}
          <button className="primary" onClick={submit} disabled={busy || !u || !p}>
            {busy ? <span className="spin" /> : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </div>
        <div className="toggle">
          {mode === 'login' ? (
            <span>No account? <a onClick={() => setMode('register')}>Create one</a></span>
          ) : (
            <span>Have an account? <a onClick={() => setMode('login')}>Sign in</a></span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- paywall ---------------- */
function PayScreen({ onPaid, onLogout }: { onPaid: () => void; onLogout: () => void }) {
  const toast = useToast();
  const [addr, setAddr] = useState('');
  const [price, setPrice] = useState(2);
  const [received, setReceived] = useState(0);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const s = await api.billingStatus();
        if (stop) return;
        if (s.paid) return onPaid();
        setAddr(s.depositAddress ?? '');
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
    navigator.clipboard.writeText(addr).then(() => toast('Address copied'));
  }

  return (
    <div className="wrap">
      <div className="auth rise">
        <img className="auth-logo-img" src={BRAND_IMG} alt="Claim Sniper" />
        <h1>Unlock Claim Sniper</h1>
        <p className="sub">One-time payment of {price} SOL unlocks the tool for good.</p>
        <div className="card">
          <label>Send exactly {price} SOL in a single transaction to:</label>
          <div className="deposit">
            <code>{addr || '…'}</code>
            <button className="ghost" onClick={copy} disabled={!addr}>Copy</button>
          </div>
          <div className="paystatus">
            <span className="spin dark" />
            <span>Waiting for payment… received {received.toFixed(3)} / {price} SOL</span>
          </div>
        </div>
        <div className="toggle"><a onClick={onLogout}>Sign out</a></div>
      </div>
    </div>
  );
}

/* ---------------- dashboard ---------------- */
function Dashboard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const toast = useToast();
  const prevStatus = useRef<Record<string, string>>({});
  const initialized = useRef(false);

  // Single combined fetch, run only by the leader tab (see useLeaderPolling).
  // Fill/TP toasts fire here, so only the leader tab shows them (no duplicates).
  const fetchAll = useCallback(async () => {
    const [w, s, st] = await Promise.all([api.walletsWithBalances(), api.snipes(), api.stats()]);
    const list = s.snipes;
    if (initialized.current) {
      for (const sn of list) {
        const prev = prevStatus.current[sn.id];
        if (prev && prev !== 'FILLED' && sn.status === 'FILLED')
          toast(`Order filled: ${sn.amountSol} SOL of ${short(sn.mint)}`, 'fill');
        else if (prev && prev !== 'FAILED' && sn.status === 'FAILED')
          toast(`Snipe failed: ${short(sn.mint)}`, 'err');
        const prevTp = prevStatus.current[`tp:${sn.id}`];
        if (prevTp && prevTp !== 'SOLD' && sn.tpStatus === 'SOLD')
          toast(`Take-profit hit, sold ${sn.tpSellPct}% of ${short(sn.mint)}`, 'fill');
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

  const { data, refresh } = useLeaderPolling('dash', fetchAll, 30000);
  const wallets = data?.wallets ?? [];
  const snipes = data?.snipes ?? [];
  const stats = data?.stats ?? null;

  const [view, setView] = useState<'dashboard' | 'discover'>('dashboard');

  return (
    <div className="wrap">
      <div className="topbar rise">
        <div className="brand">
          <img className="logo-img" src={BRAND_IMG} alt="" />
          <b>Claim Sniper</b>
        </div>
        <div className="who">
          <button className={`nav-btn ${view === 'discover' ? 'on' : ''}`} onClick={() => setView(view === 'discover' ? 'dashboard' : 'discover')}>
            {view === 'discover' ? '← Dashboard' : 'Recommended coins'}
          </button>
          <span className="user">@{username}</span>
          <button className="ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {view === 'discover' ? (
        <Discover wallets={wallets} onSniped={() => { refresh(); setView('dashboard'); }} />
      ) : (
        <div className="grid">
          <div className="col">
            <div className="rise d1"><Wallets wallets={wallets} onChange={refresh} /></div>
            <div className="rise d2"><SnipeForm wallets={wallets} onCreated={refresh} /></div>
          </div>
          <div className="col">
            <div className="rise d2"><ProfitSection stats={stats} /></div>
            <div className="rise d3"><Snipes snipes={snipes} onChange={refresh} /></div>
          </div>
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
      <h2>Profit</h2>
      <div className="stats">
        <Stat label="Spent" value={`${(stats?.spentSol ?? 0).toFixed(3)} SOL`} />
        <Stat label="Made" value={`${(stats?.madeSol ?? 0).toFixed(3)} SOL`} accent="green" />
        <Stat
          label="Net"
          value={`${net >= 0 ? '+' : ''}${net.toFixed(3)} SOL`}
          accent={net >= 0 ? 'green' : 'red'}
        />
        <Stat label="Days active" value={`${stats?.daysActive ?? 0}`} />
      </div>
    </div>
  );
}
function Stat({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'red' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${accent ?? ''}`}>{value}</div>
    </div>
  );
}

/* ---------------- wallets ---------------- */
function Wallets({ wallets, onChange }: { wallets: Wallet[]; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [pk, setPk] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  async function add() {
    setErr('');
    setBusy(true);
    try {
      await api.addWallet(name.trim(), pk.trim());
      toast(`Wallet "${name.trim()}" added`);
      setName('');
      setPk('');
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
    setTimeout(() => api.deleteWallet(w.id).then(onChange).catch((e) => toast(e.message, 'err')), 330);
  }

  return (
    <div className="card">
      <h2>Wallets</h2>
      {wallets.length === 0 && <div className="empty">No wallets yet. Add one below.</div>}
      {wallets.map((w) => (
        <div className={`wallet ${exiting.has(w.id) ? 'exiting' : ''}`} key={w.id}>
          <div>
            <div className="name">{w.name}</div>
            <div className="pk">{short(w.publicKey)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="bal">{(w.balanceSol ?? 0).toFixed(4)} SOL</div>
            <button className="danger" title="Remove wallet" onClick={() => remove(w)}>✕</button>
          </div>
        </div>
      ))}
      <label>Wallet name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main sniper" />
      <label>Private key</label>
      <input value={pk} onChange={(e) => setPk(e.target.value)} placeholder="base58 or [12,34,…] array" type="password" />
      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={add} disabled={busy || !name || !pk}>
        {busy ? <span className="spin" /> : 'Add wallet'}
      </button>
      <div className="hint">Keys are encrypted (AES-256-GCM) and only decrypted in memory when a snipe fires.</div>
    </div>
  );
}

/* ---------------- wallet select ---------------- */
function WalletSelect({ wallets, value, onChange }: { wallets: Wallet[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = wallets.find((w) => w.id === value);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = useMemo(
    () => wallets.filter((w) => w.name.toLowerCase().includes(q.toLowerCase()) || w.publicKey.toLowerCase().includes(q.toLowerCase())),
    [wallets, q],
  );

  return (
    <div className="combo" ref={ref}>
      <input
        value={open ? q : selected ? selected.name : ''}
        placeholder="Search wallets…"
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <div className="menu">
          {filtered.length === 0 && <div className="opt">No matches</div>}
          {filtered.map((w) => (
            <div key={w.id} className="opt" onClick={() => { onChange(w.id); setOpen(false); }}>
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
function SnipeForm({ wallets, onCreated }: { wallets: Wallet[]; onCreated: () => void }) {
  const toast = useToast();
  const [mint, setMint] = useState('');
  const [walletId, setWalletId] = useState('');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('15');
  const [priority, setPriority] = useState('0.0005');
  const [bribe, setBribe] = useState('0');
  const [onlyRedirected, setOnlyRedirected] = useState(false);
  const [watchWallet, setWatchWallet] = useState('');
  const [tpOn, setTpOn] = useState(false);
  const [tpMult, setTpMult] = useState('2');
  const [tpPct, setTpPct] = useState('100');
  const [tpSlip, setTpSlip] = useState('20');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function arm() {
    setErr('');
    setBusy(true);
    try {
      const takeProfit: TakeProfit | undefined = tpOn
        ? { tpEnabled: true, tpMultiplier: Number(tpMult), tpSellPct: Number(tpPct), tpSlippagePct: Number(tpSlip) }
        : undefined;
      await api.createSnipe({
        mint: mint.trim(),
        walletId,
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        priorityFee: Number(priority),
        bribe: Number(bribe),
        onlyRedirected,
        watchWallet: onlyRedirected ? watchWallet.trim() : null,
        takeProfit,
      });
      toast('Snipe armed, watching for the fee claim');
      setMint('');
      setAmount('');
      setWatchWallet('');
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = mint && walletId && Number(amount) > 0 && (!onlyRedirected || watchWallet.trim().length >= 32);

  return (
    <div className="card">
      <h2>Arm a snipe</h2>
      <label>Coin CA (mint)</label>
      <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="pump.fun mint address" />
      <label>Buy with wallet</label>
      <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
      <div className="row">
        <div><label>Amount (SOL)</label><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.5" /></div>
        <div><label>Slippage %</label><input value={slippage} onChange={(e) => setSlippage(e.target.value)} /></div>
      </div>
      <div className="row">
        <div><label>Priority (SOL)</label><input value={priority} onChange={(e) => setPriority(e.target.value)} /></div>
        <div><label>Bribe (SOL)</label><input value={bribe} onChange={(e) => setBribe(e.target.value)} /></div>
      </div>

      <label className="switch-row" onClick={() => setOnlyRedirected((v) => !v)}>
        <span className={`switch ${onlyRedirected ? 'on' : ''}`}><span className="knob" /></span>
        Only a specific wallet's claims
      </label>
      {onlyRedirected && (
        <div className="tp-fields">
          <label>Wallet to watch</label>
          <input value={watchWallet} onChange={(e) => setWatchWallet(e.target.value)} placeholder="claimer wallet address" />
          <div className="hint">Fires only when this exact wallet claims fees for the coin. The deployer's own early claims are ignored — useful once fees are redirected to someone else.</div>
        </div>
      )}

      <div className={`tp-box ${tpOn ? 'on' : ''}`}>
        <label className="switch-row" onClick={() => setTpOn((v) => !v)}>
          <span className={`switch ${tpOn ? 'on' : ''}`}><span className="knob" /></span>
          Take profit
        </label>
        {tpOn && (
          <div className="tp-fields">
            <div className="row">
              <div><label>Sell at MC ×</label><input value={tpMult} onChange={(e) => setTpMult(e.target.value)} placeholder="2" /></div>
              <div><label>Sell %</label><input value={tpPct} onChange={(e) => setTpPct(e.target.value)} placeholder="100" /></div>
              <div><label>Sell slippage %</label><input value={tpSlip} onChange={(e) => setTpSlip(e.target.value)} /></div>
            </div>
            <div className="hint">Auto-sells {tpPct || '?'}% when market cap reaches {tpMult || '?'}× your entry. Uses the same priority + bribe.</div>
          </div>
        )}
      </div>

      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={arm} disabled={busy || !ready}>
        {busy ? <span className="spin" /> : 'Confirm & arm snipe'}
      </button>
      <div className="hint">Fires the moment this coin's creator fees are next claimed. Works pre- and post-migration.</div>
    </div>
  );
}

/* ---------------- take-profit modal ---------------- */
function TpModal({ snipe, onClose, onChange }: { snipe: Snipe; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const [mult, setMult] = useState(String(snipe.tpMultiplier ?? 2));
  const [pct, setPct] = useState(String(snipe.tpSellPct ?? 100));
  const [slip, setSlip] = useState(String(snipe.tpSlippagePct ?? 20));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.editTp(snipe.id, {
        tpEnabled: true,
        tpMultiplier: Number(mult),
        tpSellPct: Number(pct),
        tpSlippagePct: Number(slip),
      });
      toast('Take-profit saved');
      onChange();
      onClose();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }
  async function cancelTp() {
    setBusy(true);
    try {
      await api.cancelTp(snipe.id);
      toast('Take-profit cancelled');
      onChange();
      onClose();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Take profit</h3>
        <p className="modal-sub">{short(snipe.mint)} · status {snipe.tpStatus}</p>
        <div className="row">
          <div><label>Sell at MC ×</label><input value={mult} onChange={(e) => setMult(e.target.value)} /></div>
          <div><label>Sell %</label><input value={pct} onChange={(e) => setPct(e.target.value)} /></div>
          <div><label>Slippage %</label><input value={slip} onChange={(e) => setSlip(e.target.value)} /></div>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>Close</button>
          <button className="danger-btn" onClick={cancelTp} disabled={busy}>Cancel take-profit</button>
          <button className="primary inline" onClick={save} disabled={busy}>
            {busy ? <span className="spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- snipes ---------------- */
function Snipes({ snipes, onChange }: { snipes: Snipe[]; onChange: () => void }) {
  const toast = useToast();
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [tpEdit, setTpEdit] = useState<Snipe | null>(null);

  function remove(id: string) {
    setExiting((s) => new Set(s).add(id));
    setTimeout(() => api.cancelSnipe(id).then(onChange).catch((e) => toast(e.message, 'err')), 330);
  }

  return (
    <div className="card">
      <h2>Snipes</h2>
      {snipes.length === 0 && <div className="empty">No snipes yet. Arm one with a coin CA, a wallet, and a SOL amount.</div>}
      {snipes.map((s) => (
        <div className={`snipe ${s.status} ${exiting.has(s.id) ? 'exiting' : ''}`} key={s.id}>
          <div className="head">
            <span className="ticker">
              {s.ticker ? `$${s.ticker}` : short(s.mint)}
              {s.onlyRedirected && <span className="redir-tag" title="Only fires on redirected-fee claims">redirected</span>}
            </span>
            <span className={`badge ${s.status}`}>
              {s.status === 'ARMED' && <span className="dot" />}
              {s.status}
            </span>
          </div>
          <div className="mint-sub">{s.mint}</div>
          <div className="meta">
            <span><b>{s.amountSol}</b> SOL</span>
            <span>{s.wallet.name}</span>
            <span>slip {s.slippagePct}%</span>
            <span>prio {s.priorityFee}</span>
            {s.bribe > 0 && <span>bribe {s.bribe}</span>}
            {s.watchWallet && <span className="tp-chip">watch {short(s.watchWallet)}</span>}
            {s.tpEnabled && s.tpStatus !== 'CANCELLED' && (
              <span className="tp-chip">TP {s.tpMultiplier}× · {s.tpSellPct}% · {s.tpStatus.toLowerCase()}</span>
            )}
            {s.signature && (
              <a href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">view tx ↗</a>
            )}
            {s.error && <span style={{ color: 'var(--red)' }}>{s.error}</span>}
          </div>
          <div className="snipe-actions">
            <button className="ghost" onClick={() => setTpEdit(s)}>Take profit</button>
            <button className="ghost" onClick={() => remove(s.id)}>
              {s.status === 'ARMED' ? 'Disarm' : 'Remove'}
            </button>
          </div>
        </div>
      ))}
      {tpEdit && <TpModal snipe={tpEdit} onClose={() => setTpEdit(null)} onChange={onChange} />}
    </div>
  );
}

/* ---------------- discover / recommended coins ---------------- */
function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtAge(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

function Discover({ wallets, onSniped }: { wallets: Wallet[]; onSniped: () => void }) {
  const [list, setList] = useState<'new' | 'almost_bonded' | 'migrated'>('new');
  const [minMcap, setMinMcap] = useState('');
  const [maxMcap, setMaxMcap] = useState('');
  const [minVol, setMinVol] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [migration, setMigration] = useState<'any' | 'true' | 'false'>('any');
  const [coins, setCoins] = useState<DiscoverCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [snipeCoin, setSnipeCoin] = useState<DiscoverCoin | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { list };
      if (minMcap) params.minMcap = minMcap;
      if (maxMcap) params.maxMcap = maxMcap;
      if (minVol) params.minVol = minVol;
      if (maxAge) params.maxAgeMin = maxAge;
      if (migration !== 'any') params.migrated = migration;
      const res = await api.discover(params);
      setCoins(res.coins);
      setMessage(res.configured ? (res.coins.length ? null : res.message ?? 'No onboarding coins match your filters right now.') : (res.message ?? 'Data source not configured.'));
    } catch (e: any) {
      setMessage(e.message);
      setCoins([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  return (
    <div className="discover rise">
      <div className="disc-head">
        <h1>Recommended coins</h1>
        <p className="sub">New onboarding coins — fees redirected to another wallet. Snipe fires on that wallet's claims.</p>
      </div>

      <div className="filters card">
        <div className="seg">
          {(['new', 'almost_bonded', 'migrated'] as const).map((l) => (
            <button key={l} className={`seg-btn ${list === l ? 'on' : ''}`} onClick={() => setList(l)}>
              {l === 'new' ? 'New' : l === 'almost_bonded' ? 'Almost bonded' : 'Migrated'}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <input placeholder="Min MC $" value={minMcap} onChange={(e) => setMinMcap(e.target.value)} />
          <input placeholder="Max MC $" value={maxMcap} onChange={(e) => setMaxMcap(e.target.value)} />
          <input placeholder="Min vol $" value={minVol} onChange={(e) => setMinVol(e.target.value)} />
          <input placeholder="Max age (min)" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
          <select value={migration} onChange={(e) => setMigration(e.target.value as any)}>
            <option value="any">Any</option>
            <option value="false">Bonding only</option>
            <option value="true">Migrated only</option>
          </select>
          <button className="primary inline" onClick={load}>Apply</button>
        </div>
      </div>

      {loading && coins.length === 0 ? (
        <div className="empty"><span className="spin dark" /> Loading…</div>
      ) : message ? (
        <div className="empty">{message}</div>
      ) : (
        <div className="coin-grid">
          {coins.map((c) => <CoinCard key={c.mint} coin={c} onSnipe={() => setSnipeCoin(c)} />)}
        </div>
      )}

      {snipeCoin && (
        <SnipeConfigModal
          coin={snipeCoin}
          wallets={wallets}
          onClose={() => setSnipeCoin(null)}
          onSniped={() => { setSnipeCoin(null); onSniped(); }}
        />
      )}
    </div>
  );
}

function CoinCard({ coin, onSnipe }: { coin: DiscoverCoin; onSnipe: () => void }) {
  const toast = useToast();
  const copy = () => navigator.clipboard.writeText(coin.mint).then(() => toast('CA copied'));
  return (
    <div className="coin-card">
      <div className="coin-top">
        <div className="coin-ic">
          {coin.image ? <img src={coin.image} alt="" /> : <span>{(coin.symbol ?? '?').slice(0, 2)}</span>}
        </div>
        <div className="coin-id">
          <div className="coin-sym">${coin.symbol ?? '???'}{coin.migrated && <span className="mig-tag">migrated</span>}</div>
          <div className="coin-name">{coin.name ?? '—'}</div>
        </div>
        <div className="coin-age">{fmtAge(coin.ageMinutes)}</div>
      </div>

      <div className="coin-stats">
        <div><span>MC</span><b>{fmtUsd(coin.marketCapUsd)}</b></div>
        <div><span>Vol</span><b>{fmtUsd(coin.volumeUsd)}</b></div>
      </div>

      <button className="ca-row" onClick={copy} title="Copy CA">
        <code>{coin.mint.slice(0, 6)}…{coin.mint.slice(-6)}</code>
        <span className="copy">copy CA</span>
      </button>
      <div className="recip">onboarded → {coin.recipient.slice(0, 4)}…{coin.recipient.slice(-4)}</div>

      <button className="primary snipe-btn" onClick={onSnipe}>Snipe</button>
    </div>
  );
}

function SnipeConfigModal({ coin, wallets, onClose, onSniped }: { coin: DiscoverCoin; wallets: Wallet[]; onClose: () => void; onSniped: () => void }) {
  const toast = useToast();
  const [walletId, setWalletId] = useState('');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('15');
  const [priority, setPriority] = useState('0.0005');
  const [bribe, setBribe] = useState('0');
  const [tpOn, setTpOn] = useState(false);
  const [tpMult, setTpMult] = useState('2');
  const [tpPct, setTpPct] = useState('100');
  const [tpSlip, setTpSlip] = useState('20');
  const [busy, setBusy] = useState(false);

  const ready = walletId && Number(amount) > 0;

  async function confirm() {
    setBusy(true);
    try {
      await api.createSnipe({
        mint: coin.mint,
        walletId,
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        priorityFee: Number(priority),
        bribe: Number(bribe),
        onlyRedirected: true,
        watchWallet: coin.recipient,
        takeProfit: tpOn ? { tpEnabled: true, tpMultiplier: Number(tpMult), tpSellPct: Number(tpPct), tpSlippagePct: Number(tpSlip) } : undefined,
      });
      toast(`Armed snipe on $${coin.symbol ?? coin.mint.slice(0, 4)}`, 'fill');
      onSniped();
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Snipe ${coin.symbol ?? '???'}</h3>
        <p className="modal-sub">{coin.mint.slice(0, 8)}… · fires when {coin.recipient.slice(0, 4)}…{coin.recipient.slice(-4)} claims</p>

        <label>Buy with wallet</label>
        <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
        <div className="row">
          <div><label>Amount (SOL)</label><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.5" /></div>
          <div><label>Slippage %</label><input value={slippage} onChange={(e) => setSlippage(e.target.value)} /></div>
        </div>
        <div className="row">
          <div><label>Priority (SOL)</label><input value={priority} onChange={(e) => setPriority(e.target.value)} /></div>
          <div><label>Bribe (SOL)</label><input value={bribe} onChange={(e) => setBribe(e.target.value)} /></div>
        </div>

        <div className={`tp-box ${tpOn ? 'on' : ''}`}>
          <label className="switch-row" onClick={() => setTpOn((v) => !v)}>
            <span className={`switch ${tpOn ? 'on' : ''}`}><span className="knob" /></span>
            Take profit
          </label>
          {tpOn && (
            <div className="tp-fields">
              <div className="row">
                <div><label>Sell at MC ×</label><input value={tpMult} onChange={(e) => setTpMult(e.target.value)} /></div>
                <div><label>Sell %</label><input value={tpPct} onChange={(e) => setTpPct(e.target.value)} /></div>
                <div><label>Slippage %</label><input value={tpSlip} onChange={(e) => setTpSlip(e.target.value)} /></div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary inline" onClick={confirm} disabled={busy || !ready}>
            {busy ? <span className="spin" /> : 'Confirm & arm'}
          </button>
        </div>
      </div>
    </div>
  );
}
