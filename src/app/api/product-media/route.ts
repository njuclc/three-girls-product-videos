import { NextResponse } from "next/server";
import { fetchProductMedia } from "@/lib/media";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

/** List a product's own media, for the "add from product media" picker. */
export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "Missing productId" }, { status: 400 });
  }

  try {
    const media = await fetchProductMedia(productId);
    return NextResponse.json({ media });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load product media" },
      { status: 500 },
    );
  }
}
