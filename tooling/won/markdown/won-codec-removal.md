# Remove WON's codec-building experiment

Status: complete (2026-10-23).

The prototype `codec.wm` schema combinators (`recordOf`, `field`, `list`,
`nullable`, `tag`, scalar checks) were deleted with their tests, probe modes,
and `codec.mjs` build output. They validated a generic tree without
reconstructing typed host values, and their presence made schemas look like a
prerequisite for using WON. See [why WON exists](won-design.md).

Done alongside the removal:

- Value constructors renamed `Decimal`/`Sequence`/`Fields` to
  `Number`/`List`/`Record`; the JS accessor `decimal` became `number`.
- Number tokens now follow JSON's grammar (`E`, `e+`); commas are whitespace.
- The repository-level `examples/won-file` and `examples/won-json` were
  deleted during the redesign rather than migrated. `tooling/won/examples/`
  keeps the app-config and Stageforge corpora.

The interop suite (`python3 tooling/won/tests/test_interop.py`) covers the
semantic exchange, format acceptance/rejection, and both backends. Do not
reintroduce a schema API, compatibility wrapper, or optional framework here.
