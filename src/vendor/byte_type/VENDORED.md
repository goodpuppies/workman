# Vendored byte_type

Complete production source of the local `byte_type_C` fork, copied without
modifications from commit `56cdc7b28a064c85ee3f9a681d48149776f7a02d` on 2026-10-06.
The source checkout was clean.

Fork: https://github.com/mommysgoodpuppy/byte_type_C

Upstream: https://github.com/denosaurs/byte_type

The fork reports version 0.4.0. Its C struct layout and codec extensions are used
by Workman's C FFI. All production modules and the original README and MIT license
are included. Upstream tests, examples, benchmarks, and package configuration are
omitted. Production modules have no external dependencies.

`deno.json` resolves `byte_type` to this source tree. `scripts/build_byte_type.ts`
bundles the complete API into `src/generated/byte_type_runtime.ts`, preserving the
MIT notice. C codec emission embeds that standalone module in generated programs;
ordinary programs do not include it. The VS Code package also carries the license
under `server/licenses/byte_type-LICENSE`.

After updating these sources, run `deno task byte-type:build` and the C codec
regression checks. `deno task generate` also regenerates the runtime. Verify it
with `deno run -A scripts/build_byte_type.ts --check`.
