import { assertEquals } from "@std/assert";
import { runtimeFlagsForJavaScript } from "../src/runtime_flags.ts";

Deno.test("enables Deno WebGPU for direct and surface-backed programs", () => {
  assertEquals(runtimeFlagsForJavaScript('gpu["requestAdapter"]()'), ["--unstable-webgpu"]);
  assertEquals(runtimeFlagsForJavaScript("new Deno.UnsafeWindowSurface({})"), [
    "--unstable-webgpu",
  ]);
  assertEquals(runtimeFlagsForJavaScript('console.log("ordinary program")'), []);
});
