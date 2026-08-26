const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

// Prefer the secure HttpOnly cookie. Safari/iOS can block that cookie when the
// installed web app and API are on different sites. A revocable random refresh
// token therefore persists the device login; access JWTs remain session-only.
const ACCESS_TOKEN_KEY = "cs_access_token";
const REFRESH_TOKEN_KEY = "cs_refresh_token";
localStorage.removeItem("token"); // clear legacy long-lived JWTs from old builds

function accessToken() {
  try { return sessionStorage.getItem(ACCESS_TOKEN_KEY); } catch { return null; }
}

function saveAccessToken(token?: string | null) {
  try {
    if (token) sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    else sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch { /* strict/private browser storage may be unavailable */ }
}

function persistentRefreshToken() {
  try { return localStorage.getItem(REFRESH_TOKEN_KEY); } catch { return null; }
}

function saveRefreshToken(token?: string | null) {
  try {
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch { /* strict/private browser storage may be unavailable */ }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let refreshInFlight: Promise<AuthSession> | null = null;

async function refreshAccess(): Promise<AuthSession> {
  const refreshToken = persistentRefreshToken();
  if (!refreshToken) throw new ApiError("Session expired", 401);
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await fetch(BASE + "/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      saveAccessToken(null);
      saveRefreshToken(null);
      throw new ApiError((data && data.error) || "Session expired", res.status);
    }
    saveAccessToken(data?.accessToken);
    return data as AuthSession;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function req<T>(path: string, opts: RequestInit = {}, allowRefresh = true): Promise<T> {
  const hasBody = opts.body != null;
  const token = accessToken();
  const res = await fetch(BASE + path, {
    credentials: "include",
    ...opts,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (
    res.status === 401 &&
    allowRefresh &&
    persistentRefreshToken() &&
    !path.startsWith("/auth/login") &&
    !path.startsWith("/auth/register") &&
    !path.startsWith("/auth/refresh") &&
    !path.startsWith("/auth/logout")
  ) {
    const restored = await refreshAccess();
    if (path === "/auth/me") return restored as T;
    return req<T>(path, opts, false);
  }
  if (!res.ok) {
    const message = (data && (data as any).error) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export interface Wallet {
  id: string;
  name: string;
  publicKey: string;
  // null means the RPC read is temporarily unavailable; it is never presented
  // as a real zero balance.
  balanceSol?: number | null;
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
  mcMinUsd?: number | null;
  mcMaxUsd?: number | null;
  amountSol: number;
  slippagePct: number;
  adaptiveSlippage?: boolean;
  maxSlippagePct?: number;
  maxBuyRetries?: number;
  buyAttempts?: number;
  finalSlippagePct?: number | null;
  priorityFee: number;
  bribe: number;
  execMode?: "PUMPPORTAL" | "LOCAL";
  triggerMode?: "CLAIM" | "REDIRECT";
  claimMode?: "PROCESSED";
  ticker?: string | null;
  onlyRedirected: boolean;
  watchWallet?: string | null;
  status: "ARMED" | "PAUSED" | "TRIGGERED" | "FILLED" | "FAILED" | "CANCELLED";
  signature?: string | null;
  error?: string | null;
  createdAt: string;
  triggeredAt?: string | null;
  filledAt?: string | null;
  exitKind?: string | null;
  exitSubmittedAt?: string | null;
  wallet: { name: string; publicKey: string };
  copyTradeId?: string | null;
  copySourceSnipeId?: string | null;
  copyLeaderUserId?: string | null;
  copyLeaderUsername?: string | null;
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
  liveMarketCapUsd?: number | null;
  liveMarketCapSol?: number | null;
  liveMarketCapUpdatedAt?: string | null;
  triggerToFillMs?: number | null;
  position?: {
    snipeId?: string | null;
    status: string;
    buySol: number;
    realizedSol: number;
    realizedProfitSol: number;
    remainingTokenRaw: string;
    remainingCostSol: number;
    openedAt: string;
    closedAt?: string | null;
  } | null;
}

export interface AdminOverview {
  generatedAt: string;
  health: {
    overall: "healthy" | "degraded";
    database: { ok: boolean; latencyMs: number; error?: string | null };
    rpc: { ok: boolean; latencyMs: number; slot?: number | null; error?: string | null };
    marketFeed: { ok: boolean; connected: boolean; subscribed: number; cached: number; solUsd?: number | null };
    queue: { ok: boolean; queued: number; priorityQueued: number; limitPerSecond: number; maxDepth: number; maxWaitMs: number; draining: boolean };
    engine: { creatorSubscriptions: number; creatorSnipeBindings: number; redirectSubscriptions: number; currentlyFiring: number; armingInFlight: number; seenSignatures: number; claimProcessingInFlight?: number; preparedExecutionPlans?: number; buyReconciliationsPending: number; processedCreatorSubscriptions?: number; processedRedirectSubscriptions?: number; backupRedirectSubscriptions?: number; backfillRuns?: number; backfilledSignatures?: number; globalClaimFeed?: { enabled: boolean; connected: boolean; activeRpc?: string | null; activeWs?: string | null; endpointCount: number; subscriptions: number; events: number; claimSignals: number; lastAnyEventAt?: string | null; lastClaimSignalAt?: string | null; reconnects: number; reconnecting: boolean; lastReconnectReason?: string | null; silenceMs?: number | null; silenceThresholdMs?: number }; fullTransactionFeed?: { enabled: boolean; connected: boolean; watchedWallets: number; subscriptions: number; events: number; claimFrames: number; reconnects: number; lastMessageAt?: string | null; lastError?: string | null }; latency?: Record<string, { count: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null }>; feeShareIndex?: { wallets: number; mappings: number }; lastClaimAt?: string | null; lastClaimSignature?: string | null; lastRedirectAt?: string | null; lastTriggerAt?: string | null; lastFillAt?: string | null };
    balances: { cachedWallets: number; subscriptions: number; references: number };
    radar: { enabled: boolean; subscriptions: number; inFlight: number; enriching: number; marketQueueDepth: number; marketQueueRunning: boolean; queuedMarketMints: number; mainPumpWatcherEnabled: boolean };
    process: { uptimeSeconds: number; rssMb: number; heapUsedMb: number; heapTotalMb: number; node: string };
  };
  users: { total: number; active: number; whitelisted: number; priority: number; new24h: number };
  snipes: { total: number; armed: number; paused: number; triggered: number; filled: number; failed: number; cancelled: number; failures24h: number; fills24h: number; recoveredRetries24h: number; avgTriggerToFillMs: number | null; buyVolume24hSol: number; soldVolume24hSol: number };
  positions: { open: number };
  billing: Record<string, number>;
  social: { messages24h: number };
  recentFailures: { id: string; userId: string; username: string; snipeId?: string | null; message: string; createdAt: string }[];
}


export interface AdminRpcUsage {
  generatedAt: string;
  range: "1h" | "24h" | "month";
  rangeStart: string;
  estimateNotice: string;
  total: { requests: number; estimatedHeliusCredits: number; streamedBytes: number; streamedMb: number; errors: number; avgLatencyMs: number };
  budget: { monthlyCredits: number; estimatedUsedThisMonth: number; estimatedRemaining: number; usedPct: number };
  subsystems: Array<{ name: string; requests: number; credits: number; bytes: number; errors: number; latencyMs: number; avgLatencyMs: number; sharePct: number }>;
  methods: Array<{ subsystem: string; method: string; kind: "http" | "wss" | string; requests: number; credits: number; bytes: number; errors: number; latencyMs: number; avgLatencyMs: number }>;
  providers: Array<{ name: string; requests: number; credits: number; bytes: number; errors: number; latencyMs: number; avgLatencyMs: number }>;
  timeline: Array<{ at: string; credits: number; requests: number; bytes: number; errors: number }>;
  pricing: { standardRpc: number; getProgramAccounts: number; getProgramAccountsV2: number; enhancedTransactions: number; getTransactionsForAddress: number; getTransfersByAddress: number; websocketCreditsPerMb: number };
}

export interface AdminRecord {
  id: string;
  sourceId: string;
  type: "snipe" | "position" | "billing";
  level: "info" | "success" | "error" | string;
  event: string;
  username: string;
  userId: string;
  snipeId?: string | null;
  mint?: string | null;
  ticker?: string | null;
  signature?: string | null;
  status?: string | null;
  message: string;
  createdAt: string;
  details?: Record<string, unknown> | null;
}

export interface AdminUserDetail {
  user: {
    id: string; username: string; paid: boolean; whitelist: boolean; priorityTx: boolean;
    subscriptionExpiresAt?: string | null; createdAt: string; payWallet?: string | null; billingMsg?: string | null;
    tradingPlatform?: string; _count?: { wallets: number; snipes: number; messages: number; pushSubscriptions: number };
  };
  summary: { activeSnipes: number; failedSnipes: number; openPositions: number; fills: number; spentSol: number; soldSol: number; realizedProfitSol: number };
  wallets: { id: string; name: string; publicKey: string; createdAt: string }[];
  snipes: Snipe[];
  positions: { id: string; snipeId?: string | null; mint: string; ticker?: string | null; buySol: number; realizedSol: number; realizedProfitSol: number; remainingTokenRaw: string; remainingCostSol: number; status: string; buySignature?: string | null; openedAt: string; closedAt?: string | null; updatedAt: string }[];
  logs: { id: string; snipeId?: string | null; level: string; message: string; createdAt: string }[];
  billing: { id: string; signature: string; sender?: string | null; lamports: string; sol: number; periods: number; status: string; sweepSignature?: string | null; refundSignature?: string | null; error?: string | null; createdAt: string }[];
}

export interface AdminSnipeDebug {
  snipe: AdminSnipe & { user: { id: string; username: string; priorityTx: boolean; whitelist: boolean; paid: boolean; subscriptionExpiresAt?: string | null } };
  position: null | { id: string; status: string; buySol: number; realizedSol: number; realizedProfitSol: number; remainingTokenRaw: string; remainingCostSol: number; buySignature?: string | null; openedAt: string; closedAt?: string | null; events: { id: string; signature: string; kind: string; tokenRaw: string; solChange: number; costBasisSol: number; realizedProfitSol: number; slot?: string | null; createdAt: string }[] };
  logs: { id: string; level: string; message: string; createdAt: string }[];
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
  activeSnipeCount?: number;
  filledSnipeCount?: number;
  failedSnipeCount?: number;
  openPositionCount?: number;
  lastActivityAt?: string | null;
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
  mcMinUsd?: number | null;
  mcMaxUsd?: number | null;
  ticker?: string | null;
  amountSol: number;
  soldSol: number;
  status: string;
  triggerMode?: "CLAIM" | "REDIRECT";
  claimMode?: "PROCESSED";
  execMode?: "PUMPPORTAL" | "LOCAL";
  slippagePct?: number;
  adaptiveSlippage?: boolean;
  maxSlippagePct?: number;
  maxBuyRetries?: number;
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
export interface CopyTrade {
  id: string;
  followerUserId: string;
  leaderUserId: string;
  walletId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  activeMirrors: number;
  leader: { id: string; username: string; avatarDataUrl?: string | null; chatColor?: string | null } | null;
  wallet: { id: string; name: string; publicKey: string } | null;
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
export interface ChatReaction {
  emoji: string;
  count: number;
  reacted: boolean;
}
export interface ChatReplyPreview {
  id: string;
  username: string;
  text: string;
  imageDataUrl?: string | null;
  tokenMint?: string | null;
  tokenTicker?: string | null;
}
export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  imageDataUrl?: string | null;
  tokenMint?: string | null;
  tokenTicker?: string | null;
  tokenPairAddress?: string | null;
  tokenPairDexId?: string | null;
  tokenPairUrl?: string | null;
  replyToId?: string | null;
  replyTo?: ChatReplyPreview | null;
  reactions?: ChatReaction[];
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

export interface DiscoveryRedirect {
  wallet: string;
  shareBps: number;
  sharePct: number;
  redirectedAt: string;
  redirectSignature: string;
  redirectSlot: string | null;
}

export interface DiscoverCoin {
  mint: string;
  ticker: string | null;
  name: string | null;
  image: string | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  volume1hUsd: number | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
  pairAddress: string | null;
  pairDexId: string | null;
  pairUrl: string | null;
  pairCreatedAt: string | null;
  marketDataUpdatedAt: string | null;
  tokenCreatedAt: string | null;
  lastTradeAt: string | null;
  graduated: boolean;
  graduatedAt: string | null;
  originalCreator: string | null;
  redirectedAt: string;
  source: string | null;
  signature: string | null;
  sharingConfig: string | null;
  replyCount: number | null;
  trendScore: number;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  metadataUpdatedAt: string | null;
  isLikelyAgent: boolean;
  isLikelyCharity: boolean;
  classificationReason: string | null;
  redirects: DiscoveryRedirect[];
  totalRedirectSharePct: number;
}

export interface DiscoveryStatus {
  available: boolean;
  enabled: boolean;
}

export interface DiscoveryFeed {
  enabled: boolean;
  available: boolean;
  columns: { new: DiscoverCoin[]; trending: DiscoverCoin[]; graduated: DiscoverCoin[] };
  counts: { total: number; new: number; trending: number; graduated: number };
  index: {
    connected: boolean;
    redirectFeedConnected?: boolean;
    claimStreamConnected?: boolean;
    subscribedWallets: number;
    lastClaimAt?: string | null;
    lastRedirectAt?: string | null;
  };
  hiddenCount?: number;
  generatedAt: string;
}

export interface AdminFeatureState {
  discovery: {
    available: boolean;
    enabled: boolean;
    runtime?: {
      enabled: boolean;
      subscriptions: number;
      redirectsIndexed?: number;
      configEventsIndexed?: number;
      marketQueueDepth?: number;
      redirectRpcReads?: number;
      enrichmentRuns?: number;
      pageTriggeredRpcReads?: number;
      lastRedirectAt?: string | null;
      lastError?: string | null;
      claimStream?: {
        running: boolean; connected: boolean; subscribedWallets: number; subscriptions: number;
        transactions: number; claimsSeen: number; redirectsMarkedClaimed: number; reconnects: number;
        lastMessageAt?: string | null; lastClaimAt?: string | null; lastError?: string | null;
      };
    };
  };
}

export interface ClaimScannerCoin {
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
  marketCapUsd: number | null;
  bps: number;
  sharePct: number;
  isAdmin: boolean;
  claimableLamports: string;
  claimableSol: number;
  claimableUsd: number | null;
  sources: { pumpSol: number; pumpSwapSol: number };
}

export interface ClaimScannerResult {
  wallet: string;
  claimableCoinCount: number;
  coinCount: number;
  totalClaimable: { sol: number; usd: number | null; lamports: string };
  totalClaimed: { sol: number; usd: number | null };
  totalEarned: { sol: number; usd: number | null };
  solPriceUsd: number | null;
  coins: ClaimScannerCoin[];
  coinsTruncated: boolean;
  perCoinEstimate: { sol: number; differsFromPumpTotal: boolean };
  fetchedAt: string;
  cached: boolean;
}

export interface DiscoverMetadata extends DiscoverCoin {
  firstSeenAt: string;
  history: Array<{
    wallet: string; shareBps: number; sharePct: number; epoch: number; active: boolean; isRedirect: boolean;
    redirectedAt: string; redirectSignature: string; claimedAt: string | null; claimSignature: string | null;
  }>;
  metadata: unknown;
}

type AuthSession = Profile & { accessToken?: string; refreshToken?: string };

export const api = {
  register: async (username: string, password: string) => {
    const result = await req<AuthSession>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    saveAccessToken(result.accessToken);
    saveRefreshToken(result.refreshToken);
    return result;
  },
  login: async (username: string, password: string) => {
    const result = await req<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    saveAccessToken(result.accessToken);
    saveRefreshToken(result.refreshToken);
    return result;
  },
  me: async () => {
    const profile = await req<Profile>("/auth/me");
    if (!persistentRefreshToken()) {
      try {
        const device = await req<{ refreshToken: string }>("/auth/device-session", { method: "POST" });
        saveRefreshToken(device.refreshToken);
      } catch {
        // Keep the already-valid cookie/access session during a rolling deploy
        // or if durable browser storage is unavailable.
      }
    }
    return profile;
  },
  logout: async () => {
    const refreshToken = persistentRefreshToken();
    try {
      return await req<{ ok: true }>("/auth/logout", {
        method: "POST",
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
    } finally {
      saveAccessToken(null);
      saveRefreshToken(null);
    }
  },
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
  pauseSnipe: (id: string) =>
    req<{ snipe: Snipe }>(`/snipes/${id}/pause`, { method: "POST" }),
  unpauseSnipe: (id: string) =>
    req<{ snipe: Snipe }>(`/snipes/${id}/unpause`, { method: "POST" }),
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
    adaptiveSlippage?: boolean;
    maxSlippagePct?: number;
    maxBuyRetries?: number;
    priorityFee?: number;
    bribe?: number;
    execMode?: "PUMPPORTAL" | "LOCAL";
    triggerMode?: "CLAIM" | "REDIRECT";
    onlyRedirected?: boolean;
    watchWallet?: string | null;
    mcMinUsd?: number | null;
    mcMaxUsd?: number | null;
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
      adaptiveSlippage?: boolean;
      maxSlippagePct?: number;
      maxBuyRetries?: number;
      priorityFee?: number;
      bribe?: number;
      execMode?: "PUMPPORTAL" | "LOCAL";
      triggerMode?: "CLAIM" | "REDIRECT";
      onlyRedirected?: boolean;
      watchWallet?: string | null;
      mcMinUsd?: number | null;
      mcMaxUsd?: number | null;
      exit?: ExitCfg;
    },
  ) =>
    req<{ snipe: Snipe }>(`/snipes/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminOverview: () => req<AdminOverview>("/admin/overview"),
  adminRpcUsage: (range: "1h" | "24h" | "month" = "24h") => req<AdminRpcUsage>(`/admin/rpc-usage?range=${encodeURIComponent(range)}`),
  adminSnipes: (filters: { status?: string; q?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (filters.status) p.set("status", filters.status);
    if (filters.q) p.set("q", filters.q);
    if (filters.limit) p.set("limit", String(filters.limit));
    const qs = p.toString();
    return req<{ snipes: AdminSnipe[] }>(`/admin/snipes${qs ? `?${qs}` : ""}`);
  },
  adminSnipeDebug: (id: string) => req<AdminSnipeDebug>(`/admin/snipes/${id}/debug`),
  adminRecords: (filters: { userId?: string; type?: string; level?: string; q?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (filters.userId) p.set("userId", filters.userId);
    if (filters.type) p.set("type", filters.type);
    if (filters.level) p.set("level", filters.level);
    if (filters.q) p.set("q", filters.q);
    if (filters.limit) p.set("limit", String(filters.limit));
    const qs = p.toString();
    return req<{ records: AdminRecord[] }>(`/admin/records${qs ? `?${qs}` : ""}`);
  },
  adminUserDetail: (id: string) => req<AdminUserDetail>(`/admin/users/${id}/detail`),
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
  copyTrades: () => req<{ copyTrades: CopyTrade[] }>("/copy-trades"),
  startCopyTrade: (body: { leaderUserId: string; walletId: string; syncExisting?: boolean }) =>
    req<{ copyTrade: CopyTrade; synced: number }>("/copy-trades", { method: "POST", body: JSON.stringify(body) }),
  updateCopyTrade: (id: string, body: { walletId?: string; enabled?: boolean; syncExisting?: boolean; cancelActive?: boolean }) =>
    req<{ copyTrade: CopyTrade }>(`/copy-trades/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCopyTrade: (id: string) =>
    req<{ ok: true; cancelled: number; inFlight: number }>(`/copy-trades/${id}`, { method: "DELETE" }),
  socialUsers: () => req<{ users: SocialUser[] }>("/social/users"),
  socialUserSnipes: (id: string) =>
    req<{ username: string; active: PublicSnipe[]; filled: PublicSnipe[] }>(
      `/social/users/${id}/snipes`,
    ),
  socialTrending: () => req<{ coins: TrendingCoin[] }>("/social/trending"),
  socialChat: (cursor: { after?: string; afterId?: string; before?: string; beforeId?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (cursor.after) p.set("after", cursor.after);
    if (cursor.afterId) p.set("afterId", cursor.afterId);
    if (cursor.before) p.set("before", cursor.before);
    if (cursor.beforeId) p.set("beforeId", cursor.beforeId);
    p.set("limit", String(cursor.limit ?? 20));
    return req<{ messages: ChatMessage[]; hasMore: boolean }>(`/social/chat?${p.toString()}`);
  },
  socialChatLatest: () => req<{ latest: string | null }>("/social/chat/latest"),
  socialSend: (input: { text?: string; imageDataUrl?: string | null; replyToId?: string | null }) =>
    req<{ message: ChatMessage }>("/social/chat", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  socialReact: (id: string, emoji: string) =>
    req<{ reactions: ChatReaction[] }>(`/social/chat/${id}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
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
  claimScanner: (wallet: string) =>
    req<ClaimScannerResult>(`/claim-scanner?wallet=${encodeURIComponent(wallet.trim())}`),
  discoveryStatus: () => req<DiscoveryStatus>("/discover/status"),
  discover: () => req<DiscoveryFeed>("/discover"),
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
    req<{ ok: true; restored: number }>("/discover/reset-hidden", { method: "POST" }),
  adminFeatures: () => req<AdminFeatureState>("/admin/features"),
  adminSetDiscovery: (enabled: boolean) =>
    req<{ ok: true; discovery: AdminFeatureState["discovery"] }>("/admin/features/discovery", {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};
