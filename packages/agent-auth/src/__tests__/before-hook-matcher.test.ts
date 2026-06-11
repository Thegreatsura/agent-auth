import { describe, expect, it } from "vitest";
import { createAgentAuthBeforeHook } from "../middleware";
import { shouldRunMiddleware } from "../server/middleware";
import type { JtiCacheStore } from "../utils/jti-cache";
import type { ResolvedAgentAuthOptions } from "../types";

/**
 * Regression: the agent-auth before-hook is registered globally on the auth
 * instance. It must only intercept requests bound for agent-auth's own
 * endpoints (/agent/*, /capability/*, /host/*).
 *
 * Previously the matcher grabbed ANY request carrying a 3-part Bearer JWT on
 * every path except /agent/register and /agent/claim. That collided with other
 * Bearer-based plugins (e.g. dashboards authenticating to /dash/* or
 * /sentinel/*) and core Better Auth routes: agent-auth would reject their
 * tokens with an AgentAuth challenge before the real owner ever ran.
 */
describe("agent-auth before-hook matcher scoping", () => {
  // The matcher only reads ctx.path and ctx.headers, so the caches/opts are
  // never touched — minimal stubs are sufficient.
  const { matcher } = createAgentAuthBeforeHook(
    {} as ResolvedAgentAuthOptions,
    {} as JtiCacheStore,
  );

  const THREE_PART_JWT = "header.payload.signature";

  function ctxFor(path: string, jwt: string | null = THREE_PART_JWT) {
    const headers = new Headers();
    if (jwt) headers.set("authorization", `Bearer ${jwt}`);
    return { path, headers };
  }

  it("intercepts agent-auth's own authenticated endpoints", () => {
    for (const path of [
      "/agent/session",
      "/agent/status",
      "/agent/request-capability",
      "/capability/execute",
      "/capability/batch-execute",
      "/host/get",
      "/host/rotate-key",
    ]) {
      expect(matcher(ctxFor(path)), `expected to match ${path}`).toBe(true);
    }
  });

  it("ignores paths owned by other plugins or core routes", () => {
    for (const path of [
      "/dash/projects",
      "/sentinel/events",
      "/get-session",
      "/sign-in/email",
      "/organization/list",
      // Public discovery doc lives outside the authenticated prefixes.
      "/agent-configuration",
      "/api/custom",
    ]) {
      expect(matcher(ctxFor(path)), `expected NOT to match ${path}`).toBe(false);
    }
  });

  it("never intercepts identity bootstrap endpoints", () => {
    expect(matcher(ctxFor("/agent/register"))).toBe(false);
    expect(matcher(ctxFor("/agent/claim"))).toBe(false);
  });

  it("requires a 3-part Bearer JWT on agent-auth paths", () => {
    expect(matcher(ctxFor("/agent/session", null))).toBe(false);
    expect(matcher(ctxFor("/agent/session", "opaque-token"))).toBe(false);
    expect(matcher(ctxFor("/agent/session", "two.parts"))).toBe(false);
  });

  it("returns false when path is missing", () => {
    expect(matcher({ path: undefined, headers: new Headers() })).toBe(false);
  });
});

/**
 * The standalone server variant must apply the exact same scoping as the
 * plugin before-hook so the two matchers never drift apart.
 */
describe("server shouldRunMiddleware matcher scoping", () => {
  const THREE_PART_JWT = "header.payload.signature";

  function headersFor(jwt: string | null = THREE_PART_JWT) {
    const headers = new Headers();
    if (jwt) headers.set("authorization", `Bearer ${jwt}`);
    return headers;
  }

  it("intercepts agent-auth's own authenticated endpoints", () => {
    for (const path of [
      "/agent/session",
      "/agent/status",
      "/agent/request-capability",
      "/capability/execute",
      "/capability/batch-execute",
      "/host/get",
      "/host/rotate-key",
    ]) {
      expect(shouldRunMiddleware(path, headersFor()), `expected to match ${path}`).toBe(true);
    }
  });

  it("ignores paths owned by other plugins or core routes", () => {
    for (const path of [
      "/dash/projects",
      "/sentinel/events",
      "/get-session",
      "/sign-in/email",
      "/organization/list",
      "/agent-configuration",
      "/api/custom",
    ]) {
      expect(shouldRunMiddleware(path, headersFor()), `expected NOT to match ${path}`).toBe(false);
    }
  });

  it("never intercepts identity bootstrap endpoints", () => {
    expect(shouldRunMiddleware("/agent/register", headersFor())).toBe(false);
    expect(shouldRunMiddleware("/agent/claim", headersFor())).toBe(false);
  });

  it("requires a 3-part Bearer JWT on agent-auth paths", () => {
    expect(shouldRunMiddleware("/agent/session", headersFor(null))).toBe(false);
    expect(shouldRunMiddleware("/agent/session", headersFor("opaque-token"))).toBe(false);
    expect(shouldRunMiddleware("/agent/session", headersFor("two.parts"))).toBe(false);
  });
});
