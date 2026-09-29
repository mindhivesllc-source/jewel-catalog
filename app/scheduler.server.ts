/**
 * In-process scheduler for auto-sync. Railway runs a single instance, so a
 * module-level interval plus the per-shop DB lock in sync.server.ts is enough.
 * Started once from entry.server.tsx; guarded against HMR / double import.
 */

import { runAutoSyncTick } from "./services/sync.server";

const TICK_MS = 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __jewelSchedulerStarted: boolean | undefined;
}

export function startScheduler(): void {
  if (globalThis.__jewelSchedulerStarted) return;
  if (process.env.DISABLE_AUTO_SYNC === "1") return;
  globalThis.__jewelSchedulerStarted = true;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runAutoSyncTick();
    } catch (err) {
      console.error(`[sync] tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  // First tick shortly after boot so a restart never delays a due sync.
  setTimeout(tick, 10 * 1000).unref?.();
  console.log("[sync] scheduler started (tick every 60s)");
}
