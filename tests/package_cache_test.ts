import { assertEquals, assertRejects } from "@std/assert";
import { cacheJsrPackage } from "../src/package_cache.ts";

const moduleUrl = new URL("https://jsr.io/@example/compiler/1.2.3/src/pakman.ts");
async function fixture(extra: Record<string, string> = {}) {
  const files = {
    "/deno.json": "{}",
    "/src/cli.ts": "// cli",
    "/tooling/pakman/pakman.wm": "// pakman",
    ...extra,
  };
  const manifest: Record<string, { size: number; checksum: string }> = {};
  for (const [path, text] of Object.entries(files)) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    manifest[path] = {
      size: bytes.length,
      checksum: "sha256-" +
        Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
  }
  const requested: string[] = [];
  const request = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("_meta.json")) return Response.json({ manifest });
    const path = decodeURIComponent(new URL(url).pathname).replace("/@example/compiler/1.2.3", "");
    const text = files[path as keyof typeof files];
    return text === undefined ? new Response("missing", { status: 404 }) : new Response(text);
  }) as typeof fetch;
  return { files, manifest, requested, request };
}

Deno.test("JSR source cache preserves versioned resources and avoids downloads on reuse", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const f = await fixture({
      "/src/resource with spaces.wm": "let value = 42;",
      "/std/other.wm": "other",
    });
    const root = await cacheJsrPackage(moduleUrl, dir, f.request);
    assertEquals(await Deno.readTextFile(`${root}/src/resource with spaces.wm`), "let value = 42;");
    assertEquals(await Deno.readTextFile(`${root}/std/other.wm`), "other");
    const before = f.requested.length;
    assertEquals(await cacheJsrPackage(moduleUrl, dir, f.request), root);
    assertEquals(f.requested.length, before);
    assertEquals(f.requested[0], "https://jsr.io/@example/compiler/1.2.3_meta.json");
    assertEquals((await Array.fromAsync(Deno.readDir(`${dir}/packages`))).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("JSR source cache rejects unsafe paths and corrupt downloads before publishing a cache", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const f = await fixture();
    f.manifest["/../escape"] = f.manifest["/src/cli.ts"];
    await assertRejects(
      () => cacheJsrPackage(moduleUrl, dir, f.request),
      Error,
      "invalid JSR package entry",
    );
    assertEquals(f.requested.length, 1);
    delete f.manifest["/../escape"];
    f.manifest["/src/cli.ts"].checksum = "sha256-" + "0".repeat(64);
    await assertRejects(
      () => cacheJsrPackage(moduleUrl, dir, f.request),
      Error,
      "checksum mismatch",
    );
    assertEquals(await Array.fromAsync(Deno.readDir(`${dir}/packages`)), []);
    await assertRejects(
      () => cacheJsrPackage(new URL("https://other.test/src/pakman.ts"), dir, f.request),
      Error,
      "cannot locate",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("JSR source cache supports concurrent invocations of the same version", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const f = await fixture();
    const [left, right] = await Promise.all([
      cacheJsrPackage(moduleUrl, dir, f.request),
      cacheJsrPackage(moduleUrl, dir, f.request),
    ]);
    assertEquals(left, right);
    assertEquals(await Deno.readTextFile(`${left}/src/cli.ts`), "// cli");
    assertEquals((await Array.fromAsync(Deno.readDir(`${dir}/packages`))).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
