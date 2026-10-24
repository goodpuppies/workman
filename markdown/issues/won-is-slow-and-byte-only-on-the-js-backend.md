# Issue: WON is slow and byte-only on the JS backend

Status: in progress (step 1 done)

Moving desktop pakman's JSON files to WON exposed two problems with the SubsetML Basis on the
Workman JS backend. Native MLton builds were not affected in practice.

## Workload

`~/var/lib/pakman/owned.json` converted to WON: 5,730 file paths, 517 KB. The benchmark reads it
with `Won.read`, then takes `payload`, `get("files")` and `items`. Measured on 2026-10-23 with
Deno's `--cpu-prof`, on a compiled `.mjs`, so compilation is excluded.

## Profile

Total 10.8 s.

| Where | Time | Cause |
|---|---|---|
| `SubsetString.fromNative` (input to a char list) | 4.4 s | `SubsetChar.fromCode` scanned the 256-entry `byteChars` list per character |
| Text values (`text`, UTF-8 check, `toNative`) | 5.8 s | `toCode` scanned the same list per byte; `toNative` scanned a 256-entry `literals` table per byte |
| The rest of parsing | < 1 s | |

Self time inside those scans was inflated by JS codegen: `__wm_is_tuple` checks on tuple
patterns in loops (2.3 s self) and I32 arithmetic through helpers that allocate an argument
array, such as `__wm_i32_sub([a, b])` (2.2 s self).

Patching only `toCode`, `fromCode` and the `literals` lookup in the compiled JS to use
`charCodeAt`/`fromCharCode` brought the same read to 1.7 s. Of that, 0.84 s was garbage
collection, 0.17 s `SubsetChar.member` (character classes tested by list scans), and the rest
list reversal, cons allocation and generic equality.

## Plan

1. **Character code primitives (done).** `SubsetTextHost.charCode`, `codeChar` and
   `fromCodes` in SubsetML, with SML and WM/JS adapters; `SubsetChar.toCode`/`fromCode` and
   `SubsetString.toNative` use them. Justified in SubsetML's `docs/basis.md`, "Byte character
   codes". The benchmark now takes about 1.5 s (three runs: 1.64, 1.43, 1.50 s), after
   regenerating `subml-basis/` and `src/generated/assets.ts`.
2. **Unicode at the boundary.** SubsetML strings are bytes. On JS a WM `String` is UTF-16, so
   `SubsetString.fromNative` rejects any code unit above 255: `Won.read("\"ä — 日本\"")` fails
   with `expected a byte string`, and `Won.encode` of such text fails with `value cannot be
   represented as WON`. WM↔Basis text needs a defined UTF-8 conversion, either general or as
   WON entry points that take native text. This blocks desktop pakman.
3. **Indexed parser input.** The parser walks a `List<Char>` cursor, allocating a cons cell
   per input byte and a `Cursor` record and tuples per step. Reading by index over the string
   would remove most of the remaining allocation and GC.
4. **JS codegen.** Skip `__wm_is_tuple` where the tuple shape is static, and inline I32
   arithmetic instead of helper calls with array arguments. These are general wm-mini changes.
5. **Character classes.** `isDigit`, `isCntrl` and the others scan character lists; with code
   primitives they can be range checks.
