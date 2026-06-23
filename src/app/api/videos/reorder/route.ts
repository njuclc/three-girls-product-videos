import { NextResponse } from "next/server";
import { readColorVideoMap, writeColorVideoMap } from "@/lib/video";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

/** Reorder the videos of a color to match the given list of fileIds. */
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
    const map = await readColorVideoMap(productId);
    const entry = map.colors[color];
    if (entry) {
      const rank = new Map(order.map((id, i) => [id, i]));
      // Stable sort by requested position; unknown ids keep their tail order.
      entry.videos = entry.videos
        .map((v, i) => ({ v, i }))
        .sort((a, b) => {
          const ra = rank.get(a.v.fileId) ?? order.length + a.i;
          const rb = rank.get(b.v.fileId) ?? order.length + b.i;
          return ra - rb;
        })
        .map((x) => x.v);
      await writeColorVideoMap(productId, map);
    }
    return NextResponse.json({ ok: true, videoMap: map });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reorder failed" },
      { status: 500 },
    );
  }
}
