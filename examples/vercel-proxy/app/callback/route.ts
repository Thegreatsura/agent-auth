import { type NextRequest, NextResponse } from "next/server";

/**
 * Forwards the "Sign in with Vercel" OAuth callback to Better Auth's handler.
 * Registering a short `/callback` redirect URI in the Vercel dashboard is
 * simpler than the full Better Auth callback path it resolves to below.
 */
export function GET(req: NextRequest) {
  const url = new URL(req.url);
  const target = new URL("/api/auth/oauth2/callback/vercel-mcp", url.origin);
  target.search = url.search;
  return NextResponse.redirect(target);
}
