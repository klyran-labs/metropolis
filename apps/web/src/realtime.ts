/**
 * Push channel: one authenticated stream per tab replaces most polling.
 *
 * The gateway publishes small "something changed" events (approvals, transfers, wallets, agents,
 * and finalized chain events) on `/telemetry/stream`. The client reacts by refetching the affected
 * queries. The stream is never the source of truth: on (re)connect and on a reported gap
 * everything is refetched, and while connected the named polling intervals relax to a slow safety
 * net, so a dropped event delays an update by at most that interval.
 */
/** A stream that stays open at least this long counts as healthy and resets the retry backoff. */
const HEALTHY_STREAM_MS = 10_000;

/** Interval while the push channel is connected: it only repairs missed events. */
export const SAFETY_NET_POLL_MS = 60_000;

/** Uniform value in [0, 1) from the platform CSPRNG (the app avoids non-cryptographic randomness). */
const unitRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

export interface ParsedSseEvent {
  event: string;
  data: string;
}

/** Splits a text buffer into complete SSE events and the unfinished remainder. */
export function parseSseChunk(buffer: string): { events: ParsedSseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: ParsedSseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue; // keep-alive comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0 || event !== "message") events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

/** Query-key prefixes to refetch for each event type. Chain events fall through to `chain`. */
export const INVALIDATIONS: Record<string, string[][]> = {
  approvals_changed: [["pending-approvals"], ["wallet-transfers"]],
  transfers_changed: [["wallet-transfers"], ["organization-wallets"], ["live-token-balance"]],
  wallets_changed: [["organization-wallets"], ["live-token-balance"]],
  agents_changed: [["agents"]],
};

const CHAIN_INVALIDATIONS: string[][] = [
  ["telemetry-events"],
  ["agents"],
  ["agent-runtime-state"],
  ["circuit-broken"],
  ["agent-policy"],
  ["live-token-balance"],
];

export function keysForEvent(eventType: string): string[][] | "all" {
  if (eventType === "telemetry_gap") return "all";
  return INVALIDATIONS[eventType] ?? CHAIN_INVALIDATIONS;
}

let connected = false;
const listeners = new Set<() => void>();

export const isRealtimeConnected = () => connected;

export function subscribeRealtimeStatus(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  listeners.forEach((listener) => listener());
}

/** Use as `refetchInterval`: the given interval while disconnected, a slow safety net while connected. */
export const pollInterval = (fallbackMs: number) => (): number =>
  connected ? Math.max(fallbackMs, SAFETY_NET_POLL_MS) : fallbackMs;

export interface RealtimeOptions {
  url: string;
  getToken: () => Promise<string | null>;
  /** Called for every event; `"all"` means refetch everything (connect, reconnect, gap). */
  onInvalidate: (keys: string[][] | "all") => void;
  /** Close the stream after the tab has been hidden this long (saves a server connection). */
  hiddenGraceMs?: number;
}

/** Starts the channel; returns a function that stops it. */
export function startRealtime(options: RealtimeOptions): () => void {
  const hiddenGraceMs = options.hiddenGraceMs ?? 30_000;
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRetry = () => {
    if (stopped || document.visibilityState === "hidden") return;
    const base = Math.min(30_000, 1_000 * 2 ** attempt);
    attempt += 1;
    retryTimer = setTimeout(connect, base / 2 + unitRandom() * (base / 2));
  };

  async function connect() {
    if (stopped) return;
    controller = new AbortController();
    try {
      const token = await options.getToken();
      const response = await fetch(options.url, {
        headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
        cache: "no-store",
      });
      const isStream = response.headers.get("content-type")?.includes("text/event-stream");
      if (!response.ok || !response.body || !isStream) throw new Error(`stream refused (${response.status})`);
      const openedAt = Date.now();
      setConnected(true);
      options.onInvalidate("all"); // repair anything missed while we were away
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        if (parsed.events.length > 0) attempt = 0; // the channel is delivering, so it is healthy
        for (const event of parsed.events) options.onInvalidate(keysForEvent(event.event));
      }
      // A stream that closes right after opening (a proxy that buffers or cuts it) is not healthy:
      // keep backing off instead of reconnecting in a tight loop.
      if (Date.now() - openedAt > HEALTHY_STREAM_MS) attempt = 0;
    } catch {
      // network error or abort: fall through to retry
    }
    setConnected(false);
    scheduleRetry();
  }

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenTimer = setTimeout(() => controller?.abort(), hiddenGraceMs);
    } else {
      clearTimeout(hiddenTimer);
      if (!connected && !retryTimer) void connect();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  void connect();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(hiddenTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    controller?.abort();
    setConnected(false);
  };
}
