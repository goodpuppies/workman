// Host operations for package recipes and the protocol modules they share with pakman.
//
// Embedded in the compiler as a data: module, so it must stay self-contained: only absolute
// imports. The manager's file system, store and build operations live in tooling/pakman/src/host.ts.
//
// Workman imports these without reflection, so operations that can fail take `ok` and `err`
// callbacks and return what one of them returns (a Result, built in Workman) instead of throwing.

type Settle<T, R> = [ok: (value: T) => R, err: (message: string) => R];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settle<T, R>(run: () => Promise<T>, [ok, err]: Settle<T, R>): Promise<R> {
  let value: T;
  try {
    value = await run();
  } catch (error) {
    return err(message(error));
  }
  return ok(value);
}

const userAgent = "pakman/0.1 (+https://github.com/goodpuppies)";

function headers(): HeadersInit {
  const token = Deno.env.get("GITHUB_TOKEN");
  return token
    ? { "User-Agent": userAgent, "Authorization": `Bearer ${token}` }
    : { "User-Agent": userAgent };
}

export function argv(): string[] {
  return Deno.args;
}

export function eprint(text: string): void {
  console.error(text);
}

export function exit(code: number): void {
  Deno.exit(code);
}

export function fetchText<R>(url: string, ...settled: Settle<string, R>): Promise<R> {
  return settle(async () => {
    const response = await fetch(url, { headers: headers() });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  }, settled);
}

/**
 * Follows redirects with a HEAD request. Returns [final URL, Last-Modified as
 * ISO-8601 or ""], for downloads whose version is only visible in where a
 * stable link redirects to.
 */
export function headInfo<R>(url: string, ...settled: Settle<string[], R>): Promise<R> {
  return settle(async () => {
    const response = await fetch(url, { method: "HEAD", redirect: "follow", headers: headers() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const modified = response.headers.get("last-modified");
    const ms = modified ? Date.parse(modified) : NaN;
    return [response.url, Number.isNaN(ms) ? "" : new Date(ms).toISOString()];
  }, settled);
}

/** Runs a command and returns its stdout. A non-zero exit fails with its stderr. */
export function runCapture<R>(
  cmd: string,
  args: string[],
  ...settled: Settle<string, R>
): Promise<R> {
  return settle(async () => {
    const { code, stdout, stderr } = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    if (code !== 0) {
      const message = decoder.decode(stderr).trim();
      throw new Error(message === "" ? `exited with ${code}` : message);
    }
    return decoder.decode(stdout);
  }, settled);
}

/** The full match followed by every capture group, or [] when nothing matches. */
export function captures(pattern: string, text: string): string[] {
  const match = text.match(new RegExp(pattern));
  return match ? Array.from(match, (part) => part ?? "") : [];
}

/** Every match of `pattern` in `text`, each as its captures (whole match first). */
export function capturesAll(pattern: string, text: string): string[][] {
  return Array.from(
    text.matchAll(new RegExp(pattern, "g")),
    (match) => Array.from(match, (part) => part ?? ""),
  );
}

/** -1, 0 or 1 by code-unit order (not locale order, so it is stable everywhere). */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The decimal integer in `text` (surrounding whitespace allowed), or `fallback`. */
export function parseIntOr(text: string, fallback: number): number {
  return /^\s*\d+\s*$/.test(text) ? Number.parseInt(text, 10) : fallback;
}

// Dynamic JSON, for documents a wm record can't describe (object keys that are
// data, such as version numbers, or names like "x86_64-linux").

/** The keys of a JSON object in document order, or [] for anything else. */
export function jsonKeys(value: unknown): string[] {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

/** Whether `value` is a JSON object with the field `key`. */
export function jsonHasField(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && key in value;
}

/** The field `key` of a JSON object; check it with `jsonHasField` first. */
export function jsonField(value: unknown, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

/** A JSON string value, or `fallback` for null, missing or non-string values. */
export function jsonTextOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
