{
  function mod(decls) { return { kind: "Module", decls }; }
}

Start = _ decls:(_ d:TopDecl { return d; })* _ EOF { return mod(decls); }

TopDecl = ImportDecl / TypeDecl / LetDecl

ImportDecl
  = "from" __ path:String __ "import" __ "*" __ "as" __ alias:Name _ ";"
    { return { kind: "ImportDecl", path: path.value, alias }; }

LetDecl
  = "let" __ rec:("rec" __)? first:LetBinding rest:(_ "and" __ b:LetBinding { return b; })* _ ";"
    { return { kind: "LetDecl", recursive: !!rec, bindings: [first, ...rest] }; }

LetBinding
  = pattern:LetPattern _ ann:TypeAnn? _ "=" _ value:Expr
    { return { pattern, annotation: ann, value }; }

LetPattern
  = name:Identifier { return { kind: "PVar", name }; }
  / "(" _ first:ParamPattern _ "," _ rest:ParamPatternList? _ ")" { return { kind: "PTuple", items: [first, ...(rest ?? [])] }; }

TypeDecl
  = "type" __ name:Constructor params:TypeParams? _ "=" _ ctors:CtorDeclList _ ";"
    { return { kind: "TypeDecl", name, params: params ?? [], ctors }; }

CtorDeclList = first:CtorDecl rest:(_ "|" _ c:CtorDecl { return c; })* { return [first, ...rest]; }
CtorDecl = name:Constructor args:("<" _ xs:TypeList _ ">" { return xs; })? { return { name, args: args ?? [] }; }

Expr = IfExpr / MatchFn / MatchExpr / Lambda / Binary

IfExpr
  = "if" _ "(" _ cond:Expr _ ")" _ thenExpr:Block _ "else" _ elseExpr:Block
    { return { kind: "If", cond, thenExpr, elseExpr }; }

MatchExpr
  = "match" _ "(" _ value:Expr _ ")" _ "{" _ arms:MatchArmList _ "}"
    { return { kind: "Match", value, arms }; }

MatchFn
  = "match" _ "(" _ names:MatchFnParams _ ")" _ "=>" _ "{" _ arms:MatchArmList _ "}"
    {
      const params = names.map((name) => ({ kind: "PVar", name }));
      const value = names.length === 1
        ? { kind: "Var", name: names[0] }
        : { kind: "Tuple", items: names.map((name) => ({ kind: "Var", name })) };
      return { kind: "Lambda", params, body: { kind: "Match", value, arms } };
    }

MatchFnParams = first:Identifier rest:(_ "," _ n:Identifier { return n; })* _ ","? { return [first, ...rest]; }

MatchArmList = first:MatchArm rest:(_ "," _ a:MatchArm { return a; })* _ ","? { return [first, ...rest]; }
MatchArm = pattern:Pattern _ "=>" _ body:Block { return { pattern, body }; }

Lambda
  = params:ParamList _ "=>" _ body:Block { return { kind: "Lambda", params, body }; }
  / "=>" _ body:Block { return { kind: "Lambda", params: [], body }; }

Binary = Or
Or = left:And rest:(_ op:("||") _ right:And { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }
And = left:Equality rest:(_ op:("&&") _ right:Equality { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }
Equality = left:Compare rest:(_ op:("==" / "!=") _ right:Compare { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }
Compare = left:Add rest:(_ op:("<=" / ">=" / "<" / ">") _ right:Add { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }
Add = left:Mul rest:(_ op:("+" / "-") _ right:Mul { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }
Mul = left:Unary rest:(_ op:("*" / "/" / "%") _ right:Unary { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }

Unary = op:("!" / "-") _ value:Unary { return { kind: "Unary", op, value }; } / Postfix
Postfix = head:Primary tail:(_ "(" _ args:ArgList? _ ")" { return args ?? []; })*
  { return tail.reduce((callee, args) => ({ kind: "Call", callee, args }), head); }

Primary
  = Float / Int / String / Bool / Void / TupleOrGroup / Block / v:LongName { return { kind: "Var", name: v }; }

TupleOrGroup
  = "(" _ first:Expr _ "," _ rest:ArgList? _ ")" { return { kind: "Tuple", items: [first, ...(rest ?? [])] }; }
  / "(" _ e:Expr _ ")" { return e; }

Block
  = "{" _ statements:BlockStatement* result:Expr _ ";"? _ "}" { return { kind: "Block", statements, result }; }

BlockStatement
  = d:LetDecl { return d; }
  / e:Expr _ ";" _ { return e; }

Pattern
  = "_" { return { kind: "PWildcard" }; }
  / "void" { return { kind: "PVoid" }; }
  / b:Bool { return { kind: "PBool", value: b.value }; }
  / i:Int { return { kind: "PInt", value: i.value }; }
  / s:String { return { kind: "PString", value: s.value }; }
  / "(" _ first:Pattern _ "," _ rest:PatternList? _ ")" { return { kind: "PTuple", items: [first, ...(rest ?? [])] }; }
  / "Var" _ "(" _ name:Identifier _ ")" { return { kind: "PVar", name }; }
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return { kind: "PCtor", name: c, args: args ?? [] }; }
  / c:LongConstructor { return { kind: "PCtor", name: c, args: [] }; }
  / v:LongName { return { kind: "PPinned", name: v }; }

ParamList = "(" _ ps:ParamPatternList? _ ")" { return ps ?? []; }
ParamPattern = "_" { return { kind: "PWildcard" }; }
  / "(" _ first:ParamPattern _ "," _ rest:ParamPatternList? _ ")" { return { kind: "PTuple", items: [first, ...(rest ?? [])] }; }
  / v:Identifier { return { kind: "PVar", name: v }; }
ParamPatternList = first:ParamPattern rest:(_ "," _ p:ParamPattern { return p; })* _ ","? { return [first, ...rest]; }
PatternList = first:Pattern rest:(_ "," _ p:Pattern { return p; })* _ ","? { return [first, ...rest]; }
CtorPattern
  = "Var" _ "(" _ name:Identifier _ ")" { return { kind: "PVar", name }; }
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return { kind: "PCtor", name: c, args: args ?? [] }; }
  / c:LongConstructor { return { kind: "PCtor", name: c, args: [] }; }
  / v:Identifier { return { kind: "PVar", name: v }; }
  / p:Pattern { return p; }
CtorPatternList = first:CtorPattern rest:(_ "," _ p:CtorPattern { return p; })* _ ","? { return [first, ...rest]; }
ArgList = first:Expr rest:(_ "," _ e:Expr { return e; })* _ ","? { return [first, ...rest]; }

TypeAnn = ":" _ t:TypeExpr { return t; }
TypeExpr = FnType
FnType = "(" _ ps:TypeList? _ ")" _ "=>" _ r:TypeExpr { return { kind: "TFn", params: ps ?? [], result: r }; } / TypeAtom
TypeAtom
  = "(" _ first:TypeExpr _ "," _ rest:TypeList? _ ")" { return { kind: "TTuple", items: [first, ...(rest ?? [])] }; }
  / "(" _ t:TypeExpr _ ")" { return t; }
  / name:LongConstructor args:("<" _ xs:TypeList _ ">" { return xs; })? { return { kind: "TName", name, args: args ?? [] }; }
  / name:Identifier { return { kind: "TVar", name }; }
TypeList = first:TypeExpr rest:(_ "," _ t:TypeExpr { return t; })* _ ","? { return [first, ...rest]; }
TypeParams = "<" _ first:TypeParam rest:(_ "," _ t:TypeParam { return t; })* _ ","? _ ">" { return [first, ...rest]; }
TypeParam = name:(Identifier / Constructor) { return name; }

Float = n:$("-"? [0-9]+ "." [0-9]+) !IdentPart { return { kind: "Float", value: Number(n) }; }
Int = n:$("-"? [0-9]+) !IdentPart { return { kind: "Int", value: Number(n) }; }
String = "\"" chars:Char* "\"" { return { kind: "String", value: chars.join("") }; }
Char = "\\n" { return "\n"; } / "\\t" { return "\t"; } / "\\\"" { return "\""; } / "\\\\" { return "\\"; } / !("\"" / "\\") c:. { return c; }
Bool = v:("true" / "false") !IdentPart { return { kind: "Bool", value: v === "true" }; }
Void = "void" !IdentPart { return { kind: "Void" }; }
Identifier = !Keyword name:$([a-z_] IdentPart*) { return name; }
Constructor = !Keyword name:$([A-Z] IdentPart*) { return name; }
Name = Constructor / Identifier
LongName = first:Name rest:("." n:Name { return n; })* { return [first, ...rest].join("."); }
LongConstructor = first:Constructor rest:("." n:Constructor { return n; })* { return [first, ...rest].join("."); }
IdentPart = [a-zA-Z0-9_]
Keyword = ("from" / "import" / "as" / "let" / "rec" / "and" / "type" / "if" / "else" / "match" / "true" / "false" / "void") !IdentPart
__ = (Whitespace / Comment)+
_ = (Whitespace / Comment)*
Whitespace = [ \t\r\n]
Comment = "--" [^\n]* / "//" [^\n]*
EOF = !.
