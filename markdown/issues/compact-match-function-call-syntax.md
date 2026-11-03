# Consider compact match-function calls without a separator

Status: proposal; deferred

## Syntax choice

Consider whether these should apply the completed function to `true`:

```text
match(x)=>{true=>1,false=>0}true;
match{true=>1,false=>0}true;
```

The current selected policy requires a space or explicit parentheses before the
argument. Both compact forms are syntax errors. Supported forms are:

```wm
let named = match(x)=>{true=>1,false=>0} true;
let anonymous = match{true=>1,false=>0}(true);
```

Any future compact syntax must behave the same for named and anonymous match
functions. It must remain ordinary function application and preserve arithmetic,
argument grouping, formatter round trips, and a single REPL result. It must not
silently split one expression into multiple top-level bindings.

## Definition reference

The Revised Definition's resolved expression grammar (`research/The-Definition-of-Standard-ML-Revised/app2.tex`)
defines application using atomic expressions. It has no WM-style braced match-function
syntax, so it does not decide whether `}true` should be valid WM application.

Programs (`prog.tex`) use semicolon-delimited interactive phrases; the derived
program form in `app1.tex` maps `exp; program` to `val it = exp; program`.
Independent expressions use `;`. The `and` keyword groups bindings and is not
an expression separator. Sequential declarations can omit `and`, as described
in `synmod.tex`; that is a different grammatical category from bare expressions.

The prior accidental phrase split is tracked in
[the parser fix](match-function-application-splits-into-top-level-expressions.md).
