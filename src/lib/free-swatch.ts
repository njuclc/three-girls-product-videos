import { getShopDomain } from "./shopify";

/**
 * One fabric color option parsed from a product's "free swatch" data.
 * Mirrors the objects the theme renders inside
 * `<script type="application/json" data-free-swatch-variants="json">`.
 */
export interface SwatchColor {
  variantId: number | null;
  publicTitle: string;
  imageSrc: string | null;
}

export interface SwatchResult {
  colors: SwatchColor[];
  source: "storefront-html" | "none";
  note?: string;
}

const SWATCH_SCRIPT_RE =
  /<script[^>]*data-free-swatch-variants=["']json["'][^>]*>([\s\S]*?)<\/script>/i;

function toSwatchColor(raw: unknown): SwatchColor | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const publicTitle =
    typeof obj.public_title === "string" && obj.public_title.trim()
      ? obj.public_title.trim()
      : typeof obj.title === "string" && obj.title.trim()
        ? obj.title.trim()
        : "";
  if (!publicTitle) return null;

  let imageSrc: string | null = null;
  const fi = obj.featured_image as Record<string, unknown> | undefined;
  if (fi && typeof fi === "object" && typeof fi.src === "string") {
    imageSrc = fi.src;
  } else if (typeof obj.image === "string") {
    imageSrc = obj.image;
  }

  const id = obj.id;
  const variantId =
    typeof id === "number" ? id : typeof id === "string" ? Number(id) || null : null;

  return { variantId, publicTitle, imageSrc };
}

function normalizeVariants(parsed: unknown): SwatchColor[] {
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const colors: SwatchColor[] = [];
  for (const raw of parsed) {
    const color = toSwatchColor(raw);
    if (!color) continue;
    if (seen.has(color.publicTitle)) continue;
    seen.add(color.publicTitle);
    colors.push(color);
  }
  return colors;
}

/** Method 1: parse the storefront product page HTML. */
async function fromStorefrontHtml(url: string): Promise<SwatchColor[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "three-girls-product-videos/1.0" },
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`storefront responded ${res.status}`);
  const html = await res.text();
  const match = html.match(SWATCH_SCRIPT_RE);
  if (!match) throw new Error("data-free-swatch-variants script tag not found");
  return normalizeVariants(JSON.parse(match[1].trim()));
}

/**
 * Resolve fabric colors for a product by parsing the storefront product page
 * `<script data-free-swatch-variants="json">` JSON.
 */
export async function getSwatchColors(args: {
  handle: string;
  onlineStoreUrl: string | null;
}): Promise<SwatchResult> {
  const { handle, onlineStoreUrl } = args;
  const url = onlineStoreUrl || `https://${getShopDomain()}/products/${handle}`;

  try {
    const colors = await fromStorefrontHtml(url);
    if (colors.length > 0) return { colors, source: "storefront-html" };
    return { colors: [], source: "none", note: "Storefront HTML had no swatch colors." };
  } catch (error) {
    return {
      colors: [],
      source: "none",
      note: `Could not read swatch colors from the storefront (${
        error instanceof Error ? error.message : "unknown"
      }).`,
    };
  }
}
