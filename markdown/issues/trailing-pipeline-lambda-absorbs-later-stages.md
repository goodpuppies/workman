# Trailing pipeline lambda absorbs later stages

Status: open, recorded 2026-11-16. Parsing follows SML's rule; the gap is the missing warning.

## Behavior

A lambda body extends as far right as possible, as `fn` does in SML. When a lambda is the
last argument of a space-applied stage, its body takes every later pipeline stage, including
stages on following lines:

```wm
let parsePair = s => {
  Ok(s)
  :> Monad.viaError Result FieldsFailed => :> String.fields(c => c == '-')
  :> Monad.via Result match {
    [a, b] => { ... },
    _ => Err(ExpectedPair)
  }
};
```

This parses as `viaError(FieldsFailed)(=> :> String.fields(...) :> Monad.via Result match {...})`.
The match runs inside the transformation and sees the raw `String.Error`, so the program fails
with a type mismatch between `String.Error` and `ParseError` that does not mention the parse.

The same happens with an ordinary lambda:

```wm
let big = items :> Monad.traverse Result (n => Ok(n + 1)) :> Result.map(List.length);
```

Here `:> Result.map(List.length)` becomes part of the lambda's body.

Braces end the lambda where intended: `=> { :> String.fields(c => c == '-') }`. A tupled call
also ends it at the closing parenthesis: `Monad.andThen(Result, => :> List.traverse(parsePair))`.

## Expected

Keep the parse; changing it would make `x :> f => :> g :> h` ambiguous. Warn when a lambda
argument of a pipeline stage absorbs stages that start on a later line than the lambda's arrow,
and suggest braces. The layout almost always means the author expected the lambda to end at the
line end. The formatter could also make the real structure visible by indenting the absorbed
stages.

## Evidence

Both examples were found while converting `wmaoc25/day2.wm` and testing `Monad.traverse`
(2026-11-16).
