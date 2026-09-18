# Shader authoring milestone

Goal: ordinary expression-oriented Workman should feel natural inside the
current shader feature set, without completing the entire shared-Core refactor.

## Todo

- [x] Support the common pipe forms through shared Core.
- [x] Discover and specialize shader calls from Core applications.
- [x] Emit complete shader function bodies by walking shared Core.
- [x] Remove the transitional Surface pipe path from WMSLang.
- [x] Keep source locations and useful diagnostics when Core validation fails.
- [x] Check the Shader Studio, jelly, Mandelbrot, and feedback examples.
- [x] Document the remaining intentionally unsupported shader constructs.

## Done when

Shader authors can use pipes, local helpers, tuples, blocks, conditionals, and
matches as ordinary Workman expressions without encountering a separate
WMSLang syntax model.

## Not part of this milestone

- imported shader-library closure;
- general records, ADTs, or higher-order closure conversion;
- host lowering from shared Core;
- the future SML backend;
- new GPU resource families, compute shaders, or a larger numeric system.

These remain explicit shader limitations rather than missing syntax handling.
Host FFI/JSON operations, escaping function values, non-tail recursion, and
general record values are also rejected by typed Core validation.
