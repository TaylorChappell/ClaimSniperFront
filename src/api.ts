const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

let token: string | null = localStorage.getItem('token');

export function getToken() {
  return token;
}
export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const hasBody = opts.body != null;
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      // Only send a JSON content-type when there's actually a body. Sending it
      // on an empty-body POST makes Fastify reject with 400 (empty JSON body).
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data as any).error) || `Request failed (${res.status})`);
  return data as T;
}

export interface Wallet {
  id: string;
  name: string;
  publicKey: string;
  balanceSol?: number;
}
export interface Snipe {
  id: string;
  mint: string;
  amountSol: number;
  slippagePct: number;
  priorityFee: number;
  status: 'ARMED' | 'TRIGGERED' | 'FILLED' | 'FAILED' | 'CANCELLED';
  signature?: string | null;
  error?: string | null;
  createdAt: string;
  wallet: { name: string; publicKey: string };
}

export const api = {
  register: (username: string, password: string) =>
    req<{ token: string; username: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ token: string; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  walletsWithBalances: () => req<{ wallets: Wallet[] }>('/wallets/balances'),
  addWallet: (name: string, privateKey: string) =>
    req<{ wallet: Wallet }>('/wallets', {
      method: 'POST',
      body: JSON.stringify({ name, privateKey }),
    }),
  deleteWallet: (id: string) => req<{ ok: true }>(`/wallets/${id}`, { method: 'DELETE' }),
  snipes: () => req<{ snipes: Snipe[] }>('/snipes'),
  createSnipe: (b: {
    mint: string;
    walletId: string;
    amountSol: number;
    slippagePct?: number;
    priorityFee?: number;
  }) => req<{ snipe: Snipe }>('/snipes', { method: 'POST', body: JSON.stringify(b) }),
  cancelSnipe: (id: string) => req<{ ok: true }>(`/snipes/${id}/cancel`, { method: 'POST' }),
};