"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Redirects the browser into the desktop companion app via its custom
 * `agent-auth://` protocol, handing over the session token and user. The scheme
 * belongs to the desktop app, so this is provider-agnostic — any Agent Auth
 * provider can reuse this component verbatim.
 */
export function DesktopAuthRedirect({
  token,
  state,
  user,
}: {
  token: string;
  state: string;
  user: string;
}) {
  const [opened, setOpened] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const callbackUrl = `agent-auth://auth-callback?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}&user=${encodeURIComponent(user)}`;

  useEffect(() => {
    // Strategy 1: hidden iframe (most reliable for ASWebAuthenticationSession).
    if (iframeRef.current) {
      iframeRef.current.src = callbackUrl;
    }

    // Strategy 2: window.location as a fallback (works for Electron).
    const timer = setTimeout(() => {
      window.location.href = callbackUrl;
    }, 100);

    setOpened(true);
    return () => clearTimeout(timer);
  }, [callbackUrl]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center">
      <iframe ref={iframeRef} className="hidden" aria-hidden="true" title="" />

      <div className="mb-6 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
        Vercel <span className="text-muted/40">|</span> Agent Auth
      </div>

      {opened ? (
        <>
          <p className="mb-2 text-sm text-foreground">
            You can close this tab and return to the app.
          </p>
          <p className="mb-6 text-xs text-muted">
            If the app didn&apos;t open automatically,{" "}
            <a href={callbackUrl} className="underline underline-offset-2 hover:text-foreground">
              click here
            </a>
            .
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Redirecting to app...</p>
      )}
    </div>
  );
}
