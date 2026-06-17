import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, type Wallet, type Snipe } from './api';

const BRAND_IMG = `${import.meta.env.BASE_URL}sniper.png`;
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

/* ---------------- toast system ---------------- */
type ToastKind = 'ok' | 'err' | 'fill';
type Toast = { id: number; text: string; kind: ToastKind };
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
const useToast = () => useContext(ToastCtx);

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [username, setUsername] = useState(localStorage.getItem('username') ?? '');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (text: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'fill' ? 5000 : 3800);
  };

  return (
    <ToastCtx.Provider value={push}>
      {!authed ? (
        <Auth
          onAuthed={(u) => {
            setUsername(u);
            localStorage.setItem('username', u);
            setAuthed(true);
          }}
        />
      ) : (
        <Dashboard
          username={username}
          onLogout={() => {
            setToken(null);
            localStorage.removeItem('username');
            setAuthed(false);
          }}
        />
      )}
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
function Auth({ onAuthed }: { onAuthed: (u: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      const fn = mode === 'login' ? api.login : api.register;
      const res = await fn(u, p);
      setToken(res.token);
      onAuthed(res.username);
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
          {mode === 'login' ? 'Sign in to your account.' : 'Create an account to store wallets and arm snipes.'}
        </p>
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
            <span>
              No account? <a onClick={() => setMode('register')}>Create one</a>
            </span>
          ) : (
            <span>
              Have an account? <a onClick={() => setMode('login')}>Sign in</a>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- dashboard ---------------- */
function Dashboard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const toast = useToast();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [snipes, setSnipes] = useState<Snipe[]>([]);
  const prevStatus = useRef<Record<string, string>>({});
  const initialized = useRef(false);

  const refreshWallets = async () => setWallets((await api.walletsWithBalances()).wallets);

  const refreshSnipes = async () => {
    const { snipes } = await api.snipes();
    // Notify on status transitions into FILLED / FAILED (skip the first load).
    if (initialized.current) {
      for (const s of snipes) {
        const prev = prevStatus.current[s.id];
        if (prev && prev !== 'FILLED' && s.status === 'FILLED') {
          toast(`Order filled — ${s.amountSol} SOL of ${short(s.mint)}`, 'fill');
        } else if (prev && prev !== 'FAILED' && s.status === 'FAILED') {
          toast(`Snipe failed — ${short(s.mint)}`, 'err');
        }
      }
    }
    const map: Record<string, string> = {};
    for (const s of snipes) map[s.id] = s.status;
    prevStatus.current = map;
    initialized.current = true;
    setSnipes(snipes);
  };

  useEffect(() => {
    refreshWallets().catch(() => {});
    refreshSnipes().catch(() => {});
    const t = setInterval(() => {
      refreshSnipes().catch(() => {});
      refreshWallets().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="wrap">
      <div className="topbar rise">
        <div className="brand">
          <img className="logo-img" src={BRAND_IMG} alt="" />
          <b>Claim Sniper</b>
        </div>
        <div className="who">
          <span className="user">@{username}</span>
          <button className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      <div className="grid">
        <div className="col">
          <div className="rise d1">
            <Wallets wallets={wallets} onChange={refreshWallets} />
          </div>
          <div className="rise d2">
            <SnipeForm wallets={wallets} onCreated={refreshSnipes} />
          </div>
        </div>
        <div className="rise d3">
          <Snipes snipes={snipes} onChange={refreshSnipes} />
        </div>
      </div>
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
    setExiting((s) => new Set(s).add(w.id)); // play exit animation first
    setTimeout(() => {
      api.deleteWallet(w.id).then(onChange).catch((e) => toast(e.message, 'err'));
    }, 330);
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
            <button className="danger" title="Remove wallet" onClick={() => remove(w)}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <label>Wallet name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main sniper" />
      <label>Private key</label>
      <input
        value={pk}
        onChange={(e) => setPk(e.target.value)}
        placeholder="base58 or [12,34,…] array"
        type="password"
      />
      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={add} disabled={busy || !name || !pk}>
        {busy ? <span className="spin" /> : 'Add wallet'}
      </button>
      <div className="hint">
        Keys are encrypted (AES-256-GCM) before storage and only decrypted in memory at the moment a
        snipe fires.
      </div>
    </div>
  );
}

/* ---------------- searchable wallet select ---------------- */
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
        value={open ? q : selected ? selected.name : ''}
        placeholder="Search wallets…"
        onFocus={() => {
          setOpen(true);
          setQ('');
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
function SnipeForm({ wallets, onCreated }: { wallets: Wallet[]; onCreated: () => void }) {
  const toast = useToast();
  const [mint, setMint] = useState('');
  const [walletId, setWalletId] = useState('');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('15');
  const [priority, setPriority] = useState('0.0005');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function arm() {
    setErr('');
    setBusy(true);
    try {
      await api.createSnipe({
        mint: mint.trim(),
        walletId,
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        priorityFee: Number(priority),
      });
      toast('Snipe armed — watching for the fee claim');
      setMint('');
      setAmount('');
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = mint && walletId && Number(amount) > 0;

  return (
    <div className="card">
      <h2>Arm a snipe</h2>
      <label>Coin CA (mint)</label>
      <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="pump.fun mint address" />
      <label>Buy with wallet</label>
      <WalletSelect wallets={wallets} value={walletId} onChange={setWalletId} />
      <div className="row">
        <div>
          <label>Amount (SOL)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.5" />
        </div>
        <div>
          <label>Slippage %</label>
          <input value={slippage} onChange={(e) => setSlippage(e.target.value)} />
        </div>
        <div>
          <label>Priority (SOL)</label>
          <input value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={arm} disabled={busy || !ready}>
        {busy ? <span className="spin" /> : 'Confirm & arm snipe'}
      </button>
      <div className="hint">
        Fires automatically the moment this coin's creator fees are next claimed on-chain. Works pre-
        and post-migration.
      </div>
    </div>
  );
}

/* ---------------- snipe list ---------------- */
function Snipes({ snipes, onChange }: { snipes: Snipe[]; onChange: () => void }) {
  const toast = useToast();
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  function remove(id: string) {
    setExiting((s) => new Set(s).add(id)); // animate out, then delete
    setTimeout(() => {
      api.cancelSnipe(id).then(onChange).catch((e) => toast(e.message, 'err'));
    }, 330);
  }

  return (
    <div className="card">
      <h2>Snipes</h2>
      {snipes.length === 0 && (
        <div className="empty">No snipes yet. Arm one with a coin CA, a wallet, and a SOL amount.</div>
      )}
      {snipes.map((s) => (
        <div className={`snipe ${s.status} ${exiting.has(s.id) ? 'exiting' : ''}`} key={s.id}>
          <div className="head">
            <span className="mint">{s.mint}</span>
            <span className={`badge ${s.status}`}>
              {s.status === 'ARMED' && <span className="dot" />}
              {s.status}
            </span>
          </div>
          <div className="meta">
            <span><b>{s.amountSol}</b> SOL</span>
            <span>{s.wallet.name}</span>
            <span>slip {s.slippagePct}%</span>
            <span>prio {s.priorityFee}</span>
            {s.signature && (
              <a href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">
                view tx ↗
              </a>
            )}
            {s.error && <span style={{ color: 'var(--red)' }}>{s.error}</span>}
          </div>
          <button className="ghost" style={{ marginTop: 12 }} onClick={() => remove(s.id)}>
            {s.status === 'ARMED' ? 'Disarm' : 'Remove'}
          </button>
        </div>
      ))}
    </div>
  );
}