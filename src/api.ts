const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

let token: string | null = localStorage.getItem("token");
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const hasBody = opts.body != null;
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      (data && (data as any).error) || `Request failed (${res.status})`,
    );
  return data as T;
}

export interface Wallet {
  id: string;
  name: string;
  publicKey: string;
  balanceSol?: number;
}
export type TradingPlatform = "AXIOM" | "GMGN" | "TERMINAL";
export interface Profile {
  username: string;
  paid: boolean;
  admin: boolean;
  whitelisted?: boolean;
  subscriptionExpiresAt?: string | null;
  avatarDataUrl: string | null;
  chatColor: string;
  tradingPlatform: TradingPlatform;
}
export interface TakeProfitEntryCfg {
  multiplier: number;
  sellPct: number;
  slippagePct: number;
}
export interface TakeProfitEntry extends TakeProfitEntryCfg {
  id: string;
  index: number;
  status: string;
  signature?: string | null;
  soldSol?: number;
}
export interface ExitCfg {
  tpEnabled?: boolean;
  takeProfits?: TakeProfitEntryCfg[];
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
export interface LiveMarketCapSnapshot {
  mint: string;
  marketCapSol: number | null;
  marketCapUsd: number | null;
  priceSol: number | null;
  priceUsd: number | null;
  updatedAt: string | null;
  source: "pumpdev" | "rpc" | "unknown" | null;
}

export interface Snipe {
  id: string;
  mint: string;
  pairAddress?: string | null;
  pairDexId?: string | null;
  pairUrl?: string | null;
  liveMarketCapSol?: number | null;
  liveMarketCapUsd?: number | null;
  livePriceSol?: number | null;
  livePriceUsd?: number | null;
  liveMarketCapUpdatedAt?: string | null;
  liveMarketCapSource?: "pumpdev" | "rpc" | "unknown" | null;
  amountSol: number;
  slippagePct: number;
  priorityFee: number;
  bribe: number;
  execMode?: "PUMPPORTAL" | "LOCAL";
  triggerMode?: "CLAIM" | "REDIRECT";
  ticker?: string | null;
  onlyRedirected: boolean;
  watchWallet?: string | null;
  status: "ARMED" | "PAUSED" | "TRIGGERED" | "FILLED" | "FAILED" | "CANCELLED";
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
  takeProfits?: TakeProfitEntry[];
  entryMcSol?: number | null;
  peakMcSol?: number | null;
  soldSol: number;
  claimCheckStatus?: "UNKNOWN" | "CHECKING" | "CLAIMED" | "NOT_FOUND" | "FAILED" | "SKIPPED";
  claimCheckWallet?: string | null;
  claimCheckTx?: string | null;
  claimCheckInstruction?: string | null;
  claimCheckRecipient?: string | null;
  claimCheckSigner?: boolean;
  claimCheckClaimedAt?: string | null;
  claimCheckCheckedAt?: string | null;
  claimCheckError?: string | null;
}
export interface BillingStatus {
  paid: boolean;
  whitelisted?: boolean;
  subscriptionExpiresAt?: string | null;
  subscriptionDays?: number;
  depositAddress?: string | null;
  priceSol?: number;
  receivedSol?: number;
  message?: string | null;
}
export interface Stats {
  spentSol: number;
  madeSol: number;
  netSol: number;
  daysActive: number;
}
export interface AdminSnipe extends Snipe {
  user: { username: string };
}
export interface AdminUser {
  id: string;
  username: string;
  paid: boolean;
  priorityTx: boolean;
  whitelist?: boolean;
  subscriptionExpiresAt?: string | null;
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
  avatarDataUrl?: string | null;
  chatColor?: string | null;
  tradingPlatform?: TradingPlatform | null;
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
  pairAddress?: string | null;
  pairDexId?: string | null;
  pairUrl?: string | null;
  liveMarketCapSol?: number | null;
  liveMarketCapUsd?: number | null;
  livePriceSol?: number | null;
  livePriceUsd?: number | null;
  liveMarketCapUpdatedAt?: string | null;
  liveMarketCapSource?: "pumpdev" | "rpc" | "unknown" | null;
  ticker?: string | null;
  amountSol: number;
  soldSol: number;
  status: string;
  triggerMode?: "CLAIM" | "REDIRECT";
  execMode?: "PUMPPORTAL" | "LOCAL";
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
  takeProfits?: TakeProfitEntry[];
  slEnabled?: boolean;
  slPct?: number | null;
  slTrailing?: boolean;
  slTrailPct?: number | null;
  slSlippagePct?: number | null;
  createdAt: string;
  filledAt?: string | null;
  signature?: string | null;
}
export interface TrendingCoin {
  mint: string;
  pairAddress?: string | null;
  pairDexId?: string | null;
  pairUrl?: string | null;
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
  avatarDataUrl?: string | null;
  chatColor?: string | null;
  tradingPlatform?: TradingPlatform | null;
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
export interface PushSubscriptionStatus {
  subscribed: boolean;
  tradeEnabled: boolean;
  chatEnabled: boolean;
}

export interface AdminNotificationResult {
  ok: true;
  total: number;
  sent: number;
  failed: number;
  removed: number;
}

export interface PushTestResult {
  ok: boolean;
  total: number;
  sent: number;
  failed: number;
  removed: number;
  error?: string;
}

export interface DiscoverCoin {
  mint: string;
  ticker: string | null;
  name: string | null;
  image: string | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  pairAddress: string | null;
  pairDexId: string | null;
  pairUrl: string | null;
  pairCreatedAt: string | null;
  marketDataUpdatedAt: string | null;
  createdAt: string | null;
  migrated: boolean;
  creator?: string | null;
  redirectedAt?: string | null;
  source?: string | null;
  signature?: string | null;
  authority?: string | null;
  sharingConfig?: string | null;
  metadataUpdatedAt?: string | null;
  isLikelyAgent?: boolean;
  isLikelyCharity?: boolean;
  classificationReason?: string | null;
}

export interface DiscoverMetadata {
  mint: string;
  ticker: string | null;
  name: string | null;
  image: string | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  pairAddress: string | null;
  pairDexId: string | null;
  pairUrl: string | null;
  pairCreatedAt: string | null;
  marketDataUpdatedAt: string | null;
  creator: string | null;
  source: string | null;
  signature: string | null;
  authority: string | null;
  sharingConfig: string | null;
  firstSeenAt: string;
  redirectedAt: string;
  metadataUpdatedAt: string | null;
  isLikelyAgent: boolean;
  isLikelyCharity: boolean;
  classificationReason: string | null;
  metadata: unknown;
}

export const api = {
  register: (username: string, password: string) =>
    req<{ token: string } & Profile>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    req<{ token: string } & Profile>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => req<Profile>("/auth/me"),
  profile: () => req<{ profile: Profile }>("/profile"),
  updateProfile: (body: {
    avatarDataUrl?: string | null;
    chatColor?: string;
    tradingPlatform?: TradingPlatform;
  }) =>
    req<{ profile: Profile }>("/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  billingStatus: () => req<BillingStatus>("/billing/status"),
  walletsWithBalances: () => req<{ wallets: Wallet[] }>("/wallets/balances"),
  addWallet: (name: string, privateKey: string) =>
    req<{ wallet: Wallet }>("/wallets", {
      method: "POST",
      body: JSON.stringify({ name, privateKey }),
    }),
  deleteWallet: (id: string) =>
    req<{ ok: true }>(`/wallets/${id}`, { method: "DELETE" }),
  snipes: () => req<{ snipes: Snipe[] }>("/snipes"),
  snipeMarketCaps: () =>
    req<{ caps: Record<string, LiveMarketCapSnapshot | null> }>("/snipes/market-caps"),
  pauseAllSnipes: () =>
    req<{ ok: true; paused: number }>("/snipes/pause-all", { method: "POST" }),
  unpauseAllSnipes: () =>
    req<{ ok: true; unpaused: number }>("/snipes/unpause-all", { method: "POST" }),
  stats: () => req<Stats>("/snipes/stats"),
  historyFills: (page = 0, pageSize = 10) =>
    req<{
      fills: PublicSnipe[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/snipes/history?page=${page}&pageSize=${pageSize}`),
  createSnipe: (b: {
    mint: string;
    walletId: string;
    amountSol: number;
    slippagePct?: number;
    priorityFee?: number;
    bribe?: number;
    execMode?: "PUMPPORTAL" | "LOCAL";
    triggerMode?: "CLAIM" | "REDIRECT";
    onlyRedirected?: boolean;
    watchWallet?: string | null;
    exit?: ExitCfg;
  }) =>
    req<{ snipe: Snipe }>("/snipes", {
      method: "POST",
      body: JSON.stringify(b),
    }),
  editSnipe: (
    id: string,
    body: {
      amountSol?: number;
      slippagePct?: number;
      priorityFee?: number;
      bribe?: number;
      execMode?: "PUMPPORTAL" | "LOCAL";
      triggerMode?: "CLAIM" | "REDIRECT";
      onlyRedirected?: boolean;
      watchWallet?: string | null;
      exit?: ExitCfg;
    },
  ) =>
    req<{ snipe: Snipe }>(`/snipes/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminArmed: () => req<{ snipes: AdminSnipe[] }>("/admin/armed"),
  adminCopySnipe: (id: string, walletId: string) =>
    req<{ snipe: Snipe }>(`/admin/snipes/${id}/copy`, {
      method: "POST",
      body: JSON.stringify({ walletId }),
    }),
  adminUsers: () => req<{ users: AdminUser[] }>("/admin/users"),
  adminSetUserPriority: (id: string, priorityTx: boolean) =>
    req<{ user: { id: string; username: string; priorityTx: boolean } }>(
      `/admin/users/${id}/priority`,
      {
        method: "PATCH",
        body: JSON.stringify({ priorityTx }),
      },
    ),
  adminSetUserWhitelist: (id: string, whitelist: boolean) =>
    req<{ user: { id: string; username: string; whitelist: boolean; paid: boolean; subscriptionExpiresAt?: string | null } }>(
      `/admin/users/${id}/whitelist`,
      {
        method: "PATCH",
        body: JSON.stringify({ whitelist }),
      },
    ),
  adminUserSnipes: (id: string) =>
    req<{
      username: string;
      payWallet: string | null;
      snipes: Snipe[];
      wallets: { id: string; name: string; publicKey: string }[];
    }>(`/admin/users/${id}/snipes`),
  adminSendNotification: (title: string, body: string, url?: string) =>
    req<AdminNotificationResult>("/admin/notifications/test", {
      method: "POST",
      body: JSON.stringify({ title, body, url }),
    }),
  adminLogs: (userId?: string, level?: string) => {
    const p = new URLSearchParams();
    if (userId) p.set("userId", userId);
    if (level) p.set("level", level);
    const qs = p.toString();
    return req<{ logs: AdminLog[] }>(`/admin/logs${qs ? `?${qs}` : ""}`);
  },
  socialUsers: () => req<{ users: SocialUser[] }>("/social/users"),
  socialUserSnipes: (id: string) =>
    req<{ username: string; active: PublicSnipe[]; filled: PublicSnipe[] }>(
      `/social/users/${id}/snipes`,
    ),
  socialTrending: () => req<{ coins: TrendingCoin[] }>("/social/trending"),
  socialChat: (after?: string) =>
    req<{ messages: ChatMessage[] }>(
      `/social/chat${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    ),
  socialChatLatest: () => req<{ latest: string | null }>("/social/chat/latest"),
  socialSend: (text: string) =>
    req<{ message: ChatMessage }>("/social/chat", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  pushPublicKey: () => req<PushPublicKey>("/push/public-key"),
  pushTest: () => req<PushTestResult>("/push/test", { method: "POST" }),
  pushSubscriptionStatus: (endpoint: string) =>
    req<PushSubscriptionStatus>("/push/subscription/status", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    }),
  savePushSubscription: (
    subscription: PushSubscriptionPayload,
    prefs?: { tradeEnabled?: boolean; chatEnabled?: boolean },
  ) =>
    req<{ ok: true }>("/push/subscription", {
      method: "POST",
      body: JSON.stringify({ ...subscription, ...(prefs ?? {}) }),
    }),
  updatePushPreferences: (
    endpoint: string,
    prefs: { tradeEnabled?: boolean; chatEnabled?: boolean },
  ) =>
    req<{ ok: true }>("/push/subscription/preferences", {
      method: "PATCH",
      body: JSON.stringify({ endpoint, ...prefs }),
    }),
  deletePushSubscription: (endpoint: string) =>
    req<{ ok: true }>("/push/subscription", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),
  cancelSnipe: (id: string) =>
    req<{ ok: true }>(`/snipes/${id}/cancel`, { method: "POST" }),
  cancelExit: (id: string) =>
    req<{ snipe: Snipe }>(`/snipes/${id}/cancel-exit`, { method: "POST" }),
  discover: (includeSpecial = false) =>
    req<{
      coins: DiscoverCoin[];
      configured: boolean;
      message?: string;
      total?: number;
      includeSpecial?: boolean;
      mode?: string;
    }>(`/discover?includeSpecial=${includeSpecial ? "true" : "false"}`),
  discoverMetadata: (mint: string) =>
    req<DiscoverMetadata>(`/discover/${encodeURIComponent(mint)}/metadata`),
  resolveTokenMarket: (mint: string) =>
    req<DiscoverCoin>(`/tokens/${encodeURIComponent(mint)}/market/resolve`, {
      method: "POST",
    }),
  discoverHide: (mint: string) =>
    req<{ ok: true }>("/discover/hide", {
      method: "POST",
      body: JSON.stringify({ mint }),
    }),
  discoverResetHidden: () =>
    req<{ ok: true }>("/discover/reset-hidden", { method: "POST" }),
};
