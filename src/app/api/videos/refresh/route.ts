import { NextResponse } from "next/server";
import {
  getVideoFileStatus,
  readColorVideoMap,
  writeColorVideoMap,
} from "@/lib/video";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Re-query pending videos and fill in their playable URLs / statuses. */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { productId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body.productId) {
    return NextResponse.json({ error: "Missing productId" }, { status: 400 });
  }

  try {
    const map = await readColorVideoMap(body.productId);
    let changed = false;
    for (const color of Object.keys(map.colors)) {
      for (const v of map.colors[color].videos) {
        // Re-query while transcoding, or to backfill a missing url / poster
        // (older entries predate poster support). FAILED is terminal — skip it.
        if (v.status !== "FAILED" && (v.status !== "READY" || !v.url || !v.poster)) {
          const result = await getVideoFileStatus(v.fileId);
          if (
            result.status !== v.status ||
            (result.url && result.url !== v.url) ||
            (result.poster && result.poster !== v.poster)
          ) {
            v.status = result.status;
            if (result.url) v.url = result.url;
            if (result.poster) v.poster = result.poster;
            changed = true;
          }
        }
      }
    }
    if (changed) await writeColorVideoMap(body.productId, map);
    return NextResponse.json({ ok: true, videoMap: map });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refresh failed" },
      { status: 500 },
    );
  }
}
