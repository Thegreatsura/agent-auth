import type { Capability } from "./openapi";

export interface ProviderConfig {
  version: string;
  provider_name: string;
  description?: string;
  issuer: string;
  algorithms: string[];
  modes: string[];
  approval_methods: string[];
  endpoints: Record<string, string>;
  jwks_uri?: string;
}

const KNOWN_PATHS = ["/api/auth/agent", "/api/auth", "/auth", "/api"];
const FETCH_TIMEOUT_MS = 8000;

// §6.2 GET /capability/list response, mapped to the directory's Capability shape.
const CAPABILITY_PAGE_SIZE = 100;
const MAX_CAPABILITIES = 1000;

interface CapabilityListEntry {
  name: string;
  description?: string;
  approval_strength?: string;
}

interface CapabilityListResponse {
  capabilities?: CapabilityListEntry[];
  has_more?: boolean;
  next_cursor?: string;
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverProvider(baseUrl: string): Promise<ProviderConfig | null> {
  const normalized = baseUrl.replace(/\/+$/, "");

  try {
    const res = await fetchWithTimeout(`${normalized}/.well-known/agent-configuration`);
    if (res.ok) {
      return (await res.json()) as ProviderConfig;
    }
  } catch {}

  for (const prefix of KNOWN_PATHS) {
    try {
      const res = await fetchWithTimeout(`${normalized}${prefix}/agent-configuration`);
      if (res.ok) {
        return (await res.json()) as ProviderConfig;
      }
    } catch {}
  }

  return null;
}

/**
 * Resolve a discovery `endpoints.*` value to an absolute URL. Some providers
 * advertise absolute URLs; others (including our own proxies) advertise paths
 * like `/capability/list`. Those are joined onto the absolute issuer by string
 * concatenation — NOT `new URL()`, which would resolve a leading-slash path
 * against the origin and drop the issuer's path prefix (e.g. `/api/auth`).
 */
function resolveEndpoint(issuer: string, endpoint: string | null | undefined): string | null {
  if (!endpoint) return null;
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const base = issuer.replace(/\/+$/, "");
  return `${base}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
}

/**
 * Fetch the capability list (§6.2) an Agent Auth provider advertises at its
 * `endpoints.capabilities` URL and map it to the directory's Capability shape.
 *
 * The discovery document only exposes the capabilities *endpoint*, not the list
 * itself, so this is what populates the column for `agent-auth` providers (the
 * way `deriveProviderFromOpenAPI` does for `openapi` ones). No auth is sent, so
 * only publicly-listed capabilities are captured — a provider with
 * `requireAuthForCapabilities` returns 401 and we fall back to null. Returns
 * null on any failure so a capability fetch never blocks a provider submission.
 */
export async function fetchProviderCapabilities(
  issuer: string,
  capabilitiesEndpoint: string | null | undefined,
): Promise<Capability[] | null> {
  const capabilitiesUrl = resolveEndpoint(issuer, capabilitiesEndpoint);
  if (!capabilitiesUrl) return null;

  const collected: Capability[] = [];
  let cursor: string | undefined;
  const maxPages = Math.ceil(MAX_CAPABILITIES / CAPABILITY_PAGE_SIZE);

  try {
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(capabilitiesUrl);
      url.searchParams.set("limit", String(CAPABILITY_PAGE_SIZE));
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetchWithTimeout(url.toString());
      if (!res.ok) break;

      const body = (await res.json()) as CapabilityListResponse;
      for (const entry of body.capabilities ?? []) {
        if (!entry?.name) continue;
        collected.push({
          name: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.approval_strength ? { approvalStrength: entry.approval_strength } : {}),
        });
        if (collected.length >= MAX_CAPABILITIES) return collected;
      }

      if (!body.has_more || !body.next_cursor) break;
      cursor = body.next_cursor;
    }
  } catch {
    return collected.length > 0 ? collected : null;
  }

  return collected.length > 0 ? collected : null;
}
