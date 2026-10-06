# JavaScript members: name-rooted dots and explicit expression receivers

A dotted path may start from a name:

```wm
response.ok
response.headers.get("content-type")
worker.postMessage("hello")
```

A member of a computed expression uses `:> .`:

```wm
"hello" :> .length
makeResponse() :> .ok
(response) :> .ok
response.json() :> .field
```

`"hello".length`, `(response).ok`, `makeResponse().ok`, and
`response.json().field` are rejected. A call ends the name-rooted path; further
member access needs another explicit pipe-member step. Assigning a value to a
name also permits dotted access: `let text = "hello"; let size = text.length;`.

Both spellings retain the existing FFI effects. Safe properties/getters and
methods return `Result` or `Task` as appropriate; dot syntax does not turn them
into pure values. The receiver must be the actual foreign value, not its enclosing
`Result`/`Task`: unwrap or use the existing carrier operations first.

JS dotted properties lower to `FfiGet`; dotted calls lower to `FfiCall`, exactly
like explicit pipe members. They share reflection, delayed HM constraints,
overload/callback inference, error wrapping, partial calls and code generation.
Method calls retain the owning JavaScript object's `this`, including deep paths.
Surface classification must not eagerly select an overload before HM has supplied
callback or remaining-argument context.

Module/namespace qualification and Workman nominal record projection retain their
existing rules. Known foreign receivers take the JS path even when their member
name also occurs on a Workman record. For an unknown receiver, an existing nominal
field label still participates in nominal record inference; annotate an ambiguous
receiver with its intended type. Unknown member labels on local receivers may
create delayed member obligations, as explicit pipe members do. This does not
introduce general structural rows or permit unresolved obligations to escape as
polymorphic values.

The parser retains name-rooted dotted syntax; the FFI elaborator lowers accesses
on foreign or unresolved local receivers. Computed postfix dots are rejected by
the grammar. Both the compiler and LSP use this elaboration. The frontend-v2
formatter remains outside this change.
