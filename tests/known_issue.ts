import { fileURLToPath } from "node:url";

/**
 * Marks a test as a known issue linked to `markdown/issues/<slug>.md`. Pass the result as `ignore`.
 *
 * Known-issue tests assert the correct behavior, so they fail until the issue is fixed and stay
 * ignored in the normal run. To see which are still failing, and to catch one that has been fixed:
 *
 *   WM_KNOWN_ISSUES=1 deno task test:known-issues
 *
 * A link to a missing issue file fails at load time, so renaming or removing an issue can't leave a
 * test pointing nowhere.
 */
export function knownIssue(slug: string): boolean {
  Deno.statSync(fileURLToPath(new URL(`../markdown/issues/${slug}.md`, import.meta.url)));
  return Deno.env.get("WM_KNOWN_ISSUES") !== "1";
}
