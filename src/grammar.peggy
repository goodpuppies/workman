{
  function mod(decls) { return { kind: "Module", decls }; }
  function asCtor(expr) {
    if (expr.kind !== "TName" || expr.name.includes(".")) {
      throw new Error("variant members must be constructor names");
    }
    return { name: expr.name, args: expr.args };
  }
  function nilExpr() {
    return { kind: "Var", name: "Nil" };
  }
  function consExpr(head, tail) {
    return { kind: "Call", callee: { kind: "Var", name: "Cons" }, args: [head, tail] };
  }
  function listExpr(items, tail) {
    return items.reduceRight((acc, item) => consExpr(item, acc), tail ?? nilExpr());
  }
  function nilPattern() {
    return { kind: "PCtor", name: "Nil", args: [] };
  }
  function consPattern(head, tail) {
    return { kind: "PCtor", name: "Cons", args: [head, tail] };
  }
  function listPattern(items, tail) {
    return items.reduceRight((acc, item) => consPattern(item, acc), tail ?? nilPattern());
  }
  function recordField(name, value) {
    return { name, value };
  }
  function recordPatternField(name, pattern) {
    return { name, pattern };
  }
}

Start = _ decls:(_ d:TopDecl { return d; })* _ EOF { return mod(decls); }

TopDecl = ImportDecl / RecordDecl / TypeDecl / LetDecl

ImportDecl
  = "from" __ path:String __ "import" __ clause:ImportClause _ ";"
    { return { kind: "ImportDecl", path: path.value, clause }; }

ImportClause
  = "*" __ "as" __ alias:Name { return { kind: "Namespace", alias }; }
  / "{" _ specs:ImportSpecList? _ "}" { return { kind: "Named", specs: specs ?? [] }; }

ImportSpecList = first:ImportSpec rest:(_ "," _ s:ImportSpec { return s; })* _ ","? { return [first, ...rest]; }
ImportSpec = name:Name alias:(_ "as" _ a:Identifier { return a; })? { return { name, alias }; }

LetDecl
  = exported:ExportModifier? "let" __ rec:("rec" __)? first:LetBinding rest:(_ "and" __ b:LetBinding { return b; })* _ ";"
    { return { kind: "LetDecl", exported: !!exported, recursive: !!rec, bindings: [first, ...rest] }; }

LetBinding
  = pattern:LetPattern _ ann:TypeAnn? _ "=" _ value:Expr
    { return { pattern, annotation: ann, value }; }

LetPattern
  = "_" { return { kind: "PWildcard" }; }
  / "void" { return { kind: "PVoid" }; }
  / b:Bool { return { kind: "PBool", value: b.value }; }
  / i:Int { return { kind: "PInt", value: i.value }; }
  / s:String { return { kind: "PString", value: s.value }; }
  / RecordLetPattern
  / ListLetPattern
  / "(" _ first:LetPattern _ "," _ rest:LetPatternList? _ ")" { return { kind: "PTuple", items: [first, ...(rest ?? [])] }; }
  / "Var" _ "(" _ name:Identifier _ ")" { return { kind: "PVar", name }; }
  / c:LongConstructor _ "(" _ args:LetCtorPatternList? _ ")" { return { kind: "PCtor", name: c, args: args ?? [] }; }
  / c:LongConstructor { return { kind: "PCtor", name: c, args: [] }; }
  / name:Identifier { return { kind: "PVar", name }; }

LetPatternList = first:LetPattern rest:(_ "," _ p:LetPattern { return p; })* _ ","? { return [first, ...rest]; }
LetCtorPattern
  = name:Identifier { return { kind: "PVar", name }; }
  / p:LetPattern { return p; }
LetCtorPatternList = first:LetCtorPattern rest:(_ "," _ p:LetCtorPattern { return p; })* _ ","? { return [first, ...rest]; }

RecordDecl
  = exported:ExportModifier? "record" __ name:Constructor params:TypeParams? _ "=" _ "{" _ fields:RecordFieldDeclList? _ "}" _ ";"
    { return { kind: "RecordDecl", exported: !!exported, name, params: params ?? [], fields: fields ?? [] }; }

RecordFieldDeclList = first:RecordFieldDecl rest:(_ "," _ f:RecordFieldDecl { return f; })* _ ","? { return [first, ...rest]; }
RecordFieldDecl = name:Identifier _ ":" _ type:TypeExpr { return { name, type }; }

TypeDecl
  = exported:ExportModifier? "type" __ name:Constructor params:TypeParams? _ "=" _ body:TypeDeclBody _ ";"
    {
      return {
        kind: "TypeDecl",
        exported: !!exported,
        name,
        params: params ?? [],
        ctors: body.ctors,
        alias: body.alias,
        hasLeadingPipe: body.hasLeadingPipe,
      };
    }

TypeDeclBody
  = hasLeadingPipe:("|" _ { return true; })? first:TypeExpr rest:(_ "|" _ t:TypeExpr { return t; })*
    {
      if (!hasLeadingPipe && rest.length === 0) {
        return { alias: first, ctors: [], hasLeadingPipe: false };
      }
      const members = [first, ...rest];
      return {
        alias: undefined,
        ctors: members.map(asCtor),
        hasLeadingPipe: !!hasLeadingPipe,
      };
    }

ExportModifier = "export" __

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
      const params = names.map((name) => ({ pattern: { kind: "PVar", name } }));
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
  = Float / Int / String / Bool / Void / RecordExpr / ListExpr / TupleOrGroup / Block / v:LongName { return { kind: "Var", name: v }; }

RecordExpr
  = "." _ "{" _ fields:RecordExprFieldList? _ "}"
    { return { kind: "Record", fields: fields ?? [] }; }
RecordExprFieldList = first:RecordExprField rest:(_ "," _ f:RecordExprField { return f; })* _ ","? { return [first, ...rest]; }
RecordExprField
  = name:Identifier _ "=" _ value:Expr { return recordField(name, value); }
  / name:Identifier { return recordField(name, { kind: "Var", name }); }

ListExpr
  = "[" _ "]" { return nilExpr(); }
  / "[" _ ".." _ tail:Expr _ "]" { return tail; }
  / "[" _ first:Expr rest:(_ "," _ e:Expr { return e; })* tail:(_ "," _ ".." _ t:Expr { return t; })? _ ","? _ "]"
    { return listExpr([first, ...rest], tail ?? undefined); }

TupleOrGroup
  = "(" _ first:Expr _ "," _ rest:ArgList? _ ")" { return { kind: "Tuple", items: [first, ...(rest ?? [])] }; }
  / "(" _ e:Expr _ ")" { return e; }

Block
  = "{" _ items:BlockItem* result:Expr? _ "}" {
      return { kind: "Block", items, result: result ?? { kind: "Void" } };
    }

BlockItem
  = d:TypeDecl _ { return d; }
  / d:LetDecl _ { return d; }
  / &(Expr _ ";") e:Expr _ ";" _ { return e; }

Pattern
  = "_" { return { kind: "PWildcard" }; }
  / "void" { return { kind: "PVoid" }; }
  / b:Bool { return { kind: "PBool", value: b.value }; }
  / i:Int { return { kind: "PInt", value: i.value }; }
  / s:String { return { kind: "PString", value: s.value }; }
  / RecordPattern
  / ListPattern
  / "(" _ first:Pattern _ "," _ rest:PatternList? _ ")" { return { kind: "PTuple", items: [first, ...(rest ?? [])] }; }
  / "Var" _ "(" _ name:Identifier _ ")" { return { kind: "PVar", name }; }
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return { kind: "PCtor", name: c, args: args ?? [] }; }
  / c:LongConstructor { return { kind: "PCtor", name: c, args: [] }; }
  / v:LongName { return { kind: "PPinned", name: v }; }

ParamList = "(" _ ps:ParamListItems? _ ")" { return ps ?? []; }
Param = pattern:ParamPattern ann:TypeAnn? { return { pattern, annotation: ann }; }
ParamPattern = "_" { return { kind: "PWildcard" }; }
  / RecordParamPattern
  / ListParamPattern
  / "(" _ first:ParamPattern _ "," _ rest:ParamPatternList? _ ")" { return { kind: "PTuple", items: [first, ...(rest ?? [])] }; }
  / v:Identifier { return { kind: "PVar", name: v }; }
ParamListItems = first:Param rest:(_ "," _ p:Param { return p; })* _ ","? { return [first, ...rest]; }
ParamPatternList = first:ParamPattern rest:(_ "," _ p:ParamPattern { return p; })* _ ","? { return [first, ...rest]; }
PatternList = first:Pattern rest:(_ "," _ p:Pattern { return p; })* _ ","? { return [first, ...rest]; }
CtorPattern
  = "Var" _ "(" _ name:Identifier _ ")" { return { kind: "PVar", name }; }
  / RecordPattern
  / ListPattern
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return { kind: "PCtor", name: c, args: args ?? [] }; }
  / c:LongConstructor { return { kind: "PCtor", name: c, args: [] }; }
  / v:Identifier { return { kind: "PVar", name: v }; }
  / p:Pattern { return p; }
CtorPatternList = first:CtorPattern rest:(_ "," _ p:CtorPattern { return p; })* _ ","? { return [first, ...rest]; }
ArgList = first:Expr rest:(_ "," _ e:Expr { return e; })* _ ","? { return [first, ...rest]; }
ListPattern
  = "[" _ "]" { return nilPattern(); }
  / "[" _ ".." _ tail:ListPatternItem _ "]" { return tail; }
  / "[" _ first:ListPatternItem rest:(_ "," _ p:ListPatternItem { return p; })* tail:(_ "," _ ".." _ t:ListPatternItem { return t; })? _ ","? _ "]"
    { return listPattern([first, ...rest], tail ?? undefined); }
ListPatternItem
  = "Var" _ "(" _ name:Identifier _ ")" { return { kind: "PVar", name }; }
  / RecordPattern
  / ListPattern
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return { kind: "PCtor", name: c, args: args ?? [] }; }
  / c:LongConstructor { return { kind: "PCtor", name: c, args: [] }; }
  / v:Identifier { return { kind: "PVar", name: v }; }
  / p:Pattern { return p; }
ListLetPattern
  = "[" _ "]" { return nilPattern(); }
  / "[" _ ".." _ tail:LetPattern _ "]" { return tail; }
  / "[" _ first:LetPattern rest:(_ "," _ p:LetPattern { return p; })* tail:(_ "," _ ".." _ t:LetPattern { return t; })? _ ","? _ "]"
    { return listPattern([first, ...rest], tail ?? undefined); }
ListParamPattern
  = "[" _ "]" { return nilPattern(); }
  / "[" _ ".." _ tail:ParamPattern _ "]" { return tail; }
  / "[" _ first:ParamPattern rest:(_ "," _ p:ParamPattern { return p; })* tail:(_ "," _ ".." _ t:ParamPattern { return t; })? _ ","? _ "]"
    { return listPattern([first, ...rest], tail ?? undefined); }
RecordPattern
  = "." _ "{" _ fields:RecordPatternFieldList? _ "}"
    { return { kind: "PRecord", fields: fields ?? [] }; }
RecordPatternFieldList = first:RecordPatternField rest:(_ "," _ f:RecordPatternField { return f; })* _ ","? { return [first, ...rest]; }
RecordPatternField
  = name:Identifier _ "=" _ pattern:Pattern { return recordPatternField(name, pattern); }
  / name:Identifier { return recordPatternField(name, { kind: "PVar", name }); }
RecordLetPattern
  = "." _ "{" _ fields:RecordLetPatternFieldList? _ "}"
    { return { kind: "PRecord", fields: fields ?? [] }; }
RecordLetPatternFieldList = first:RecordLetPatternField rest:(_ "," _ f:RecordLetPatternField { return f; })* _ ","? { return [first, ...rest]; }
RecordLetPatternField
  = name:Identifier _ "=" _ pattern:LetPattern { return recordPatternField(name, pattern); }
  / name:Identifier { return recordPatternField(name, { kind: "PVar", name }); }
RecordParamPattern
  = "." _ "{" _ fields:RecordParamPatternFieldList? _ "}"
    { return { kind: "PRecord", fields: fields ?? [] }; }
RecordParamPatternFieldList = first:RecordParamPatternField rest:(_ "," _ f:RecordParamPatternField { return f; })* _ ","? { return [first, ...rest]; }
RecordParamPatternField
  = name:Identifier _ "=" _ pattern:ParamPattern { return recordPatternField(name, pattern); }
  / name:Identifier { return recordPatternField(name, { kind: "PVar", name }); }

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
Keyword = ("from" / "import" / "as" / "export" / "let" / "rec" / "and" / "type" / "record" / "if" / "else" / "match" / "true" / "false" / "void") !IdentPart
__ = (Whitespace / Comment)+
_ = (Whitespace / Comment)*
Whitespace = [ \t\r\n]
Comment = "--" [^\n]* / "//" [^\n]*
EOF = !.
