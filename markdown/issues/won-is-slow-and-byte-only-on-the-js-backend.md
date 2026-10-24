# Issue: WON is slow and byte-only on the JS backend

Status: in progress (steps 1 and 2 done)

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
2. **Unicode at the boundary (done).** See [Text as UTF-8 bytes](#text-as-utf-8-bytes).
   This unblocks desktop pakman.
3. **Indexed parser input.** The parser walks a `List<Char>` cursor, allocating a cons cell
   per input byte and a `Cursor` record and tuples per step. Reading by index over the string
   would remove most of the remaining allocation and GC.
4. **JS codegen.** Skip `__wm_is_tuple` where the tuple shape is static, and inline I32
   arithmetic instead of helper calls with array arguments. These are general wm-mini changes.
5. **Character classes.** `isDigit`, `isCntrl` and the others scan character lists; with code
   primitives they can be range checks.

## Text as UTF-8 bytes

### The problem

A SubsetML `string` is a byte sequence. Natively that is an SML string. On JS the Basis
stores one byte per UTF-16 code unit (a Latin-1 carrier): `lib/subset_host.js` reads files as
`latin1`, and the translator spells SML `"caf\195\169"` as WM `"caf\u00c3\u00a9"`. SubsetML
compiled to JS is therefore consistent.

WM-written code is not. Desktop pakman reads files with `Deno.readTextFile`, and WM literals
are JS text, so `ä` arrives as the single unit U+00E4. WM text and Basis byte strings share the
`String` type and nothing converts between them:

| WM text | Basis reads | Result |
|---|---|---|
| `"ä — 日本"` | `—` is unit 8212, not a byte | `Won.read` fails: `expected a byte string` |
| `"ä"` | byte `E4`, invalid UTF-8 | read fails; `Won.encode(W.Text("ä"))` fails: `value cannot be represented as WON` |
| `"Ã©"` | bytes `C3 A9`, valid UTF-8 | silently becomes `é` |

The Basis already handles UTF-8 (`SubsetUtf8`, and WON validates its text). The missing piece
is a typed, explicit conversion between host text and UTF-8 bytes.

### Decision: treat text like numbers

WON keeps a number as its exact spelling and leaves conversion to the host. That works because
the spelling is ASCII, which is the same in every string convention. Text is the one value that
can carry non-ASCII, so it gets the same treatment with an explicit representation:

- WON wire data is bytes. A text value is its validated UTF-8 bytes,
  `SubsetWonValue.Text of char list`, like `Blob of char list`. `Won.text` returns those bytes.
  This is the "UTF-8 bytes" choice already allowed by `tooling/won/markdown/won-mapping.md`.
- Each host converts at its edge. `Won.textString` converts a text value to host text. A small
  `SubsetText` module converts both ways (`toUtf8 : string -> bytes`,
  `fromUtf8 : bytes -> string`), with strict validation in source and one host primitive per
  direction: identity in SML, `TextEncoder`/`TextDecoder` in WM/JS. A JS lone surrogate is
  encoded as its three-byte form so source validation rejects it instead of replacing it.
- The Basis string contract and the translator's literal spelling do not change.

Passing WM text where text bytes are expected becomes a type error rather than wrong output.

Text and blobs stay distinct in the format and the value model: `"abc"` follows the text token
rules (strict UTF-8, named escapes), `x"616263"` is arbitrary bytes, and neither decodes into
the other.

### Implemented

- SubsetML: `SubsetTextHost.encodeUtf8`/`decodeUtf8` (identity in SML; URI codecs in WM/JS),
  `SubsetText.toUtf8`/`fromUtf8`, `SubsetWonValue.Text of char list`, `SubsetWon.textString`.
  The WON probe covers byte text, `textString`, invalid UTF-8 and a `SubsetText` round trip.
- wm-mini: `interop.ts` reads text bytes; pakman-subsetml's codecs build text with
  `SubsetText.toUtf8` and read it with `textString`; `tests/library_discovery_test.ts` sends
  `ä — 日本 😀` from WM through WON and back.

Documents, keys and tag names stay byte strings. Names are ASCII and read the same in both
representations; a quoted non-ASCII key arrives as UTF-8 bytes. Keeping documents as byte
strings also keeps the JS interop layer simple, since it cannot build WM lists.

### Measurements

A 1 MB WON version of `owned.json` (5,730 entries with hashes), three runs:

| Step | Time |
|---|---|
| WM text to UTF-8 bytes to a document byte string | about 850 ms |
| `Won.read`, then `files` items | about 1.05 s |
| `textString` on all 5,730 paths | about 115 ms |

The first row is the cost of reading a document as text and converting it. Desktop pakman
should read WON files as bytes instead (a `latin1` read in `host.ts`, like
`lib/subset_host.js`), which needs no conversion.
