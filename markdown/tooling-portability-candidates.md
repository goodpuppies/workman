# Tooling portability candidates

Assessment: 2026-10-30. Scope: `tooling/pakman/`, `tooling/frontend-v3/`,
`tooling/tuiman/`, and the shared `pakman/` recipe API they consume.
Companion: [JS FFI inventory](js-ffi-inventory.md).

The strongest first batch is a small portable string/decimal API exercised by
pakman's package-selector and SemVer code. Tuiman benefits from the same source
algorithms, but its Unicode text needs a broader contract than byte-only strings.
Frontend v3's main algorithms already use the shared source-view Basis.

Most of this document is an assessment and proposed migration order. Implemented
first text batch (2026-10-30): shared `String` and Unicode `Text`
`isPrefix/isSuffix/isSubstring/fields/tokens`, plus pakman joining and path component
splitting through the shared Basis. Remaining candidates below are proposals.

Second text batch (2026-10-30): checked byte/scalar `extract/substring/map/translate`
and Unicode scalar `explode/implode/str` now live in the shared Basis. Pakman
request parsing, date/hash slices, shell quoting, GitLab project escaping, profile
names, sudo argument fields and existing path/URL prefixes consume these helpers.
No new host operations were introduced. Padding is also a Basis candidate via
SML `StringCvt.padLeft/padRight` (correcting the earlier std classification).
The remaining direct text receiver calls
in `pakman/` and `tooling/pakman/` are table padding and the generation filename's
first `.won` replacement. Regex captures and `parseIntOr` remain explicit host
imports, as does legacy text ordering.

Subsequent completion: source decimal parsing, SemVer, padding, UTF-16 lexical
ordering, dirname, store-name mapping, and Unicode subsequence matching have now
replaced those small WM/JS edges. General regex remains in finders; SemVer no
longer depends on it. The current remaining boundaries and validation are recorded
in [pakman portability status](pakman-portability-status.md). The candidate tables
below retain the original assessment context for frontend/tuiman as well.

## Pakman scope

The target is `pakman/` and `tooling/pakman/`. `tooling/pakman-subsetml/` is a
temporary sister project, useful as implementation precedent rather than the
migration target. Its standalone native host-contract test needed the source
option datatype before Result; that test dependency was corrected and the
lifecycle/refusal/host-contract test passed on 2026-10-30.

## Existing text coverage

The Basis already provides the Unicode foundation; new Unicode host primitives
are not a prerequisite for pakman's text cleanup:

- `SubsetText.toUtf8/fromUtf8` convert host text to/from validated UTF-8 bytes.
- `SubsetUtf8` and `SubsetUtf16` encode/decode Unicode scalars with typed errors.
- `SubsetBytes` provides predicate field splitting, trimming and checked slicing.
- `SubsetSource` provides indexed byte views; `SubsetUtf16Source` provides
  checked UTF-16 views, including lossless unit input for lone surrogates.
- `SubsetString.concat/concatWith` join native strings. Its byte conversion
  functions are distinct from the Unicode text boundary.

`pakman/won.wm` already uses `SubsetText` for its UTF-8 boundary. For a Unicode
path split on ASCII `/`, compose `Text.toUtf8`, `Bytes.fields` and
`List.traverse(..., Text.fromUtf8)`. ASCII delimiters cannot occur inside a
multibyte UTF-8 encoding. Scratch checks passed on JS and compiled native SML for `café/東京/🦊`, empty
input, leading/consecutive/trailing separators, and joining. The JS check also
verified rejection of a lone surrogate. Conversion errors must remain errors for package/path validation.

The first batch now supplies prefix/suffix/substring tests and predicate-based
fields/tokens for byte strings and Unicode text. Literal replacement and padding
remain candidates; joining needs no new algorithm. General string
slicing needs an explicit byte/scalar/unit index contract. Replacing JS lexical
comparison also requires choosing an ordering: UTF-16 unit order and UTF-8 byte
order differ for some Unicode strings.

## Where the dependency actually lives

The inventory snapshot gives the following direct syntax counts. These exclude
transitive calls hidden behind ordinary WM imports.

| Area | Tracked WM files | Runtime JS import declarations | Receiver calls/gets |
| --- | --- | --- | --- |
| `tooling/pakman/` | 39 | 10, in 7 files | 15, in 7 files |
| `tooling/frontend-v3/` | 40 | 4, all in 2 debug tools | 3, all in `tools/lex.wm` |
| `tooling/tuiman/` | 41 | 36, in 19 files | 82, in 13 files |

Tuiman's counts include terminal, Buffer and PNG probes. Their repeated calls
inflate the apparent binary-API demand; inspect the shipped modules before
choosing a Basis feature. Pakman's host operations also arrive through
`pakman/io.wm`, `pakman/finders.wm` and `src/io.wm` rather than direct imports at
every call site.

## High-value source-library work

| Candidate | Concrete consumers | Existing Basis coverage | Work needed |
| --- | --- | --- | --- |
| Prefix/suffix tests, find, drop/take and slicing | [pakman selector parsing](../tooling/pakman/pakman.wm#L88), [SemVer selectors](../tooling/pakman/src/semver.wm#L15), [path checks](../tooling/pakman/src/apply.wm#L79), [hash prefix](../tooling/pakman/src/store.wm#L226) | Byte/source slicing and list operations exist; the first batch adds checked byte-string and Unicode prefix/suffix/substring tests. | Migrate callers to the checked helpers; indexed find/slicing still need a contract. Define indices, bounds and failure behavior. |
| Splitting fields and joining strings | [path components](../tooling/pakman/src/apply.wm#L79), [sudo command](../tooling/pakman/src/install.wm#L308), [word/line wrapping](../tooling/tuiman/draw.wm#L142) | `SubsetString.fields/tokens` and `SubsetText.fields/tokens` now expose checked splitting; `SubsetString.concat`/`concatWith` join native strings. | Migrate remaining callers. These callers mainly use single ASCII separators; a general regex split is unnecessary. |
| Repetition, padding and literal replacement | [pakman table padding](../tooling/pakman/pakman.wm#L318), [tuiman sanitizing/wrapping](../tooling/tuiman/draw.wm#L67), [image URL rewriting](../tooling/tuiman/kitty.wm#L296) | List repetition and string concatenation exist. Substring replacement and padding APIs are missing. | Implement source algorithms over the chosen text representation. Define empty-needle, negative-count and output-size behavior rather than copying all JS edge cases. |
| Checked nonnegative decimal parsing | [SemVer components](../tooling/pakman/src/semver.wm#L8), shared [parseIntOr](../tooling/pakman/api/js/recipe.ts#L113) | `SubsetNatural` has validation, division and formatting, but no parser. | Add a checked `I32` parser with invalid-input and overflow errors. Apply fallback behavior in the caller. Decide whitespace policy explicitly. |
| Fixed grammar parsing instead of regex | [pakman SemVer](../tooling/pakman/src/semver.wm#L8) | Lists, byte characters and typed Results are sufficient. | Implement pakman's small `X.Y.Z`/`~X.Y.Z` grammar in pakman source; share decimal primitives through the Basis. SemVer itself belongs to the application. |

None of these algorithms requires a new host primitive. Native-string entry and
exit can use the existing text adapters. A source implementation should convert
or validate once and work on a portable representation internally.

There is already related source code in the native pakman port:
[`io.wm`](../tooling/pakman-subsetml/src/io.wm) implements field splitting,
joining and parent-path handling. Treat it as algorithm precedent; review its
imports, path assumptions and error contracts before sharing it.

### A deliberately small first patch

1. Checked prefix/suffix/substring and field/token wrappers are implemented in
   the shared Basis; pakman path splitting and joining now consume it. Add checked
   decimal parsing next.
2. Replace the regex and JS number parsing in pakman's SemVer module with source
   parsing. Keep package-version policy in pakman.
3. Migrate selector parsing and the simplest ASCII metadata operations to those
   helpers. Run their pure closures through SubsetML/native checking.
4. Preserve Unicode through the existing text boundary for arbitrary paths.
   Choose indexing and display-width contracts separately for terminal layout.

The current SemVer record uses `Number`, whereas the shared Basis uses `I32` for
integral counts. A checked `I32` parser cannot silently preserve arbitrary
JS-number inputs. Choose a component range, migrate the record if appropriate,
and test overflow, leading zeros, empty components and trailing data. Likewise,
the current `parseIntOr` accepts surrounding JS whitespace; that policy should
not accidentally become an ASCII-only policy during migration.

Do not build a portable regex engine to eliminate this particular SemVer regex.
Other package finders use general capture patterns and need a separate decision.

## Tuiman: immediate wins and the text boundary

The simplest direct swaps are [ANSI constants](../tooling/tuiman/ansi.wm#L3)
and [event control characters](../tooling/tuiman/event.wm#L5).
`String.fromCharCode(27)` can be a source string literal such as `"\u001b"`;
the same applies to Ctrl-C, carriage return and DEL. This needs no Basis extension
or fallible host call. The event module's comment claiming WM has no Char type
is also stale.

`event.wm` repeatedly slices off one JS UTF-16 unit to build `List<String>`.
It could parse a `SubsetUtf16Source` unit list instead. That module already offers
`fromNativeUnits`, `toUnits`, `peek`, `at`, `length` and `slice`, and preserves
lone surrogates. Decode host input at the adapter, then frame and recognize
terminal control sequences in source. Character events can be reconstructed
under an explicit Unicode policy.

The larger win is [draw.wm](../tooling/tuiman/draw.wm): repeat, replace, slice,
length, splitting and wrapping are ordinary algorithms currently expressed as
JS member calls. However, it renders box-drawing characters and arbitrary user
text. **Byte-only `explode` or `String.toList` is not a safe drop-in replacement**:
those functions reject non-byte characters, and `toList` returns an empty list
for the whole failed conversion.

Use one of the existing representation boundaries deliberately:

- UTF-16 source views preserve the current JS storage-unit indexing behavior.
- Strict UTF-8 text plus source byte operations can preserve Unicode while
  splitting/matching ASCII delimiters, with explicit text conversion at the edge.
- Scalar-based text operations require a different slicing/counting contract.

Terminal display width is a further issue: UTF-16 units, bytes, Unicode scalars,
graphemes and terminal columns are different quantities. Removing JS FFI should
not imply that the current `.length` implementation measures display width
correctly. Preserve the current behavior explicitly or handle width separately.

## Frontend v3: reuse the boundary already present

There are no direct JS imports or receiver-access sites in `src/` or `adapters/`
in this scan. The lexer already operates on `basis/utf16_source.wm` views;
[`Reader.textBetween`](../tooling/frontend-v3/src/lexer/reader.wm#L61) already
uses checked source slicing. [`adapters/js/lexer.wm`](../tooling/frontend-v3/adapters/js/lexer.wm)
does the native-string conversion once.

The remaining small cleanup is in [tools/lex.wm](../tooling/frontend-v3/tools/lex.wm#L13):
token-preview slicing can use the same source view and `I32` spans rather than
converting offsets to Number for JS `.slice`. Rendering malformed input must
remain lossless or escaped; routing all previews through strict UTF-8 can lose
lone-surrogate source. [reader_debug.wm](../tooling/frontend-v3/tools/reader_debug.wm#L4)
also uses host character construction for previews, which can stay in a rendering
adapter or use a portable escaped-unit renderer.

File reading, directory walking and output remain host operations. The existing
[native lexer driver](../scripts/build_frontend_v3_native.py) already demonstrates
the portable core/host-driver split. The [native notes](../tooling/frontend-v3/native-portability.md)
also record a projector/View inference problem; that probe was not rerun for this
assessment. A library cleanup alone does not establish portability of the whole
editor closure.

## Binary helpers: useful second-stage work

Tuiman's [PNG module](../tooling/tuiman/png.wm#L1) exposes a deeper dependency:
`Pixels.bytes` is a Node `Buffer`, and decoding mutates buffers through
`readUInt8`, `writeUInt8`, copying and integer reads. Replacing one accessor
would leave that representation dependency in place.

`SubsetBytes` already provides byte lists, validation, slicing and sequential
readers. Good source extensions include checked fixed-width reads and Base64
encoding. These could support PNG header inspection and Kitty payload building
without handing Node Buffer objects around. A 32-bit unsigned read needs an
explicit result representation or overflow policy; signed `I32` is not a generic
replacement for every `readUInt32BE` result.

The existing decoder also performs indexed pixel writes and repeated lookups.
Moving that workload directly to linked lists could be much slower. Choose a
source algorithm/representation or a bounded byte-buffer host interface before
porting the full decoder. Keep decompression or PNG decoding behind a narrow
adapter initially; do not make a compression implementation a prerequisite for
portable text layout.

## Structural blockers that string helpers will not remove

- **Async effects:** pakman and tuiman use `Task` extensively. `std/task.wm`
  sequences JS Promises through `std/js/task.js`. `SubsetIo` currently exposes
  synchronous Result-shaped operations, so it is not a drop-in replacement for
  pakman's async I/O. Define a native Task/effect profile or a separate synchronous
  driver boundary before claiming whole-program portability.
- **External services:** HTTP, subprocesses, filesystem metadata/permissions,
  clocks, environment, terminal raw mode/events and image decoding need backend
  adapters. Reuse logical interfaces while changing their implementations.
- **Representation at adapters:** many `Js.Array` conversions in pakman's I/O
  and JSON serialization are boundary conversions. Move them into the adapter
  when possible; a list-only core can still use a JS-array-based host API.
- **Legacy std contracts:** `List.length` has Number counts and `List.foldLeft`
  is accumulator-first. The shared Basis uses I32 and element-first callbacks.
  Migrating pure tooling code should select the Basis directly and update callers;
  these existing source functions are not themselves JS FFI dependencies.
- **Math/rounding:** tuiman's image/layout code uses JS rounding and numeric
  helpers. Integer counts can use source integer arithmetic, but real-valued
  scaling is not equivalent to integer division. Any portable rounding API needs
  a chosen numeric/error contract and, where justified, a small backend primitive.

Start with pakman's pure string/decimal closure and tuiman's literal controls.
Then use those real consumers to shape shared text APIs. This removes concrete
algorithmic JS dependencies without turning terminal/network backends into a
large compulsory Basis.
