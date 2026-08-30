# tuiman in the Workman compiler

This is the compiler-owned copy of the Workman terminal UI library. `wm problems` imports these
modules directly. Flowing compiler diagnostics use `diagnostic.wm`, compiled to the checked-in
`src/generated/tuiman.js` stage-0 artifact.

Rebuild the host artifact with:

```sh
deno task tuiman:build
```

The build compiles completely before replacing the previous artifact. Compiler error reporting may
therefore keep using the last successful renderer while the Workman source is temporarily broken.
The host adapter must retain a plain TypeScript fallback for an artifact that cannot load or render.

Diagnostic callers pass semantic roles (`error`, `type`, `secondary`, `header`, `hint`, or `plain`)
instead of ANSI codes. In particular, rendered text must never be reparsed to guess those roles.
