(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./wm_lexer.sml" import * as WmLexer;
from "./subset_string.sml" import * as SubsetString;
from "./sml_list.sml" import * as SmlList;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_char.sml" import * as SubsetChar;
from "./wm_print.sml" import * as WmPrint;
from "./backend_names.sml" import * as BackendNames;
from "./subset_list.sml" import * as SubsetList;
from "./sml_option.sml" import * as SmlOption;
*)

(* Parsing Workman source into SubsetML abstract syntax: the reverse of WmPrint.

   It accepts the Workman fragment that corresponds to SubsetML, plus the expression compatibility forms that
   WmPrint emits (`div`, `mod`, `@`, `o`, `before`, `#lab`, `~`). Workman features outside
   the reverse profile (JS receivers, JSON, FFI imports, ...) are reported as errors.
   Numeric, pinned and computed match patterns survive internally until binding resolution lowers them. *)
structure WmParse = struct
  open SubsetOptionValue

  open Syntax
  open WmLexer

  type toks = (token * pos) list

  datatype 'a res =
      Done of 'a * toks
    | Fail of string * pos

  val bind = fn r => fn k =>
    case r of
      Done (x, ts) => k x ts
    | Fail (message, pos) => Fail (message, pos)

  (* WmProject marks a bare namespace alias as `\`alias.Name.Target`. Only a value atom reads the
     mark (parseAtom); everywhere else it is the plain name. *)
  val peek = fn
      (WName ["`alias", head, _], p) :: _ => (WName [head], p)
    | (WName ["`bind", name], p) :: _ => (WName [name], p)
    | t :: _ => t
    | [] => (WEOF, 0)

  val advance = fn
      _ :: rest => rest
    | [] => []

  val posOf = fn ts => let val (_, p) = peek ts in p end

  val isKey = fn (k, ts) =>
    case peek ts of
      (WKey k', _) => k = k'
    | _ => false

  val describe = fn
      WKey k => "`" ^ k ^ "`"
    | WName path => "`" ^ SubsetString.concatWith (path, ".") ^ "`"
    | WSelect l => "`#" ^ l ^ "`"
    | WScon _ => "a literal"
    | WOpen _ => "a resolved header open"
    | WEOF => "end of input"

  val expected = fn (what, ts) =>
    let val (t, p) = peek ts in Fail ("expected " ^ what ^ ", found " ^ describe t, p) end

  val expect = fn (k, ts) =>
    if isKey (k, ts) then Done ((), advance ts) else expected ("`" ^ k ^ "`", ts)

  (* `item (sep item)*`, allowing a trailing separator before `close`. *)
  val separated = fn (item, sep, close, ts) =>
    let
      val rec loop = fn (acc, ts) =>
        if isKey (close, ts) then Done (SmlList.rev acc, ts)
        else
          case item ts of
            Done (x, rest) =>
              if isKey (sep, rest) then loop (x :: acc, advance rest)
              else Done (SmlList.rev (x :: acc), rest)
          | Fail (message, offset) => Fail (message, offset)
    in
      loop ([], ts)
    end

  (* `open items close` *)
  val delimited = fn (openK, item, sep, close, ts) =>
    bind (expect (openK, ts)) (fn _ => fn ts =>
      bind (separated (item, sep, close, ts)) (fn xs => fn ts =>
        bind (expect (close, ts)) (fn _ => fn ts => Done (xs, ts))))

  (* --------------------------------------------------------------------------------------- *)
  (* Names (the inverse of WmPrint's) *)

  val isUpperName = fn s => CompilerText.firstIs (s, SubsetChar.isUpper)

  val decapitalize = fn s =>
    case CompilerText.characters s of [] => "" | c :: rest => CompilerText.stringOf (SubsetChar.toLower c :: rest)

  val valueName = fn
      ([], "Nil") => ([], "nil")
    | ([], "Cons") => ([], "::")
    | (qs, "None") => (qs, "NONE")
    | (qs, "Some") => (qs, "SOME")
    | id =>
        (case SmlList.find (fn (_, wm) => wm = id) WmPrint.numNames of
           SOME entry => let val (sml, _) = entry in sml end
         | NONE => id)

  val constructorName = fn name =>
    let val (_, target) = valueName ([], name) in target end

  val tyConName = fn
      ([], "Void") => ([], "unit")
    | (["Real64"], "Real") => ([], "real")
    | ([], "Real64") => ([], "real")
    | (["Int32"], "Int") => ([], "int")
    | ([], "Int32") => ([], "int")
    | (qs, s) => (qs, decapitalize s)

  (* Splits a path into structure qualifiers, the named value, and record field selections. *)
  val splitPath = fn path =>
    let
      val rec go = fn
          (quals, [last]) => (SmlList.rev quals, last, [])
        | (quals, c :: rest) => if isUpperName c then go (c :: quals, rest) else (SmlList.rev quals, c, rest)
        | (quals, []) => (SmlList.rev quals, "", [])
    in
      go ([], path)
    end

  val rec lastOf = fn path => case path of [] => "" | [name] => name | _ :: rest => lastOf rest

  val pathExp = fn (p, path) =>
    let val (quals, base, fields) = splitPath path in
      SmlList.foldl (fn (l, e) => EApp (ESelect (p, l), e)) (EId (p, valueName (quals, base))) fields
    end

  (* "./sml_print.wm" names the structure SmlPrint. *)
  val structureName = fn file =>
    let
      val base =
        case SmlList.rev (CompilerText.fields (file, fn c => c = #"/")) of
          last :: _ => last
        | [] => file
      val stem = if CompilerText.isSuffix (base, ".wm") then CompilerText.slice (base, 0, CompilerText.size base - 3) else base
    in BackendNames.moduleHint stem
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Types *)

  val rec parseType = fn ts =>
    bind (parseTypeAtom ts) (fn t => fn ts =>
      if isKey ("->", ts) then
        bind (parseType (advance ts)) (fn r => fn ts => Done (TyArrow (t, r), ts))
      else Done (t, ts))

  and parseTypeAtom = fn ts =>
    case peek ts of
      (WKey "(", _) =>
        bind (delimited ("(", parseType, ",", ")", ts)) (fn types => fn ts =>
          case types of
            [single] => Done (single, ts)
          | [] => expected ("a type", ts)
          | _ => Done (TyTuple types, ts))
    | (WName [v], _) =>
        if isUpperName v then typeName ([], v, advance ts) else Done (TyVar ("'" ^ v), advance ts)
    | (WName path, _) =>
        (case SmlList.rev path of
           last :: rest => typeName (SmlList.rev rest, last, advance ts)
         | [] => expected ("a type", ts))
    | _ => expected ("a type", ts)

  and typeName = fn (quals, name, ts) =>
    if isKey ("<", ts) then
      bind (delimited ("<", parseType, ",", ">", ts)) (fn args => fn ts =>
        Done (TyCon (args, tyConName (quals, name)), ts))
    else Done (TyCon ([], tyConName (quals, name)), ts)

  val negativeLiteral = fn (minusPos, ts) =>
    case peek ts of
      (WScon (SInt s), p) => if (p = minusPos + 1) then SOME (SInt ("~" ^ s)) else NONE
    | (WScon (SReal s), p) => if (p = minusPos + 1) then SOME (SReal ("~" ^ s)) else NONE
    | _ => NONE

  (* The text of an integer literal at the start of `ts`, `-` included: `(n: Int32.Int)` is an SML int
     constant even outside the range a bare literal reads as int. *)
  val integerText = fn ts =>
    case peek ts of
      (WScon (SInt s), _) => SOME s
    | (WKey "-", p) => (case peek (advance ts) of
        (WScon (SInt s), q) => if q = p + 1 then SOME ("~" ^ s) else NONE
      | _ => NONE)
    | _ => NONE

  val isIntType = fn t => case t of TyCon ([], ([], "int")) => true | _ => false

  (* Builds `h1 :: ... :: tail`. *)
  val consPat = fn (p, items, tail) =>
    SmlList.foldr (fn (h, t) => PApp (p, ([], "::"), PTuple [h, t])) tail items

  (* `[a, b, ..tail]` after the `[`: the items and the optional spread tail. *)
  val listItems = fn (item, ts) =>
    let
      val rec go = fn (acc, ts) =>
        case peek ts of
          (WKey "]", _) => Done ((SmlList.rev acc, NONE), advance ts)
        | (WKey "..", _) =>
            bind (item (advance ts)) (fn t => fn ts =>
              bind (expect ("]", if isKey (",", ts) then advance ts else ts)) (fn _ => fn ts =>
                Done ((SmlList.rev acc, SOME t), ts)))
        | _ =>
            (case item ts of
               Done (x, rest) =>
                 if isKey (",", rest) then go (x :: acc, advance rest)
                 else bind (expect ("]", rest)) (fn _ => fn rest => Done ((SmlList.rev (x :: acc), NONE), rest))
             | Fail (message, offset) => Fail (message, offset))
    in
      go ([], ts)
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Expressions *)

  (* Capture contracts have no SML runtime representation. WM checks their lexical contract;
     reverse translation retains ordinary lexical closure semantics after parsing the list. *)
  val captureClause = fn ts =>
    if isKey ("||", ts) then Done ((), advance ts)
    else (if isKey ("|", ts) then
      let val name = fn ts => case peek ts of
              (WName [name], _) => Done (name, advance ts)
            | _ => expected ("a capture name", ts)
      in bind (separated (name, ",", "|", advance ts)) (fn names => fn rest =>
        if SubsetList.exists (names, fn name =>
          SubsetList.length (SubsetList.filter (names, fn other => other = name)) > 1)
        then Fail ("a capture is listed more than once", posOf ts)
        else bind (expect ("|", rest)) (fn _ => fn rest => Done ((), rest))) end
    else Done ((), ts))

  (* Whether a result annotation `: T` at the head of ts is followed by `=>`. A type never
     contains `=>`, and a token no type can contain ends the search. *)
  val resultAnnotationAhead = fn ts =>
    let
      val rec scan = fn (depth, ts) =>
        case peek ts of
          (WEOF, _) => false
        | (WKey k, _) =>
            if k = "=>" then depth = 0
            else (if depth = 0 andalso (k = "|" orelse k = "||") then
              (case captureClause ts of Done (_, rest) => isKey ("=>", rest) | Fail _ => false)
            else (if k = "(" orelse k = "<" then scan (depth + 1, advance ts)
            else (if k = ")" orelse k = ">" then
              (if depth = 0 then false else scan (depth - 1, advance ts))
            else (if k = "," then (if depth = 0 then false else scan (depth, advance ts))
            else (if k = "->" orelse k = "." then scan (depth, advance ts) else false)))))
        | (WName _, _) => scan (depth, advance ts)
        | _ => false
    in
      isKey (":", ts) andalso scan (0, advance ts)
    end

  (* Whether the `(` at the head of ts begins a lambda, i.e. its matching `)` is followed by `=>`,
     or by a result annotation and then `=>`. *)
  val lambdaAhead = fn ts =>
    let
      val rec scan = fn (depth, ts) =>
        case peek ts of
          (WEOF, _) => false
        | (WKey k, _) =>
            if k = "(" orelse k = "[" orelse k = "{" orelse k = ".{" then scan (depth + 1, advance ts)
            else
              (if k = ")" orelse k = "]" orelse k = "}" then
                 (if (depth = 1) then
                    (case captureClause (advance ts) of
                       Done (_, rest) => isKey ("=>", rest) orelse resultAnnotationAhead rest
                     | Fail _ => false)
                  else scan (depth - 1, advance ts))
               else scan (depth, advance ts))
        | _ => scan (depth, advance ts)
    in
      isKey ("(", ts) andalso scan (0, ts)
    end

  val binLevel = fn
      "||" => SOME 1
    | "&&" => SOME 2
    | "==" => SOME 3
    | "!=" => SOME 3
    | "<" => SOME 4
    | ">" => SOME 4
    | "<=" => SOME 4
    | ">=" => SOME 4
    | "++" => SOME 5
    | "+" => SOME 5
    | "-" => SOME 5
    | "*" => SOME 6
    | "/" => SOME 6
    | "%" => SOME 6
    | _ => NONE

  val smlOperator = fn
      "==" => "="
    | "!=" => "<>"
    | "++" => "^"
    | s => s

  (* The SML operators WmPrint keeps where Workman has none. *)
  val fallbackOperator = fn ts =>
    case peek ts of
      (WKey "@", _) => SOME "@"
    | (WName [s], _) => if s = "div" orelse s = "mod" orelse s = "o" orelse s = "before" then SOME s else NONE
    | _ => NONE

  val infixApp = fn (opr, p, l, r) => EApp (EId (p, ([], opr)), ETuple [l, r])

  (* Calls and syntax-only pipe insertion share the same argument convention. *)
  val apply = fn (callee, args) =>
    case (callee, args) of
      (EId (p, (["List"], "append")), [left, right]) => infixApp ("@", p, left, right)
    | (_, [single]) => EApp (callee, single)
    | _ => EApp (callee, ETuple args)

  val consExp = fn (p, items, tail) =>
    SmlList.foldr (fn (h, t) => infixApp ("::", p, h, t)) tail items

  val startsDecl = fn ts =>
    isKey ("let", ts) orelse isKey ("type", ts) orelse isKey ("record", ts)
    orelse (case peek ts of (WOpen _, _) => true | _ => false)

  (* `export` is contextual: it's an ordinary name unless an import follows it. *)
  val startsExport = fn ts =>
    case peek ts of
      (WName ["export"], _) => isKey ("from", advance ts)
    | _ => false

  datatype item =
      IDec of dec
    | IExp of exp

  (* A block's items as an expression: declarations become `let`, a trailing `;` gives (). *)
  val rec blockExp = fn (items, terminated) =>
    let
      val rec decs = fn
          (IDec d :: rest, acc) => decs (rest, d :: acc)
        | (rest, acc) => (SmlList.rev acc, rest)
      val rec exps = fn
          (IExp e :: rest, acc) => exps (rest, e :: acc)
        | (rest, acc) => (SmlList.rev acc, rest)
      val (ds, rest) = decs (items, [])
      val (es, after) = exps (rest, [])
      val body =
        case (after, terminated) of
          ([], true) => SubsetList.append (es, [ETuple []])
        | ([], false) => es
        | (_, _) => SubsetList.append (es, [blockExp (after, terminated)])
    in
      case (ds, body) of
        ([], [single]) => single
        | _ => ELet (ds, body)
    end

  datatype result =
      Module of dec list * exp list * comment list
    | ParseError of string * pos

  datatype recordLayout = Layout of string * string * string list * (string * ty) list
  datatype recordPart = Spread of exp | Field of string * exp

  (* Resolve uppercase generic parameter references before producing SML types. *)
  val rec parameterType = fn (variables, t) =>
    case t of
      TyCon ([], ([], name)) =>
        (case SmlList.find (fn v => decapitalize (CompilerText.drop (v, 1)) = name) variables of
           SOME v => TyVar v | NONE => t)
    | TyCon (args, name) => TyCon (SmlList.map (fn a => parameterType (variables, a)) args, name)
    | TyTuple types => TyTuple (SmlList.map (fn a => parameterType (variables, a)) types)
    | TyArrow (a, b) => TyArrow (parameterType (variables, a), parameterType (variables, b))
    | TyRecord fields => TyRecord (SmlList.map (fn (l, a) => (l, parameterType (variables, a))) fields)
    | TyVar _ => t

  val parseModuleLowering = fn (layouts, owner, src, lexed, fieldPrefix, recordResolver) =>
    let
      (* A private named record import keeps its lexical name for type/binding resolution.
         Its literal layout is still the defining record's layout. *)
      val recordImports = case lexed of
          Tokens (tokens, _) => SubsetList.concat (SubsetList.map (tokens, fn (token, _) => case token of
            WOpen (("`import" :: target :: items) :: _) =>
              let val rec pairs = fn items => case items of
                    original :: alias :: rest => (alias, [target, original]) :: pairs rest
                  | _ => []
              in pairs items end
          | _ => []))
        | _ => []
      val legacyRecordPath = fn path => case path of
          [name] => if SubsetList.exists (layouts, fn Layout (moduleName, recordName, _, _) =>
              moduleName = owner andalso recordName = decapitalize name) then path else
            (case SubsetList.find (recordImports, fn (alias, _) => alias = name) of
              SOME (_, target) => target | NONE => path)
        | _ => path
      val recordPath = fn (pos, path) => case recordResolver of
          SOME resolve => resolve (pos, path)
        | NONE => SOME (legacyRecordPath path)
      (* Export field-type witnesses through their owning record module. Consumers need
         not import private dependencies merely to type-check generated reconstruction. *)
      val fieldAlias = fn (recordName, label) =>
        case fieldPrefix of NONE => "" | SOME prefix =>
          prefix ^ "Field" ^ CompilerText.natural (CompilerText.size recordName) ^ "_" ^ recordName ^ "_" ^ label
      (* Names absent from the authored source cannot capture its bindings. *)
      val names = case lexed of
          Tokens (tokens, _) => SmlList.concat (SmlList.map
            (fn (WName path, _) => path | _ => []) tokens)
        | LexError (_, _) => []
      val fresh = fn name => BackendNames.avoid (names, name)
      val source = CompilerText.source src
      val spaceBefore = fn ts =>
        let val p = posOf ts in
          p > 0 andalso
            (WmLexer.isSpace (CompilerText.sub (source, p - 1)) orelse
             CompilerText.sub (source, p - 1) = #"/")
        end
      val startsSpaceArgument = fn ts =>
        spaceBefore ts andalso
          (case peek ts of
             (WName _, _) => (case fallbackOperator ts of NONE => true | SOME _ => false)
           | (WScon _, _) => true
           | (WKey k, _) => member (k, ["(", "[", "{", ".{", "true", "false", "void", "match"])
           | _ => false)

      (* Conservative source purity: constructor applications and other computed forms use
         ordered lowering until their value status can be resolved by the checker. *)
      val rec pure = fn e =>
        case e of
          EScon (_, _) => true
        | EId (_, _) => true
        | EFn _ => true
        | ERecord (_, fields) => SmlList.all (fn (_, value) => pure value) fields
        | EList values => SmlList.all pure values
        | ETuple values => SmlList.all pure values
        | ETyped (value, _) => pure value
        | _ => false
      val rec variablesIn = fn t =>
        case t of
          TyVar name => [name]
        | TyCon (args, _) => SmlList.concat (SmlList.map variablesIn args)
        | TyTuple args => SmlList.concat (SmlList.map variablesIn args)
        | TyArrow (a, b) => SubsetList.append (variablesIn a, variablesIn b)
        | TyRecord fields => SmlList.concat (SmlList.map (fn (_, t) => variablesIn t) fields)
      val argumentShape = fn t =>
        case t of TyVar _ => true
        | TyTuple args => SmlList.all (fn TyVar _ => true | _ => false) args
        | _ => false
      val literalLayout = fn (variables, fields) =>
        let val occurrences = SmlList.concat (SmlList.map (fn (_, t) => variablesIn t) fields) in
          SmlList.all (fn v => (SubsetList.length (SmlList.filter (fn n => n = v) occurrences) = 1)) variables
          andalso SmlList.all (fn (_, t) =>
            SubsetList.isEmpty (variablesIn t) orelse
            (case t of TyVar _ => true | TyArrow (a, TyVar _) => argumentShape a | _ => false)) fields
        end
      (* Imported layouts must be visible outside a literal's lowering helper too.
         Type aliases have no runtime effect and do not create record identities. *)
      val referenced =
        let
          val rec scan = fn tokens =>
            case tokens of
              (WName path, p) :: (WKey "{", _) :: rest =>
                (case recordPath (p, path) of SOME target => target :: scan rest | NONE => scan rest)
            | _ :: rest => scan rest
            | [] => []
        in case lexed of Tokens (tokens, _) => scan tokens | LexError (_, _) => [] end
      val aliases = SmlList.map (fn Layout (moduleName, name, parameters, _) =>
        DType (0, [(parameters, fresh ("subsetmlLayout_" ^ moduleName ^ "_" ^ name),
          TyCon (SmlList.map TyVar parameters, (CompilerText.fields (moduleName, fn c => c = #"."), name)))]))
        (SmlList.filter (fn Layout (moduleName, name, _, _) => moduleName <> owner andalso
          SmlList.exists (fn path =>
            let val (qs, n, _) = splitPath path in
              SubsetString.concatWith (qs, ".") = moduleName andalso decapitalize n = name
            end) referenced) layouts)

  val bareParameterAhead = fn ts =>
    isKey ("=>", advance ts) andalso SubsetBool.not (isKey (":>", advance (advance ts)))

  (* An `if` is an operand, so `if (c) { a } else { b } >= 0` compares the whole conditional. *)
  val rec parseExp = fn ts =>
    case peek ts of
      (WKey "=>", _) => parseBareLambda (advance ts)
    | (WKey "|", _) => bind (captureClause ts) (fn _ => fn ts =>
        bind (expect ("=>", ts)) (fn _ => fn ts => parseBareLambda ts))
    | (WKey "||", _) => bind (captureClause ts) (fn _ => fn ts =>
        bind (expect ("=>", ts)) (fn _ => fn ts => parseBareLambda ts))
    | (WKey "if", _) => parseFallback ts
    | (WKey "match", _) => parseFallback ts
    | (WKey "(", _) => if lambdaAhead ts then parseLambda ts else parseFallback ts
    (* `x => body` and `_ => body`: one parameter without parentheses. A body can't start with
       `:>`, so `f => :> g` is `f` applied to the pipeline lambda `=> :> g`. *)
    | (WName [_], _) => if bareParameterAhead ts then parseBareParameter ts else parseFallback ts
    | (WKey "_", _) => if bareParameterAhead ts then parseBareParameter ts else parseFallback ts
    | _ => parseFallback ts

  and parseMatch = fn ts =>
        if isKey ("{", advance ts) then
          bind (parseArms (advance ts)) (fn rules => fn ts => Done (EFn rules, ts))
        else
          (if lambdaAhead (advance ts) then parseMatchFunction (advance ts)
           else
             bind (delimited ("(", parseExp, ",", ")", advance ts)) (fn values => fn ts =>
               bind (parseArms ts) (fn rules => fn ts =>
                 case values of
                   [single] => Done (ECase (single, rules), ts)
                 | _ => Done (ECase (ETuple values, rules), ts))))

  and parseBareLambda = fn ts =>
    let
      val p = posOf ts
      val name = fresh ("subsetmlPipeInput" ^ CompilerText.natural p)
      val input = (WName [name], p)
      val pipeline = isKey (":>", ts) orelse
        (isKey ("{", ts) andalso isKey (":>", advance ts))
      val body = if isKey (":>", ts) then input :: ts
        else (if pipeline then peek ts :: input :: advance ts else ts)
    in bind (parseExp body) (fn value => fn rest =>
      Done (EFn [(if pipeline then PId (p, ([], name)) else PTuple [], value)], rest)) end

  (* Patterns share the expression parser's recursion for `=(expression)`. *)
  and parsePat = fn (inMatch, binds, ts) =>
    let val child = fn b => fn ts => parseAnnotated (inMatch, b orelse SubsetBool.not inMatch, ts) in
      case (case ts of (WName ["`bind", name], p) :: _ => (WKey "`bind", p) | _ => peek ts) of
        (WKey "_", _) => Done (PWild, advance ts)
      (* Workman's `_name` binds, in a match too; read as `name'` (WmLexer). *)
      | (WKey "`bind", p) => (case peek ts of
           (WName [name], _) => Done (PId (p, ([], name)), advance ts)
         | _ => expected ("a pattern", ts))
      | (WKey "=", p) =>
          if inMatch then
            bind (expect ("(", advance ts)) (fn _ => fn ts =>
              bind (parseExp ts) (fn value => fn ts =>
                bind (expect (")", ts)) (fn _ => fn ts => Done (PComputed (p, value), ts))))
          else Fail ("computed patterns are only supported in match arms", p)
      | (WKey "void", _) => Done (PTuple [], advance ts)
      | (WKey "true", p) => Done (PId (p, ([], "true")), advance ts)
      | (WKey "false", p) => Done (PId (p, ([], "false")), advance ts)
      | (WScon (SInt s), p) => Done (PScon (p, SInt s), advance ts)
      | (WScon (SReal s), p) => Done (PScon (p, SReal s), advance ts)
      | (WScon c, p) => Done (PScon (p, c), advance ts)
      | (WKey "-", p) =>
          (case negativeLiteral (p, advance ts) of
             SOME c => Done (PScon (p, c), advance (advance ts))
           | _ => expected ("a pattern", ts))
      | (WKey ".{", p) =>
          let
            val field = fn ts =>
              case peek ts of
                (WName [l], lp) =>
                  if isKey ("=", advance ts) then
                    bind (child false (advance (advance ts))) (fn q => fn ts => Done ((l, q), ts))
                  else Done ((l, PId (lp, ([], l))), advance ts)
              | _ => expected ("a record field", ts)
          in
            bind (separated (field, ",", "}", advance ts)) (fn fields => fn ts =>
              bind (expect ("}", ts)) (fn _ => fn ts => Done (PRecord (p, fields), ts)))
          end
      | (WKey "[", p) =>
          bind (listItems (child true, advance ts)) (fn (items, tail) => fn ts =>
            case tail of
              NONE => Done (PList items, ts)
            | SOME t => Done (consPat (p, items, t), ts))
      | (WKey "(", _) =>
          bind (delimited ("(", child false, ",", ")", ts)) (fn ps => fn ts =>
            case ps of
              [single] => Done (single, ts)
            | _ => Done (PTuple ps, ts))
      | (WName ["Var"], _) =>
          (case (peek (advance ts), peek (advance (advance ts)), peek (advance (advance (advance ts)))) of
             ((WKey "(", _), (WName [x], p), (WKey ")", _)) =>
               Done (PId (p, ([], x)), advance (advance (advance (advance ts))))
           | _ => expected ("`Var(name)`", ts))
      | (WName path, p) =>
          let
            val name :: reversedQuals = SubsetList.reverse path
            val quals = SubsetList.reverse reversedQuals
          in
            case (isUpperName name, binds, SmlList.null quals) of
              (true, _, _) =>
                if isKey ("(", advance ts) then
                  bind (delimited ("(", child true, ",", ")", advance ts)) (fn args => fn ts =>
                    case args of
                      [single] => Done (PApp (p, valueName (quals, name), single), ts)
                    | _ => Done (PApp (p, valueName (quals, name), PTuple args), ts))
                else Done (if inMatch then PPinned (p, valueName (quals, name))
                          else PId (p, valueName (quals, name)), advance ts)
            | (false, true, true) =>
                (* The reader reads `print` as Workman's pervasive (Translate.printing). *)
                if name = "print" then Fail ("the translation reads `print` as Workman's print; rename this binding", p)
                else Done (PId (p, ([], name)), advance ts)
            | (false, _, _) =>
                Done (PPinned (p, valueName (quals, name)), advance ts)
          end
      | _ => expected ("a pattern", ts)
    end

  (* A pattern that may carry a type annotation, as inside parentheses. *)
  and parseAnnotated = fn (inMatch, binds, ts) =>
    bind (parsePat (inMatch, binds, ts)) (fn p => fn rest =>
      if isKey (":", rest) then
        bind (parseType (advance rest)) (fn t => fn after =>
          Done (case (p, isIntType t, integerText ts) of
                  (PScon (q, _), true, SOME s) => PScon (q, SInt s)
                | _ => PTyped (p, t), after))
      else Done (p, rest))

  (* `match(x, y) => { arms }`: a function of its named parameters. *)
  and parseMatchFunction = fn ts =>
    let
      val name = fn ts =>
        case peek ts of
          (WName [x], p) =>
            if x = "print" then Fail ("the translation reads `print` as Workman's print; rename this binding", p)
            else Done ((p, x), advance ts)
        | _ => expected ("a parameter name", ts)
    in
      bind (delimited ("(", name, ",", ")", ts)) (fn names => fn ts =>
        bind (captureClause ts) (fn _ => fn ts =>
        bind (expect ("=>", ts)) (fn _ => fn ts =>
          bind (parseArms ts) (fn rules => fn ts =>
            let
              val param =
                case names of
                  [(p, x)] => PId (p, ([], x))
                | _ => PTuple (SmlList.map (fn (p, x) => PId (p, ([], x))) names)
              val value =
                case names of
                  [(p, x)] => EId (p, ([], x))
                | _ => ETuple (SmlList.map (fn (p, x) => EId (p, ([], x))) names)
            in
              Done (EFn [(param, ECase (value, rules))], ts)
            end))))
    end

  (* A lambda's body: a block, or any expression, as in `a => b => a + b`. *)
  and parseLambdaBody = fn ts =>
    if lambdaAhead ts then parseLambda ts
    else (if isKey ("{", ts) then parseBlock ts else parseExp ts)

  and parseBareParameter = fn ts =>
    bind (parsePat (false, true, ts)) (fn p => fn ts =>
      bind (expect ("=>", ts)) (fn _ => fn ts =>
        bind (parseLambdaBody ts) (fn body => fn ts => Done (EFn [(p, body)], ts))))

  (* `(params) => body`, where the body is a block or any expression. *)
  and parseLambda = fn ts =>
    let
      val param = fn ts =>
        bind (parsePat (false, true, ts)) (fn p => fn ts =>
          if isKey (":", ts) then bind (parseType (advance ts)) (fn t => fn ts => Done (PTyped (p, t), ts))
          else Done (p, ts))
      (* `(params): T => body` constrains the body: `fn params => (body : t)`. *)
      val result = fn ts =>
        if isKey (":", ts) then bind (parseType (advance ts)) (fn t => fn ts => Done (SOME t, ts))
        else Done (NONE, ts)
    in
      bind (delimited ("(", param, ",", ")", ts)) (fn ps => fn ts =>
        bind (result ts) (fn annotation => fn ts =>
        bind (captureClause ts) (fn _ => fn ts =>
        bind (expect ("=>", ts)) (fn _ => fn ts =>
          bind (parseLambdaBody ts) (fn body => fn ts =>
            let
              val p =
                case ps of
                  [single] => single
                | _ => PTuple ps
              val constrained =
                case annotation of
                  NONE => body
                | SOME t => ETyped (body, t)
            in
              Done (EFn [(p, constrained)], ts)
            end)))))
    end

  and parseArms = fn ts =>
    let
      val arm = fn ts =>
        bind (parseAnnotated (true, false, ts)) (fn p => fn ts =>
          bind (expect ("=>", ts)) (fn _ => fn ts =>
            bind (parseBlock ts) (fn e => fn ts => Done ((p, e), ts))))
    in
      delimited ("{", arm, ",", "}", ts)
    end

  and parseBlock = fn ts =>
    let
      val rec items = fn (acc, ts) =>
        case peek ts of
          (WKey "}", _) => Done ((SmlList.rev acc, true), advance ts)
        | _ =>
            if startsDecl ts then
              bind (parseDecl ts) (fn ds => fn ts => items (SubsetList.append (SmlList.map IDec ds, acc), ts))
            else
              bind (parseExp ts) (fn e => fn ts =>
                if isKey (";", ts) then items (IExp e :: acc, advance ts)
                else bind (expect ("}", ts)) (fn _ => fn ts => Done ((SmlList.rev (IExp e :: acc), false), ts)))
    in
      bind (expect ("{", ts)) (fn _ => fn ts =>
        bind (items ([], ts)) (fn (parts, terminated) => fn ts =>
          (* An empty block or one ending in `;` yields void. *)
          Done (blockExp (parts, terminated orelse SmlList.null parts), ts)))
    end

  (* The SML operators kept by WmPrint bind loosest. *)
  and parseFallback = fn ts =>
    let
      val rec more = fn (l, ts) =>
        case fallbackOperator ts of
          SOME opr =>
            bind (parseBinary (1, advance ts)) (fn r => fn ts' => more (infixApp (opr, posOf ts, l, r), ts'))
        | NONE => Done (l, ts)
    in
      bind (parseBinary (1, ts)) (fn l => fn ts => more (l, ts))
    end

  and parseBinary = fn (minLevel, ts) =>
    let
      val rec more = fn (l, ts) =>
        case peek ts of
          (WKey opr, p) =>
            (case binLevel opr of
               SOME level =>
                 if level < minLevel then Done (l, ts)
                 else
                   (
                      bind (parseBinary (level + 1, advance ts)) (fn r => fn ts =>
                        more (case opr of
                                "&&" => EAndalso (l, r)
                              | "||" => EOrelse (l, r)
                              | _ =>
                                  (* Workman's `%` truncates toward zero; its SML spelling depends on
                                     the operand type (Translate.remainders), as does that of real
                                     `==` and `!=` (Translate.realEquality). *)
                                  case (opr, l) of
                                    (* SML-to-Workman printing annotates a real `==` operand;
                                       the comparison itself is spelled after inference. *)
                                    ("==", ETyped (x, TyCon ([], ([], "real")))) => infixApp ("=", p, x, r)
                                  | ("!=", ETyped (x, TyCon ([], ([], "real")))) => infixApp ("<>", p, x, r)
                                  | ("%", _) => EApp (EId (p, ([], "`rem")), ETuple [l, r])
                                  | _ => infixApp (smlOperator opr, p, l, r), ts)))
             | NONE => Done (l, ts))
        | _ => Done (l, ts)
    in
      bind (parseUnary ts) (fn l => fn ts => more (l, ts))
    end

  and parseUnary = fn ts =>
    case peek ts of
      (WKey "!", p) => bind (parseUnary (advance ts)) (fn e => fn ts => Done (EApp (EId (p, ([], "`not")), e), ts))
    | (WKey "-", p) =>
        (case negativeLiteral (p, advance ts) of
           SOME c =>
             if isKey (":>", advance (advance ts)) then
               bind (parseUnary (advance ts)) (fn e => fn ts => Done (EApp (EId (p, ([], "~")), e), ts))
             else Done (EScon (p, c), advance (advance ts))
         | NONE => bind (parseUnary (advance ts)) (fn e => fn ts => Done (EApp (EId (p, ([], "~")), e), ts)))
    | _ => parsePipe ts

  (* Pipes bind above unary/binary operators and chain left-to-right. Record member stages
     become ordinary selections/calls; SML inference must establish a record receiver. *)
  and parsePipe = fn ts =>
    let
      val rec more = fn (left, ts) =>
        if isKey (":>", ts) then
          let val stage = advance ts in
            if isKey (".", stage) then
              (case peek (advance stage) of
                 (WName path, p) =>
                   let val selected = SubsetList.foldLeft (path, left,
                         fn (label, receiver) => EApp (ESelect (p, label), receiver))
                       val rest = advance (advance stage)
                   in if isKey ("(", rest) then
                     bind (delimited ("(", parseExp, ",", ")", rest)) (fn args => fn rest =>
                       more (apply (selected, args), rest))
                   else more (selected, rest) end
               | _ => expected ("a record member after `:> .`", advance stage))
            else (if isKey ("if", stage) andalso isKey ("{", advance stage) then
              bind (parseBlock (advance stage)) (fn yes => fn rest =>
                bind (expect ("else", rest)) (fn _ => fn rest =>
                  bind (parseBlock rest) (fn no => fn rest => more (EIf (left, yes, no), rest))))
            else bind (parsePostfixForm stage) (fn (right, insertion) => fn rest =>
              more (case insertion of
                      SOME (callee, args) => apply (callee, left :: args)
                    | NONE => EApp (right, left), rest)))
          end
        else Done (left, ts)
    in
      bind (parsePostfix ts) (fn left => fn ts => more (left, ts))
    end

  and parsePostfix = fn ts =>
    bind (parsePostfixForm ts) (fn (value, _) => fn rest => Done (value, rest))

  (* Retain just the outer call's source form until pipe insertion is decided.
     Grouping returns a primary with no insertion slot. A space application is
     a fully constructed stage; a final explicit call supplies an insertion slot. *)
  and parsePostfixForm = fn ts =>
    let
      (* An annotation belongs to the completed postfix expression, including a call
         argument such as `f (1: Int32.Int) next`. Do not require an extra group. *)
      val finish = fn (value, insertion, rest) =>
        if isKey (":", rest) then
          bind (parseType (advance rest)) (fn t => fn rest =>
            Done ((ETyped (value, t), NONE), rest))
        else Done ((value, insertion), rest)
      (* Direct self tail calls, not `bind` continuations, so a long application chain
         runs in constant stack on the Workman backend too. *)
      val rec calls = fn (callee, insertion, ts) =>
        if isKey ("(", ts) andalso SubsetBool.not (lambdaAhead ts) then
          (case delimited ("(", parseExp, ",", ")", ts) of
             Done (args, rest) => calls (apply (callee, args), SOME (callee, args), rest)
           | Fail (message, offset) => Fail (message, offset))
        else (if isKey (".", ts) then
          (* `f(x).field` reads a field of the call's result: `#field (f x)`. *)
          (case peek (advance ts) of
             (WName [label], p) => calls (EApp (ESelect (p, label), callee), NONE, advance (advance ts))
           | _ => finish (callee, insertion, ts))
        else (if startsSpaceArgument ts then
          (case (if lambdaAhead ts then parseLambda ts else parsePrimary ts) of
             Done (arg, rest) => calls (EApp (callee, arg), NONE, rest)
           | Fail (message, offset) => Fail (message, offset))
        (* `f => :> g`: a pipeline lambda as a space argument; it extends as far as it can. *)
        else (if isKey ("=>", ts) then
          (case parseBareLambda (advance ts) of
             Done (arg, rest) => finish (EApp (callee, arg), NONE, rest)
           | Fail (message, offset) => Fail (message, offset))
        else finish (callee, insertion, ts))))
    in
      bind (parsePrimary ts) (fn value => fn rest => calls (value, NONE, rest))
    end

  (* A backtick string: its text pieces joined with `^`, each `${ e }` converted to text by
     the internal `\`show`, which elaboration types and translation resolves by type. *)
  and parseTemplate = fn (p, ts) =>
    let
      val concat = fn (a, b) => EApp (EId (p, ([], "^")), ETuple [a, b])
      val rec parts = fn (acc, ts) =>
        case peek ts of
          (WScon (SString text), q) =>
            parts ((if text = "" then acc else EScon (q, SString text) :: acc), advance ts)
        | (WKey "${", q) =>
            bind (parseExp (advance ts)) (fn e => fn ts =>
              bind (expect ("}$", ts)) (fn _ => fn ts =>
                parts (EApp (EId (q, ([], "`show")), e) :: acc, ts)))
        | (WKey "`)", _) =>
            (case SmlList.rev acc of
               [] => Done (EScon (p, SString ""), advance ts)
             | first :: rest => Done (SmlList.foldl (fn (e, joined) => concat (joined, e)) first rest, advance ts))
        | _ => expected ("the rest of a backtick string", ts)
    in parts ([], ts) end

  (* A carrier group, `Result|a, b, c|`, as Workman desugars it: `Result.andThen(a, x =>
     Result.andThen(b, y => Result.map(c, z => (x, y, z))))`. One item is the item itself. *)
  and parseCarrierGroup = fn (p, carrier, ts) =>
    let
      val member = fn name => pathExp (p, SubsetList.append (carrier, [name]))
      val rec items = fn (acc, ts) =>
        bind (parseExp ts) (fn e => fn ts =>
          if isKey (",", ts) then items (e :: acc, advance ts)
          else bind (expect ("|", ts)) (fn _ => fn ts => Done (SmlList.rev (e :: acc), ts)))
      val rec build = fn (index, remaining, values) =>
        case remaining of
          [] => ETuple (SmlList.rev values)
        | item :: rest =>
            let
              val name = fresh ("subsetmlLift" ^ CompilerText.natural p ^ "_" ^ CompilerText.natural index)
              val value = EId (p, ([], name))
              val body = build (index + 1, rest, value :: values)
              val step = case rest of [] => "map" | _ => "andThen"
            in EApp (member step, ETuple [item, EFn [(PId (p, ([], name)), body)]]) end
    in
      bind (items ([], ts)) (fn group => fn ts =>
        case group of
          [single] => Done (single, ts)
        | _ => Done (build (0, group, []), ts))
    end

  and atomPath = fn (p, path, ts) =>
    (* Workman's pervasive `print` takes any value; Translate.printing writes its display. *)
    if path = ["print"] then Done (EId (p, ([], "`print")), advance ts)
    (* `Text.of(v)` is a template's conversion, `${v}`; unapplied, it is `v => Text.of(v)`. *)
    else (if path = ["Text", "of"] orelse path = ["SubsetText", "of"] then
      (if isKey ("(", advance ts) then Done (EId (p, ([], "`show")), advance ts)
       else Done (EFn [(PId (p, ([], "textOfValue")), EApp (EId (p, ([], "`show")), EId (p, ([], "textOfValue"))))],
                  advance ts))
    else (if isKey ("{", advance ts) then parseNamedRecord (p, path, advance (advance ts))
    else (if isKey ("|", advance ts) andalso CompilerText.firstIs (lastOf path, SubsetChar.isUpper)
    then parseCarrierGroup (p, path, advance (advance ts))
    else Done (pathExp (p, path), advance ts))))

  and parsePrimary = fn ts =>
    case peek ts of
      (WScon c, p) => Done (EScon (p, c), advance ts)
    | (WKey "`(", p) => parseTemplate (p, advance ts)
    | (WKey "true", p) => Done (EId (p, ([], "true")), advance ts)
    | (WKey "false", p) => Done (EId (p, ([], "false")), advance ts)
    | (WKey "void", _) => Done (ETuple [], advance ts)
    | (WKey "~", p) => Done (EId (p, ([], "~")), advance ts)
    | (WName path, p) =>
        (* A bare namespace in value position is its carrier: `Monad.map(x, Result, f)`. *)
        (case ts of
           (WName ["`alias", _, target], _) :: _ =>
             if SubsetBool.not (isKey ("{", advance ts) orelse isKey ("(", advance ts))
             then Done (EId (p, ([target], "carrier")), advance ts)
             else atomPath (p, path, ts)
         | _ => atomPath (p, path, ts))
    | (WSelect l, p) =>
        if CompilerText.firstIs (l, SubsetChar.isDigit)
        then Fail ("tuple selectors are not part of SubsetML; use a pattern such as (_, x)", p)
        else Done (ESelect (p, l), advance ts)
    | (WKey "[", p) =>
        bind (listItems (parseExp, advance ts)) (fn (items, tail) => fn ts =>
          case tail of
            NONE => Done (EList items, ts)
          | SOME t => Done (consExp (p, items, t), ts))
    | (WKey ".{", p) =>
        let
          val field = fn ts =>
            case peek ts of
              (WName [l], lp) =>
                if isKey ("=", advance ts) then
                  bind (parseExp (advance (advance ts))) (fn e => fn ts => Done ((l, e), ts))
                else Done ((l, EId (lp, ([], l))), advance ts)
            | (WKey "..", offset) => Fail ("a record spread must come first: .{ ..value, field = replacement }", offset)
            | _ => expected ("a record field", ts)
          val fields = fn ts =>
            if isKey ("}", ts) then Done ([], ts) else separated (field, ",", "}", ts)
        in
          if isKey ("..", advance ts) then
            (* `.{ ..source, x = e }`: an update whose layout is the source's inferred type.
               `\`update` keeps the source's type; each `[#x u, e]` makes e's type that of x.
               Translate.recordUpdates expands it once the type is known. *)
            bind (parseExp (advance (advance ts))) (fn source => fn ts =>
              bind (if isKey (",", ts) then fields (advance ts) else Done ([], ts)) (fn updates => fn ts =>
                bind (expect ("}", ts)) (fn _ => fn ts =>
                  let
                    val u = fresh ("subsetmlUpdate" ^ CompilerText.natural p)
                    val value = EId (p, ([], u))
                    val checks = SmlList.map (fn (l, e) => EList [EApp (ESelect (p, l), value), e]) updates
                  in
                    Done (EApp (EId (p, ([], "`update")),
                      ELet ([DVal (p, [], [(PId (p, ([], u)), source)], [])], SubsetList.append (checks, [value]))), ts)
                  end)))
          else
            bind (separated (field, ",", "}", advance ts)) (fn fields => fn ts =>
              bind (expect ("}", ts)) (fn _ => fn ts => Done (ERecord (p, fields), ts)))
        end
    | (WKey "{", _) => parseBlock ts
    | (WKey "(", _) =>
        bind (parseExp (advance ts)) (fn first => fn rest =>
          case peek rest of
            (WKey ":", _) =>
              bind (parseType (advance rest)) (fn t => fn after =>
                bind (expect (")", after)) (fn _ => fn after =>
                  Done (case (first, isIntType t, integerText (advance ts)) of
                          (EScon (q, _), true, SOME s) => EScon (q, SInt s)
                        | _ => ETyped (first, t), after)))
          | (WKey ",", _) =>
              bind (separated (parseExp, ",", ")", advance rest)) (fn more => fn ts =>
                bind (expect (")", ts)) (fn _ => fn ts => Done (ETuple (first :: more), ts)))
          | (WKey ";", _) =>
              bind (separated (parseExp, ";", ")", advance rest)) (fn more => fn ts =>
                bind (expect (")", ts)) (fn _ => fn ts => Done (ESeq (first :: more), ts)))
          | _ => bind (expect (")", rest)) (fn _ => fn ts => Done (first, ts)))
    | (WKey "if", _) => parseIf ts
    | (WKey "match", _) => parseMatch ts
    | _ => expected ("an expression", ts)

  and parseIf = fn ts =>
    bind (expect ("(", advance ts)) (fn _ => fn ts =>
      bind (parseExp ts) (fn c => fn ts =>
        bind (expect (")", ts)) (fn _ => fn ts =>
          bind (parseBlock ts) (fn a => fn ts =>
            bind (expect ("else", ts)) (fn _ => fn ts =>
              bind (parseBlock ts) (fn b => fn ts => Done (EIf (c, a, b), ts)))))))

  (* Named record layout is explicit; no inference is needed to enumerate copied fields. *)
  and parseNamedRecord = fn (p, path, ts) =>
    let
      val resolved = recordPath (p, path)
      val originalPath = path
      val path = case resolved of SOME target => target | NONE => path
      val (qualifiers, name, selections) = splitPath path
      val sourceOwner = if SubsetList.isEmpty qualifiers then owner else SubsetString.concatWith (qualifiers, ".")
      val candidate = case resolved of NONE => NONE | SOME _ =>
        SmlList.find (fn Layout (moduleName, recordName, _, _) =>
          moduleName = sourceOwner andalso recordName = decapitalize name) layouts
      val part = fn ts =>
        case peek ts of
          (WKey "..", _) => bind (parseExp (advance ts)) (fn e => fn ts => Done (Spread e, ts))
        | (WName [label], offset) =>
            if isKey ("=", advance ts) then
              bind (parseExp (advance (advance ts))) (fn e => fn ts => Done (Field (label, e), ts))
            else Done (Field (label, EId (offset, ([], label))), advance ts)
        | _ => expected ("a record field or spread", ts)
    in
      if SubsetBool.not (SubsetList.isEmpty selections) then Fail ("expected a nominal record type name", p)
      else case candidate of
        NONE => Fail ("unknown record layout " ^ SubsetString.concatWith (originalPath, ".") ^ "; supply its declaration when translating", p)
      | SOME (Layout (_, recordName, variables, fields)) =>
          bind (separated (part, ",", "}", ts)) (fn parts => fn ts =>
            bind (expect ("}", ts)) (fn _ => fn ts =>
              let
                val prefix = "subsetmlRecord" ^ CompilerText.natural p ^ "_"
                val parameters = SmlList.map (fn v => (v, "'" ^ fresh (prefix ^ CompilerText.drop (v, 1)))) variables
                val rec fieldType = fn t =>
                  case t of
                    TyVar v => (case SmlList.find (fn (old, _) => old = v) parameters of
                      SOME pair => let val (_, name) = pair in TyVar name end | NONE => t)
                  | TyCon (args, (qs, n)) =>
                      let val builtin = SmlList.exists (fn b => b = n) ["real", "string", "char", "bool", "unit", "list", "option"]
                          val qs = if SubsetList.isEmpty qs andalso SubsetBool.not builtin andalso sourceOwner <> owner then [sourceOwner] else qs
                      in TyCon (SmlList.map fieldType args, (qs, n)) end
                  | TyTuple types => TyTuple (SmlList.map fieldType types)
                  | TyArrow (a, b) => TyArrow (fieldType a, fieldType b)
                  | TyRecord fs => TyRecord (SmlList.map (fn (l, t) => (l, fieldType t)) fs)
                val fieldFor = fn (label, t) =>
                  case fieldPrefix of
                    SOME _ => if sourceOwner <> owner then
                      TyCon (SmlList.map (fn (_, v) => TyVar v) parameters,
                        ([sourceOwner], fieldAlias (recordName, label)))
                      else fieldType t
                  | NONE => fieldType t
                val targetType = TyCon (SmlList.map (fn (_, v) => TyVar v) parameters, (qualifiers, recordName))
                val literal =
                  if literalLayout (variables, fields) then
                    let
                      val rec direct = fn remaining =>
                        case remaining of
                          [] => SOME []
                        | Spread _ :: _ => NONE
                        | Field (label, value) :: rest =>
                            if SubsetBool.not (pure value) then NONE
                            else (case (SmlList.find (fn (l, _) => l = label) fields, direct rest) of
                              (SOME entry, SOME tail) =>
                                let
                                  val (_, t) = entry
                                  val value = if SubsetList.isEmpty (variablesIn t) then ETyped (value, fieldFor (label, t))
                                    else (case t of
                                      TyArrow (domain, TyVar _) =>
                                        let
                                          val arguments = case domain of TyTuple args => args | _ => [domain]
                                          val rec argumentNames = fn (index, remaining) =>
                                            case remaining of [] => [] | _ :: rest =>
                                              fresh (prefix ^ label ^ "Argument" ^ CompilerText.natural index)
                                                :: argumentNames (index + 1, rest)
                                          val bound = argumentNames (0, arguments)
                                          val patterns = SmlList.map (fn name => PId (p, ([], name))) bound
                                          val values = SmlList.map (fn name => EId (p, ([], name))) bound
                                          val pattern = case domain of TyTuple _ => PTuple patterns | _ =>
                                            let val [single] = patterns in single end
                                          val argument = case domain of TyTuple _ => ETuple values | _ =>
                                            let val [single] = values in single end
                                        in EFn [(pattern, EApp (value, argument))] end
                                    | _ => value)
                                in SOME ((label, value) :: tail) end
                            | _ => NONE)
                    in direct parts end
                  else NONE
                val rec finish = fn (remaining, index, bindings, values, explicit) =>
                  case remaining of
                    [] =>
                      (case SmlList.find (fn (label, _) => SubsetBool.not (SmlList.exists (fn (l, _) => l = label) values)) fields of
                         SOME pair => let val (label, _) = pair in Fail ("missing record field " ^ label, p) end
                       | NONE =>
                           let
                             val ordered = SmlList.rev bindings
                             val patterns = SmlList.map (fn (pattern, _) => pattern) ordered
                             val arguments = SmlList.map (fn (_, argument) => argument) ordered
                             val pattern = case patterns of [single] => single | _ => PTuple patterns
                             val argument = case arguments of [single] => single | _ => ETuple arguments
                             val helper = fresh (prefix ^ "build")
                             val result = ETyped (ERecord (p, SmlList.map (fn (label, _) =>
                               let val SOME pair = SmlList.find (fn (l, _) => l = label) values
                                   val (_, value) = pair in (label, value) end) fields), targetType)
                             val layoutAlias = DType (p, [(SmlList.map (fn (_, v) => v) parameters,
                               fresh (prefix ^ "layout"), targetType)])
                             (* Generalize the layout parameters on the helper, not on its caller.
                                Arguments retain source order and are evaluated once, including
                                entries overwritten by a later spread. *)
                             val declaration = DVal (p, [], [(PId (p, ([], helper)),
                               EFn [(pattern, ELet ([layoutAlias], [result]))])], [])
                             val ordered = ELet ([declaration], [EApp (EId (p, ([], helper)), argument)])
                             (* Replaced or discarded entries can constrain outer weak variables.
                                A plain copy retains every entry in its emitted field wrappers. *)
                             val copy = (case parts of [Spread (EId (_, _))] => true | _ => false)
                               andalso SmlList.all (fn (_, TyArrow (_, _)) => true | _ => false) fields
                               andalso SmlList.all (fn Spread (EId (_, _)) => true
                                 | Field (_, value) => pure value | _ => false) parts
                             val final = SmlList.foldl (fn (part, values) =>
                               case part of Spread e => SmlList.map (fn (label, _) =>
                                 (label, EApp (ESelect (p, label), e))) fields
                               | Field (label, e) => (label, e) :: SmlList.filter (fn (l, _) => l <> label) values) [] parts
                           in Done ((case literal of
                             SOME fields => ERecord (p, fields)
                           | NONE => if copy then ECopy (p, ordered, ERecord (p, final), targetType)
                             else ordered), ts) end)
                  | part :: rest =>
                      let val temporary = fresh (prefix ^ CompilerText.natural index)
                          val value = EId (p, ([], temporary)) in
                        case part of
                          Spread e => finish (rest, index + 1,
                            (PTyped (PId (p, ([], temporary)), targetType), e) :: bindings,
                            SmlList.map (fn (label, _) => (label, EApp (ESelect (p, label), value))) fields, explicit)
                        | Field (label, e) =>
                            if SmlList.exists (fn l => l = label) explicit then Fail ("duplicate record field " ^ label, p)
                            else (case SmlList.find (fn (l, _) => l = label) fields of
                              NONE => Fail (name ^ " has no field " ^ label, p)
                            | SOME pair =>
                                let val (_, t) = pair in finish (rest, index + 1,
                                  (PTyped (PId (p, ([], temporary)), fieldFor (label, t)), e) :: bindings,
                                  (label, value) :: SmlList.filter (fn (l, _) => l <> label) values,
                                  label :: explicit) end)
                      end
                            in finish (parts, 0, [], [], []) end))
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Declarations. A namespace import (`import * as X`) yields no declaration: SML refers to
     structures by name without importing them. *)

  and parseDecl = fn ts =>
    let val p = posOf ts in
      case peek ts of
        (WOpen ids, _) => Done ([DOpen (p, ids)], advance ts)
      | (WKey "let", _) =>
          let
            val isRec = isKey ("rec", advance ts)
            val binding = fn ts =>
              bind (parsePat (false, true, ts)) (fn pat => fn ts =>
                let
                  val rhs = fn (pat, ts) =>
                    bind (expect ("=", ts)) (fn _ => fn ts =>
                      bind (parseExp ts) (fn e => fn ts => Done ((pat, e), ts)))
                in
                  if isKey (":", ts) then
                    bind (parseType (advance ts)) (fn t => fn ts => rhs (PTyped (pat, t), ts))
                  else rhs (pat, ts)
                end)
            val rec bindings = fn ts =>
              bind (binding ts) (fn b => fn ts =>
                if isKey ("and", ts) then
                  bind (bindings (advance ts)) (fn bs => fn ts => Done (b :: bs, ts))
                else Done ([b], ts))
          in
            bind (bindings (if isRec then advance (advance ts) else advance ts)) (fn bs => fn ts =>
              bind (expect (";", ts)) (fn _ => fn ts =>
                if isRec then
                  (if SmlList.all (fn (_, e) => case e of EFn _ => true | _ => false) bs
                   then Done ([DVal (p, [], [], bs)], ts)
                   else Fail ("the right side of a `let rec` binding must be a function", p))
                else Done ([DVal (p, [], bs, [])], ts)))
          end
      | (WKey "type", _) => parseTypeDecl (p, advance ts)
      | (WKey "record", _) =>
          (case peek (advance ts) of
             (WName [name], _) =>
               bind (typeParams (advance (advance ts))) (fn vs => fn ts =>
                 bind (expect ("=", ts)) (fn _ => fn ts =>
                   let
                     val field = fn ts =>
                       case peek ts of
                         (WName [l], _) =>
                           bind (expect (":", advance ts)) (fn _ => fn ts =>
                             bind (parseType ts) (fn t => fn ts => Done ((l, t), ts)))
                       | _ => expected ("a record field", ts)
                   in
                     bind (delimited ("{", field, ",", "}", ts)) (fn fields => fn ts =>
                       bind (expect (";", ts)) (fn _ => fn ts =>
                         Done (DType (p, [(vs, decapitalize name, TyRecord (SmlList.map (fn (l, t) => (l, parameterType (vs, t))) fields))]) :: SubsetList.append (
                           (case fieldPrefix of NONE => [] | SOME prefix =>
                             let
                               val arguments = SmlList.map (fn (label, _) =>
                                 (label, fresh (prefix ^ "Constructor_" ^ name ^ "_" ^ label))) fields
                               val patterns = SmlList.map (fn (_, argument) => PId (p, ([], argument))) arguments
                               val parameter = case patterns of [single] => single | _ => PTuple patterns
                               val target = TyCon (SmlList.map TyVar vs, ([], decapitalize name))
                               val body = ETyped (ERecord (p, SmlList.map (fn (label, argument) =>
                                 (label, EId (p, ([], argument)))) arguments), target)
                             in [DVal (p, [], [(PId (p, ([], name)), EFn [(parameter, body)])], [])] end),
                           (case fieldPrefix of NONE => [] | SOME _ =>
                             SmlList.map (fn (label, t) => DType (p,
                               [(vs, fieldAlias (decapitalize name, label), parameterType (vs, t))])) fields)), ts)))
                   end))
           | _ => expected ("a record name", advance ts))
      | (WKey "from", _) =>
          (case (peek (advance ts), peek (advance (advance ts)), peek (advance (advance (advance ts)))) of
             ((WScon (SString file), _), (WKey "import", _), (WKey "*", _)) =>
               let val rest = advance (advance (advance (advance ts))) in
                 if isKey ("as", rest) then
                   bind (expect (";", advance (advance rest))) (fn _ => fn ts => Done ([], ts))
                 else
                   bind (expect (";", rest)) (fn _ => fn ts =>
                     Done ([DOpen (p, [[structureName file]])], ts))
               end
           | _ => Fail ("only `from \"./file.wm\" import *` imports have a SubsetML counterpart", p))
      | (WName ["export"], _) =>
          let val clause = advance ts in
            case (peek clause, peek (advance clause), peek (advance (advance clause)),
                  peek (advance (advance (advance clause)))) of
              ((WKey "from", _), (WScon (SString file), _), (WKey "import", _), (WKey "*", _)) =>
                let val rest = advance (advance (advance (advance clause))) in
                  if isKey ("as", rest) then
                    bind (expect (";", advance (advance rest))) (fn _ => fn ts => Done ([], ts))
                  else
                    bind (expect (";", rest)) (fn _ => fn ts =>
                      Done ([DOpen (p, [[structureName file]])], ts))
                end
            | _ => Fail ("only `export from \"./file.wm\" import *` and `import * as Name` have a SubsetML counterpart", p)
          end
      | _ => expected ("a declaration", ts)
    end

  (* `<a, b>` after a type name. *)
  and typeParams = fn ts =>
    if isKey ("<", ts) then
      delimited ("<", fn ts =>
                   case peek ts of
                     (WName [v], _) => Done ("'" ^ v, advance ts)
                   | _ => expected ("a type parameter", ts), ",", ">", ts)
    else Done ([], ts)

  (* `type` bindings: aliases, or datatypes when the body has `|`. *)
  and parseTypeDecl = fn (p, ts) =>
    let
      (* `C` or `C<T1, ..., Tn>`; several arguments are one tuple payload. *)
      val constructor = fn ts =>
        case peek ts of
          (WName [c], cp) =>
            if SubsetBool.not (isUpperName c) then expected ("a constructor", ts)
            else
              (if isKey ("<", advance ts) then
                 bind (delimited ("<", parseType, ",", ">", advance ts)) (fn args => fn ts =>
                   case args of
                     [single] => Done ((cp, constructorName c, SOME single), ts)
                   | _ => Done ((cp, constructorName c, SOME (TyTuple args)), ts))
               else Done ((cp, constructorName c, NONE), advance ts))
        | _ => expected ("a constructor", ts)
      val rec members = fn (acc, ts) =>
        if isKey ("|", ts) then
          bind (constructor (advance ts)) (fn c => fn ts => members (c :: acc, ts))
        else Done (SmlList.rev acc, ts)
      val binding = fn ts =>
        case peek ts of
          (WName [name], _) =>
            bind (typeParams (advance ts)) (fn vs => fn ts =>
              bind (expect ("=", ts)) (fn _ => fn body =>
                if isKey ("|", body) then
                  bind (members ([], body)) (fn cons => fn ts => Done ((vs, decapitalize name, NONE, cons), ts))
                else
                  (* Without a leading `|`, a body with no `|` is an alias. *)
                  bind (parseType body) (fn t => fn ts =>
                    if isKey ("|", ts) then
                      bind (constructor body) (fn first => fn ts =>
                        bind (members ([first], ts)) (fn cons => fn ts =>
                          Done ((vs, decapitalize name, NONE, cons), ts)))
                    else Done ((vs, decapitalize name, SOME t, []), ts))))
        | _ => expected ("a type name", ts)
      val rec bindings = fn ts =>
        bind (binding ts) (fn b => fn ts =>
          if isKey ("and", ts) then bind (bindings (advance ts)) (fn bs => fn ts => Done (b :: bs, ts))
          else Done ([b], ts))
    in
      bind (bindings ts) (fn bs => fn ts =>
        bind (expect (";", ts)) (fn _ => fn ts =>
          case (SmlList.all (fn (_, _, alias, _) => SmlOption.isSome alias) bs,
                SmlList.all (fn (_, _, alias, _) => SubsetBool.not (SmlOption.isSome alias)) bs) of
            (true, _) => Done ([DType (p, SmlList.map (fn (vs, n, alias, _) => let val SOME t = alias in (vs, n, parameterType (vs, t)) end) bs)], ts)
          | (_, true) => Done ([DDatatype (p, SmlList.map (fn (vs, n, _, cons) => (vs, n,
              SmlList.map (fn (q, c, arg) => (q, c, case arg of
                SOME t => SOME (parameterType (vs, t)) | NONE => NONE)) cons)) bs)], ts)
          | _ => Fail ("SubsetML cannot mix type aliases and datatypes in one group", p)))
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Modules *)

    in case lexed of
      LexError (message, pos) => ParseError (message, pos)
    | Tokens (ts, comments) =>
        let
          (* `private` is a modifier only in front of a declaration; elsewhere it is a name. *)
          val privateDecl = fn ts =>
            case (peek ts, peek (advance ts)) of
              ((WName ["private"], _), (WKey "let", _)) => true
            | ((WName ["private"], _), (WKey "type", _)) => true
            | ((WName ["private"], _), (WKey "record", _)) => true
            | ((WName ["private"], _), (WOpen _, _)) => true
            | _ => false
          (* Each declaration with whether Workman keeps it private: authored `private`
             declarations, plain `import *` and the bindings of named imports. *)
          val rec items = fn (decs, exps, ts) =>
            case peek ts of
              (WEOF, _) => Done ((SmlList.rev decs, SmlList.rev exps), ts)
            | _ =>
                let
                  val p = posOf ts
                  (* An unresolved plain import is private; `export from` is public. A resolved
                     one arrives as an open marked `private` when it is private. *)
                  val plainImport = isKey ("from", ts)
                  val add = fn (hidden, ds, ts) =>
                    items (SmlList.revAppend (SmlList.map (fn d => (hidden, p, d)) ds, decs), exps, ts)
                in
                  if privateDecl ts
                  then bind (parseDecl (advance ts)) (fn ds => fn ts => add (true, ds, ts))
                  else (if startsDecl ts orelse isKey ("from", ts) orelse startsExport ts
                  then bind (parseDecl ts) (fn ds => fn ts => add (plainImport, ds, ts))
                  else
                    bind (parseExp ts) (fn e => fn ts =>
                      bind (expect (";", ts)) (fn _ => fn ts =>
                        add (false, [DVal (0, [], [(PId (0, ([], "it")), e)], [])], ts))))
                end
          (* A private run becomes `local <run> in <rest> end`, since the rest may use it. *)
          val rec scope = fn decs =>
            case decs of
              [] => []
            | (false, _, d) :: rest => d :: scope rest
            | (true, p, d) :: rest =>
                let
                  val rec run = fn (acc, xs) => case xs of
                      (true, _, x) :: more => run (x :: acc, more)
                    | _ => (SmlList.rev acc, xs)
                  val (hidden, rest') = run ([d], rest)
                in [DLocal (p, hidden, scope rest')] end
        in
          case items ([], [], ts) of
            Done ((decs, exps), _) => Module (
              if SubsetList.isEmpty aliases then scope decs else [DLocal (0, aliases, scope decs)],
              exps, comments)
          | Fail (message, pos) => ParseError (message, pos)
        end
    end

  val parseModuleTokens = fn (layouts, owner, src, lexed) =>
    parseModuleLowering (layouts, owner, src, lexed, NONE, NONE)

  val parseModuleProject = fn (layouts, owner, src, lexed, prefix) =>
    parseModuleLowering (layouts, owner, src, lexed, SOME prefix, NONE)

  val parseModuleRecordScope = fn (layouts, owner, src, lexed, prefix, resolve) =>
    parseModuleLowering (layouts, owner, src, lexed, SOME prefix, SOME resolve)

  val parseModuleWithLayouts = fn (layouts, owner, src) =>
    parseModuleTokens (layouts, owner, src, WmLexer.lex src)

  (* Extract declaration layouts without requiring the rest of a module to translate yet.
     Complete expressions still pass through normal parsing and strict elaboration. *)
  val recordLayoutsTokens = fn (owner, src, lexed) =>
    let
      val rec scan = fn (tokens, layouts, depth) =>
        case tokens of
          (WKey "record", start) :: rest =>
            if depth > 0 then Fail ("record layout declarations must be top-level in the initial translation profile", start)
            else let
              (* The declaration's own tokens, up to its `;`. Hoisted inline records carry the
                 position of their use, so positions don't delimit them. *)
              val rec header = fn (remaining, acc) =>
                case remaining of
                  (WKey ";", stop) :: tail =>
                    (case parseModuleTokens ([], owner, src, Tokens (
                      SubsetList.append ((WKey "record", start) :: SmlList.rev ((WKey ";", stop) :: acc), [(WEOF, stop + 1)]), [])) of
                       Module ([DType (_, [(variables, name, TyRecord fields)])], [], _) =>
                         scan (tail, Layout (owner, name, variables, fields) :: layouts, depth)
                     | Module (_, _, _) => Fail ("invalid record declaration", start)
                     | ParseError (message, offset) => Fail (message, offset))
                | (WEOF, offset) :: _ => Fail ("unterminated record declaration", offset)
                | token :: tail => header (tail, token :: acc)
                | [] => Fail ("unterminated record declaration", start)
            in header (rest, []) end
        | (WKey "{", _) :: rest => scan (rest, layouts, depth + 1)
        | (WKey ".{", _) :: rest => scan (rest, layouts, depth + 1)
        | (WKey "}", _) :: rest => scan (rest, layouts, depth - 1)
        | _ :: rest => scan (rest, layouts, depth)
        | [] => Done (SmlList.rev layouts, [])
    in
      case lexed of
        LexError (message, offset) => Fail (message, offset)
      | Tokens (tokens, _) => scan (tokens, [], 0)
    end

  val recordLayouts = fn (path, src) =>
    recordLayoutsTokens (structureName path, src, WmLexer.lex src)

  (* `export from "./x.wm" import * as Name;` is `structure Name = X`, which belongs to the
     module's structure rather than its declarations. *)
  val structureAliases = fn src =>
    case lex src of
      LexError _ => []
    | Tokens (tokens, _) =>
        let
          val rec scan = fn tokens =>
            case tokens of
              [] => []
            | (WName ["export"], p) :: (WKey "from", _) :: (WScon (SString file), _) ::
              (WKey "import", _) :: (WKey "*", _) :: (WKey "as", _) :: (WName [alias], _) ::
              (WKey ";", _) :: rest => (p, alias, structureName file) :: scan rest
            | _ :: rest => scan rest
        in scan tokens end

  val parseModule = fn src =>
    case recordLayouts ("", src) of
      Fail (message, offset) => ParseError (message, offset)
    | Done (layouts, _) => parseModuleWithLayouts (layouts, "", src)

end
