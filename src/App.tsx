import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, type Wallet, type Snipe, type Stats, type TakeProfit, type DiscoverCoin, type AdminSnipe, type AdminUser } from './api';
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
  const [admin, setAdmin] = useState(false);
  const [username, setUsername] = useState(localStorage.getItem('username') ?? '');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Unlock audio on the first user gesture so buy/fail chimes can play later.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // On load with a stored token, learn paid/admin/username immediately
  // (avoids a pay-screen flash on reload and surfaces admin access).
  useEffect(() => {
    if (!getToken()) return;
    api.me()
      .then((m) => {
        setUsername(m.username);
        localStorage.setItem('username', m.username);
        setPaid(m.paid);
        setAdmin(m.admin);
      })
      .catch(() => {});
  }, []);

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
    setAdmin(false);
  }

  let screen;
  if (!authed) {
    screen = (
      <Auth
        onAuthed={(u, p, a) => {
          setUsername(u);
          localStorage.setItem('username', u);
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
          <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'fill' ? 'fill' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- auth ---------------- */
function Auth({ onAuthed }: { onAuthed: (u: string, paid: boolean, admin: boolean) => void }) {
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
function Dashboard({ username, admin, onLogout }: { username: string; admin: boolean; onLogout: () => void }) {
  const toast = useToast();
  const prevStatus = useRef<Record<string, string>>({});
  const initialized = useRef(false);

  // Single combined fetch, run only by the leader tab (see useLeaderPolling).
  // Fill/TP toasts + sounds fire here, so only the leader tab plays them.
  const fetchAll = useCallback(async () => {
    const [w, s, st] = await Promise.all([api.walletsWithBalances(), api.snipes(), api.stats()]);
    const list = s.snipes;
    if (initialized.current) {
      for (const sn of list) {
        const prev = prevStatus.current[sn.id];
        if (prev && prev !== 'FILLED' && sn.status === 'FILLED') {
          toast(`Order filled: ${sn.amountSol} SOL of ${short(sn.mint)}`, 'fill');
          playChime('fill');
        } else if (prev && prev !== 'FAILED' && sn.status === 'FAILED') {
          toast(`Snipe failed: ${short(sn.mint)}`, 'err');
          playChime('fail');
        }
        const prevTp = prevStatus.current[`tp:${sn.id}`];
        if (prevTp && prevTp !== 'SOLD' && sn.tpStatus === 'SOLD') {
          toast(`Take-profit hit, sold ${sn.tpSellPct}% of ${short(sn.mint)}`, 'fill');
          playChime('fill');
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

  const { data, refresh } = useLeaderPolling('dash', fetchAll, 30000);
  const wallets = data?.wallets ?? [];
  const snipes = data?.snipes ?? [];
  const stats = data?.stats ?? null;

  const [view, setView] = useState<'dashboard' | 'discover' | 'history' | 'admin'>('dashboard');
  const filled = useMemo(() => snipes.filter((s) => s.status === 'FILLED'), [snipes]);

  return (
    <div className="wrap">
      <div className="topbar rise">
        <div className="brand">
          <img className="logo-img" src={BRAND_IMG} alt="" />
          <b>Claim Sniper</b>
        </div>
        <div className="who">
          <button className={`nav-btn ${view === 'dashboard' ? 'on' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
          <button className={`nav-btn ${view === 'discover' ? 'on' : ''}`} onClick={() => setView('discover')}>Discover</button>
          <button className={`nav-btn ${view === 'history' ? 'on' : ''}`} onClick={() => setView('history')}>History</button>
          {admin && <button className={`nav-btn admin ${view === 'admin' ? 'on' : ''}`} onClick={() => setView('admin')}>Admin</button>}
          <span className="user">@{username}</span>
          <button className="ghost" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {view === 'discover' ? (
        <Discover wallets={wallets} onSniped={() => { refresh(); setView('dashboard'); }} />
      ) : view === 'history' ? (
        <History snipes={filled} />
      ) : view === 'admin' ? (
        <AdminPanel />
      ) : (
        <div className="grid">
          <div className="col">
            <div className="rise d1"><Wallets wallets={wallets} onChange={refresh} /></div>
            <div className="rise d2"><SnipeForm wallets={wallets} onCreated={refresh} /></div>
          </div>
          <div className="col">
            <div className="rise d2"><ProfitSection stats={stats} /></div>
            <div className="rise d3"><Snipes snipes={snipes} wallets={wallets} onChange={refresh} /></div>
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
function EditSnipeModal({ snipe, onClose, onChange }: { snipe: Snipe; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const armed = snipe.status === 'ARMED';
  const [amount, setAmount] = useState(String(snipe.amountSol));
  const [slippage, setSlippage] = useState(String(snipe.slippagePct));
  const [priority, setPriority] = useState(String(snipe.priorityFee));
  const [bribe, setBribe] = useState(String(snipe.bribe));
  const [redir, setRedir] = useState(snipe.onlyRedirected);
  const [watchWallet, setWatchWallet] = useState(snipe.watchWallet ?? '');
  const [tpOn, setTpOn] = useState(snipe.tpEnabled && snipe.tpStatus !== 'CANCELLED');
  const [mult, setMult] = useState(String(snipe.tpMultiplier ?? 2));
  const [pct, setPct] = useState(String(snipe.tpSellPct ?? 100));
  const [slip, setSlip] = useState(String(snipe.tpSlippagePct ?? 20));
  const [busy, setBusy] = useState(false);

  const ready = Number(amount) > 0 && (!redir || watchWallet.trim().length >= 32);

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
        takeProfit: { tpEnabled: tpOn, tpMultiplier: Number(mult), tpSellPct: Number(pct), tpSlippagePct: Number(slip) },
      });
      toast(armed ? 'Snipe updated & re-armed' : 'Snipe updated');
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
        <h3>Edit {snipe.ticker ? `$${snipe.ticker}` : 'snipe'}</h3>
        <p className="modal-sub">{short(snipe.mint)} · {snipe.status.toLowerCase()}</p>

        {armed ? (
          <>
            <div className="row">
              <div><label>Amount (SOL)</label><input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><label>Slippage %</label><input value={slippage} onChange={(e) => setSlippage(e.target.value)} /></div>
            </div>
            <div className="row">
              <div><label>Priority (SOL)</label><input value={priority} onChange={(e) => setPriority(e.target.value)} /></div>
              <div><label>Bribe (SOL)</label><input value={bribe} onChange={(e) => setBribe(e.target.value)} /></div>
            </div>
            <label className="switch-row" onClick={() => setRedir((v) => !v)}>
              <span className={`switch ${redir ? 'on' : ''}`}><span className="knob" /></span>
              Only a specific wallet's claims
            </label>
            {redir && (
              <div className="tp-fields">
                <label>Wallet to watch</label>
                <input value={watchWallet} onChange={(e) => setWatchWallet(e.target.value)} placeholder="claimer wallet address" />
              </div>
            )}
          </>
        ) : (
          <p className="modal-sub" style={{ marginTop: -4 }}>This snipe already filled — only take-profit can be changed.</p>
        )}

        <div className={`tp-box ${tpOn ? 'on' : ''}`}>
          <label className="switch-row" onClick={() => setTpOn((v) => !v)}>
            <span className={`switch ${tpOn ? 'on' : ''}`}><span className="knob" /></span>
            Take profit
          </label>
          {tpOn && (
            <div className="tp-fields">
              <div className="row">
                <div><label>Sell at MC ×</label><input value={mult} onChange={(e) => setMult(e.target.value)} /></div>
                <div><label>Sell %</label><input value={pct} onChange={(e) => setPct(e.target.value)} /></div>
                <div><label>Slippage %</label><input value={slip} onChange={(e) => setSlip(e.target.value)} /></div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>Close</button>
          <button className="primary inline" onClick={save} disabled={busy || !ready}>
            {busy ? <span className="spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- snipes ---------------- */
function Snipes({ snipes, onChange }: { snipes: Snipe[]; wallets: Wallet[]; onChange: () => void }) {
  const toast = useToast();
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Snipe | null>(null);

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
              {s.onlyRedirected && <span className="redir-tag" title="Only fires on a specific wallet's claims">redirected</span>}
            </span>
            <span className={`badge ${s.status}`}>
              {s.status === 'ARMED' && <span className="dot" />}
              {s.status}
            </span>
          </div>
          <CopyCA mint={s.mint} className="mint-sub" />
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
            <button className="ghost" onClick={() => setEdit(s)}>Edit</button>
            <button className="ghost" onClick={() => remove(s.id)}>
              {s.status === 'ARMED' ? 'Disarm' : 'Remove'}
            </button>
          </div>
        </div>
      ))}
      {edit && <EditSnipeModal snipe={edit} onClose={() => setEdit(null)} onChange={onChange} />}
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
  const [minLiq, setMinLiq] = useState('');
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
      if (minLiq) params.minLiq = minLiq;
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
        <h1>Discover</h1>
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
          <input placeholder="Min liq $" value={minLiq} onChange={(e) => setMinLiq(e.target.value)} />
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
        <div><span>Liq</span><b>{fmtUsd(coin.liquidityUsd)}</b></div>
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

/* ---------------- notification sound ---------------- */
let _audioCtx: AudioContext | null = null;
function ensureCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    _audioCtx = _audioCtx || new Ctx();
    if (_audioCtx.state === 'suspended') void _audioCtx.resume();
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

function playChime(kind: 'fill' | 'fail') {
  try {
    const ctx = ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    // fill (a buy landed) = rising bright two-note; fail = descending low two-note.
    const notes = kind === 'fill' ? [660, 990] : [300, 160];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
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

/* ---------------- history (filled only) ---------------- */
function History({ snipes }: { snipes: Snipe[] }) {
  return (
    <div className="discover rise">
      <div className="disc-head">
        <h1>Snipe history</h1>
        <p className="sub">Every snipe that filled.</p>
      </div>
      {snipes.length === 0 ? (
        <div className="empty">No filled snipes yet.</div>
      ) : (
        <div className="hist-list">
          {snipes.map((s) => (
            <div className="hist-row" key={s.id}>
              <span className="hist-tk">{s.ticker ? `$${s.ticker}` : short(s.mint)}</span>
              <CopyCA mint={s.mint} />
              <span className="hist-amt">{s.amountSol} SOL</span>
              {s.soldSol > 0 && <span className="hist-sold">+{s.soldSol.toFixed(3)} SOL</span>}
              <span className="hist-date">{new Date(s.createdAt).toLocaleString()}</span>
              {s.signature && (
                <a href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">tx ↗</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- admin panel (MrKnowBody / Rich) ---------------- */
function AdminPanel() {
  const toast = useToast();
  const [tab, setTab] = useState<'armed' | 'users'>('armed');
  const [armed, setArmed] = useState<AdminSnipe[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sel, setSel] = useState<{ username: string; snipes: Snipe[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.adminArmed(), api.adminUsers()])
      .then(([a, u]) => { setArmed(a.snipes); setUsers(u.users); })
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openUser(u: AdminUser) {
    try {
      setSel(await api.adminUserSnipes(u.id));
    } catch (e: any) {
      toast(e.message, 'err');
    }
  }

  return (
    <div className="discover rise">
      <div className="disc-head">
        <h1>Admin</h1>
        <p className="sub">All armed snipes and every account.</p>
      </div>

      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={`seg-btn ${tab === 'armed' ? 'on' : ''}`} onClick={() => setTab('armed')}>Armed ({armed.length})</button>
        <button className={`seg-btn ${tab === 'users' ? 'on' : ''}`} onClick={() => setTab('users')}>Users ({users.length})</button>
      </div>

      {loading ? (
        <div className="empty"><span className="spin dark" /> Loading…</div>
      ) : tab === 'armed' ? (
        armed.length === 0 ? <div className="empty">Nothing armed right now.</div> : (
          <div className="admin-list">
            {armed.map((s) => (
              <div className="admin-row" key={s.id}>
                <span className="hist-tk">{s.ticker ? `$${s.ticker}` : short(s.mint)}</span>
                <span className="admin-user">@{s.user.username}</span>
                <span>{s.amountSol} SOL</span>
                <span>{s.wallet.name}</span>
                {s.watchWallet && <span className="tp-chip">watch {short(s.watchWallet)}</span>}
                {s.tpEnabled && <span className="tp-chip">TP {s.tpMultiplier}×</span>}
                <CopyCA mint={s.mint} />
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="admin-list">
          {users.map((u) => (
            <div className="admin-row clickable" key={u.id} onClick={() => openUser(u)}>
              <span className="admin-user">@{u.username}</span>
              <span className={`badge ${u.paid ? 'FILLED' : 'FAILED'}`}>{u.paid ? 'paid' : 'unpaid'}</span>
              <span>{u.snipeCount} snipes</span>
              <span>{u.walletCount} wallets</span>
              <span className="hist-date">{new Date(u.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {sel && (
        <div className="modal-overlay" onMouseDown={() => setSel(null)}>
          <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
            <h3>@{sel.username}</h3>
            <p className="modal-sub">{sel.snipes.length} snipe(s)</p>
            <div className="admin-list scroll">
              {sel.snipes.length === 0 ? <div className="empty">No snipes.</div> : sel.snipes.map((s) => (
                <div className="admin-row" key={s.id}>
                  <span className="hist-tk">{s.ticker ? `$${s.ticker}` : short(s.mint)}</span>
                  <span className={`badge ${s.status}`}>{s.status}</span>
                  <span>{s.amountSol} SOL</span>
                  {s.tpEnabled && <span className="tp-chip">TP {s.tpMultiplier}×</span>}
                  <CopyCA mint={s.mint} />
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setSel(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- copyable CA ---------------- */
function CopyCA({ mint, className }: { mint: string; className?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={`ca-copy ${className ?? ''}`}
      title="Copy contract address"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(mint).then(() => toast('CA copied'));
      }}
    >
      <code>{short(mint)}</code>
      <span className="copy">copy CA</span>
    </button>
  );
}
