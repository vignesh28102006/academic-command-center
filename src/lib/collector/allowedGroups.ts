/**
 * Canonical configuration of allowed WhatsApp groups for Academic Command Center.
 * 
 * Strict Privacy & Relevance Rule:
 * Only messages originating from these explicitly configured academic groups are
 * processed by the collector, AI parser, Supabase, and Notion.
 * All other groups (e.g., embedded-project groups, personal groups, casual groups)
 * must be completely ignored.
 */

export const ALLOWED_ACADEMIC_GROUPS: readonly string[] = [
  "Machine Learning CSE-C",
  "Computer Networks CSE-C",
  "TOC 23CSE303 - CSE-C",
  "NLP 2026 batch",
  "CSE-C Announcements",
  "23CSE351 FoDS G1"
];

/**
 * Normalizes a WhatsApp group name for exact matching:
 * - Unicode NFKC normalization
 * - Trims leading and trailing whitespace
 * - Collapses repeated internal whitespace to a single space
 * - Lowercases for case-insensitive matching
 */
export function normalizeGroupName(name?: string | null): string {
  if (!name || typeof name !== "string") return "";
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const ALLOWED_NORMALIZED_SET = new Set<string>(
  ALLOWED_ACADEMIC_GROUPS.map(g => normalizeGroupName(g))
);

/**
 * Validates whether a given group name is in the configured allowlist.
 * Uses strict normalized exact matching.
 * Substring matching (e.g. includes("CSE-C")) is strictly forbidden.
 */
export function isGroupAllowed(groupName?: string | null): boolean {
  if (!groupName) return false;
  const normalized = normalizeGroupName(groupName);
  return ALLOWED_NORMALIZED_SET.has(normalized);
}

/**
 * Returns the canonical title for an allowed group, or null if disallowed.
 */
export function getCanonicalGroupName(groupName?: string | null): string | null {
  if (!groupName) return null;
  const normalized = normalizeGroupName(groupName);
  const found = ALLOWED_ACADEMIC_GROUPS.find(g => normalizeGroupName(g) === normalized);
  return found || null;
}
