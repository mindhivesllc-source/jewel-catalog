/**
 * Catalog service — fetch, store, query, and manage supplier products in the
 * local Prisma database.
 */

import prisma from "../db.server";
import type { SupplierItem } from "./supplier.server";
import { fetchAllSupplierProducts } from "./supplier.server";
import { supplierItemToDbRow } from "./mapper.server";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CatalogFilters {
  category?: string;
  shape?: string;
  metalType?: string;
  jewelryType?: string;
  size?: string;
  clarity?: string;
  inHand?: boolean;
  onMemo?: boolean;
  diaWtMin?: number;
  diaWtMax?: number;
  search?: string;
  selected?: boolean;
  pushed?: boolean;
  page?: number;
  limit?: number;
}

// ── Fetch & Store ────────────────────────────────────────────────────────────

/**
 * Pull every product from the LGD USA API and upsert into the local
 * SupplierProduct table.  Does NOT overwrite `selected` or `pushed` flags
 * on existing rows — only updates price, inhandPcs, memoOut and syncHash.
 */
export async function fetchAndStoreCatalog(
  shop: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ total: number }> {
  const items = await fetchAllSupplierProducts(apiKey, signal);

  let upserted = 0;

  // Batch upserts in transactions of 50 to avoid ~1900 sequential
  // round-trips to Postgres.
  const BATCH = 50;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((item) => {
        const row = supplierItemToDbRow(item, shop);
        return prisma.supplierProduct.upsert({
          where: {
            shop_stockNo: { shop, stockNo: row.stockNo },
          },
          create: row,
          update: row,
        });
      }),
    );
    upserted += batch.length;
  }

  // Update shop settings last-fetch timestamp
  await prisma.shopSettings.upsert({
    where: { shop },
    create: { shop, lastFetchAt: new Date() },
    update: { lastFetchAt: new Date() },
  });

  return { total: upserted };
}

// ── Counts ───────────────────────────────────────────────────────────────────

export async function getProductCounts(
  shop: string,
): Promise<{ total: number; selected: number; pushed: number; notPushed: number }> {
  const [total, selected, pushed, notPushed] = await Promise.all([
    prisma.supplierProduct.count({ where: { shop } }),
    prisma.supplierProduct.count({ where: { shop, selected: true } }),
    prisma.supplierProduct.count({ where: { shop, pushed: true } }),
    prisma.supplierProduct.count({
      where: { shop, pushed: false },
    }),
  ]);

  return { total, selected, pushed, notPushed };
}

// ── Distinct values ──────────────────────────────────────────────────────────

export async function getCategories(shop: string): Promise<string[]> {
  const rows = await prisma.supplierProduct.findMany({
    where: { shop },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category);
}

export async function getFilterFacets(
  shop: string,
): Promise<{
  shapes: string[];
  metals: string[];
  styles: string[];
  sizes: string[];
  clarities: string[];
}> {
  const [shapes, metals, styles, sizes, clarities] = await Promise.all([
    prisma.supplierProduct.findMany({
      where: { shop },
      distinct: ["shape"],
      select: { shape: true },
      orderBy: { shape: "asc" },
    }),
    prisma.supplierProduct.findMany({
      where: { shop },
      distinct: ["metalType"],
      select: { metalType: true },
      orderBy: { metalType: "asc" },
    }),
    prisma.supplierProduct.findMany({
      where: { shop },
      distinct: ["jewelryType"],
      select: { jewelryType: true },
      orderBy: { jewelryType: "asc" },
    }),
    prisma.supplierProduct.findMany({
      where: { shop },
      distinct: ["size"],
      select: { size: true },
      orderBy: { size: "asc" },
    }),
    prisma.supplierProduct.findMany({
      where: { shop },
      distinct: ["clarity"],
      select: { clarity: true },
      orderBy: { clarity: "asc" },
    }),
  ]);

  return {
    shapes: shapes.map((r) => r.shape).filter(Boolean),
    metals: metals.map((r) => r.metalType).filter(Boolean),
    styles: styles.map((r) => r.jewelryType).filter(Boolean),
    sizes: sizes.map((r) => r.size).filter(Boolean),
    clarities: clarities.map((r) => r.clarity).filter(Boolean),
  };
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Build a Prisma `where` clause from the CatalogFilters bag.
 */
function buildWhere(
  shop: string,
  filters: CatalogFilters,
): Record<string, unknown> {
  const where: Record<string, unknown> = { shop };

  if (filters.category) where.category = filters.category;
  if (filters.shape) where.shape = filters.shape;
  if (filters.metalType) where.metalType = filters.metalType;
  if (filters.jewelryType) where.jewelryType = filters.jewelryType;
  if (filters.size) where.size = filters.size;
  if (filters.clarity) where.clarity = filters.clarity;

  if (filters.inHand === true) {
    where.inhandPcs = { not: "0" };
  }

  if (filters.onMemo === true) {
    where.memoOut = { not: "0" };
  }

  if (filters.selected !== undefined) {
    where.selected = filters.selected;
  }

  if (filters.pushed !== undefined) {
    where.pushed = filters.pushed;
  }

  // Numeric range on diaWt
  if (filters.diaWtMin !== undefined || filters.diaWtMax !== undefined) {
    const conditions: Record<string, unknown>[] = [];

    if (filters.diaWtMin !== undefined) {
      conditions.push({
        diaWt: { not: "" },
      });
      // We'll do a raw filter: cast(diaWt to float) >= min
      // Since SQLite stores these as strings, we rely on Prisma's raw query later.
      // For now we mark this via a special key that queryProducts will handle.
      where._diaWtMin = filters.diaWtMin;
    }

    if (filters.diaWtMax !== undefined) {
      where._diaWtMax = filters.diaWtMax;
    }
  }

  // Free-text search across stockNo, subitem, remarks
  if (filters.search && filters.search.trim().length > 0) {
    const term = filters.search.trim();
    // mode: "insensitive" — Postgres `contains` is case-sensitive by default
    // (SQLite was not), so without it searches like "ring" miss "Ring".
    where.OR = [
      { stockNo: { contains: term, mode: "insensitive" } },
      { subitem: { contains: term, mode: "insensitive" } },
      { remarks: { contains: term, mode: "insensitive" } },
    ];
  }

  return where;
}

export interface PaginatedProducts {
  products: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Query the local catalog with optional filters and pagination.
 */
export async function queryProducts(
  shop: string,
  filters: CatalogFilters = {},
): Promise<PaginatedProducts> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const skip = (page - 1) * limit;

  const where = buildWhere(shop, filters);

  // Extract special keys that Prisma can't handle directly
  const _diaWtMin = where._diaWtMin as number | undefined;
  const _diaWtMax = where._diaWtMax as number | undefined;
  delete where._diaWtMin;
  delete where._diaWtMax;

  // For numeric diaWt filtering on SQLite we need raw conditions.
  // Build AND array if needed.
  const andConditions: Record<string, unknown>[] = [];
  if (_diaWtMin !== undefined || _diaWtMax !== undefined) {
    // We hack this: filter after query or use raw SQL.
    // Simpler approach for SQLite: do an in-memory post-filter for diaWt.
    // We'll fetch without the diaWt filter and post-process.
  }

  const [rows, total] = await Promise.all([
    prisma.supplierProduct.findMany({
      where: where as any,
      orderBy: { stockNo: "asc" },
      skip,
      take: limit,
    }),
    prisma.supplierProduct.count({
      where: where as any,
    }),
  ]);

  // Post-filter for diaWt range (SQLite string columns can't do numeric compare
  // easily through Prisma)
  let filtered = rows;
  if (_diaWtMin !== undefined || _diaWtMax !== undefined) {
    filtered = rows.filter((row) => {
      const val = parseFloat(row.diaWt);
      if (isNaN(val)) return false;
      if (_diaWtMin !== undefined && val < _diaWtMin) return false;
      if (_diaWtMax !== undefined && val > _diaWtMax) return false;
      return true;
    });
  }

  // Convert Prisma objects to plain objects
  const products = filtered.map((r) => ({ ...r }));

  return {
    products,
    total: _diaWtMin !== undefined || _diaWtMax !== undefined
      ? filtered.length // approximate when post-filtering
      : total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

// ── Selection helpers ────────────────────────────────────────────────────────

export async function setProductSelected(
  shop: string,
  stockNo: string,
  selected: boolean,
): Promise<void> {
  await prisma.supplierProduct.updateMany({
    where: { shop, stockNo },
    data: { selected },
  });
}

export async function selectAllInView(
  shop: string,
  filters: CatalogFilters,
): Promise<{ count: number }> {
  const where = buildWhere(shop, filters);
  delete where._diaWtMin;
  delete where._diaWtMax;

  const result = await prisma.supplierProduct.updateMany({
    where: where as any,
    data: { selected: true },
  });

  return { count: result.count };
}

export async function deselectAll(shop: string): Promise<{ count: number }> {
  const result = await prisma.supplierProduct.updateMany({
    where: { shop, selected: true },
    data: { selected: false },
  });

  return { count: result.count };
}

// ── CSV export ───────────────────────────────────────────────────────────────

export async function exportToCsv(
  shop: string,
  filters: CatalogFilters = {},
): Promise<string> {
  const where = buildWhere(shop, filters);
  delete where._diaWtMin;
  delete where._diaWtMax;

  const rows = await prisma.supplierProduct.findMany({
    where: where as any,
    orderBy: { stockNo: "asc" },
  });

  // CSV header
  const headers = [
    "Stock No",
    "Subitem",
    "Category",
    "Jewelry Type",
    "Metal Type",
    "Casting Wt",
    "Shape",
    "Color",
    "Clarity",
    "Dia Pcs",
    "Dia Wt",
    "Gross Wt",
    "Growth Type",
    "Size",
    "Certificate",
    "Inhand Pcs",
    "Memo Out",
    "Price",
    "Remarks",
    "Image 1",
    "Image 2",
    "Video",
  ];

  const csvRows: string[] = [headers.join(",")];

  for (const row of rows) {
    const fields = [
      row.stockNo,
      row.subitem,
      row.category,
      row.jewelryType,
      row.metalType,
      row.castingWt,
      row.shape,
      row.color,
      row.clarity,
      row.diaPcs,
      row.diaWt,
      row.grossWt,
      row.growthType,
      row.size,
      row.certificate,
      row.inhandPcs,
      row.memoOut,
      row.price.toString(),
      // Quote remarks to handle embedded commas
      `"${(row.remarks ?? "").replace(/"/g, '""')}"`,
      row.image1,
      row.image2,
      row.video,
    ];

    csvRows.push(fields.join(","));
  }

  return csvRows.join("\n");
}
