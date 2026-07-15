const webGpuMarkers = [
  "Deno.UnsafeWindowSurface",
  "GPUBufferUsage",
  "GPUShaderStage",
  "requestAdapter",
];

export function runtimeFlagsForJavaScript(js: string): string[] {
  return webGpuMarkers.some((marker) => js.includes(marker)) ? ["--unstable-webgpu"] : [];
}
