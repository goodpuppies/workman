# Inline WebGPU example

There are now two versions of the same small compute/readback program:

- [`../../examples/webgpu_compute.wm`](../../examples/webgpu_compute.wm) is current, runnable
  Workman. It owns the WebGPU descriptors, buffers, pipeline, command encoding, dispatch, carrier
  flow, and readback, while its shader is still a WGSL string.
- [`inline-webgpu-example.wm`](./inline-webgpu-example.wm) is future illustrative wmslang. It keeps
  the host program in Workman and replaces only that string with an inline `@gpu` function.

The example intentionally uses compute rather than inventing a Shadertoy API. It demonstrates the
more general boundary:

```text
raw GPUBuffer
  -> Gpu.buffer(raw, Gpu.u32, Gpu.readWrite)
  -> captured by an inferred @gpu function
  -> Gpu.compute(workgroupSize, function)
  -> generated WGSL plus reflected artifact metadata
  -> ordinary WebGPU pipeline and bind-group construction
```

The important type inference is inside the shader. `id` receives the compute builtin type from the
stage constructor; `(x, y, _)` therefore contains unsigned integers. The buffer evidence makes the
large packed color an unsigned value and constrains `Gpu.write`. Neither `uvec3`, `uint`, a WGSL
binding declaration, nor a manually typed function signature appears in source.

`Gpu.buffer`, `Gpu.write`, `Gpu.binding`, `Gpu.wgsl`, and `Gpu.entryPoint` are illustrative names.
They specify required roles, not a frozen spelling for the eventual basis. In particular,
`Gpu.binding(program, typedOutput)` represents lookup by compiler-known resource identity rather than
string-based field magic.

## Current narrow TypeScript bridge

[`../../examples/webgpu_device.ts`](../../examples/webgpu_device.ts) is intentionally mechanical.
It acquires the nullable adapter and exposes narrow WebGPU method bridges, while the `.wm` file owns
the actual program. This is needed because current delayed FFI elaboration loses nominal receiver
evidence for `GPUAdapter` inside `Task<Option<GPUAdapter>, _>` callbacks and for deeply carrierized
receiver helpers. It is not part of the proposed wmslang runtime design.

Once that FFI limitation is fixed, the host example can call the reflected WebGPU receivers
directly. The wmslang boundary remains the same: raw resources require static element/access
evidence, and dynamic resource objects are attached to an already compiled artifact rather than
causing runtime shader compilation.
