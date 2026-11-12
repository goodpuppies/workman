# tuiman in the Workman compiler

This is the compiler-owned copy of the Workman terminal UI library. `wm problems` imports these
modules directly. Flowing compiler diagnostics use `diagnostic.wm`, which `document.ts` imports as a
Workman module: `deno.json` maps it to the checked-in stage-0 artifact
`src/generated/wm/tooling/tuiman/diagnostic.wm.js`, and tsc types it through the content mapper.

Rebuild the artifact with the compiler's other Workman modules:

```sh
deno task src-wm:build
```

The build compiles completely before replacing the previous artifact. Compiler error reporting may
therefore keep using the last successful renderer while the Workman source is temporarily broken.
The host adapter must retain a plain TypeScript fallback for an artifact that cannot load or render,
so `document.ts` imports it dynamically.

Diagnostic callers pass semantic roles (`error`, `type`, `secondary`, `header`, `hint`, or `plain`)
instead of ANSI codes. In particular, rendered text must never be reparsed to guess those roles.
