import { NextResponse } from "next/server";
import { entryId, readColorMediaMap, writeColorMediaMap } from "@/lib/media";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

/** Remove a single media entry (by its id: fileId or mediaId) from a color. */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { productId?: string; color?: string; entryId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { productId, color, entryId: id } = body;
  if (!productId || !color || !id) {
    return NextResponse.json(
      { error: "productId, color and entryId are required" },
      { status: 400 },
    );
  }

  try {
    const map = await readColorMediaMap(productId);
    const entry = map.colors[color];
    if (entry) {
      entry.media = entry.media.filter((m) => entryId(m) !== id);
      if (entry.media.length === 0) delete map.colors[color];
      await writeColorMediaMap(productId, map);
    }
    return NextResponse.json({ ok: true, mediaMap: map });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remove failed" },
      { status: 500 },
    );
  }
}
