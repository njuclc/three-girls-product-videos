import { NextResponse } from "next/server";
import { passwordRequired, setAuthCookie, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!passwordRequired()) {
    // No password configured: nothing to log in to.
    return NextResponse.json({ ok: true });
  }
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }
  if (!body.password || !verifyPassword(body.password)) {
    return NextResponse.json(
      { ok: false, error: "Incorrect password" },
      { status: 401 },
    );
  }
  await setAuthCookie();
  return NextResponse.json({ ok: true });
}
