import { NextResponse } from "next/server";
import {
  getMediaImageStatus,
  readColorMediaMap,
  registerMediaFile,
  writeColorMediaMap,
  type MediaEntry,
  type ProductMediaRef,
} from "@/lib/media";
import { getVideoFileStatus, registerFile } from "@/lib/video";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Step 3 of gallery-media upload, or direct add of a product-media reference:
 * append an entry to the color's `media` list in `custom.color_media`.
 *
 * - mode "upload": register the staged resource as a Shopify file first
 *   (IMAGE or VIDEO), then store the entry with an opportunistic status check.
 * - mode "product_media": store a bare { kind, mediaId, type } reference; no
 *   file is created and no url is stored (product media urls can expire, the
 *   theme renders these from product.media by id).
 */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: {
    productId?: string;
    color?: string;
    mode?: string;
    // upload mode:
    resourceUrl?: string;
    filename?: string;
    type?: string; // "image" | "video"
    // product_media mode:
    mediaId?: string;
    mediaType?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { productId, color } = body;
  if (!productId || !color) {
    return NextResponse.json(
      { error: "productId and color are required" },
      { status: 400 },
    );
  }

  try {
    const map = await readColorMediaMap(productId);
    const entry = map.colors[color] ?? { media: [] };
    let appended: MediaEntry;

    if (body.mode === "product_media") {
      const { mediaId, mediaType } = body;
      if (!mediaId || !mediaType) {
        return NextResponse.json(
          { error: "mediaId and mediaType are required" },
          { status: 400 },
        );
      }
      if (entry.media.some((m) => m.kind === "product_media" && m.mediaId === mediaId)) {
        return NextResponse.json({ error: "Already in this color's media" }, { status: 409 });
      }
      appended = {
        kind: "product_media",
        mediaId,
        type: mediaType as ProductMediaRef["type"],
      };
    } else {
      const { resourceUrl, filename } = body;
      const type = body.type === "image" ? "image" : "video";
      if (!resourceUrl) {
        return NextResponse.json({ error: "resourceUrl is required" }, { status: 400 });
      }

      let fileId: string;
      if (type === "image") {
        fileId = await registerMediaFile(resourceUrl, "IMAGE", `Gallery image for ${color}`);
        let status = "PROCESSING";
        let url = "";
        let width = 0;
        let height = 0;
        try {
          const r = await getMediaImageStatus(fileId);
          status = r.status;
          url = r.url;
          width = r.width;
          height = r.height;
        } catch {
          // ignore; refresh later
        }
        appended = {
          kind: "upload",
          type: "image",
          fileId,
          url,
          width,
          height,
          filename: filename || "image",
          status,
        };
      } else {
        fileId = await registerFile(resourceUrl, `Gallery video for ${color}`);
        let status = "PROCESSING";
        let url = "";
        let poster = "";
        try {
          const r = await getVideoFileStatus(fileId);
          status = r.status;
          url = r.url;
          poster = r.poster;
        } catch {
          // ignore; refresh later
        }
        appended = {
          kind: "upload",
          type: "video",
          fileId,
          url,
          poster,
          filename: filename || "video.mp4",
          status,
        };
      }
    }

    entry.media.push(appended);
    map.colors[color] = entry;
    await writeColorMediaMap(productId, map);

    return NextResponse.json({ ok: true, entry: appended, mediaMap: map });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Register failed" },
      { status: 500 },
    );
  }
}
