import { NextResponse } from "next/server";
import { adminGraphql } from "@/lib/shopify";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

interface ProductsResponse {
  products: {
    edges: {
      node: {
        id: string;
        title: string;
        handle: string;
        featuredMedia: { preview: { image: { url: string } | null } | null } | null;
      };
    }[];
  };
}

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  try {
    const data = await adminGraphql<ProductsResponse>(
      `query SearchProducts($q: String) {
        products(first: 25, query: $q, sortKey: TITLE) {
          edges {
            node {
              id
              title
              handle
              featuredMedia { preview { image { url } } }
            }
          }
        }
      }`,
      { q },
    );
    const products = data.products.edges.map((e) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      image: e.node.featuredMedia?.preview?.image?.url ?? null,
    }));
    return NextResponse.json({ products });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load products" },
      { status: 500 },
    );
  }
}
