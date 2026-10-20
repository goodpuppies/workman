# Nominal field requirements

Decision, 2026-10-19: infer a field requirement when a Workman record receiver is
unknown. Do not select a nominal owner, enumerate candidates, or warn simply because
several declared records share the label. This replaces first-owner projection defaults
and the intermediate joint-candidate solver.

```wm
record Session = { accessJwt: String, did: String };
record AppFeeds = { accessJwt: String, posts: List<Number> };
let token = (value) => { value.accessJwt };
let sessionToken = token(Session("jwt", "did:example"));
let feedsToken = token(AppFeeds("jwt", []));
```

The inferred type is displayed as:

```text
token : 'a -> 'b where 'a.accessJwt: 'b
```

If the body requires a String, the result and field requirement both become String.
A caller supplies a nominal receiver, and the compiler checks the required field against
that record's declaration. Independent calls instantiate the receiver and field result
variables together. Fields need not have the same type across unrelated records when
the function body permits both types.

## Identity and safety

These are relations on nominal types, not mutable structural record rows. A function
that returns its input returns the same receiver variable:

```text
retain : 'a -> 'a where 'a.accessJwt: 'b
```

Supplying Session makes the result Session. It cannot be annotated as AppFeeds, and
accessing another field later must validate that field on Session. A required field must
exist on the supplied nominal record; foreign objects and primitives cannot satisfy
these obligations merely by sharing a property spelling.

Requirements with the same field name share a result type. Requirements on receiver
variables merged by unification stay together. Generic parameters shared by a record's
fields remain shared when it is supplied to a function. Nested requirements can refer to
one another, including returning the same receiver, without unfolding a structural row.
Equality and other ordinary checks on a required field's type remain in force.

## Generalization and modules

Field requirements are part of a type variable's inference graph. Free-variable analysis
includes their result types, including variables not otherwise visible in a function's
result. Generalization follows the ordinary value restriction. Instantiation freshens the
receiver, required field results and any shared relationships in one substitution.

The existing live module schemes retain these requirements through imports and re-exports.
A caller may supply a nominal record declared only in the calling module; validation uses
the record metadata on that actual type, not a list of owner names captured in the library.
No source re-elaboration, whole-program retry, fixed point or candidate search is needed.

Manual annotations still constrain types and can reject incompatible uses. They are not
required to rescue an implementation default. Existing JS representation/reflection and
GPU annotation boundaries remain separate; field generalization does not make unresolved
foreign interactions polymorphic.

## Projection classification and construction

The current front end distinguishes Workman projections from foreign members using known
declared label names and receiver types. This change does not reinterpret unknown JS
members as record requirements or change explicit foreign pipe-member access.

Record construction still creates one nominal record. Shape-based literal selection and
its existing ambiguity diagnostics are separate from projection requirements. This design
does not introduce anonymous structural record values or nominal casts.

## Diagnostics, tooling and emission

Type displays include `where` field requirements. Semantic type snapshots retain their
field/result relations. A generic field occurrence is recorded as a requirement rather
than attributed to an arbitrarily chosen record declaration. Concrete/annotated receivers
continue to have ordinary record-field references. Requirement diagnostics preserve the
declaring source document across imports.

Generated field access remains ordinary property access. A generic accessor is emitted
once; no runtime owner selection or dispatch is introduced.

## Regression coverage

- Different nominal receivers and different field result types on independent calls.
- Accessors imported by a caller defining its own nominal records.
- Receiver identity preserved through returns; cross-nominal casts rejected.
- Shared generic field parameters and repeated/nested projection relationships.
- Higher-order callbacks, local helpers, pipes and recursive uses.
- Missing fields, inconsistent field types and equality violations rejected.
- Source-aware imported diagnostics and honest semantic type snapshots.
- Imported accessors execute correctly without specialization or runtime dispatch.

The atview accessJwt clash is an acceptance case: a separately exported helper must accept
Auth.Session even when AppFeeds was declared first. Its identity must be determined by
the actual argument, not by declaration order in the helper's module.
