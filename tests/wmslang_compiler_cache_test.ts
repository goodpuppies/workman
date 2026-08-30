import { assertEquals } from "@std/assert";
import { loadCachedWmslangCompiler } from "../src/wmslang/compiler_cache.ts";

Deno.test("wmslang compiler cache reuses a validated generated module", async () => {
  const identity = crypto.randomUUID();
  const cacheName = `workman-wmslang-test-${identity}`;
  const source = `
    export const compileGpuSlice = (input) => input;
    export const elaborateGpuSliceTypes = (input) => input;
  `;
  let builds = 0;
  const load = () =>
    loadCachedWmslangCompiler({
      identity,
      cacheName,
      build: async () => {
        builds += 1;
        return source;
      },
    });

  try {
    await load();
    await load();
    assertEquals(builds, 1);
  } finally {
    await caches.delete(cacheName);
  }
});

Deno.test("wmslang compiler cache discards an invalid cached module", async () => {
  const identity = crypto.randomUUID();
  const cacheName = `workman-wmslang-test-${identity}`;
  const key = `https://wmslang-compiler-cache.workman.invalid/v1/${identity}.mjs`;
  const cache = await caches.open(cacheName);
  await cache.put(key, new Response("export const broken = true;"));
  let builds = 0;

  try {
    await loadCachedWmslangCompiler({
      identity,
      cacheName,
      build: async () => {
        builds += 1;
        return `
          export const compileGpuSlice = (input) => input;
          export const elaborateGpuSliceTypes = (input) => input;
        `;
      },
    });
    assertEquals(builds, 1);
  } finally {
    await caches.delete(cacheName);
  }
});
