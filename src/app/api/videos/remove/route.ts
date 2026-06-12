import { NextResponse } from "next/server";
import { readColorVideoMap, writeColorVideoMap } from "@/lib/video";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

/** Remove a single video (by fileId) from a color in the metafield. */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { productId?: string; color?: string; fileId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { productId, color, fileId } = body;
  if (!productId || !color || !fileId) {
    return NextResponse.json(
      { error: "productId, color and fileId are required" },
      { status: 400 },
    );
  }

  try {
    const map = await readColorVideoMap(productId);
    const entry = map.colors[color];
    if (entry) {
      entry.videos = entry.videos.filter((v) => v.fileId !== fileId);
      if (entry.videos.length === 0) delete map.colors[color];
      await writeColorVideoMap(productId, map);
    }
    return NextResponse.json({ ok: true, videoMap: map });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remove failed" },
      { status: 500 },
    );
  }
}
