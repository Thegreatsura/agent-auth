import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DesktopAuthRedirect } from "./desktop-auth-redirect";

/**
 * Entry point for the Agent Auth desktop companion app's browser sign-in.
 *
 * The desktop app opens `${providerUrl}/desktop-auth?state=<random>` in the
 * system browser. If the visitor already has a real (non-anonymous) session we
 * hand the session token back to the app via the `agent-auth://` deep link.
 * Otherwise we bounce them through the normal sign-in and return here.
 */
export default async function DesktopAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;

  if (!state) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted">
        Invalid request: missing state parameter.
      </div>
    );
  }

  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true, disableRefresh: true },
  });

  const isAnonymous = (session?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous;

  if (!session?.user || isAnonymous) {
    // Send them through the OAuth sign-in, then come straight back here so we
    // can complete the desktop handoff.
    redirect(`/?callbackURL=${encodeURIComponent(`/desktop-auth?state=${state}`)}`);
  }

  const token = session.session.token;
  const user = JSON.stringify({
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image ?? null,
  });

  return <DesktopAuthRedirect token={token} state={state} user={user} />;
}
