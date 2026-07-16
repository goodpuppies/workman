/// <reference types="@webgpu/types" />

import type { VisualShaderDescriptorV1 } from "../gpu_artifact.ts";

export class WmslangWebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WmslangWebGpuUnavailableError";
  }
}

export async function renderVisualShaderV1(
  artifact: VisualShaderDescriptorV1,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("visual-v1 render dimensions must be positive integers");
  }
  if (!navigator.gpu) {
    throw new WmslangWebGpuUnavailableError("this runtime does not expose WebGPU");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new WmslangWebGpuUnavailableError("no WebGPU adapter is available");
  const device = await adapter.requestDevice();

  const module = device.createShaderModule({ code: artifact.wgsl });
  const compilation = await module.getCompilationInfo();
  const shaderErrors = compilation.messages.filter((message) => message.type === "error");
  if (shaderErrors.length !== 0) {
    throw new Error(
      shaderErrors.map((message) =>
        `WGSL ${message.lineNum}:${message.linePos}: ${message.message}`
      ).join("\n"),
    );
  }
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: artifact.vertexEntry },
    fragment: {
      module,
      entryPoint: artifact.fragmentEntry,
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  const texture = device.createTexture({
    size: { width, height },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readback = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  try {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setViewport(0, 0, width, height, 0, 1);
    pass.setScissorRect(0, 0, width, height);
    pass.draw(3, 1, 0, 0);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readback, bytesPerRow, rowsPerImage: height },
      { width, height },
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readback.getMappedRange());
    const pixels = new Uint8Array(unpaddedBytesPerRow * height);
    for (let row = 0; row < height; row++) {
      pixels.set(
        padded.subarray(row * bytesPerRow, row * bytesPerRow + unpaddedBytesPerRow),
        row * unpaddedBytesPerRow,
      );
    }
    return pixels;
  } finally {
    if (readback.mapState === "mapped") readback.unmap();
    readback.destroy();
    texture.destroy();
    device.destroy();
  }
}
