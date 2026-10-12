import { NextResponse } from "next/server";
import { readColorMediaMap, refreshUploadedEntry, writeColorMediaMap } from "@/lib/media";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Re-query pending uploaded gallery media and fill in urls / posters / sizes.
 * Product-media references carry no status and are skipped.
 */
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
    const map = await readColorMediaMap(body.productId);
    let changed = false;
    for (const color of Object.keys(map.colors)) {
      for (const m of map.colors[color].media) {
        if (m.kind !== "upload") continue;
        if (await refreshUploadedEntry(m)) changed = true;
      }
    }
    if (changed) await writeColorMediaMap(body.productId, map);
    return NextResponse.json({ ok: true, mediaMap: map });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refresh failed" },
      { status: 500 },
    );
  }
}
