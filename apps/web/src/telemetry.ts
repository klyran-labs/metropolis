// Real-user performance and error reporting.
//
// Sends Core Web Vitals plus a small number of sanitized client errors to the gateway's public
// intake endpoint. Nothing user-specific is collected: pages are reported as paths (never query
// strings), error text is scrubbed of URLs' query parts and long hex identifiers, and the report is
// capped in size. The pure parts live here so they can be unit tested; `startTelemetry` binds them
// to the browser.

export type VitalSample = { name: string; value: number; rating?: string };
export type ErrorSample = { kind: "error" | "rejection"; message: string };

export type Transport = (url: string, body: string) => boolean;

const MAX_MESSAGE = 200;
const MAX_ERRORS_PER_REPORT = 5;
const MAX_ERRORS_PER_PAGE = 20;

/** Removes anything that could identify a user or carry a secret before text leaves the browser. */
export function scrubMessage(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#]\S*/gi, "$1")
    .replace(/0x[0-9a-fA-F]{16,}/g, "0x…")
    .replace(/\b(bearer|token|key|secret|password)\b\s*[:=]\s*\S+/gi, "$1=…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE);
}

export function createReporter(options: {
  endpoint: string;
  release: string;
  page: () => string;
  transport: Transport;
}) {
  const metrics = new Map<string, VitalSample>();
  const errors: ErrorSample[] = [];
  const seenErrors = new Set<string>();
  let errorsThisPage = 0;

  return {
    addMetric(sample: VitalSample) {
      if (Number.isFinite(sample.value)) metrics.set(sample.name, sample);
    },
    addError(sample: ErrorSample) {
      const message = scrubMessage(sample.message);
      if (!message || seenErrors.has(message) || errorsThisPage >= MAX_ERRORS_PER_PAGE) return;
      seenErrors.add(message);
      errorsThisPage += 1;
      if (errors.length < MAX_ERRORS_PER_REPORT) errors.push({ kind: sample.kind, message });
    },
    /** Sends what has been gathered since the last flush. Returns false when there was nothing to send. */
    flush(): boolean {
      if (metrics.size === 0 && errors.length === 0) return false;
      const body = JSON.stringify({
        page: options.page(),
        release: options.release,
        metrics: [...metrics.values()],
        errors,
      });
      metrics.clear();
      errors.length = 0;
      options.transport(options.endpoint, body);
      return true;
    },
  };
}

const beaconTransport: Transport = (url, body) => {
  try {
    if (typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};

/** Starts collecting. Safe to call once at startup; never throws and never blocks rendering. */
export function startTelemetry(options: { endpoint: string; release: string }) {
  if (typeof window === "undefined") return;
  const reporter = createReporter({
    ...options,
    page: () => window.location.pathname,
    transport: beaconTransport,
  });

  window.addEventListener("error", (event) => {
    reporter.addError({ kind: "error", message: event.message || "Unknown error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reporter.addError({
      kind: "rejection",
      message: reason instanceof Error ? reason.message : String(reason ?? "Unhandled rejection"),
    });
  });

  // Metrics finalize when the page is hidden or closed, so that is when to send.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") reporter.flush();
  });
  window.addEventListener("pagehide", () => reporter.flush());

  const collect = () => {
    void import("web-vitals")
      .then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
        const add = (metric: { name: string; value: number; rating: string }) =>
          reporter.addMetric({ name: metric.name, value: metric.value, rating: metric.rating });
        onCLS(add);
        onFCP(add);
        onINP(add);
        onLCP(add);
        onTTFB(add);
      })
      .catch(() => undefined);
  };
  if (document.readyState === "complete") collect();
  else window.addEventListener("load", () => window.setTimeout(collect, 0), { once: true });
}
