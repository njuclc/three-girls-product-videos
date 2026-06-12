import { NextResponse } from "next/server";
import { createStagedTarget } from "@/lib/video";
import { guard } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * Step 1 of upload: ask Shopify for a staged upload target. The browser then
 * uploads the file bytes directly to this target (bypassing Vercel's request
 * body size limit), and finally calls /api/upload/register.
 */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  let body: { filename?: string; mimeType?: string; fileSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { filename, mimeType, fileSize } = body;
  if (!filename || !mimeType || !fileSize) {
    return NextResponse.json(
      { error: "filename, mimeType and fileSize are required" },
      { status: 400 },
    );
  }

  try {
    const target = await createStagedTarget({ filename, mimeType, fileSize });
    return NextResponse.json({ target });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Staged upload failed" },
      { status: 500 },
    );
  }
}
