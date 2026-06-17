{
  let nextNodeId = 0;
  let nextLiftId = 0;
  function span(loc) {
    return {
      line: loc.start.line,
      col: loc.start.column - 1,
      start: loc.start.offset,
      end: loc.end.offset,
    };
  }
  function node(loc) { return { id: nextNodeId++, span: span(loc) }; }
  function at(value, loc) { return { ...value, node: node(loc) }; }
  function atSpan(value, span) { return { ...value, node: { id: nextNodeId++, span } }; }
  function spanFromStartToLoc(startNode, loc) {
    return {
      line: startNode.span.line,
      col: startNode.span.col,
      start: startNode.span.start,
      end: loc.end.offset,
    };
  }
  function mod(decls, loc) { return at({ kind: "Module", decls }, loc); }
  function asCtor(expr) {
    if (expr.kind !== "TName" || expr.name.includes(".")) {
      throw new Error("variant members must be constructor names");
    }
    return { name: expr.name, args: expr.args, node: expr.node };
  }
  function nilExpr(loc) {
    return at({ kind: "Var", name: "Nil" }, loc);
  }
  function consExpr(head, tail, loc) {
    return at({ kind: "Call", callee: at({ kind: "Var", name: "Cons" }, loc), args: [head, tail] }, loc);
  }
  function listExpr(items, tail, loc) {
    return items.reduceRight((acc, item) => consExpr(item, acc, loc), tail ?? nilExpr(loc));
  }
  function nilPattern(loc) {
    return at({ kind: "PCtor", name: "Nil", args: [] }, loc);
  }
  function consPattern(head, tail, loc) {
    return at({ kind: "PCtor", name: "Cons", args: [head, tail] }, loc);
  }
  function listPattern(items, tail, loc) {
    return items.reduceRight((acc, item) => consPattern(item, acc, loc), tail ?? nilPattern(loc));
  }
  function recordField(name, value, loc) {
    return at({ name, value }, loc);
  }
  function recordPatternField(name, pattern, loc) {
    return at({ name, pattern }, loc);
  }
  function jsonField(key, value, loc) {
    return at({ key, value }, loc);
  }
  function varExpr(name, loc) {
    return at({ kind: "Var", name }, loc);
  }
  function callExpr(callee, args, loc) {
    return at({ kind: "Call", callee, args }, loc);
  }
  function tupleExpr(items, loc) {
    return at({ kind: "Tuple", items }, loc);
  }
  function liftedParam(name, loc) {
    return at({ pattern: at({ kind: "PVar", name }, loc) }, loc);
  }
  function liftedLambda(name, body, loc) {
    return at({ kind: "Lambda", params: [liftedParam(name, loc)], body }, loc);
  }
  function taskTupleLift(tasks, loc) {
    if (tasks.length === 0) {
      throw new Error("lifted Task tuple requires at least one task argument");
    }
    if (tasks.length === 1) return tasks[0];
    const names = tasks.map(() => `__wm_lift_${nextLiftId++}`);
    function build(index, values) {
      const name = names[index];
      const value = varExpr(name, loc);
      const nextValues = [...values, value];
      const body = index === tasks.length - 1
        ? tupleExpr(nextValues, loc)
        : build(index + 1, nextValues);
      return callExpr(
        varExpr(index === tasks.length - 1 ? "Task.map" : "Task.andThen", loc),
        [tasks[index], liftedLambda(name, body, loc)],
        loc,
      );
    }
    return build(0, []);
  }
}

Start = &{ nextNodeId = 0; nextLiftId = 0; return true; } _ decls:(_ d:TopPhrase { return d; })* _ EOF { return mod(decls, location()); }

TopPhrase = d:TopDecl _ ";" { return d; }

TopDecl = JsImportDecl / ImportDecl / RecordDecl / TypeDecl / LetDecl

ImportDecl
  = "from" __ path:String __ "import" __ clause:ImportClause
    { return at({ kind: "ImportDecl", path: path.value, pathNode: path.node, clause }, location()); }

ImportClause
  = "*" __ "as" __ alias:Name { return at({ kind: "Namespace", alias }, location()); }
  / "*" { return at({ kind: "All" }, location()); }
  / "{" _ specs:ImportSpecList? _ "}" { return at({ kind: "Named", specs: specs ?? [] }, location()); }

ImportSpecList = first:ImportSpec rest:(_ "," _ s:ImportSpec { return s; })* _ ","? { return [first, ...rest]; }
ImportSpec = name:Name alias:(_ "as" _ a:Identifier { return a; })? { return at({ name, alias }, location()); }

JsImportDecl
  = "from" __ target:JsTarget __ "import" __ typeOnly:("type" __)? clause:JsImportClause
    { return at({ kind: "JsImportDecl", target, clause, typeOnly: !!typeOnly }, location()); }

JsTarget
  = "js.global" _ "(" _ path:String _ ")"
    { return at({ kind: "JsGlobal", path: path.value }, location()); }
  / "js.global" !IdentPart
    { return at({ kind: "JsGlobalRoot" }, location()); }
  / "js.module" _ "(" _ specifier:String _ ")"
    { return at({ kind: "JsModule", specifier: specifier.value }, location()); }

JsImportClause
  = unsafe:("unsafe" __)? clause:JsImportClauseBody
    { return at({ ...clause, unsafe: !!unsafe }, location()); }

JsImportClauseBody
  = "*" __ "as" __ alias:Name { return { kind: "Namespace", alias }; }
  / "{" _ specs:JsImportSpecList? _ "}" alias:(__ "as" __ a:Name { return a; })?
    { return { kind: "Named", specs: specs ?? [], alias }; }

JsImportSpecList = first:JsImportSpec rest:(_ "," _ s:JsImportSpec { return s; })* _ ","? { return [first, ...rest]; }
JsImportSpec
  = name:MemberName alias:(_ "as" _ a:Name { return a; })? type:(_ ":" _ t:TypeExpr { return t; })?
    { return at({ name, alias, type }, location()); }

LetDecl
  = "let" __ rec:("rec" __)? first:LetBinding rest:(_ "and" __ b:LetBinding { return b; })*
    { return at({ kind: "LetDecl", exported: true, recursive: !!rec, bindings: [first, ...rest] }, location()); }

LetBinding
  = pattern:LetPattern _ ann:TypeAnn? _ "=" _ value:Expr
    { return at({ pattern, annotation: ann, value }, location()); }

LetPattern
  = "_" { return at({ kind: "PWildcard" }, location()); }
  / "void" { return at({ kind: "PVoid" }, location()); }
  / b:Bool { return at({ kind: "PBool", value: b.value }, location()); }
  / i:Int { return at({ kind: "PInt", value: i.value }, location()); }
  / s:String { return at({ kind: "PString", value: s.value }, location()); }
  / RecordLetPattern
  / ListLetPattern
  / "(" _ first:LetPattern _ "," _ rest:LetPatternList? _ ")" { return at({ kind: "PTuple", items: [first, ...(rest ?? [])] }, location()); }
  / "Var" _ "(" _ name:Identifier _ ")" { return at({ kind: "PVar", name }, location()); }
  / c:LongConstructor _ "(" _ args:LetCtorPatternList? _ ")" { return at({ kind: "PCtor", name: c, args: args ?? [] }, location()); }
  / c:LongConstructor { return at({ kind: "PCtor", name: c, args: [] }, location()); }
  / name:Identifier { return at({ kind: "PVar", name }, location()); }

LetPatternList = first:LetPattern rest:(_ "," _ p:LetPattern { return p; })* _ ","? { return [first, ...rest]; }
LetCtorPattern
  = name:Identifier { return at({ kind: "PVar", name }, location()); }
  / p:LetPattern { return p; }
LetCtorPatternList = first:LetCtorPattern rest:(_ "," _ p:LetCtorPattern { return p; })* _ ","? { return [first, ...rest]; }

RecordDecl
  = "record" __ name:Constructor params:TypeParams? _ "=" _ "{" _ fields:RecordFieldDeclList? _ "}"
    { return at({ kind: "RecordDecl", exported: true, name, params: params ?? [], fields: fields ?? [] }, location()); }

RecordFieldDeclList = first:RecordFieldDecl rest:(_ "," _ f:RecordFieldDecl { return f; })* _ ","? { return [first, ...rest]; }
RecordFieldDecl = name:FieldName _ ":" _ type:TypeExpr { return at({ name, type }, location()); }

TypeDecl
  = "type" __ name:Constructor params:TypeParams? _ "=" _ body:TypeDeclBody
    {
      return at({
        kind: "TypeDecl",
        exported: true,
        name,
        params: params ?? [],
        ctors: body.ctors,
        alias: body.alias,
        hasLeadingPipe: body.hasLeadingPipe,
      }, location());
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

Expr = IfExpr / MatchFn / MatchExpr / Lambda / Binary

IfExpr
  = "if" _ "(" _ cond:Expr _ ")" _ thenExpr:Block _ "else" _ elseExpr:Block
    { return at({ kind: "If", cond, thenExpr, elseExpr }, location()); }

MatchExpr
  = "match" _ "(" _ value:Expr _ ")" _ "{" _ arms:MatchArmList _ "}"
    { return at({ kind: "Match", value, arms }, location()); }

MatchFn
  = "match" _ "(" _ names:MatchFnParams _ ")" _ "=>" _ "{" _ arms:MatchArmList _ "}"
    {
      const params = names.map((name) => at({ pattern: at({ kind: "PVar", name }, location()) }, location()));
      const value = names.length === 1
        ? at({ kind: "Var", name: names[0] }, location())
        : at({ kind: "Tuple", items: names.map((name) => at({ kind: "Var", name }, location())) }, location());
      return at({ kind: "Lambda", params, body: at({ kind: "Match", value, arms }, location()) }, location());
    }

MatchFnParams = first:Identifier rest:(_ "," _ n:Identifier { return n; })* _ ","? { return [first, ...rest]; }

MatchArmList = first:MatchArm rest:(_ "," _ a:MatchArm { return a; })* _ ","? { return [first, ...rest]; }
MatchArm = pattern:Pattern _ "=>" _ body:Block { return at({ pattern, body }, location()); }

Lambda
  = params:ParamList _ "=>" _ body:LambdaBody { return at({ kind: "Lambda", params, body }, location()); }
  / "=>" _ body:LambdaBody { return at({ kind: "Lambda", params: [], body }, location()); }

LambdaBody = Block / ParenSeq

Binary = Or
Or = left:And rest:(_ op:("||") _ right:And { return { op, right }; })*
  { return rest.reduce((left, r) => at({ kind: "Binary", op: r.op, left, right: r.right }, location()), left); }
And = left:Equality rest:(_ op:("&&") _ right:Equality { return { op, right }; })*
  { return rest.reduce((left, r) => at({ kind: "Binary", op: r.op, left, right: r.right }, location()), left); }
Equality = left:Compare rest:(_ op:("==" / "!=") _ right:Compare { return { op, right }; })*
  { return rest.reduce((left, r) => at({ kind: "Binary", op: r.op, left, right: r.right }, location()), left); }
Compare = left:Add rest:(_ op:("<=" / ">=" / "<" / ">") _ right:Add { return { op, right }; })*
  { return rest.reduce((left, r) => at({ kind: "Binary", op: r.op, left, right: r.right }, location()), left); }
Add = left:Mul rest:(_ op:("++" / "+" / "-") _ right:Mul { return { op, right }; })*
  { return rest.reduce((left, r) => at({ kind: "Binary", op: r.op, left, right: r.right }, location()), left); }
Mul = left:Unary rest:(_ op:("*" / "/" / "%") _ right:Unary { return { op, right }; })*
  { return rest.reduce((left, r) => at({ kind: "Binary", op: r.op, left, right: r.right }, location()), left); }

Unary = op:("!" / "-") _ value:Unary { return at({ kind: "Unary", op, value }, location()); } / Pipe
Pipe = left:Postfix rest:(_ ":>" _ right:(PipeMember / Postfix) { return { right, loc: location() }; })*
  {
    return rest.reduce((left, segment) => {
      const right = segment.right;
      const exprSpan = spanFromStartToLoc(left.node, segment.loc);
      if (right.kind === "PipeMember") {
        return right.args === undefined
          ? atSpan({ kind: "FfiGet", receiver: left, path: right.path }, exprSpan)
          : atSpan({ kind: "FfiCall", receiver: left, path: right.path, args: right.args }, exprSpan);
      }
      return atSpan({ kind: "Pipe", left, right }, exprSpan);
    }, left);
  }
PipeMember = "." first:MemberName rest:("." n:MemberName { return n; })* call:(_ "(" _ args:ArgList? _ ")" { return args ?? []; })?
  { return { kind: "PipeMember", path: [first, ...rest], args: call ?? undefined }; }
Postfix = head:Primary tail:(SpaceCall / ExplicitCall)*
  { return tail.reduce((callee, item) => at({ kind: "Call", callee, args: item.args }, location()), head); }
ExplicitCall = _ "(" _ args:ArgList? _ ")" { return { kind: "Call", args: args ?? [] }; }
SpaceCall = __ arg:SpaceArg { return { kind: "Call", args: [arg] }; }
SpaceArg = Lambda / Primary

Primary
  = Float / Int / String / Bool / Void / PanicExpr / LiftTupleExpr / JsonExpr / RecordExpr / ListExpr / ParenSeq / TupleOrGroup / Block / v:LongName { return at({ kind: "Var", name: v }, location()); }

LiftTupleExpr = "|" _ args:ArgList _ "|" { return taskTupleLift(args, location()); }

PanicExpr
  = "Panic" !IdentPart _ "(" _ message:Expr _ ")"
    { return at({ kind: "Panic", message }, location()); }

JsonExpr
  = "JSON" !IdentPart _ "{" _ fields:JsonObjectFieldList? _ "}"
    { return at({ kind: "JsonObject", fields: fields ?? [] }, location()); }
  / "JSON" !IdentPart _ "[" _ items:ArgList? _ "]"
    { return at({ kind: "JsonArray", items: items ?? [] }, location()); }

JsonObjectFieldList = first:JsonObjectField rest:(_ "," _ f:JsonObjectField { return f; })* _ ","? { return [first, ...rest]; }
JsonObjectField
  = key:FieldName _ ":" _ value:Expr { return jsonField(key, value, location()); }
  / key:String _ ":" _ value:Expr { return jsonField(key.value, value, location()); }

RecordExpr
  = "." _ "{" _ fields:RecordExprFieldList? _ "}"
    { return at({ kind: "Record", fields: fields ?? [] }, location()); }
RecordExprFieldList = first:RecordExprField rest:(_ "," _ f:RecordExprField { return f; })* _ ","? { return [first, ...rest]; }
RecordExprField
  = name:FieldName _ "=" _ value:Expr { return recordField(name, value, location()); }
  / name:Identifier { return recordField(name, at({ kind: "Var", name }, location()), location()); }

ListExpr
  = "[" _ "]" { return nilExpr(location()); }
  / "[" _ ".." _ tail:Expr _ "]" { return tail; }
  / "[" _ first:Expr rest:(_ "," _ e:Expr { return e; })* tail:(_ "," _ ".." _ t:Expr { return t; })? _ ","? _ "]"
    { return listExpr([first, ...rest], tail ?? undefined, location()); }

TupleOrGroup
  = "(" _ first:Expr _ "," _ rest:ArgList? _ ")" { return at({ kind: "Tuple", items: [first, ...(rest ?? [])] }, location()); }
  / "(" _ e:Expr _ ")" { return e; }

ParenSeq = "(" _ seq:ParenSeqBody _ ")" { return at({ kind: "Block", items: seq.items, result: seq.result }, location()); }

Block
  = "{" _ seq:BlockSeqBody _ "}" {
      return at({ kind: "Block", items: seq.items, result: seq.result }, location());
    }

BlockSeqBody = items:BlockSeqItem* result:Expr? {
  return { items, result: result ?? at({ kind: "Void" }, location()) };
}

BlockSeqItem
  = d:BlockDecl _ ";" _ { return d; }
  / e:Expr _ ";" _ { return e; }

BlockDecl = RecordDecl / TypeDecl / LetDecl

ParenSeqBody = items:ParenSeqItem+ result:Expr? {
  return { items, result: result ?? at({ kind: "Void" }, location()) };
}

ParenSeqItem = e:Expr _ ";" _ { return e; }

Pattern
  = "_" { return at({ kind: "PWildcard" }, location()); }
  / "void" { return at({ kind: "PVoid" }, location()); }
  / b:Bool { return at({ kind: "PBool", value: b.value }, location()); }
  / i:Int { return at({ kind: "PInt", value: i.value }, location()); }
  / s:String { return at({ kind: "PString", value: s.value }, location()); }
  / RecordPattern
  / ListPattern
  / "(" _ first:Pattern _ "," _ rest:PatternList? _ ")" { return at({ kind: "PTuple", items: [first, ...(rest ?? [])] }, location()); }
  / "Var" _ "(" _ name:Identifier _ ")" { return at({ kind: "PVar", name }, location()); }
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return at({ kind: "PCtor", name: c, args: args ?? [] }, location()); }
  / c:LongConstructor { return at({ kind: "PCtor", name: c, args: [] }, location()); }
  / v:LongName { return at({ kind: "PPinned", name: v }, location()); }

ParamList = "(" _ ps:ParamListItems? _ ")" { return ps ?? []; }
Param = pattern:ParamPattern ann:TypeAnn? { return at({ pattern, annotation: ann }, location()); }
ParamPattern = "_" { return at({ kind: "PWildcard" }, location()); }
  / RecordParamPattern
  / ListParamPattern
  / "(" _ first:ParamPattern _ "," _ rest:ParamPatternList? _ ")" { return at({ kind: "PTuple", items: [first, ...(rest ?? [])] }, location()); }
  / v:Identifier { return at({ kind: "PVar", name: v }, location()); }
ParamListItems = first:Param rest:(_ "," _ p:Param { return p; })* _ ","? { return [first, ...rest]; }
ParamPatternList = first:ParamPattern rest:(_ "," _ p:ParamPattern { return p; })* _ ","? { return [first, ...rest]; }
PatternList = first:Pattern rest:(_ "," _ p:Pattern { return p; })* _ ","? { return [first, ...rest]; }
CtorPattern
  = "Var" _ "(" _ name:Identifier _ ")" { return at({ kind: "PVar", name }, location()); }
  / RecordPattern
  / ListPattern
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return at({ kind: "PCtor", name: c, args: args ?? [] }, location()); }
  / c:LongConstructor { return at({ kind: "PCtor", name: c, args: [] }, location()); }
  / v:Identifier { return at({ kind: "PVar", name: v }, location()); }
  / p:Pattern { return p; }
CtorPatternList = first:CtorPattern rest:(_ "," _ p:CtorPattern { return p; })* _ ","? { return [first, ...rest]; }
ArgList = first:Expr rest:(_ "," _ e:Expr { return e; })* _ ","? { return [first, ...rest]; }
ListPattern
  = "[" _ "]" { return nilPattern(location()); }
  / "[" _ ".." _ tail:ListPatternItem _ "]" { return tail; }
  / "[" _ first:ListPatternItem rest:(_ "," _ p:ListPatternItem { return p; })* tail:(_ "," _ ".." _ t:ListPatternItem { return t; })? _ ","? _ "]"
    { return listPattern([first, ...rest], tail ?? undefined, location()); }
ListPatternItem
  = "Var" _ "(" _ name:Identifier _ ")" { return at({ kind: "PVar", name }, location()); }
  / RecordPattern
  / ListPattern
  / c:LongConstructor _ "(" _ args:CtorPatternList? _ ")" { return at({ kind: "PCtor", name: c, args: args ?? [] }, location()); }
  / c:LongConstructor { return at({ kind: "PCtor", name: c, args: [] }, location()); }
  / v:Identifier { return at({ kind: "PVar", name: v }, location()); }
  / p:Pattern { return p; }
ListLetPattern
  = "[" _ "]" { return nilPattern(location()); }
  / "[" _ ".." _ tail:LetPattern _ "]" { return tail; }
  / "[" _ first:LetPattern rest:(_ "," _ p:LetPattern { return p; })* tail:(_ "," _ ".." _ t:LetPattern { return t; })? _ ","? _ "]"
    { return listPattern([first, ...rest], tail ?? undefined, location()); }
ListParamPattern
  = "[" _ "]" { return nilPattern(location()); }
  / "[" _ ".." _ tail:ParamPattern _ "]" { return tail; }
  / "[" _ first:ParamPattern rest:(_ "," _ p:ParamPattern { return p; })* tail:(_ "," _ ".." _ t:ParamPattern { return t; })? _ ","? _ "]"
    { return listPattern([first, ...rest], tail ?? undefined, location()); }
RecordPattern
  = "." _ "{" _ fields:RecordPatternFieldList? _ "}"
    { return at({ kind: "PRecord", fields: fields ?? [] }, location()); }
RecordPatternFieldList = first:RecordPatternField rest:(_ "," _ f:RecordPatternField { return f; })* _ ","? { return [first, ...rest]; }
RecordPatternField
  = name:FieldName _ "=" _ pattern:Pattern { return recordPatternField(name, pattern, location()); }
  / name:Identifier { return recordPatternField(name, at({ kind: "PVar", name }, location()), location()); }
RecordLetPattern
  = "." _ "{" _ fields:RecordLetPatternFieldList? _ "}"
    { return at({ kind: "PRecord", fields: fields ?? [] }, location()); }
RecordLetPatternFieldList = first:RecordLetPatternField rest:(_ "," _ f:RecordLetPatternField { return f; })* _ ","? { return [first, ...rest]; }
RecordLetPatternField
  = name:FieldName _ "=" _ pattern:LetPattern { return recordPatternField(name, pattern, location()); }
  / name:Identifier { return recordPatternField(name, at({ kind: "PVar", name }, location()), location()); }
RecordParamPattern
  = "." _ "{" _ fields:RecordParamPatternFieldList? _ "}"
    { return at({ kind: "PRecord", fields: fields ?? [] }, location()); }
RecordParamPatternFieldList = first:RecordParamPatternField rest:(_ "," _ f:RecordParamPatternField { return f; })* _ ","? { return [first, ...rest]; }
RecordParamPatternField
  = name:FieldName _ "=" _ pattern:ParamPattern { return recordPatternField(name, pattern, location()); }
  / name:Identifier { return recordPatternField(name, at({ kind: "PVar", name }, location()), location()); }

TypeAnn = ":" _ t:TypeExpr { return t; }
TypeExpr = FnType
FnType = "(" _ ps:TypeList? _ ")" _ "=>" _ r:TypeExpr { return at({ kind: "TFn", params: ps ?? [], result: r }, location()); } / TypeAtom
TypeAtom
  = "(" _ first:TypeExpr _ "," _ rest:TypeList? _ ")" { return at({ kind: "TTuple", items: [first, ...(rest ?? [])] }, location()); }
  / "(" _ t:TypeExpr _ ")" { return t; }
  / name:LongConstructor args:("<" _ xs:TypeList _ ">" { return xs; })? { return at({ kind: "TName", name, args: args ?? [] }, location()); }
  / name:Identifier { return at({ kind: "TVar", name }, location()); }
TypeList = first:TypeExpr rest:(_ "," _ t:TypeExpr { return t; })* _ ","? { return [first, ...rest]; }
TypeParams = "<" _ first:TypeParam rest:(_ "," _ t:TypeParam { return t; })* _ ","? _ ">" { return [first, ...rest]; }
TypeParam = name:(Identifier / Constructor) { return name; }

Float = n:$("-"? [0-9]+ "." [0-9]+) !IdentPart { return at({ kind: "Float", value: Number(n) }, location()); }
Int = n:$("-"? [0-9]+) !IdentPart { return at({ kind: "Int", value: Number(n) }, location()); }
String = MultilineString / QuotedString
QuotedString = "\"" chars:QuotedChar* "\"" { return at({ kind: "String", value: chars.join("") }, location()); }
MultilineString = "`" chars:MultilineChar* "`" { return at({ kind: "String", value: chars.join("") }, location()); }
QuotedChar
  = "\\n" { return "\n"; }
  / "\\t" { return "\t"; }
  / "\\\"" { return "\""; }
  / "\\\\" { return "\\"; }
  / !("\"" / "\\" / LineTerminator) c:. { return c; }
MultilineChar
  = "\\n" { return "\n"; }
  / "\\t" { return "\t"; }
  / "\\`" { return "`"; }
  / "\\\\" { return "\\"; }
  / !("`" / "\\") c:. { return c; }
LineTerminator = "\r\n" / "\n" / "\r"
Bool = v:("true" / "false") !IdentPart { return at({ kind: "Bool", value: v === "true" }, location()); }
Void = "void" !IdentPart { return at({ kind: "Void" }, location()); }
Identifier = !Keyword name:$([a-z_] IdentPart*) { return name; }
Constructor = !Keyword name:$([A-Z] IdentPart*) { return name; }
Name = Constructor / Identifier
MemberName = name:$([a-zA-Z_] IdentPart*) { return name; }
FieldName = !Keyword name:MemberName { return name; }
LongName = first:Name rest:("." n:MemberName { return n; })* { return [first, ...rest].join("."); }
LongConstructor = first:Constructor rest:("." n:Constructor { return n; })* { return [first, ...rest].join("."); }
IdentPart = [a-zA-Z0-9_]
Keyword = ("from" / "import" / "as" / "let" / "rec" / "and" / "type" / "record" / "if" / "else" / "match" / "true" / "false" / "void") !IdentPart
__ = (Whitespace / Comment)+
_ = (Whitespace / Comment)*
Whitespace = [ \t\r\n]
Comment = "--" [^\n]* / "//" [^\n]*
EOF = !.
