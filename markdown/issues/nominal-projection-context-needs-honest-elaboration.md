# Issue: contextual nominal projection — current implementation and remaining policy work

Status: open as a design follow-up. The atview and pakman failures are fixed; the current
behavior is working for those projects. Updated 2026-10-06.

## Current state

Calls and pipes share application inference. Ambiguous nominal projections can now wait
for ordinary constraints in the enclosing top-level declaration instead of immediately
committing to the first record declaring a label. Receiver constraints, field result types
and the combination of projected labels determine the owner where possible.

The motivating bugs were premature record selection despite enough context to determine
the receiver. Both are fixed. The implementation still combines contextual hints, deferred
obligations and a compatibility fallback, so this issue remains a record of the design and
its boundaries rather than a claim of complete SML conformance.

Annotations may disambiguate a genuinely unresolved nominal identity. That is legitimate
and matches Grain's contextual approach. Calling all annotation-based disambiguation a
compatibility violation was too broad; the distinction is between selecting an unresolved
identity and overriding an identity already determined by ordinary constraints.

## Original problem

Previously, `selectedFieldRecord` picked the first viable owner and warned before the
surrounding constraints had necessarily determined the receiver. A later constraint could
then produce an artificial mismatch against that default. Diagnostics exposed the choice,
but the inference needed to wait for the context rather than merely explain its bad guess.

## Concrete failure

The atview project declares both `ProfileCore` and `ActorCore` with `did` and `handle`.
Other records, `Profile` and `Actor`, also declare those labels. Its decoder contains:

```wm
let core: Result<ActorCore, Js.Error> = body :> Json.assert;
Result|
  core,
  Boundary.optionalString(body, "displayName"),
  Boundary.optionalString(body, "avatar")
| :> Result.map((core, displayName, avatar) => {
  Actor(core.did, core.handle, displayName, avatar)
})
```

Previously the callback body was checked before the pipe input was connected to
`Result.map`'s signature. `core.did` selected `ProfileCore`, then the enclosing pipe
reported `ActorCore` versus `ProfileCore`. Neither that default nor the callback's
parameter was an actual declaration that the programmer intended to mean ProfileCore.

Projection provenance now retains the committing `core.did` occurrence and the
ambiguity candidates. A remaining clash points there rather than only at `core` in the
lambda head. Those diagnostics remain necessary for separately defined callbacks.

## Implemented application and projection handling

`callInvocationPlan` and `pipeInvocationPlan` describe the application represented by
an authored expression. `inferApplication` now checks both through one routine:

1. Infer the callee's instantiated signature.
2. Check arguments in expanded application order.
3. Constrain each earlier argument before inferring the next one. For a tupled
   application, these are slots of the single tuple parameter, not curried applications.
4. Pass each argument its expected type. An inline lambda can use expected nominal
   record parameter identities before its body projects their fields.
5. Check the complete application and retain the authored source identity, type facts,
   argument origins and call/pipe diagnostic presentation.

Thus `input :> Result.map(callback)` and `Result.map(input, callback)` receive the same
application context. Parenthesized or space-applied pipe stages still represent applying
an already produced function; their grouping/currying is preserved by the invocation plan.
Runtime evaluation order and the single evaluation of the pipe input remain unchanged.

This does not move the whole compiler to Core-before-inference. Inference still runs on
surface occurrences; Core lowering later produces `CoreApp`. Pipe-aware diagnostic
wrappers remain for source presentation. Foreign member elaboration and domain-specific
GPU/carrier typing also have their existing rules. The plan is a shared interpretation,
not a claim that all syntax has already been erased before inference.

Expected lambda parameter hints cover nominal records in the host dialect. They do not
add a privileged path for nested annotations such as `Option<LockEntry>` or `List<Record>`.
Foreign reflection and GPU inference retain their existing boundaries.

A follow-up to the pakman failure now keeps ambiguous projections pending through ordinary
constraints in the enclosing top-level declaration. Receiver constraints and the combined
projected labels determine the nominal owner when possible. Outstanding receiver/field
variables stay monomorphic until these obligations resolve; top-level schemes are finalized
again afterward so generic nominal arguments can still be generalized normally. Pending
commitments retain their projection origins and field facts for editor tooling.

If the declaration still leaves an owner ambiguous, the compatibility first-owner fallback
runs at its boundary and emits the existing warning. This is not nominal identity polymorphism
and does not let a later top-level consumer reinterpret a previously elaborated function.

The motivating case was `locked: Option<LockEntry>` followed by `Some(entry)` and a branch
returning either `Task.succeed(entry)` or another computation returning LockEntry. The branch
constraint resolves the pending `entry.version` without using the parameter annotation.
The real resolve.wm now has the same inferred signature when that annotation is removed.

## Annotation disambiguation

The intended distinction is:

- If ordinary constraints determine LockEntry, an annotation checks that identity; removing
  the annotation should not recreate the pakman Candidate mismatch.
- If the computation genuinely permits several nominal owners, an annotation may select one.
- If the computation determines an incompatible identity, the annotation must report a
  mismatch. It cannot coerce the receiver or override the established identity.

The existing `InferAnnotation.NominalRecordParameter` path applies a bare nominal record
parameter annotation before its body is checked. For a function projecting only a label
shared by Point and Offset, `value: Offset` is valid disambiguation. This is not itself a bug
or a reason to remove the path. It is also not a dynamic shape assertion: Json.assert remains
the explicit JS representation boundary.

A trial removal exposed compiler helpers whose bodies genuinely permit multiple record
owners, including shared `id` and `typeId` projections in wmslang. Their annotations are
useful disambiguation; the existing path was retained. The proposed additional early path
for nested annotations such as Option<LockEntry> was backed out because the motivating
pakman computation already determines LockEntry without it. Pending parameter checks run
after ordinary declaration-level projection resolution rather than supplying that workaround.

Bare annotations, nested annotations, expected callback types and late checks still take
different implementation paths. Making those paths more consistent is future design work;
it should preserve legitimate disambiguation instead of imposing a blanket ban on annotations
helping inference.

## Remaining boundaries and policy questions

- The first-owner fallback and warning still exist for labels unresolved at the declaration boundary.
- Inference-order independence is not claimed for every language construct. New cases need
  a focused reproduction before adding another contextual hint or special inference path.
- A separately bound callback is elaborated at its definition, before a later application
  can provide context. Its nominal identity does not become polymorphic over record owners.
- Expected-type propagation is limited; deferred projection obligations now cover ordinary
  context in the same declaration, but do not replace all contextual elaboration machinery.
- The current hint mechanism is an implementation ordering aid, not a complete account of
  which contextual constraints resolve an ambiguous projection and when they must resolve.
- Diagnostics must distinguish a programmer annotation from an implementation default;
  merely reporting an inferred parameter type hides that distinction.

For example, this still defaults at the callback's definition and fails at the use:

```wm
record ProfileCore = { did: String, handle: String };
record ActorCore = { did: String, handle: String };
let toActor = (core) => { Actor(core.did, core.handle) };
let bad = input :> Result.map(toActor);
```

An annotation on `toActor` resolves it under the current policy. A later use must not
silently reinterpret a generalized function's nominal identity.

## SML and Grain comparison

The Revised SML Definition's application rule (`research/The-Definition-of-Standard-ML-Revised/statcor.tex`,
application rule around line 691) requires a shared type between the function input and
argument. It does not prescribe this implementation's traversal order. Appendix A
(`app1.tex`) treats derived forms as rewrites to equivalent bare-language forms.
Pipes should follow that model: expanded calls and their pipe spellings must impose the
same constraints, preserve generalization/value restrictions, and have equivalent runtime
behavior. Keeping authored source metadata does not justify separate typing semantics.

SML records are structural, whereas Workman's record identities are nominal; its record
resolution rule cannot simply be copied verbatim. Section 4.11 requires context to determine
a flexible record row's domain uniquely. It does not authorize our first nominal owner
fallback. Appendix E's structure-level context discussion is about predefined overloading,
not a direct specification of user-defined nominal record-label overloading. We must state
our extension and its resolution boundary explicitly rather than call it SML conformance.

Grain's local compiler (`../grain/compiler/src/typed/disambiguation.re`) selects by receiver
identity when known, otherwise selects a label candidate and warns. `typecore.re` passes
expected types into argument checking and lambda patterns, checking arguments in order.
Two local compilations confirmed that input-before-callback disambiguates successfully,
while callback-before-input warns, selects the other owner, and errors. Grain does not
retry candidates after a later type clash. Shared application inference follows that contextual behavior. Workman's deferred
projection obligations now go further by waiting for ordinary constraints through the
enclosing top-level declaration; they still do not retry already elaborated definitions.

## Future work

Revisit [record-projection-resolution-is-not-sml-context-deferred.md](record-projection-resolution-is-not-sml-context-deferred.md)
with an explicit decision about Workman's nominal-label policy:

- Extend and audit the implemented receiver obligations across recursion, nested scopes,
  module signatures and exported schemes. Preserve the origin supplying the identity.
- Decide and document the resolution boundary and interaction with local lets,
  generalization, recursion, module signatures and exported schemes.
- Decide whether unresolved ambiguity at that boundary is an error or an intentional
  default. Removing defaults is a language change and requires migration review.
- Do not allow obligations to escape as accidental structural record polymorphism.
- Keep FFI reflection and GPU projections separate where their semantics require it.
- Consider consolidating expected-type and annotation disambiguation paths. Preserve
  valid disambiguation and reject genuinely incompatible annotations.

Do not implement whole-program retry, fixed-point re-inference, or choosing whichever
record happens to make an already failed program pass. Constraints should determine a
record identity; resolution should neither coerce nominal records nor rewrite an already
elaborated polymorphic definition at its later use sites.

## Validation completed

- 218 scoped tests passed, covering records, pipes, diagnostics, module inference, JS
  reflection/dynamic boundaries, GPU selection, carriers and LSP hover.
- Main toolchain and LSP typechecks passed.
- Pakman compiled successfully without changes to its source.
- Its real resolve.wm inferred the same signature with `locked: Option<LockEntry>` present
  and removed: `(Paths, PackageInfo, Option<LockEntry>) -> Task<LockEntry, String>`.
- Atview's original inline Result.map clash was eliminated. Its later FeedPost.author
  failure was a separate case and should not be presented as the original bug persisting.

## Further validation

Focused checks should cover equivalent direct/pipe calls, tupled callbacks, generic nominal
records, independent polymorphic instantiations, incompatible explicit annotations, grouped
and curried pipe stages, source-aware errors and runtime evaluation order. Keep the separately
bound ambiguous callback as a documented boundary case. Existing record soundness, JS callback,
GPU and carrier checks must continue to pass.

A complete replacement additionally needs cases where nested annotations and constraints
later in the same allowed context resolve a projection, where unresolved ambiguity fails at
its declared boundary, and where generalization cannot smuggle obligations across that boundary.
