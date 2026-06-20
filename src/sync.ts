import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One poller per ACCOUNT (browser), not per tab. Uses the Web Locks API to
 * elect a single leader tab that does the polling; it broadcasts results over
 * a BroadcastChannel and every other tab renders from those without making
 * their own requests. New tabs ask the leader for the latest on mount, and any
 * tab can trigger a shared refresh after a mutation.
 *
 * Falls back to per-tab polling if Web Locks/BroadcastChannel are unavailable.
 */
export function useLeaderPolling<T>(name: string, fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const leaderRef = useRef(false);
  const lastRef = useRef<T | null>(null);
  const chanRef = useRef<BroadcastChannel | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async () => {
    try {
      const d = await fetcherRef.current();
      lastRef.current = d;
      setData(d);
      chanRef.current?.postMessage({ type: 'data', payload: d });
    } catch {
      /* keep last good data */
    }
  }, []);

  useEffect(() => {
    let chan: BroadcastChannel | null = null;
    try {
      chan = new BroadcastChannel(`cs-${name}`);
    } catch {
      chan = null;
    }
    chanRef.current = chan;

    if (chan) {
      chan.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'data') {
          lastRef.current = m.payload;
          setData(m.payload);
        } else if (m.type === 'req' && leaderRef.current && lastRef.current != null) {
          chan!.postMessage({ type: 'data', payload: lastRef.current });
        } else if (m.type === 'refresh' && leaderRef.current) {
          void doFetch();
        }
      };
      chan.postMessage({ type: 'req' });
    }

    let released = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const becomeLeader = () => {
      leaderRef.current = true;
      setIsLeader(true);
      void doFetch();
      intervalId = setInterval(() => void doFetch(), intervalMs);
    };

    const locks = (navigator as any).locks;
    if (!locks || !chan) {
      becomeLeader(); // no coordination available — poll solo
    } else {
      locks
        .request(`cs-leader-${name}`, { mode: 'exclusive' }, () =>
          new Promise<void>((resolve) => {
            becomeLeader();
            const tick = setInterval(() => {
              if (released) {
                clearInterval(tick);
                resolve(); // free the lock so another tab can take over
              }
            }, 500);
          }),
        )
        .catch(() => {});
    }

    return () => {
      released = true;
      if (intervalId) clearInterval(intervalId);
      chan?.close();
      leaderRef.current = false;
    };
  }, [name, intervalMs, doFetch]);

  const refresh = useCallback(() => {
    if (leaderRef.current) void doFetch();
    else chanRef.current?.postMessage({ type: 'refresh' });
  }, [doFetch]);

  return { data, isLeader, refresh };
}
