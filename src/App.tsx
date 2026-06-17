import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken, type Wallet, type Snipe } from './api';

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [username, setUsername] = useState(localStorage.getItem('username') ?? '');

  if (!authed) {
    return (
      <Auth
        onAuthed={(u) => {
          setUsername(u);
          localStorage.setItem('username', u);
          setAuthed(true);
        }}
      />
    );
  }
  return (
    <Dashboard
      username={username}
      onLogout={() => {
        setToken(null);
        localStorage.removeItem('username');
        setAuthed(false);
      }}
    />
  );
}

/* ------------------------- Auth ------------------------- */
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
      <div className="auth card">
        <div className="brand" style={{ marginBottom: 6 }}>
          <b>Snipe Desk</b>
          <span className="tag">armed &amp; ready</span>
        </div>
        <p className="hint">
          {mode === 'login' ? 'Sign in to your account.' : 'Create an account to store wallets and arm snipes.'}
        </p>
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
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
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

/* ------------------------- Dashboard ------------------------- */
function Dashboard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [snipes, setSnipes] = useState<Snipe[]>([]);

  async function refreshWallets() {
    const { wallets } = await api.walletsWithBalances();
    setWallets(wallets);
  }
  async function refreshSnipes() {
    const { snipes } = await api.snipes();
    setSnipes(snipes);
  }

  useEffect(() => {
    refreshWallets().catch(() => {});
    refreshSnipes().catch(() => {});
    // Poll snipe + balance state so fills show up live.
    const t = setInterval(() => {
      refreshSnipes().catch(() => {});
      refreshWallets().catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <b>Snipe Desk</b>
          <span className="tag">armed &amp; ready</span>
        </div>
        <div className="who">
          <span>@{username}</span>
          <button className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      <div className="grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Wallets wallets={wallets} onChange={refreshWallets} />
          <SnipeForm wallets={wallets} onCreated={refreshSnipes} />
        </div>
        <Snipes snipes={snipes} onChange={refreshSnipes} />
      </div>
    </div>
  );
}

/* ------------------------- Wallets ------------------------- */
function Wallets({ wallets, onChange }: { wallets: Wallet[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [pk, setPk] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    setErr('');
    setBusy(true);
    try {
      await api.addWallet(name.trim(), pk.trim());
      setName('');
      setPk('');
      onChange();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Wallets</h2>
      {wallets.length === 0 && <div className="empty">No wallets yet. Add one below.</div>}
      {wallets.map((w) => (
        <div className="wallet" key={w.id}>
          <div>
            <div className="name">{w.name}</div>
            <div className="pk">
              {w.publicKey.slice(0, 4)}…{w.publicKey.slice(-4)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="bal">{(w.balanceSol ?? 0).toFixed(4)} SOL</div>
            <button
              className="danger"
              title="Remove wallet"
              onClick={() => {
                if (confirm(`Remove "${w.name}"? The encrypted key is deleted.`))
                  api.deleteWallet(w.id).then(onChange).catch((e) => alert(e.message));
              }}
            >
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
        {busy ? '…' : 'Add wallet'}
      </button>
      <div className="hint">
        Keys are encrypted (AES-256-GCM) before storage and only decrypted in memory at the moment a
        snipe fires.
      </div>
    </div>
  );
}

/* --------------- searchable wallet select --------------- */
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
        value={open ? q : selected ? `${selected.name}` : ''}
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

/* ------------------------- Snipe form ------------------------- */
function SnipeForm({ wallets, onCreated }: { wallets: Wallet[]; onCreated: () => void }) {
  const [mint, setMint] = useState('');
  const [walletId, setWalletId] = useState('');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('15');
  const [priority, setPriority] = useState('0.0005');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function arm() {
    setErr('');
    setOk('');
    setBusy(true);
    try {
      await api.createSnipe({
        mint: mint.trim(),
        walletId,
        amountSol: Number(amount),
        slippagePct: Number(slippage),
        priorityFee: Number(priority),
      });
      setOk('Snipe armed. Watching for the fee claim.');
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
      {ok && <div className="hint" style={{ color: 'var(--live)' }}>{ok}</div>}
      <button className="primary" onClick={arm} disabled={busy || !ready}>
        {busy ? '…' : 'Confirm & arm snipe'}
      </button>
      <div className="hint">
        Fires automatically the moment this coin's creator fees are claimed on-chain. Works pre- and
        post-migration.
      </div>
    </div>
  );
}

/* ------------------------- Snipe list ------------------------- */
function Snipes({ snipes, onChange }: { snipes: Snipe[]; onChange: () => void }) {
  return (
    <div className="card">
      <h2>Snipes</h2>
      {snipes.length === 0 && (
        <div className="empty">No snipes yet. Arm one with a coin CA, a wallet, and a SOL amount.</div>
      )}
      {snipes.map((s) => (
        <div className="snipe" key={s.id}>
          <div className="head">
            <span className="mint">{s.mint}</span>
            <span className={`badge ${s.status}`}>
              {s.status === 'ARMED' && <span className="dot" />}
              {s.status}
            </span>
          </div>
          <div className="meta">
            <span>{s.amountSol} SOL</span>
            <span>{s.wallet.name}</span>
            <span>slip {s.slippagePct}%</span>
            <span>prio {s.priorityFee}</span>
            {s.signature && (
              <a href={`https://solscan.io/tx/${s.signature}`} target="_blank" rel="noreferrer">
                view tx
              </a>
            )}
            {s.error && <span style={{ color: 'var(--danger)' }}>{s.error}</span>}
          </div>
          {s.status === 'ARMED' && (
            <button
              className="ghost"
              style={{ marginTop: 10 }}
              onClick={() => api.cancelSnipe(s.id).then(onChange).catch((e) => alert(e.message))}
            >
              Disarm
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
