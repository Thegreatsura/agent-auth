import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { provider } from "@/lib/db/schema";
import type { ProviderConfig } from "@/lib/discover";
import { rankByIntent } from "@/lib/intent-search";
import { safeJsonParse } from "@/lib/utils";

export type ProviderSearchResult = ProviderConfig & {
  display_name: string;
  url: string;
  categories: string[];
  verified: boolean;
};

export async function searchProvidersByIntent(
  intent: string,
  limit = 10,
): Promise<ProviderSearchResult[]> {
  const clamped = Math.min(50, Math.max(1, limit));

  const rows = await db
    .select()
    .from(provider)
    .where(and(eq(provider.status, "active"), eq(provider.public, true)));

  const searchable = rows.map((row) => ({
    ...row,
    displayName: row.displayName,
    categories: safeJsonParse<string[]>(row.categories, []),
  }));

  const ranked = await rankByIntent(searchable, intent);

  return ranked.slice(0, clamped).map((row) => ({
    version: row.version,
    provider_name: row.name,
    description: row.description,
    issuer: row.issuer,
    algorithms: safeJsonParse<string[]>(row.algorithms, []),
    modes: safeJsonParse<string[]>(row.modes, []),
    approval_methods: safeJsonParse<string[]>(row.approvalMethods, []),
    endpoints: safeJsonParse<Record<string, string>>(row.endpoints, {}),
    jwks_uri: row.jwksUri ?? undefined,
    display_name: row.displayName,
    url: row.url,
    categories: row.categories,
    verified: row.verified,
  }));
}
