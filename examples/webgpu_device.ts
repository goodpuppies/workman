export interface WmGpuBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

export interface WmGpuBindGroupLayout {}
export interface WmGpuPipelineLayout {}
export interface WmGpuShaderModule {}
export interface WmGpuComputePipeline {
  getBindGroupLayout(index: number): WmGpuBindGroupLayout;
}
export interface WmGpuBindGroup {}

export interface WmGpuComputePass {
  setPipeline(pipeline: WmGpuComputePipeline): void;
  setBindGroup(index: number, bindGroup: WmGpuBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface WmGpuCommandBuffer {}

export interface WmGpuCommandEncoder {
  beginComputePass(): WmGpuComputePass;
  copyBufferToBuffer(
    source: WmGpuBuffer,
    sourceOffset: number,
    destination: WmGpuBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): WmGpuCommandBuffer;
}

export interface WmGpuQueue {
  submit(commands: WmGpuCommandBuffer[]): void;
}

export interface WmGpuDevice {
  readonly queue: WmGpuQueue;
  createBuffer(descriptor: unknown): WmGpuBuffer;
  createBindGroupLayout(descriptor: unknown): WmGpuBindGroupLayout;
  createPipelineLayout(descriptor: unknown): WmGpuPipelineLayout;
  createShaderModule(descriptor: unknown): WmGpuShaderModule;
  createComputePipeline(descriptor: unknown): WmGpuComputePipeline;
  createBindGroup(descriptor: unknown): WmGpuBindGroup;
  createCommandEncoder(): WmGpuCommandEncoder;
}

// Keep the nullable adapter edge in TypeScript until Workman's delayed FFI elaboration preserves
// GPUAdapter receiver evidence through Option inside Task callbacks. The actual GPU orchestration
// remains in webgpu_compute.wm.
export async function getWebGpuDevice(): Promise<WmGpuDevice> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("navigator.gpu found no suitable adapter");
  return await adapter.requestDevice() as unknown as WmGpuDevice;
}

// Narrow method bridges preserve the nominal WebGPU receiver types across Workman's current
// carrier-heavy FFI elaboration. They contain no pipeline policy; the .wm file still owns every
// descriptor and operation ordering.
export const createBuffer = (device: WmGpuDevice, descriptor: unknown) =>
  device.createBuffer(descriptor);
export const createBindGroupLayout = (device: WmGpuDevice, descriptor: unknown) =>
  device.createBindGroupLayout(descriptor);
export const createPipelineLayout = (device: WmGpuDevice, descriptor: unknown) =>
  device.createPipelineLayout(descriptor);
export const createShaderModule = (device: WmGpuDevice, descriptor: unknown) =>
  device.createShaderModule(descriptor);
export const createComputePipeline = (device: WmGpuDevice, descriptor: unknown) =>
  device.createComputePipeline(descriptor);
export const getBindGroupLayout = (pipeline: WmGpuComputePipeline, index: number) =>
  pipeline.getBindGroupLayout(index);
export const createBindGroup = (device: WmGpuDevice, descriptor: unknown) =>
  device.createBindGroup(descriptor);
export const createCommandEncoder = (device: WmGpuDevice) => device.createCommandEncoder();
export const beginComputePass = (encoder: WmGpuCommandEncoder) => encoder.beginComputePass();
export const setPipeline = (pass: WmGpuComputePass, pipeline: WmGpuComputePipeline) =>
  pass.setPipeline(pipeline);
export const setBindGroup = (pass: WmGpuComputePass, bindGroup: WmGpuBindGroup) =>
  pass.setBindGroup(0, bindGroup);
export const dispatchOneWorkgroup = (pass: WmGpuComputePass) => pass.dispatchWorkgroups(1, 1);
export const endComputePass = (pass: WmGpuComputePass) => pass.end();
export const copyBuffer = (
  encoder: WmGpuCommandEncoder,
  source: WmGpuBuffer,
  destination: WmGpuBuffer,
  size: number,
) => encoder.copyBufferToBuffer(source, 0, destination, 0, size);
export const finishCommands = (encoder: WmGpuCommandEncoder) => encoder.finish();
export const submitCommands = (device: WmGpuDevice, command: WmGpuCommandBuffer) =>
  device.queue.submit([command]);
export const mapBuffer = (buffer: WmGpuBuffer, mode: number) => buffer.mapAsync(mode);
export function readFirstUint32(buffer: WmGpuBuffer): number {
  const words = new Uint32Array(buffer.getMappedRange());
  const first = words.at(0) ?? 0;
  buffer.unmap();
  return first;
}
