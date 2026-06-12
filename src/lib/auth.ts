import { cookies } from "next/headers";
import crypto from "node:crypto";

const COOKIE_NAME = "tgpv_auth";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** True when an APP_PASSWORD is configured (i.e. the tool is protected). */
export function passwordRequired(): boolean {
  return !!process.env.APP_PASSWORD;
}

/** The cookie token we expect for an authenticated session. */
function expectedToken(): string | null {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  return crypto.createHash("sha256").update(pw).digest("hex");
}

/** Verify a submitted password against APP_PASSWORD (constant-time-ish). */
export function verifyPassword(input: string): boolean {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(pw);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Read the current session and report whether the request is authenticated. */
export async function isAuthed(): Promise<boolean> {
  // No password configured -> open access (intended only for local dev).
  if (!passwordRequired()) return true;
  const token = expectedToken();
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value === token;
}

export async function setAuthCookie(): Promise<void> {
  const token = expectedToken();
  if (!token) return;
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearAuthCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
