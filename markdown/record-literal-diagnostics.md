# Record literal field-set diagnostics

`.{ ... }` constructs a nominal record. When no record has exactly the supplied field names, the
checker also looks for records containing all of those names.

- One containing record produces `record.missing-fields`, listing every missing field and its
  declaration location.
- Several containing records produce `record.ambiguous-incomplete`, showing their missing fields
  without selecting a nominal identity.
- No containing record produces `record.no-matching-type`, listing the supplied fields. When
  records share at least half of the supplied field names, the ones sharing the most (up to three)
  are named as the closest record, with their missing and unknown fields and the same per-field
  evidence as the cases above. This catches renamed fields, such as a carrier still written with
  `fn` after `Carrier` renamed it to `via`. Records sharing fewer names are not suggested.

Exact matches retain precedence. A partial literal is still an error: this does not synthesize
fields or introduce anonymous structural record values. Candidate comparison uses field names and
does not probe or mutate field value types.

Explicit targets and contextual annotations use the same field-set comparison. They can report
missing fields, unknown fields, or both. A spread supplies the remaining fields of its nominal
record, so updates only check for unknown fields.

Field-set failures carry separate evidence for provided fields, each candidate's declared fields,
and individual missing or unknown fields. Imported declaration sources are retained for terminal
output, inspection, and LSP related locations.

This follows the useful parts of `research/workman-old`: layer 1 emits `missing_field` diagnostics,
and compiler lowering compares expected and actual record fields to describe missing and extra
fields. The current implementation also diagnoses unannotated partial nominal literals and keeps
ambiguous candidate sets explicit.
