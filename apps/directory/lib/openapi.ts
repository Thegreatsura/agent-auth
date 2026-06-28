import { createFromOpenAPI } from "@better-auth/agent-auth/openapi";

type OpenAPISpecInput = Parameters<typeof createFromOpenAPI>[0];

/**
 * The subset of the protocol's Capability shape we store and render, mirroring
 * agent-auth-protocol.com/docs/capabilities (name, description, input/output
 * JSON Schema) plus this implementation's `approvalStrength` (§8.11). Defined
 * here so the directory doesn't depend on the plugin's published type surface.
 */
export interface Capability {
  name: string;
  description?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  approvalStrength?: string;
  /** HTTP method + path the capability proxies to (OpenAPI-derived only). */
  method?: string;
  path?: string;
  [key: string]: unknown;
}

export interface DerivedProvider {
  /** Slugified provider_name (matches the directory's PROVIDER_NAME rule). */
  name: string;
  displayName: string;
  description: string;
  issuer: string;
  baseUrl: string;
  version: string;
  capabilities: Capability[];
  openapiUrl: string;
}

const FETCH_TIMEOUT_MS = 8000;

// Graduated approval: reads are session-level, mutations require WebAuthn.
const APPROVAL_BY_METHOD = {
  GET: "session",
  HEAD: "session",
  POST: "webauthn",
  PUT: "webauthn",
  PATCH: "webauthn",
  DELETE: "webauthn",
} as const;

/** Turn an arbitrary string into a provider_name slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalize an OpenAPI operationId (e.g. "findPetsByStatus", "messages.list")
 * to the protocol's snake_case capability-name rule: `[a-z0-9_]+`.
 */
export function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch", "head", "options", "trace"]);

/**
 * Map each operationId to the HTTP method + path it is defined on. The plugin's
 * `createFromOpenAPI` drops this once it builds the executor, so we re-read it
 * from the spec to display `METHOD /path` alongside each derived capability.
 */
function buildMethodMap(spec: OpenAPISpecInput): Map<string, { method: string; path: string }> {
  const map = new Map<string, { method: string; path: string }>();
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, op] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const operationId = (op as { operationId?: unknown } | undefined)?.operationId;
      if (typeof operationId === "string" && operationId) {
        map.set(operationId, { method: method.toUpperCase(), path });
      }
    }
  }
  return map;
}

/**
 * Derive a directory provider (name, metadata, capability list) from an
 * already-parsed OpenAPI 3.x document. Uses the protocol's own
 * `createFromOpenAPI` so the capabilities match exactly what a real wrapper
 * would expose. Pure (no I/O), so it is unit-testable without network.
 */
export function deriveProviderFromSpec(
  spec: OpenAPISpecInput,
  specUrl: string,
): DerivedProvider | null {
  const specOrigin = safeOrigin(specUrl);
  let baseUrl = spec.servers?.[0]?.url?.trim() || specOrigin;
  if (baseUrl.startsWith("/") && specOrigin) baseUrl = specOrigin + baseUrl;
  if (!baseUrl) baseUrl = specUrl;

  const derived = createFromOpenAPI(spec, {
    baseUrl,
    approvalStrength: { ...APPROVAL_BY_METHOD },
  });

  const methodMap = buildMethodMap(spec);

  // Capability names from OpenAPI operationIds are normalized to the protocol's
  // snake_case rule ([a-z0-9_]+) and de-duplicated if any collide. The original
  // operationId (still on cap.name here) keys back to the spec's method + path.
  const seen = new Map<string, number>();
  const derivedCaps = (derived.capabilities ?? []) as Capability[];
  const capabilities = derivedCaps.map((cap) => {
    const meta = methodMap.get(cap.name);
    let normalized = toSnakeCase(cap.name) || "capability";
    const count = seen.get(normalized) ?? 0;
    seen.set(normalized, count + 1);
    if (count > 0) normalized = `${normalized}_${count + 1}`;
    return {
      ...cap,
      name: normalized,
      ...(meta ? { method: meta.method, path: meta.path } : {}),
    };
  });
  if (capabilities.length === 0) return null;

  const title = spec.info?.title?.trim() || hostFromUrl(specUrl) || "openapi-service";
  const name = slugify(title) || slugify(hostFromUrl(specUrl)) || "openapi-service";

  return {
    name,
    displayName: title,
    description: derived.providerDescription ?? spec.info?.description ?? "",
    issuer: baseUrl,
    baseUrl,
    version: spec.info?.version ?? "openapi",
    capabilities,
    openapiUrl: specUrl,
  };
}

/** Fetch an OpenAPI document by URL and derive a provider from it. */
export async function deriveProviderFromOpenAPI(specUrl: string): Promise<DerivedProvider | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let spec: OpenAPISpecInput;
  try {
    const res = await fetch(specUrl, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) return null;
    spec = (await res.json()) as OpenAPISpecInput;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!spec || typeof spec !== "object" || !spec.paths) return null;
  return deriveProviderFromSpec(spec, specUrl);
}
