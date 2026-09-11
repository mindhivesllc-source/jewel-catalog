import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getCategories } from "../services/catalog.server";

const MARKUP_TYPES = ["percent", "fixed"] as const;
const ROUND_TO = ["none", "0.99", "whole"] as const;

interface RuleInput {
  category: string;
  markupType: (typeof MARKUP_TYPES)[number];
  markupValue: number;
  roundTo: (typeof ROUND_TO)[number];
}

async function payload(shop: string) {
  const [categories, rules] = await Promise.all([
    getCategories(shop),
    prisma.categoryPricingRule.findMany({
      where: { shop },
      orderBy: { category: "asc" },
      select: { category: true, markupType: true, markupValue: true, roundTo: true },
    }),
  ]);
  return { success: true, categories: ["*", ...categories.filter((c) => c !== "*")], rules };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    return data(await payload(session.shop));
  } catch (err: any) {
    return data({ error: err.message || "Failed to load pricing rules" }, { status: 500 });
  }
};

function parseRules(raw: unknown): RuleInput[] {
  if (!Array.isArray(raw)) throw new Error("rules must be an array");
  const out: RuleInput[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const category = String(r.category ?? "").trim();
    if (!category) continue;
    const markupType = MARKUP_TYPES.includes(r.markupType as any)
      ? (r.markupType as RuleInput["markupType"])
      : "percent";
    const roundTo = ROUND_TO.includes(r.roundTo as any)
      ? (r.roundTo as RuleInput["roundTo"])
      : "none";
    const markupValue = Number(r.markupValue);
    if (!Number.isFinite(markupValue)) throw new Error(`Invalid markup value for ${category}`);
    out.push({ category, markupType, markupValue, roundTo });
  }
  return out;
}

/** POST JSON { rules: [...] } — replaces the shop's full rule set. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const body = (await request.json()) as { rules?: unknown };
    const rules = parseRules(body.rules);

    await prisma.$transaction([
      prisma.categoryPricingRule.deleteMany({
        where: { shop, category: { notIn: rules.map((r) => r.category) } },
      }),
      ...rules.map((r) =>
        prisma.categoryPricingRule.upsert({
          where: { shop_category: { shop, category: r.category } },
          create: { shop, ...r },
          update: { markupType: r.markupType, markupValue: r.markupValue, roundTo: r.roundTo },
        }),
      ),
    ]);

    return data(await payload(shop));
  } catch (err: any) {
    return data({ error: err.message || "Failed to save pricing rules" }, { status: 400 });
  }
};
