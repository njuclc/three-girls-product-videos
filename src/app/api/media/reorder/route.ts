import { NextResponse } from "next/server";
import { entryId, readColorMediaMap, writeColorMediaMap } from "@/lib/media";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

/** Reorder the media of a color to match the given list of entry ids. */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { productId?: string; color?: string; order?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { productId, color, order } = body;
  if (!productId || !color || !Array.isArray(order)) {
    return NextResponse.json(
      { error: "productId, color and order[] are required" },
      { status: 400 },
    );
  }

  try {
    const map = await readColorMediaMap(productId);
    const entry = map.colors[color];
    if (entry) {
      const rank = new Map(order.map((id, i) => [id, i]));
      // Stable sort by requested position; unknown ids keep their tail order.
      entry.media = entry.media
        .map((m, i) => ({ m, i }))
        .sort((a, b) => {
          const ra = rank.get(entryId(a.m)) ?? order.length + a.i;
          const rb = rank.get(entryId(b.m)) ?? order.length + b.i;
          return ra - rb;
        })
        .map((x) => x.m);
      await writeColorMediaMap(productId, map);
    }
    return NextResponse.json({ ok: true, mediaMap: map });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reorder failed" },
      { status: 500 },
    );
  }
}
