import { NextResponse } from "next/server";
import { isAuthed } from "./auth";

/**
 * Guard for API route handlers. Returns a 401 NextResponse when the request
 * is not authenticated, or null when it is allowed to proceed.
 */
export async function guard(): Promise<NextResponse | null> {
  if (await isAuthed()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
