import { NextResponse } from "next/server";
import { adminGraphql } from "@/lib/shopify";
import { getSwatchColors } from "@/lib/free-swatch";
import { readColorVideoMap } from "@/lib/video";
import { readColorMediaMap } from "@/lib/media";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

interface ProductResponse {
  product: {
    id: string;
    title: string;
    handle: string;
    onlineStoreUrl: string | null;
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  } | null;
}

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "Missing productId" }, { status: 400 });
  }

  try {
    const data = await adminGraphql<ProductResponse>(
      `query ProductForConfig($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          onlineStoreUrl
          featuredMedia { preview { image { url } } }
        }
      }`,
      { id: productId },
    );
    const product = data.product;
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const swatch = await getSwatchColors({
      handle: product.handle,
      onlineStoreUrl: product.onlineStoreUrl ?? null,
    });
    const [videoMap, mediaMap] = await Promise.all([
      readColorVideoMap(product.id),
      readColorMediaMap(product.id),
    ]);

    return NextResponse.json({
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        image: product.featuredMedia?.preview?.image?.url ?? null,
      },
      colors: swatch.colors,
      swatchSource: swatch.source,
      swatchNote: swatch.note ?? null,
      videoMap,
      mediaMap,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load colors" },
      { status: 500 },
    );
  }
}
