# Slang WASM bindings

The generated JavaScript and TypeScript bindings are taken from the official Slang `v2026.13.1` WASM
release for the wmslang visual-v1 compiler backend:

| File              | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `slang-wasm.js`   | `60fe8b4234d73d67c69d798d6deddb820c594a7f130b913b673f2d9c66b769ab` |
| `slang-wasm.d.ts` | `1ddd692dcdbddd20833ebc252ad5cdf8b17f2dcb8b34b7480a3d5876beec97d8` |

The 22.7 MB WASM binary is deliberately not vendored. At first use, `slang_backend.ts` downloads the
pinned official
[`slang-2026.13.1-wasm.zip`](https://github.com/shader-slang/slang/releases/download/v2026.13.1/slang-2026.13.1-wasm.zip),
stores it in Deno's persistent Cache Storage, verifies archive SHA-256
`ff5c1a83ddfaf9a86cfbe81580ca9694e0a3ded4158722549a24a57cf6f03255`, extracts the first
`slang-wasm.wasm` entry in memory, and verifies binary SHA-256
`90661b3cf23fdf3e3f6daa07b14fd5e4f6f300ad703aa7b23ddc4579279a2fb5`. Later Workman processes reuse
the cached archive without network access. A corrupt cache entry is discarded and downloaded again.

The runtime reports Slang version `2026.13.1` and compile targets `GLSL`, `HLSL`, `WGSL`, `SPIRV`,
`METAL`, and `CUDA`. Visual v1 uses only `WGSL`.

The JavaScript and declaration files are Emscripten-generated Slang bindings. Slang is distributed
under the Apache License 2.0 with LLVM exceptions; see [`LICENSE`](./LICENSE). The downloaded
release may incorporate separately licensed third-party components documented by the upstream Slang
release.

Do not edit the generated files by hand. Replacing them requires updating the bindings hashes,
release URL and archive hash, extracted binary hash and size, reported version, license notices, and
the focused backend integration test together.
