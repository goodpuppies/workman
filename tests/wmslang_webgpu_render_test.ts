/// <reference types="@webgpu/types" />

import { assertEquals } from "@std/assert";
import { coreVirtual } from "../src/compiler.ts";
import type { VisualShaderDescriptorV1 } from "../src/gpu_artifact.ts";
import { renderVisualShaderV1 } from "../src/wmslang/webgpu_render.ts";

const webGpuUnavailable = !navigator.gpu;

Deno.test({
  name: "visual-v1 renders the flat-color artifact as opaque red",
  ignore: webGpuUnavailable,
  async fn() {
    const artifact = await compileAcceptanceArtifact("flat_color.wm");
    const pixels = await renderVisualShaderV1(artifact, 16, 16);

    assertEquals(pixels.length, 16 * 16 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      assertEquals([...pixels.subarray(offset, offset + 4)], [255, 0, 0, 255]);
    }
  },
});

Deno.test({
  name: "visual-v1 renders stable Mandelbrot probes from the f32 CPU oracle",
  ignore: webGpuUnavailable,
  async fn() {
    const artifact = await compileAcceptanceArtifact("static_mandelbrot.wm");
    const pixels = await renderVisualShaderV1(artifact, 64, 64);
    const probes = [
      { x: 43, y: 31, classification: "interior" },
      { x: 44, y: 32, classification: "interior" },
      { x: 2, y: 2, classification: "exterior" },
      { x: 61, y: 2, classification: "exterior" },
      { x: 2, y: 61, classification: "exterior" },
      { x: 61, y: 61, classification: "exterior" },
    ] as const;

    for (const probe of probes) {
      assertProbeHasClassificationMargin(probe.x, probe.y, probe.classification);
      const expected = oracleRgba(probe.x, probe.y);
      const offset = (probe.y * 64 + probe.x) * 4;
      const actual = [...pixels.subarray(offset, offset + 4)];
      assertRgbaNear(actual, expected, 1, `${probe.classification} probe (${probe.x}, ${probe.y})`);
    }
  },
});

Deno.test({
  name: "visual-v2 renders a reflected curried uniform environment",
  ignore: webGpuUnavailable,
  async fn() {
    const source = `
      record Uniforms = { color: (Number, Number, Number, Number) };
      let shade = (uniforms: Uniforms) => {
        (_coord) => {
          @gpu;
          uniforms.color
        }
      };
      let current: Uniforms = .{ color = (1.0, 0.0, 0.0, 1.0) };
      let fragment = Gpu.fragment(shade(current));
    `;
    const compiled = await coreVirtual(
      "/test/main.wm",
      new Map([["/test/main.wm", source]]),
    );
    const artifact = [...compiled.core.shaderArtifacts.values()][0];
    assertEquals(artifact.uniformLayout?.byteLength, 16);
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    [1, 0, 0, 1].forEach((value, index) => view.setFloat32(index * 4, value, true));

    const pixels = await renderVisualShaderV1(artifact, 16, 16, bytes);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      assertEquals([...pixels.subarray(offset, offset + 4)], [255, 0, 0, 255]);
    }
  },
});

async function compileAcceptanceArtifact(name: string): Promise<VisualShaderDescriptorV1> {
  const compiled = await coreVirtual(
    "/test/main.wm",
    new Map([["/test/main.wm", await acceptanceBlock(name)]]),
  );
  const artifacts = [...compiled.core.shaderArtifacts.values()];
  assertEquals(artifacts.length, 1);
  return artifacts[0];
}

function assertProbeHasClassificationMargin(
  x: number,
  y: number,
  classification: "interior" | "exterior",
): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      assertEquals(
        oracleEscapeRemaining(x + dx, y + dy) === 0 ? "interior" : "exterior",
        classification,
        `probe (${x}, ${y}) lacks a 3x3 ${classification} margin`,
      );
    }
  }
}

function oracleRgba(x: number, y: number): number[] {
  const remaining = oracleEscapeRemaining(x, y);
  if (remaining === 0) return [0, 0, 0, 255];
  const amount = Math.fround(remaining / 96);
  return [
    unorm8(amount),
    unorm8(Math.fround(Math.fround(0.25) * amount)),
    unorm8(Math.fround(1 - amount)),
    255,
  ];
}

function oracleEscapeRemaining(pixelX: number, pixelY: number): number {
  const x = Math.fround(pixelX + 0.5);
  const y = Math.fround(pixelY + 0.5);
  const cx = Math.fround(
    Math.fround(Math.fround(Math.fround(2) * x) - Math.fround(64)) / Math.fround(48) -
      Math.fround(0.5),
  );
  const cy = Math.fround(
    Math.fround(Math.fround(Math.fround(2) * y) - Math.fround(64)) / Math.fround(48),
  );
  let zx = Math.fround(0);
  let zy = Math.fround(0);
  let remaining = 96;
  while (remaining > 0) {
    const zxSquared = Math.fround(zx * zx);
    const zySquared = Math.fround(zy * zy);
    if (Math.fround(zxSquared + zySquared) > Math.fround(4)) return remaining;
    const nextX = Math.fround(Math.fround(zxSquared - zySquared) + cx);
    const nextY = Math.fround(
      Math.fround(Math.fround(Math.fround(2) * zx) * zy) + cy,
    );
    zx = nextX;
    zy = nextY;
    remaining--;
  }
  return 0;
}

function unorm8(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function assertRgbaNear(
  actual: number[],
  expected: number[],
  tolerance: number,
  label: string,
): void {
  assertEquals(actual.length, 4);
  for (let channel = 0; channel < 4; channel++) {
    if (Math.abs(actual[channel] - expected[channel]) > tolerance) {
      throw new Error(
        `${label}: channel ${channel} expected ${expected[channel]} ± ${tolerance}, got ${
          actual[channel]
        }`,
      );
    }
  }
}

async function acceptanceBlock(name: string): Promise<string> {
  const markdown = await Deno.readTextFile(
    new URL("../markdown/wmslang/v1-acceptance.md", import.meta.url),
  );
  const heading = `\`${name}\``;
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`missing acceptance heading containing ${heading}`);
  const fenced = markdown.indexOf("```workman\n", start);
  const end = markdown.indexOf("```", fenced + 11);
  if (fenced < 0 || end < 0) throw new Error(`missing Workman block for ${name}`);
  return markdown.slice(fenced + 11, end);
}
