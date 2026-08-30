{
  const constructors = new Set();
  function mod(decls) { return { kind: "Module", decls }; }
  function ctorName(name) {
    if (!constructors.has(name)) constructors.add(name);
    return name;
  }
  function typeName(name) {
    if (name === "int") return "Number";
    if (name === "bool") return "Bool";
    if (name === "string") return "String";
    if (name === "unit") return "Void";
    return name;
  }
  function call(callee, arg) {
    return { kind: "Call", callee, args: [arg] };
  }
  function tuple(items) {
    return { kind: "Tuple", items };
  }
  function tuplePattern(items) {
    return { kind: "PTuple", items };
  }
  function patternName(name) {
    if (constructors.has(name)) return { kind: "PCtor", name, args: [] };
    return { kind: "PVar", name };
  }
  function ctorPattern(name, arg) {
    if (!constructors.has(name)) throw new Error(`unknown constructor pattern ${name}`);
    return { kind: "PCtor", name, args: arg.kind === "PTuple" ? arg.items : [arg] };
  }
}

Start = _ decls:(_ d:TopDecl _ Semi? { return d; })* _ EOF { return mod(decls); }

TopDecl = DatatypeDecl / ValDecl

ValDecl = RecValDecl / PlainValDecl

PlainValDecl
  = "val" __ first:ValBinding rest:(_ "and" __ b:ValBinding { return b; })*
    { return { kind: "LetDecl", exported: false, recursive: false, bindings: [first, ...rest] }; }

RecValDecl
  = "val" __ "rec" __ first:RecValBinding rest:(_ "and" __ b:RecValBinding { return b; })*
    {
      const bindings = [first, ...rest];
      bindings.forEach((binding) => constructors.delete(binding.pattern.name));
      return { kind: "LetDecl", exported: false, recursive: true, bindings };
    }

ValBinding
  = pattern:Pattern _ ann:TypeAnn? _ "=" _ value:Expr
    { return { pattern, annotation: ann, value }; }

RecValBinding
  = name:Name _ ann:TypeAnn? _ "=" _ value:FnExpr
    { return { pattern: { kind: "PVar", name }, annotation: ann, value }; }

DatatypeDecl
  = "datatype" __ params:DatatypeParams? name:TyCon _ "=" _ ctors:DatatypeCtorList
    { return { kind: "TypeDecl", exported: false, name, params: params ?? [], ctors, hasLeadingPipe: false }; }

DatatypeParams
  = vars:TyVarTuple __ { return vars; }
  / v:TyVar __ { return [v]; }

DatatypeCtorList = first:DatatypeCtor rest:(_ "|" _ c:DatatypeCtor { return c; })*
  { return [first, ...rest]; }
DatatypeCtor
  = name:ConName __ "of" __ arg:TypeExpr { return { name: ctorName(name), args: arg.kind === "TTuple" ? arg.items : [arg] }; }
  / name:ConName { return { name: ctorName(name), args: [] }; }

Expr = FnExpr / CaseExpr / IfExpr / Binary

FnExpr
  = "fn" __ p:Pattern _ "=>" _ body:Expr
    { return { kind: "Lambda", params: [{ pattern: p }], directives: [], body }; }

CaseExpr
  = "case" __ value:Expr __ "of" __ arms:CaseArmList
    { return { kind: "Match", value, arms }; }

CaseArmList = first:CaseArm rest:(_ "|" _ a:CaseArm { return a; })*
  { return [first, ...rest]; }
CaseArm = pattern:Pattern _ "=>" _ body:Expr { return { pattern, body }; }

IfExpr
  = "if" __ cond:Expr __ "then" __ thenExpr:Expr __ "else" __ elseExpr:Expr
    { return { kind: "If", cond, thenExpr, elseExpr }; }

Binary = Equality
Equality = left:Compare rest:(_ op:("=" / "<>") _ right:Compare { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op === "=" ? "==" : "!=", left, right: r.right }), left); }
Compare = left:Add rest:(_ op:("<=" / ">=" / "<" / ">") _ right:Add { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }
Add = left:Mul rest:(_ op:("+" / "-") _ right:Mul { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op, left, right: r.right }), left); }
Mul = left:App rest:(_ op:("*" / "/" / "div" / "mod") _ right:App { return { op, right }; })*
  { return rest.reduce((left, r) => ({ kind: "Binary", op: r.op === "div" ? "/" : r.op === "mod" ? "%" : r.op, left, right: r.right }), left); }

App = head:Unary tail:(__ a:Unary { return a; })*
  { return tail.reduce(call, head); }

Unary = "~" _ value:Unary { return { kind: "Unary", op: "-", value }; } / Primary

Primary
  = Int / String / Bool / Unit / TupleOrGroup / v:LongName { return { kind: "Var", name: v }; }

TupleOrGroup
  = "(" _ first:Expr _ "," _ rest:ExprList _ ")" { return tuple([first, ...rest]); }
  / "(" _ e:Expr _ ")" { return e; }

Pattern
  = "_" { return { kind: "PWildcard" }; }
  / IntPattern
  / StringPattern
  / BoolPattern
  / UnitPattern
  / "(" _ first:Pattern _ "," _ rest:PatternList _ ")" { return tuplePattern([first, ...rest]); }
  / name:ConName __ arg:PatternAtom { return ctorPattern(name, arg); }
  / name:LongName { return patternName(name); }

PatternAtom
  = IntPattern / StringPattern / BoolPattern / UnitPattern
  / "(" _ first:Pattern _ "," _ rest:PatternList _ ")" { return tuplePattern([first, ...rest]); }
  / "(" _ p:Pattern _ ")" { return p; }
  / name:LongName { return patternName(name); }

PatternList = first:Pattern rest:(_ "," _ p:Pattern { return p; })* _ ","? { return [first, ...rest]; }

TypeAnn = ":" _ t:TypeExpr { return t; }
TypeExpr = FnType
FnType = left:TupleType _ "->" _ right:TypeExpr { return { kind: "TFn", params: [left], result: right }; } / TupleType
TupleType = first:AppType rest:(_ "*" _ t:AppType { return t; })*
  { return rest.length ? { kind: "TTuple", items: [first, ...rest] } : first; }
AppType
  = arg:TypeAtom __ name:TyCon { return { kind: "TName", name: typeName(name), args: [arg] }; }
  / args:TyTuple __ name:TyCon { return { kind: "TName", name: typeName(name), args }; }
  / TypeAtom
TypeAtom
  = v:TyVar { return { kind: "TVar", name: v }; }
  / name:TyCon { return { kind: "TName", name: typeName(name), args: [] }; }
  / "(" _ t:TypeExpr _ ")" { return t; }

TyTuple = "(" _ first:TypeExpr _ "," _ rest:TypeList _ ")" { return [first, ...rest]; }
TyVarTuple = "(" _ first:TyVar _ "," _ rest:TyVarList _ ")" { return [first, ...rest]; }
TyVarList = first:TyVar rest:(_ "," _ v:TyVar { return v; })* _ ","? { return [first, ...rest]; }
TypeList = first:TypeExpr rest:(_ "," _ t:TypeExpr { return t; })* _ ","? { return [first, ...rest]; }
ExprList = first:Expr rest:(_ "," _ e:Expr { return e; })* _ ","? { return [first, ...rest]; }

Int = n:$([0-9]+) !IdentPart { return { kind: "Int", value: Number(n) }; }
IntPattern = n:$([0-9]+) !IdentPart { return { kind: "PInt", value: Number(n) }; }
String = "\"" chars:Char* "\"" { return { kind: "String", value: chars.join("") }; }
StringPattern = "\"" chars:Char* "\"" { return { kind: "PString", value: chars.join("") }; }
Char = "\\n" { return "\n"; } / "\\t" { return "\t"; } / "\\\"" { return "\"" } / "\\\\" { return "\\"; } / !("\"" / "\\") c:. { return c; }
Bool = v:("true" / "false") !IdentPart { return { kind: "Bool", value: v === "true" }; }
BoolPattern = v:("true" / "false") !IdentPart { return { kind: "PBool", value: v === "true" }; }
Unit = "(" _ ")" { return { kind: "Void" }; }
UnitPattern = "(" _ ")" { return { kind: "PVoid" }; }

TyVar = "'" name:$([a-zA-Z_][a-zA-Z0-9_]*) { return name; }
TyCon = !Keyword name:$([a-zA-Z_][a-zA-Z0-9_]*) { return name; }
ConName = !Keyword name:$([A-Z][a-zA-Z0-9_]* / [a-zA-Z_][a-zA-Z0-9_]*) { return name; }
Name = !Keyword name:$([a-zA-Z_][a-zA-Z0-9_]*) { return name; }
LongName = first:Name rest:("." n:Name { return n; })* { return [first, ...rest].join("."); }
IdentPart = [a-zA-Z0-9_']
Keyword = ("val" / "rec" / "and" / "datatype" / "of" / "fn" / "case" / "if" / "then" / "else" / "true" / "false" / "div" / "mod") !IdentPart
Semi = ";"+
__ = (Whitespace / Comment)+
_ = (Whitespace / Comment)*
Whitespace = [ \t\r\n]
Comment = "(*" (Comment / !"*)" .)* "*)"
EOF = !.
