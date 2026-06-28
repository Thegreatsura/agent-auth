/**
 * Backfill `provider.capabilities` for existing `agent-auth` providers.
 *
 * The directory only derived capabilities for `openapi` submissions; rows added
 * via Agent Auth discovery were stored with `capabilities = null` because the
 * discovery document only advertises a capabilities *endpoint*, not the list.
 * This re-fetches each provider's `endpoints.capabilities` (§6.2) and fills the
 * column, matching what `lib/discover.ts#fetchProviderCapabilities` now does at
 * submit time.
 *
 * Usage (reads DATABASE_URL from env):
 *   node scripts/backfill-capabilities.mjs            # dry run (no writes)
 *   node scripts/backfill-capabilities.mjs --apply    # persist updates
 *
 * No auth is sent, so only publicly-listed capabilities are captured; providers
 * with `requireAuthForCapabilities` return 401 and are left untouched.
 */
import postgres from "postgres";

const DRY_RUN = !process.argv.includes("--apply");
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const CAPABILITY_PAGE_SIZE = 100;
const MAX_CAPABILITIES = 1000;
const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

// Mirror lib/discover.ts: join relative endpoint paths onto the absolute issuer
// by concatenation (a leading-slash path via `new URL()` would drop /api/auth).
function resolveEndpoint(issuer, endpoint) {
  if (!endpoint) return null;
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const base = (issuer ?? "").replace(/\/+$/, "");
  if (!base) return null;
  return `${base}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
}

async function fetchProviderCapabilities(capabilitiesUrl) {
  const collected = [];
  let cursor;
  const maxPages = Math.ceil(MAX_CAPABILITIES / CAPABILITY_PAGE_SIZE);

  try {
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(capabilitiesUrl);
      url.searchParams.set("limit", String(CAPABILITY_PAGE_SIZE));
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetchWithTimeout(url.toString());
      if (!res.ok) {
        console.warn(`    fetch ${url.toString()} -> HTTP ${res.status}`);
        break;
      }

      const body = await res.json();
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
  } catch (err) {
    console.warn(`    fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return collected.length > 0 ? collected : null;
  }

  return collected.length > 0 ? collected : null;
}

const sql = postgres(DATABASE_URL);

try {
  const rows = await sql`
    select id, name, issuer, endpoints, capabilities
    from provider
    where source_type = 'agent-auth'
    order by name
  `;

  console.log(`Found ${rows.length} agent-auth provider(s).\n`);

  let updated = 0;
  for (const row of rows) {
    let endpoints = {};
    try {
      endpoints = JSON.parse(row.endpoints ?? "{}");
    } catch {}

    const had = Array.isArray(row.capabilities)
      ? row.capabilities.length
      : row.capabilities
        ? "?"
        : 0;
    const capabilitiesUrl = resolveEndpoint(row.issuer, endpoints.capabilities);

    if (!capabilitiesUrl) {
      console.log(`- ${row.name}: no capabilities endpoint advertised; skip (had ${had})`);
      continue;
    }

    const caps = await fetchProviderCapabilities(capabilitiesUrl);
    if (!caps || caps.length === 0) {
      console.log(`- ${row.name}: fetched 0 capabilities; skip (had ${had})`);
      continue;
    }

    console.log(`- ${row.name}: ${caps.length} capabilities (had ${had})`);
    console.log(
      `    sample: ${caps
        .slice(0, 5)
        .map((c) => c.name)
        .join(", ")}${caps.length > 5 ? ", …" : ""}`,
    );

    if (!DRY_RUN) {
      const now = new Date().toISOString();
      await sql`
        update provider
        set capabilities = ${sql.json(caps)}, last_checked_at = ${now}, updated_at = ${now}
        where id = ${row.id}
      `;
      updated++;
    }
  }

  console.log(
    `\n${DRY_RUN ? "DRY RUN — no writes. Re-run with --apply to persist." : `Applied: updated ${updated} provider(s).`}`,
  );
} finally {
  await sql.end();
}
