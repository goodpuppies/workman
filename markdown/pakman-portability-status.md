# Pakman portability after the small-helper pass

Scope: the main `pakman/` API and `tooling/pakman/` manager, 2026-10-30.
The temporary `tooling/pakman-subsetml/` sister project is not the migration target.

The recipe API now lives in `tooling/pakman/api/`; `pakman/...` remains its public
import prefix. Historical paths and counts below refer to the pre-move inventory.

## Source implementations now in use

- Shared byte-string and Unicode text matching, fields/tokens, extraction/slicing,
  character mapping/translation, scalar conversion and trimming.
- `basis/int.wm`: checked decimal prefix parsing (`fromString`) and full-input
  signed/unsigned parsing (`parseDecimal`, `parseNatural`). Overflow is detected
  before arithmetic, including the minimum signed 32-bit value.
- `basis/string_cvt.wm`: byte and scalar padding, following SML StringCvt.
- `basis/path.wm`: lexical slash-separated Unicode directory extraction.
- Unicode text comparison with explicit UTF-16 lexical order, preserving JS
  comparison for valid text. Byte comparison remains a distinct API.
- `std/string.wm`: checked Unicode subsequence matching. This convenience has no
  comparable SML Basis operation and therefore belongs in WM std.
- Source SemVer parsing for exact `X.Y.Z` and patch-range `~X.Y.Z`, source store
  component mapping, shell quoting, selector splitting, path validation, URL
  project escaping and generation filename handling.

No new host primitive was introduced. `pakman/text.wm` and `pakman/won.wm` also no
longer import the Task-bearing `pakman/fun.wm` merely for pure list helpers.
Removed WM-facing host imports include number parsing, comparison, dirname,
subsequence matching, repository-prefix tests and store-name sanitization.
Host filesystem code keeps its own private dirname helper where it needs one.

## Deliberate contracts

SemVer components are now canonical nonnegative I32, with overflow rejected.
Config/protocol parsing keeps the previous unsigned full-input policy and
ECMAScript whitespace set, but out-of-I32-range input returns the caller's
fallback rather than being rounded by JS Number. Existing Number-shaped records
remain Number-shaped at that adapter; this is not a wholesale numeric migration.
Generation directory entries must end in `.won` and have a bounded positive
number. Previously unrelated names containing `.won` could be accepted.

Text slicing/padding count Unicode scalars, not UTF-16 storage units, graphemes or
terminal columns. Store-name sanitization deliberately preserves its previous
UTF-16 unit policy (one underscore per disallowed unit), so astral characters
still become two underscores. Malformed Unicode is rejected at checked text
boundaries instead of silently becoming empty path components or shell arguments.
The dirname adapter preserves pakman's existing `/` fallback for a bare filename;
the shared lexical path API correctly returns an empty directory in that case.

## Portable JSON library follow-up

`std/json.wm` now implements the portable JSON tree, strict Unicode parser,
encoder, lossless number spellings and checked traversal. Built-in GitHub/GitLab
finders use `fetchDocument` and source decoders. Legacy `fetchJson`/dynamic JS
helpers remain for external recipes using `Json.assert`; store manifest and
repository formats have not changed. See [the JSON API](../docs/json.md).
The remaining JSON work is consumer/format migration, not implementing a parser.

## Remaining substantive boundaries

| Boundary | Current dependency | Why it is a larger next step |
| --- | --- | --- |
| Async execution | `std/task.wm` and its JS Promise runtime | Needs a native Task/effect profile, scheduler, or deliberate synchronous driver split. Shared synchronous Result I/O is not a drop-in replacement. |
| JSON compatibility consumers | Store manifests, repository bookkeeping and legacy recipe `fetchJson`/`Json.assert` | The portable parser now exists and serves built-in finders. Migrate legacy consumers explicitly, and choose WON versus JSON for stored formats with compatibility/versioning in mind. |
| General regular expressions | Finder `captures` and `capturesAll` | Arbitrary package patterns need an engine or an explicit backend capability. SemVer no longer requires regex. |
| Date interpretation | `isoToSeconds` using host `Date.parse` | Needs a defined supported date grammar, calendar arithmetic and timestamp range. This is distinct from acquiring the current clock. |
| Host services | Filesystem, HTTP, subprocesses, environment, console, hashing, archive extraction, permissions and recipe compilation | Keep narrow logical adapters; provide native implementations. Not ordinary missing string algorithms. |
| Adapter representations | `Js.Array` conversions and JS-shaped host objects | Native adapters should expose portable lists/records rather than requiring the core to emulate JS objects. |

The fresh syntax inventory has **zero receiver call/get sites** in tracked WM
under `pakman/` and `tooling/pakman/`, including their tests, with no parse errors
in those directories. Explicit imports now correspond to the capabilities above.
This is a direct syntax audit, not proof that transitive std or host code is free
of JS. At the original audit, the then-untracked `pakman/number.wm` was inspected
separately and had only ordinary Basis imports. The inventory script scans
tracked sources and untracked examples, not arbitrary untracked WM files.

## Validation

- Strict source portability and dependency inventory checks: `make selfcheck`.
- Original SML, roundtripped SML, and generated WM text/number/padding/path tests:
  `make text-basis-check`; native oracles use SML Int32 and StringCvt only in tests.
- Custom Basis checks: `make custom-basis-check`.
- WM tests cover Unicode planes, malformed input and callback order, 20,000 leading
  zeroes, I32 overflow, whitespace compatibility, canonical SemVer, paths and
  the unchanged UTF-16 store-name policy.
- Modified host adapters typecheck. All 21 Basis type/interface tests and all
  89 pakman tests pass, including the complete lifecycle suite with generated
  sources held fixed. Both JS helper test suites pass.

These establish library behavior and preserve the existing JS-backed application;
they do not establish a native build of the entire manager. The remaining async,
JSON, regex, date and external-service profiles are the next portability work.
