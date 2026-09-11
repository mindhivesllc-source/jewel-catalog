/**
 * Auto-sync: re-fetch the supplier catalog on a schedule, re-push products
 * whose data changed, and zero the stock of products the supplier delisted.
 *
 * Pure decision helpers (`shouldSkipTick`, `planSync`) are unit-tested;
 * `runAutoSync` wires them to Prisma, the supplier client and the push job.
 */

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { fetchAndStoreCatalog } from "./catalog.server";
import { startPushJob } from "./push.server";
import type { Admin } from "./push.server";

/** Supplier allows 1 request per 15 minutes — the sync interval equals it. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
/** Lock long enough to cover a full push; cleared on completion anyway. */
const SYNC_LOCK_MS = 3 * 60 * 60 * 1000;

/**
 * A tick is skipped when any fetch (manual, test connection, or a previous
 * sync) happened less than SYNC_INTERVAL_MS ago — the supplier would reject it.
 */
export function shouldSkipTick(lastFetchAt: Date | null, now: Date): boolean {
  if (!lastFetchAt) return false;
  return now.getTime() - lastFetchAt.getTime() < SYNC_INTERVAL_MS;
}

export interface SyncCandidate {
  id: number;
  stockNo: string;
  pushed: boolean;
  syncHash: string;
  lastPushedHash: string | null;
  inhandPcs: string;
  delistedAt: Date | null;
}

export interface SyncPlan {
  /** pushed rows whose supplier data changed since the last push */
  changedIds: number[];
  /** pushed rows no longer in the supplier feed (stock must go to 0) */
  delistedIds: number[];
  /** rows that were delisted earlier but are back in the feed */
  relistedIds: number[];
}

export function planSync(
  rows: SyncCandidate[],
  fetchedStockNos: Set<string>,
): SyncPlan {
  const plan: SyncPlan = { changedIds: [], delistedIds: [], relistedIds: [] };
  for (const row of rows) {
    if (!row.pushed) continue;
    const inFeed = fetchedStockNos.has(row.stockNo);
    if (!inFeed) {
      // Already zeroed and pushed as delisted → nothing new to do.
      if (row.delistedAt && row.inhandPcs === "0" && row.lastPushedHash === row.syncHash) continue;
      plan.delistedIds.push(row.id);
      continue;
    }
    if (row.delistedAt) plan.relistedIds.push(row.id);
    if (row.lastPushedHash !== row.syncHash) plan.changedIds.push(row.id);
  }
  return plan;
}

export interface SyncOutcome {
  skipped?: string;
  fetched?: number;
  changed: number;
  delisted: number;
  jobId?: number;
  warning?: string;
}

/** Run one sync for one shop. Never throws; records the outcome on ShopSettings. */
export async function runAutoSync(shop: string, now = new Date()): Promise<SyncOutcome> {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings || !settings.autoSyncEnabled || !settings.supplierApiKey) {
    return { skipped: "disabled", changed: 0, delisted: 0 };
  }
  if (settings.syncLockedUntil && settings.syncLockedUntil > now) {
    return { skipped: "locked", changed: 0, delisted: 0 };
  }
  if (shouldSkipTick(settings.lastFetchAt, now)) {
    return { skipped: "rate-limit window", changed: 0, delisted: 0 };
  }

  await prisma.shopSettings.update({
    where: { shop },
    data: { syncLockedUntil: new Date(now.getTime() + SYNC_LOCK_MS) },
  });

  const finish = async (outcome: SyncOutcome, message: string) => {
    await prisma.shopSettings
      .update({
        where: { shop },
        data: { syncLockedUntil: null, lastSyncAt: new Date(), lastSyncMessage: message },
      })
      .catch(() => {});
    return outcome;
  };

  try {
    const fetched = await fetchAndStoreCatalog(shop, settings.supplierApiKey);
    if (fetched.warning) {
      // Partial feed: do NOT treat missing rows as delisted.
      return finish(
        { fetched: fetched.total, changed: 0, delisted: 0, warning: fetched.warning },
        `Partial fetch, sync postponed: ${fetched.warning}`,
      );
    }
    const feed = new Set(fetched.stockNos);

    const rows = await prisma.supplierProduct.findMany({
      where: { shop, pushed: true },
      select: {
        id: true, stockNo: true, pushed: true, syncHash: true,
        lastPushedHash: true, inhandPcs: true, delistedAt: true,
      },
    });
    const plan = planSync(rows, feed);

    if (plan.relistedIds.length) {
      await prisma.supplierProduct.updateMany({
        where: { id: { in: plan.relistedIds } },
        data: { delistedAt: null },
      });
    }
    if (plan.delistedIds.length) {
      await prisma.supplierProduct.updateMany({
        where: { id: { in: plan.delistedIds } },
        data: { inhandPcs: "0", delistedAt: now, selected: true },
      });
    }
    if (plan.changedIds.length) {
      await prisma.supplierProduct.updateMany({
        where: { id: { in: plan.changedIds } },
        data: { selected: true },
      });
    }

    const total = plan.changedIds.length + plan.delistedIds.length;
    if (total === 0) {
      return finish(
        { fetched: fetched.total, changed: 0, delisted: 0 },
        `Fetched ${fetched.total} products, nothing changed.`,
      );
    }

    const { admin } = await unauthenticated.admin(shop);
    const job = await startPushJob(shop, admin as unknown as Admin, "auto");
    return finish(
      { fetched: fetched.total, changed: plan.changedIds.length, delisted: plan.delistedIds.length, jobId: job.jobId },
      `Fetched ${fetched.total}; re-pushing ${plan.changedIds.length} changed, ${plan.delistedIds.length} delisted (job ${job.jobId}).`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync] ${shop}: ${message}`);
    return finish({ changed: 0, delisted: 0, warning: message }, `Sync failed: ${message}`);
  }
}

/** One scheduler tick: sync every shop that opted in. */
export async function runAutoSyncTick(now = new Date()): Promise<void> {
  const shops = await prisma.shopSettings.findMany({
    where: { autoSyncEnabled: true },
    select: { shop: true },
  });
  for (const { shop } of shops) {
    const outcome = await runAutoSync(shop, now);
    if (!outcome.skipped) console.log(`[sync] ${shop}: ${JSON.stringify(outcome)}`);
  }
}
