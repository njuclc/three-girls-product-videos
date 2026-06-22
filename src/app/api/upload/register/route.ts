import { NextResponse } from "next/server";
import {
  getVideoFileStatus,
  readColorVideoMap,
  registerFile,
  writeColorVideoMap,
} from "@/lib/video";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Step 3 of upload: register the staged resource as a Shopify Video file and
 * append it to the product's color_videos metafield. We do one quick status
 * check; the playable URL usually arrives later (resolve via /api/videos/refresh).
 */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: {
    productId?: string;
    color?: string;
    variantId?: number | null;
    resourceUrl?: string;
    filename?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { productId, color, resourceUrl, filename } = body;
  const variantId = body.variantId ?? null;
  if (!productId || !color || !resourceUrl) {
    return NextResponse.json(
      { error: "productId, color and resourceUrl are required" },
      { status: 400 },
    );
  }

  try {
    const fileId = await registerFile(resourceUrl, `Video for ${color}`);

    // Opportunistic single status check (don't block on transcoding).
    let status = "PROCESSING";
    let url = "";
    let poster = "";
    try {
      const result = await getVideoFileStatus(fileId);
      status = result.status;
      url = result.url;
      poster = result.poster;
    } catch {
      // ignore; refresh later
    }

    const entry = { fileId, url, poster, filename: filename || "video.mp4", status };

    const map = await readColorVideoMap(productId);
    const existing = map.colors[color] ?? { variantId, videos: [] };
    existing.videos.push(entry);
    if (variantId != null) existing.variantId = variantId;
    map.colors[color] = existing;
    await writeColorVideoMap(productId, map);

    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Register failed" },
      { status: 500 },
    );
  }
}
