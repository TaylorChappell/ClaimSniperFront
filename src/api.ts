const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

let token: string | null = localStorage.getItem('token');
export const getToken = () => token;
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
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data as any).error) || `Request failed (${res.status})`);
  return data as T;
}

export interface Wallet { id: string; name: string; publicKey: string; balanceSol?: number; }
export interface TakeProfit {
  tpEnabled: boolean;
  tpMultiplier?: number;
  tpSellPct?: number;
  tpSlippagePct?: number;
}
export interface Snipe {
  id: string;
  mint: string;
  amountSol: number;
  slippagePct: number;
  priorityFee: number;
  bribe: number;
  status: 'ARMED' | 'TRIGGERED' | 'FILLED' | 'FAILED' | 'CANCELLED';
  signature?: string | null;
  error?: string | null;
  createdAt: string;
  wallet: { name: string; publicKey: string };
  tpEnabled: boolean;
  tpMultiplier?: number | null;
  tpSellPct?: number | null;
  tpSlippagePct?: number | null;
  tpStatus: string;
  tpSignature?: string | null;
  entryMcSol?: number | null;
  soldSol: number;
}
export interface BillingStatus {
  paid: boolean;
  depositAddress?: string | null;
  priceSol?: number;
  receivedSol?: number;
  message?: string | null;
}
export interface Stats { spentSol: number; madeSol: number; netSol: number; daysActive: number; }

export const api = {
  register: (username: string, password: string) =>
    req<{ token: string; username: string; paid: boolean }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ token: string; username: string; paid: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  billingStatus: () => req<BillingStatus>('/billing/status'),
  walletsWithBalances: () => req<{ wallets: Wallet[] }>('/wallets/balances'),
  addWallet: (name: string, privateKey: string) =>
    req<{ wallet: Wallet }>('/wallets', { method: 'POST', body: JSON.stringify({ name, privateKey }) }),
  deleteWallet: (id: string) => req<{ ok: true }>(`/wallets/${id}`, { method: 'DELETE' }),
  snipes: () => req<{ snipes: Snipe[] }>('/snipes'),
  stats: () => req<Stats>('/snipes/stats'),
  createSnipe: (b: {
    mint: string;
    walletId: string;
    amountSol: number;
    slippagePct?: number;
    priorityFee?: number;
    bribe?: number;
    takeProfit?: TakeProfit;
  }) => req<{ snipe: Snipe }>('/snipes', { method: 'POST', body: JSON.stringify(b) }),
  editTp: (id: string, tp: TakeProfit) =>
    req<{ snipe: Snipe }>(`/snipes/${id}/tp`, { method: 'PUT', body: JSON.stringify(tp) }),
  cancelTp: (id: string) => req<{ snipe: Snipe }>(`/snipes/${id}/tp/cancel`, { method: 'POST' }),
  cancelSnipe: (id: string) => req<{ ok: true }>(`/snipes/${id}/cancel`, { method: 'POST' }),
};
