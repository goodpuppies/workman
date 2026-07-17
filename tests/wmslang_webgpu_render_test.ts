/// <reference types="@webgpu/types" />

import { assertEquals } from "@std/assert";
import { coreFile, coreVirtual } from "../src/compiler.ts";
import type { VisualShaderArtifactV1, VisualShaderDescriptorV1 } from "../src/gpu_artifact.ts";
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
  name: "visual-v3 renders the warped-noise acceptance shader",
  ignore: webGpuUnavailable,
  async fn() {
    const artifact = await compileExampleArtifact("warped_noise_shader.wm");
    const pixels = await renderVisualShaderV1(
      artifact,
      64,
      64,
      packUniforms(artifact, {
        resolution: [64, 64],
        time: 1200,
      }),
    );
    assertOpaqueVaryingImage(pixels, "warped noise");
  },
});

Deno.test({
  name: "visual-v3 renders the recursive raymarcher acceptance shader",
  ignore: webGpuUnavailable,
  async fn() {
    const artifact = await compileExampleArtifact("raymarch_shader.wm");
    const pixels = await renderVisualShaderV1(
      artifact,
      64,
      64,
      packUniforms(artifact, {
        resolution: [64, 64],
        time: 800,
        cameraRotation: [0.15, -0.1],
      }),
    );
    assertOpaqueVaryingImage(pixels, "raymarcher");
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

Deno.test({
  name: "visual-v5 executes sampled-texture update and display passes with ping-pong feedback",
  ignore: webGpuUnavailable,
  async fn() {
    const path = new URL("../examples/wmslang_feedback_window/main.wm", import.meta.url).pathname;
    const compiled = await coreFile(path);
    const artifacts = [...compiled.core.shaderArtifacts.values()];
    const update = artifacts.find((artifact) =>
      artifact.resourceLayout?.bindings.some((binding) => binding.name === "previous")
    )!;
    const display = artifacts.find((artifact) =>
      artifact.resourceLayout?.bindings.some((binding) => binding.name === "image")
    )!;
    assertEquals(Boolean(update), true);
    assertEquals(Boolean(display), true);

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapter unavailable after navigator.gpu probe");
    const device = await adapter.requestDevice();
    device.pushErrorScope("validation");
    const updateModule = device.createShaderModule({ code: update.wgsl });
    const displayModule = device.createShaderModule({ code: display.wgsl });
    const updatePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: updateModule, entryPoint: update.vertexEntry },
      fragment: {
        module: updateModule,
        entryPoint: update.fragmentEntry,
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const displayPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: displayModule, entryPoint: display.vertexEntry },
      fragment: {
        module: displayModule,
        entryPoint: display.fragmentEntry,
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const width = 32;
    const height = 32;
    const makeStateTexture = () =>
      device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
    const state = [makeStateTexture(), makeStateTexture()];
    const output = device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const sampler = device.createSampler({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "nearest",
      minFilter: "nearest",
    });
    const updateUniform = device.createBuffer({
      size: update.uniformLayout!.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const displayUniform = device.createBuffer({
      size: display.uniformLayout!.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      displayUniform,
      0,
      packUniforms(display, { resolution: [width, height] }).slice().buffer,
    );
    const initial = device.createCommandEncoder();
    for (const texture of state) {
      const pass = initial.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.end();
    }
    device.queue.submit([initial.finish()]);

    let read = 0;
    for (let frame = 0; frame < 3; frame++) {
      const write = 1 - read;
      device.queue.writeBuffer(
        updateUniform,
        0,
        packUniforms(update, { frame }).slice().buffer,
      );
      const updateGroup = device.createBindGroup({
        layout: updatePipeline.getBindGroupLayout(0),
        entries: [
          { binding: update.uniformLayout!.binding, resource: { buffer: updateUniform } },
          { binding: resourceBinding(update, "previous"), resource: state[read].createView() },
        ],
      });
      const displayGroup = device.createBindGroup({
        layout: displayPipeline.getBindGroupLayout(0),
        entries: [
          { binding: display.uniformLayout!.binding, resource: { buffer: displayUniform } },
          { binding: resourceBinding(display, "image"), resource: state[write].createView() },
          { binding: resourceBinding(display, "sampler"), resource: sampler },
        ],
      });
      const encoder = device.createCommandEncoder();
      const updatePass = encoder.beginRenderPass({
        colorAttachments: [{
          view: state[write].createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      updatePass.setPipeline(updatePipeline);
      updatePass.setBindGroup(0, updateGroup);
      updatePass.draw(3);
      updatePass.end();
      const displayPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: output.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      displayPass.setPipeline(displayPipeline);
      displayPass.setBindGroup(0, displayGroup);
      displayPass.draw(3);
      displayPass.end();
      device.queue.submit([encoder.finish()]);
      read = write;
    }
    await device.queue.onSubmittedWorkDone();
    const validationError = await device.popErrorScope();
    if (validationError) throw new Error(`WebGPU feedback validation: ${validationError.message}`);

    const bytesPerRow = 256;
    const readback = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const copy = device.createCommandEncoder();
    copy.copyTextureToBuffer(
      { texture: output },
      { buffer: readback, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    device.queue.submit([copy.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readback.getMappedRange());
    const colors = new Set<string>();
    let opaquePixels = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * bytesPerRow + x * 4;
        if (padded[offset + 3] === 255) {
          opaquePixels += 1;
          colors.add(`${padded[offset]},${padded[offset + 1]},${padded[offset + 2]}`);
        }
      }
    }
    assertEquals(opaquePixels, width * height);
    assertEquals(colors.size >= 2, true, `feedback colors: ${[...colors].join(" | ")}`);
    readback.unmap();
    readback.destroy();
    updateUniform.destroy();
    displayUniform.destroy();
    output.destroy();
    state.forEach((texture) => texture.destroy());
    device.destroy();
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

async function compileExampleArtifact(name: string): Promise<VisualShaderArtifactV1> {
  const path = new URL(`../examples/wmslang_window/src/${name}`, import.meta.url).pathname;
  const compiled = await coreFile(path);
  const artifacts = [...compiled.core.shaderArtifacts.values()];
  assertEquals(artifacts.length, 1);
  return artifacts[0];
}

function packUniforms(
  artifact: VisualShaderArtifactV1,
  values: Record<string, number | number[]>,
): Uint8Array {
  const layout = artifact.uniformLayout;
  if (!layout) throw new Error("acceptance shader has no reflected uniform layout");
  const bytes = new Uint8Array(layout.byteLength);
  const view = new DataView(bytes.buffer);
  for (const field of layout.fields) {
    const supplied = values[field.name];
    if (supplied === undefined) throw new Error(`missing acceptance uniform ${field.name}`);
    const components = typeof supplied === "number" ? [supplied] : supplied;
    const width = field.representation.includes("x") ? Number(field.representation.at(-1)) : 1;
    assertEquals(components.length, width, `uniform ${field.name} width`);
    components.forEach((value, index) => {
      if (field.representation.startsWith("i32")) {
        view.setInt32(field.offset + index * 4, value, true);
      } else {
        view.setFloat32(field.offset + index * 4, value, true);
      }
    });
  }
  assertEquals(Object.keys(values).sort(), layout.fields.map((field) => field.name).sort());
  return bytes;
}

function resourceBinding(artifact: VisualShaderArtifactV1, name: string): number {
  const binding = artifact.resourceLayout?.bindings.find((item) => item.name === name);
  if (!binding) throw new Error(`missing resource binding ${name}`);
  return binding.binding;
}

function assertOpaqueVaryingImage(pixels: Uint8Array, label: string): void {
  const colors = new Set<string>();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const rgba = pixels.subarray(offset, offset + 4);
    assertEquals(rgba[3], 255, `${label} alpha at pixel ${offset / 4}`);
    colors.add(`${rgba[0]},${rgba[1]},${rgba[2]}`);
  }
  if (colors.size < 8) {
    throw new Error(`${label} produced only ${colors.size} distinct RGB colors`);
  }
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
