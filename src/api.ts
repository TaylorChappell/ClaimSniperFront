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
export interface ExitCfg {
  tpEnabled?: boolean;
  tpMultiplier?: number;
  tpSellPct?: number;
  tpSlippagePct?: number;
  tpTrailing?: boolean;
  tpTrailPct?: number;
  slEnabled?: boolean;
  slPct?: number;
  slTrailing?: boolean;
  slTrailPct?: number;
  slSlippagePct?: number;
}
export interface Snipe {
  id: string;
  mint: string;
  amountSol: number;
  slippagePct: number;
  priorityFee: number;
  bribe: number;
  execMode?: 'PUMPPORTAL' | 'LOCAL';
  triggerMode?: 'CLAIM' | 'REDIRECT';
  ticker?: string | null;
  onlyRedirected: boolean;
  watchWallet?: string | null;
  status: 'ARMED' | 'TRIGGERED' | 'FILLED' | 'FAILED' | 'CANCELLED';
  signature?: string | null;
  error?: string | null;
  createdAt: string;
  wallet: { name: string; publicKey: string };
  tpEnabled: boolean;
  tpMultiplier?: number | null;
  tpSellPct?: number | null;
  tpSlippagePct?: number | null;
  tpTrailing?: boolean;
  tpTrailPct?: number | null;
  slEnabled?: boolean;
  slPct?: number | null;
  slTrailing?: boolean;
  slTrailPct?: number | null;
  slSlippagePct?: number | null;
  tpStatus: string;
  tpSignature?: string | null;
  entryMcSol?: number | null;
  peakMcSol?: number | null;
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
export interface AdminSnipe extends Snipe {
  user: { username: string };
}
export interface AdminUser {
  id: string;
  username: string;
  paid: boolean;
  createdAt: string;
  snipeCount: number;
  walletCount: number;
  spentSol: number;
  madeSol: number;
  netSol: number;
}

export interface SocialUser {
  id: string;
  username: string;
  createdAt: string;
  snipeCount: number;
  filledCount: number;
  spentSol: number;
  madeSol: number;
  netSol: number;
}
export interface PublicSnipe {
  id: string;
  mint: string;
  ticker?: string | null;
  amountSol: number;
  soldSol: number;
  status: string;
  triggerMode?: 'CLAIM' | 'REDIRECT';
  execMode?: 'PUMPPORTAL' | 'LOCAL';
  slippagePct?: number;
  priorityFee?: number;
  bribe?: number;
  watchWallet?: string | null;
  onlyRedirected?: boolean;
  tpEnabled: boolean;
  tpMultiplier?: number | null;
  tpSellPct?: number | null;
  tpSlippagePct?: number | null;
  tpTrailing?: boolean;
  tpTrailPct?: number | null;
  tpStatus?: string;
  slEnabled?: boolean;
  slPct?: number | null;
  slTrailing?: boolean;
  slTrailPct?: number | null;
  slSlippagePct?: number | null;
  createdAt: string;
  filledAt?: string | null;
}
export interface TrendingCoin {
  mint: string;
  ticker?: string | null;
  userCount: number;
  snipeCount: number;
  redirectCount: number;
}
export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  createdAt: string;
}
export interface AdminLog {
  id: string;
  username: string;
  userId: string;
  level: string;
  message: string;
  createdAt: string;
}

export interface PushPublicKey {
  configured: boolean;
  publicKey: string | null;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface DiscoverCoin {
  mint: string;
  ticker: string | null;
  name: string | null;
  image: string | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  createdAt: string | null;
  migrated: boolean;
  creator?: string | null;
  redirectedAt?: string | null;
}

export const api = {
  register: (username: string, password: string) =>
    req<{ token: string; username: string; paid: boolean; admin: boolean }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ token: string; username: string; paid: boolean; admin: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => req<{ username: string; paid: boolean; admin: boolean }>('/auth/me'),
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
    execMode?: 'PUMPPORTAL' | 'LOCAL';
    triggerMode?: 'CLAIM' | 'REDIRECT';
    onlyRedirected?: boolean;
    watchWallet?: string | null;
    exit?: ExitCfg;
  }) => req<{ snipe: Snipe }>('/snipes', { method: 'POST', body: JSON.stringify(b) }),
  editSnipe: (id: string, body: {
    amountSol?: number;
    slippagePct?: number;
    priorityFee?: number;
    bribe?: number;
    execMode?: 'PUMPPORTAL' | 'LOCAL';
    triggerMode?: 'CLAIM' | 'REDIRECT';
    onlyRedirected?: boolean;
    watchWallet?: string | null;
    exit?: ExitCfg;
  }) => req<{ snipe: Snipe }>(`/snipes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  adminArmed: () => req<{ snipes: AdminSnipe[] }>('/admin/armed'),
  adminCopySnipe: (id: string, walletId: string) =>
    req<{ snipe: Snipe }>(`/admin/snipes/${id}/copy`, { method: 'POST', body: JSON.stringify({ walletId }) }),
  adminUsers: () => req<{ users: AdminUser[] }>('/admin/users'),
  adminUserSnipes: (id: string) =>
    req<{ username: string; payWallet: string | null; snipes: Snipe[]; wallets: { id: string; name: string; publicKey: string }[] }>(`/admin/users/${id}/snipes`),
  adminLogs: (userId?: string, level?: string) => {
    const p = new URLSearchParams();
    if (userId) p.set('userId', userId);
    if (level) p.set('level', level);
    const qs = p.toString();
    return req<{ logs: AdminLog[] }>(`/admin/logs${qs ? `?${qs}` : ''}`);
  },
  socialUsers: () => req<{ users: SocialUser[] }>('/social/users'),
  socialUserSnipes: (id: string) =>
    req<{ username: string; active: PublicSnipe[]; filled: PublicSnipe[] }>(`/social/users/${id}/snipes`),
  socialTrending: () => req<{ coins: TrendingCoin[] }>('/social/trending'),
  socialChat: (after?: string) =>
    req<{ messages: ChatMessage[] }>(`/social/chat${after ? `?after=${encodeURIComponent(after)}` : ''}`),
  socialChatLatest: () => req<{ latest: string | null }>('/social/chat/latest'),
  socialSend: (text: string) =>
    req<{ message: ChatMessage }>('/social/chat', { method: 'POST', body: JSON.stringify({ text }) }),
  pushPublicKey: () => req<PushPublicKey>('/push/public-key'),
  savePushSubscription: (subscription: PushSubscriptionPayload) =>
    req<{ ok: true }>('/push/subscription', { method: 'POST', body: JSON.stringify(subscription) }),
  deletePushSubscription: (endpoint: string) =>
    req<{ ok: true }>('/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  cancelSnipe: (id: string) => req<{ ok: true }>(`/snipes/${id}/cancel`, { method: 'POST' }),
  cancelExit: (id: string) => req<{ snipe: Snipe }>(`/snipes/${id}/cancel-exit`, { method: 'POST' }),
  discover: () => req<{ coins: DiscoverCoin[]; configured: boolean; message?: string }>('/discover'),
  discoverHide: (mint: string) => req<{ ok: true }>('/discover/hide', { method: 'POST', body: JSON.stringify({ mint }) }),
  discoverResetHidden: () => req<{ ok: true }>('/discover/reset-hidden', { method: 'POST' }),
};