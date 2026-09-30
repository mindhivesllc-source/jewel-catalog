/**
 * Merchant-hosted product images. Files are named after the stock number and
 * an index, e.g. https://cdn.example.com/LGD1002RMH_1.jpg … _8.jpg. The
 * template uses {stockNo} and {n}; a URL is only sent to Shopify when the
 * file actually exists (Shopify would otherwise fail media processing).
 */

export const MAX_CUSTOM_IMAGES = 12;

export function renderImageUrl(
  template: string,
  stockNo: string,
  n: number,
): string {
  return template
    .trim()
    .replace(/\{stockNo\}/g, encodeURIComponent(stockNo.trim()))
    .replace(/\{n\}/g, String(n));
}

export function customImageUrls(
  template: string,
  count: number,
  stockNo: string,
): string[] {
  const t = (template || "").trim();
  if (!/^https:\/\/.+\{stockNo\}/i.test(t) || !stockNo.trim()) return [];
  const total = Math.max(1, Math.min(MAX_CUSTOM_IMAGES, Math.floor(count) || 1));
  const urls: string[] = [];
  for (let n = 1; n <= total; n++) urls.push(renderImageUrl(t, stockNo, n));
  return [...new Set(urls)];
}

/** Human-readable problem with a template, or null when it is usable. */
export function validateImageTemplate(template: string): string | null {
  const t = (template || "").trim();
  if (!t) return null;
  if (!/^https:\/\//i.test(t)) return "The image URL must start with https://";
  if (!t.includes("{stockNo}")) return "The image URL must contain {stockNo}";
  if (!t.includes("{n}")) return "The image URL must contain {n} (the image number, 1 to 8)";
  let host = "";
  try {
    host = new URL(renderImageUrl(t, "TEST123", 1)).hostname.toLowerCase();
  } catch {
    return "The image URL is not a valid address";
  }
  // The server fetches these URLs itself: never let them point inside the
  // hosting network.
  if (
    host === "localhost" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^(\d+\.){3}\d+$/.test(host) ||
    host.includes(":")
  ) {
    return "The image URL must use a public domain name";
  }
  return null;
}

const existsCache = new Map<string, Promise<boolean>>();

/** True when the URL serves an image (HEAD, falling back to a 1-byte GET). */
export function imageExists(url: string): Promise<boolean> {
  const cached = existsCache.get(url);
  if (cached) return cached;
  const probe = (async () => {
    const attempt = async (method: "HEAD" | "GET") => {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
        headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      });
      if (method === "GET") await res.body?.cancel().catch(() => {});
      return res;
    };
    try {
      let res = await attempt("HEAD");
      if (res.status === 405 || res.status === 403 || res.status === 501) {
        res = await attempt("GET");
      }
      if (!res.ok) return false;
      const type = (res.headers.get("content-type") || "").toLowerCase();
      return !type || type.startsWith("image/") || type === "application/octet-stream";
    } catch {
      return false;
    }
  })();
  existsCache.set(url, probe);
  // Do not remember failures for long: the merchant may be uploading now.
  probe.then((ok) => {
    if (!ok) setTimeout(() => existsCache.delete(url), 60_000).unref?.();
  });
  return probe;
}

/** Existing custom image URLs for one product, in order. */
export async function resolveCustomImages(
  template: string,
  count: number,
  stockNo: string,
  check: (url: string) => Promise<boolean> = imageExists,
): Promise<string[]> {
  const urls = customImageUrls(template, count, stockNo);
  if (urls.length === 0) return [];
  const flags = await Promise.all(urls.map((u) => check(u)));
  return urls.filter((_, i) => flags[i]);
}
