import { log, parseError } from "evlog";
import type { Handler } from "hono";

import { checkInternalToken } from "./internal-token";

/**
 * The shape every background runner here shares (digests, webhooks,
 * retention): one batch function, driven by two triggers —
 *
 *   - an in-process ticker, for the long-lived container this normally ships as;
 *   - `POST /internal/<name>/run`, for deployments where the process is not
 *     long-lived (serverless) or where an external scheduler owns the cadence.
 *
 * The runners claim their work in the database, so both triggers may be active
 * at once. What lives here is only the plumbing around that: no overlapping
 * runs within one process, quiet logs, and the shared-token guard.
 */
export type ScheduledRunnerOptions<T extends object> = {
  /** Log source, e.g. `"digests"`. */
  source: string;
  /** Log message for a run worth reporting, e.g. `"digest run"`. */
  label: string;
  enabled: boolean;
  intervalSeconds: number;
  run: () => Promise<T>;
  /** Idle runs are the common case; only log the ones that moved something. */
  shouldLog: (summary: T) => boolean;
  /** Error body for a failed HTTP-triggered run. */
  failureMessage: string;
};

export function createScheduledRunner<T extends object>(options: ScheduledRunnerOptions<T>) {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Runs one batch, never concurrently with itself. A run that outlives its
   * tick would otherwise pile ticks up behind it; skipping is correct because
   * the next tick finds the same work.
   */
  async function tick(trigger: "timer" | "http"): Promise<T | null> {
    if (running) {
      log.info({ source: options.source, msg: "run already in progress, skipping", trigger });
      return null;
    }
    running = true;
    try {
      const summary = await options.run();
      if (options.shouldLog(summary)) {
        log.info({ source: options.source, msg: options.label, trigger, ...summary });
      }
      return summary;
    } finally {
      running = false;
    }
  }

  /** Starts the periodic runner. Idempotent — a second call is ignored. */
  function start(): void {
    if (!options.enabled || timer) return;
    timer = setInterval(() => {
      void tick("timer").catch((error) => {
        log.error({ source: options.source, ...parseError(error) });
      });
    }, options.intervalSeconds * 1000);
    // Never hold the process open on the scheduler alone; the HTTP server does
    // that, and a pending tick must not delay shutdown.
    timer.unref?.();
    log.info({
      source: options.source,
      msg: "scheduler started",
      intervalSeconds: options.intervalSeconds,
    });
  }

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  /**
   * Manual/external trigger. Guarded by the shared `/internal` token rather
   * than a session: the caller is a scheduler, and the work is expensive.
   */
  const handleRun: Handler = async (c) => {
    const auth = checkInternalToken(c.req.header("authorization"));
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    try {
      const summary = await tick("http");
      if (!summary) return c.json({ status: "busy" }, 202);
      return c.json({ status: "ok", ...summary });
    } catch (error) {
      log.error({ source: options.source, ...parseError(error) });
      return c.json({ error: options.failureMessage }, 500);
    }
  };

  return { start, stop, handleRun };
}
