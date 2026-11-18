(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./doc.sml" import * as Doc;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_string.sml" import * as SubsetString;
from "./subset_list.sml" import * as SubsetList;
from "./sml_list.sml" import * as SmlList;
from "./subset_result.sml" import * as SubsetResult;
from "./parser.sml" import * as Parser;
from "./subset_process.sml" import * as SubsetProcess;
*)

(* Prints abstract syntax as Workman source, following the frontend-v3 spelling
   (../wm-mini/tooling/frontend-v3/lexical-design.md). The mapping is designed to be read back
   by WmParse; docs/translation.md lists every rule.

   Translate rejects unsupported declaration forms before printing; no embedded SML
   declarations are emitted. Expression compatibility forms retain their own mappings. *)
structure WmPrint = struct
  open SubsetOptionValue

  open Syntax
  open Doc

  (* --------------------------------------------------------------------------------------- *)
  (* Names *)

  val capitalize = fn s =>
    case CompilerText.characters s of [] => "" | first :: rest =>
      CompilerText.stringOf (SubsetChar.toUpper first :: rest)

  val startsUpper = fn s =>
    case CompilerText.characters s of [] => false | first :: rest => SubsetChar.isUpper first
  val startsAlpha = fn s =>
    case CompilerText.characters s of [] => false | first :: rest => SubsetChar.isAlpha first
  val dotted = fn (qs, s) => SubsetString.concatWith (SubsetList.append (qs, [s]), ".")

  (* Type constructors are capitalized; the Definition's `unit` and the fixed-size `int` and
     `real` take Workman's names. *)
  val tyConName = fn
      ([], "unit") => "Void"
    | ([], "real") => "Real64.Real"
    | ([], "int") => "Int32.Int"
    | (qs, s) => dotted (qs, capitalize s)

  (* Numeric adapters retain SML argument order. Keep this table shared with the reader. *)
  val numNames =
    SubsetList.concat [
      SmlList.concat (SmlList.map (fn (q, names) =>
        SmlList.map (fn x => ((["Num", q], x), ([q], x))) names)
        [("String", ["size", "sub", "substring", "extract"]),
         ("List", ["length", "nth", "take", "drop", "tabulate"]),
         ("Char", ["ord", "chr"]), ("CharVector", ["tabulate"])]),
      SmlList.map (fn x => ((["Num"], x), (["Real64"], x)))
        ["div", "mod", "toString", "fromString"],
      SmlList.map (fn x => (([], x), (["Int32"], x))) ["div", "mod"],
      (* Read back only: Workman's per-type division is SML's overloaded `div` and `mod`. *)
      SmlList.concat (SmlList.map (fn q => SmlList.map (fn x => (([], x), ([q], x))) ["div", "mod"])
        ["Int64", "Word8", "Word16", "Word32", "Word64"])]

  (* Basis constructors spelled differently in Workman. *)
  val valueName = fn
      (qs, "NONE") => dotted (qs, "None")
    | (qs, "SOME") => dotted (qs, "Some")
    | id =>
        (case SmlList.find (fn (sml, _) => sml = id) numNames of
           SOME entry => let val (sml, wm) = entry in dotted wm end
         | NONE => dotted id)

  (* Workman tells constructors from variables by case; SubsetML code follows the same
     convention, with the Definition's lowercase constructors as exceptions. *)
  val isConName = fn (qs, s) =>
    SubsetBool.not (SmlList.null qs) orelse startsUpper s orelse s = "true" orelse s = "false"
    orelse s = "nil"

  (* `'a` is written `a`: Workman type variables are lowercase type names. *)
  val tyVarName = fn v =>
    case CompilerText.characters v of [] => "" | first :: rest => CompilerText.stringOf rest

  (* --------------------------------------------------------------------------------------- *)
  (* Constants *)

  val minus = fn s => CompilerText.map (fn c => if c = #"~" then #"-" else c) s

  (* Compiler-internal byte code: subtraction splits at most fifteen hexadecimal groups. *)
  val hex2 = fn n =>
    let
      val SubsetResult.Ok byte = SubsetChar.fromCode n
      val digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"]
      val rec digit = fn (index, values) =>
        case values of first :: rest =>
          if index <= 0 then first else digit (index - 1, rest)
      val rec split = fn (low, high) =>
        if low >= 16 then split (low - 16, high + 1) else (high, low)
      val (high, low) = split (n, 0)
    in digit (high, digits) ^ digit (low, digits) end

  val escapeChar = fn (quote, c) =>
    case c of
      #"\n" => "\\n"
    | #"\t" => "\\t"
    | #"\r" => "\\r"
    | #"\\" => "\\\\"
    | _ =>
        if c = quote then "\\" ^ CompilerText.str c
        else (if SubsetChar.isPrint c then CompilerText.str c else "\\u00" ^ hex2 (let val SubsetResult.Ok code = SubsetChar.toCode c in code end))

  (* An SML int constant is a bare Workman literal: Workman types an integer literal by context and
     defaults it to Int32, and an SML int constant is always in Int32 range. A real keeps its
     fraction, since a bare integer literal in an undecided context is int. *)
  val scon = fn
      SInt s => minus s
    (* A Workman integer literal takes a word type from context: `0w7` is 7, `0wx1F` 0x1F. *)
    | SWord s => if CompilerText.slice (s, 0, 3) = "0wx" then "0" ^ CompilerText.drop (s, 2) else CompilerText.drop (s, 2)
    | SReal s => minus s
    | SString s => "\"" ^ SubsetString.concat (SubsetList.map (CompilerText.characters s,
        fn c => escapeChar (#"\"", c))) ^ "\""
    | SChar c => "'" ^ escapeChar (#"'", c) ^ "'"

  val isNegative = fn
      SReal s => (case CompilerText.characters s of #"~" :: rest => true | bytes => false)
    | SInt s => (case CompilerText.characters s of #"~" :: rest => true | bytes => false)
    | _ => false

  (* --------------------------------------------------------------------------------------- *)
  (* Types *)

  val rec ty = fn
      TyVar v => text (tyVarName v)
    | TyCon ([], id) => text (tyConName id)
    | TyCon (args, id) => cats [text (tyConName id ^ "<"), join (", ", SmlList.map ty args), text ">"]
    | TyTuple ts => cats [text "(", join (", ", SmlList.map ty ts), text ")"]
    | TyArrow (TyArrow (a, b), c) => cats [text "(", ty (TyArrow (a, b)), text ") -> ", ty c]
    | TyArrow (a, b) => cats [ty a, text " -> ", ty b]
    | TyRecord fields =>
        group ("{", ",", "}", SmlList.map (fn (l, t) => cats [text (l ^ ": "), ty t]) fields)

  val typeParams = fn
      [] => ""
    | vs => "<" ^ SubsetString.concatWith (SubsetList.map (vs, tyVarName), ", ") ^ ">"

  (* --------------------------------------------------------------------------------------- *)
  (* Patterns

     `inMatch` says whether the pattern is in a match arm, where Workman pins bare names;
     `binds` says whether a bare name binds at this exact position. In a match arm that holds
     only for constructor arguments, list items and record field puns, so other binders are
     written `Var(x)`. *)

  val rec pat = fn (inMatch, binds, p) =>
    let val child = fn (b, q) => pat (inMatch, b orelse SubsetBool.not inMatch, q) in
      case p of
        PWild => text "_"
      | PScon (pos, c) => atom (pos, scon c)
      | PId (pos, ([], "nil")) => atom (pos, "[]")
      | PPinned (pos, id) => atom (pos, valueName id)
      | PComputed (pos, _) => atom (pos, "UNLOWERED_COMPUTED_PATTERN")
      | PId (pos, id) =>
          if isConName id orelse binds then atom (pos, valueName id)
          else cats [text "Var(", atom (pos, valueName id), text ")"]
      | PTuple [] => text "void"
      | PTuple ps => group ("(", ",", ")", SmlList.map (fn q => child (false, q)) ps)
      | PList ps => group ("[", ",", "]", SmlList.map (fn q => child (true, q)) ps)
      | PApp (pos, ([], "::"), PTuple [h, t]) =>
          let
            val rec spine = fn
                (PApp (_, ([], "::"), PTuple [h, t]), acc) => spine (t, h :: acc)
              | (PList items, acc) => (SubsetList.append (SmlList.rev acc, items), NONE)
              | (PId (_, ([], "nil")), acc) => (SmlList.rev acc, NONE)
              | (tail, acc) => (SmlList.rev acc, SOME tail)
            val (items, tail) = spine (p, [])
            val itemDocs = SmlList.map (fn q => child (true, q)) items
            val tailDocs =
              case tail of
                NONE => []
              | SOME q => [cat (text "..", child (true, q))]
          in
            cat (atom (pos, ""), group ("[", ",", "]", SubsetList.append (itemDocs, tailDocs)))
          end
      | PApp (pos, id, PTuple (args :: more)) =>
          cats [atom (pos, valueName id),
                group ("(", ",", ")", SmlList.map (fn q => child (true, q)) (args :: more))]
      | PApp (pos, id, arg) => cats [atom (pos, valueName id), text "(", child (true, arg), text ")"]
      | PRecord (pos, fields) =>
          let
            val field = fn
                (l, PId (_, ([], x))) =>
                  if x = l andalso SubsetBool.not (isConName ([], x)) then text l
                  else cats [text (l ^ " = "), child (false, PId (0, ([], x)))]
              | (l, q) => cats [text (l ^ " = "), child (false, q)]
          in
            cat (atom (pos, "."), group ("{ ", ",", " }", SmlList.map field fields))
          end
      | PTyped (q, t) => cats [text "(", child (false, q), text ": ", ty t, text ")"]
    end

  (* Patterns Workman accepts as lambda parameters: no constructors or constants. *)
  val rec paramOk = fn
      PWild => true
    | PId (_, id) => SubsetBool.not (isConName id)
    | PTuple ps => SmlList.all paramOk ps
    | PList ps => SmlList.all paramOk ps
    | PRecord (_, fields) => SmlList.all (fn (_, q) => paramOk q) fields
    | PTyped (q, _) => paramOk q
    | PApp (_, ([], "::"), PTuple [h, t]) => paramOk h andalso paramOk t
    | _ => false

  (* A lambda parameter list: a tuple pattern is the list itself. *)
  val params = fn p =>
    let
      val item = fn
          PTyped (q, t) => cats [pat (false, true, q), text ": ", ty t]
        | q => pat (false, true, q)
    in
      case p of
        PTuple [] => text "()"
      | PTuple ps => group ("(", ",", ")", SmlList.map item ps)
      | _ => cats [text "(", item p, text ")"]
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Expressions

     Levels follow the Workman grammar: 0 for if, match, lambdas and expression compatibility forms, then
     || 1, && 2, == != 3, comparisons 4, ++ + - 5, * / 6, prefix 7, calls 9, atoms 10. *)

  val binop = fn
      "=" => SOME ("==", 3)
    | "<>" => SOME ("!=", 3)
    | "<" => SOME ("<", 4)
    | ">" => SOME (">", 4)
    | "<=" => SOME ("<=", 4)
    | ">=" => SOME (">=", 4)
    | "+" => SOME ("+", 5)
    | "-" => SOME ("-", 5)
    | "^" => SOME ("++", 5)
    | "*" => SOME ("*", 6)
    | "/" => SOME ("/", 6)
    | _ => NONE

  val parenAt = fn (need : int, (level, d)) =>
    if level >= need then d else cats [text "(", d, text ")"]

  (* An expression usable as `e.lab`: a variable or a chain of such selections. *)
  val rec selectable = fn
      EId (_, id) => SubsetBool.not (isConName id)
    | EApp (ESelect (_, l), e) => startsAlpha l andalso selectable e
    | _ => false

  (* The body of a block: a `let` contributes its declarations and expressions. *)
  val blockParts = fn
      ELet (ds, es) => (ds, es)
    | e => ([], [e])

  val rec expL = fn
      EScon (p, c) => (if isNegative c then 7 else 10, atom (p, scon c))
    | EId (p, ([], "nil")) => (10, atom (p, "[]"))
    | EId (p, (["Real"], opr)) =>
        if opr = "==" orelse opr = "!=" then
          let
            val realTy = TyCon ([], ([], "real"))
            val left = PTyped (PId (p, ([], "realLeft")), realTy)
            val right = PTyped (PId (p, ([], "realRight")), realTy)
          in
            expL (EFn [(PTuple [left, right],
              EApp (EId (p, (["Real"], opr)),
                    ETuple [EId (p, ([], "realLeft")), EId (p, ([], "realRight"))]))])
          end
        else (10, atom (p, valueName (["Real"], opr)))
    (* `op +`: Workman has no operator values, so an operator passed as a value is a lambda.
       `div` and `mod` have Workman function spellings already, and the printer reaches their
       calls through this case, so they stay names. *)
    | EId (p, ([], opr)) =>
        if (Parser.isInfix opr orelse opr = "=") andalso valueName ([], opr) = opr
        then expL (EFn [(PTuple [PId (p, ([], "left")), PId (p, ([], "right"))],
                         EApp (EId (p, ([], opr)), ETuple [EId (p, ([], "left")), EId (p, ([], "right"))]))])
        else (10, atom (p, valueName ([], opr)))
    | EId (p, id) => (10, atom (p, valueName id))
    | ERecord (p, fields) =>
        (10, cat (atom (p, "."),
                  group ("{ ", ",", " }", SmlList.map (fn (l, e) => cats [text (l ^ " = "), exp e]) fields)))
    | ECopy (_, source, _, _) => expL source
    | ESelect (p, l) => (10, atom (p, "#" ^ l))
    | ETuple [] => (10, text "void")
    | ETuple es => (10, group ("(", ",", ")", SmlList.map exp es))
    | EList es => (10, group ("[", ",", "]", SmlList.map exp es))
    | ESeq es => (10, group ("(", ";", ")", SmlList.map exp es))
    | ELet (ds, es) => (10, block (ds, es))
    | EApp (EId (p, ([], "::")), ETuple [h, t]) =>
        let
          val rec spine = fn
              (EApp (EId (_, ([], "::")), ETuple [h, t]), acc) => spine (t, h :: acc)
            | (EList items, acc) => (SubsetList.append (SmlList.rev acc, items), NONE)
            | (EId (_, ([], "nil")), acc) => (SmlList.rev acc, NONE)
            | (tail, acc) => (SmlList.rev acc, SOME tail)
          val (items, tail) = spine (EApp (EId (p, ([], "::")), ETuple [h, t]), [])
          val tailDocs =
            case tail of
              NONE => []
            | SOME e => [cat (text "..", exp e)]
        in
          (10, cat (atom (p, ""), group ("[", ",", "]", SubsetList.append (SmlList.map exp items, tailDocs))))
        end
    | EApp (EId (p, (["Int"], "rem")), ETuple [l, r]) =>
        (6, cats [parenAt (6, expL l), atom (p, " % "), parenAt (7, expL r)])
    | EApp (EId (p, (["Real"], opr)), ETuple [l, r]) =>
        if opr = "==" orelse opr = "!=" then
          let val left = case l of ETyped (x, TyCon ([], ([], "real"))) => x | _ => l in
            (3, cats [text "(", exp left, text ": Real64.Real)", atom (p, " " ^ opr ^ " "),
                        parenAt (4, expL r)])
          end
        else call (EId (p, (["Real"], opr)), ETuple [l, r])
    | EApp (EId (p, ([], opr)), ETuple [l, r]) =>
        (case (binop opr, Parser.isInfix opr) of
           (NONE, true) =>
             if opr = "@" orelse opr = "div" orelse opr = "mod"
             then call (EId (p, if opr = "@" then (["List"], "append") else ([], opr)), ETuple [l, r])
             else
               (* o and before: no Workman operator, so the SML operator stays. *)
               (0, cats [parenAt (9, expL l), atom (p, " " ^ opr ^ " "), parenAt (9, expL r)])
         | (SOME entry, _) =>
             let val (spelling, level) = entry in (level, cats [parenAt (level, expL l), atom (p, " " ^ spelling ^ " "),
                           parenAt (level + 1, expL r)]) end
         | (NONE, false) => call (EId (p, ([], opr)), ETuple [l, r]))
    | EApp (EId (p, ([], "not")), e) => (7, cat (atom (p, "!"), parenAt (7, expL e)))
    | EApp (EId (p, ([], "~")), e) =>
        let val (level, d) = expL e in
          (* `-3` would read back as a negative literal, so a literal operand keeps parentheses. *)
          (7, cat (atom (p, "-"),
                   case (e, level >= 9) of
                     (EScon (_, _), _) => cats [text "(", d, text ")"]
                   | (_, true) => d
                   | (_, false) => cats [text "(", d, text ")"]))
        end
    | EApp (ESelect (p, l), e) =>
        if selectable e andalso startsAlpha l
        then (10, cats [exp e, atom (p, "." ^ l)])
        else call (ESelect (p, l), e)
    | EApp (f, a) => call (f, a)
    | ETyped (e, t) => (10, cats [text "(", exp e, text ": ", ty t, text ")"])
    | EAndalso (a, b) => expL (EIf (a, b, EId (0, ([], "false"))))
    | EOrelse (a, b) => expL (EIf (a, EId (0, ([], "true")), b))
    | EIf (c, a, b) =>
        (0, cats [text "if (", exp c, text ") ", block (blockParts a), text " else ",
                  block (blockParts b)])
    | ECase (e, rules) =>
        let
          val scrutinee =
            case e of
              ETuple (first :: second :: more) => join (", ", SmlList.map exp (first :: second :: more))
            | _ => exp e
        in
          (0, cat (cats [text "match(", scrutinee, text ") "], arms rules))
        end
    | EFn [(p, body)] =>
        if paramOk p then (0, cats [params p, text " => ", lambdaBody body])
        else (0, cat (text "match ", arms [(p, body)]))
    | EFn rules => (0, cat (text "match ", arms rules))

  and exp = fn e => let val (_, d) = expL e in d end

  (* Application is always an explicit call; a tuple argument becomes the argument list. *)
  and call = fn (f, a) =>
    let
      val args =
        case a of
          ETuple [] => text "()"
        | ETuple es => group ("(", ",", ")", SmlList.map exp es)
        | _ => cats [text "(", exp a, text ")"]
    in
      (9, cat (parenAt (9, expL f), args))
    end

  (* A curried lambda chains without braces: (a) => (b) => { e }. *)
  and lambdaBody = fn
      EFn [(p, body)] =>
        if paramOk p then cats [params p, text " => ", lambdaBody body] else block ([], [EFn [(p, body)]])
    | e => block (blockParts e)

  and arms = fn rules =>
    let
      val arm = fn (p, e) => cats [pat (true, false, p), text " => ", block (blockParts e)]
      val count = SubsetList.length32 rules
      val rec go = fn
          (_, []) => []
        | (i, r :: rest) => (if i < count - 1 then cat (arm r, text ",") else arm r) :: go (i + 1, rest)
    in
      stack [text "{", indent (2, stack (go (0, rules))), text "}"]
    end

  (* `{ decs; e1; ...; en }`, on one line when it is a single short expression. *)
  and block = fn (ds, es) =>
    let
      val count = SubsetList.length32 es
      val rec exps = fn
          (_, []) => []
        | (i, e :: rest) => (if i < count - 1 then cat (exp e, text ";") else exp e) :: exps (i + 1, rest)
      val items = SubsetList.append (SmlList.map (fn d => dec ([], d)) ds, exps (0, es))
    in
      case items of
        [single] =>
          if SmlList.null ds andalso (case flat single of SOME text => CompilerText.size text <= 60 | NONE => false)
          then cats [text "{ ", single, text " }"]
          else stack [text "{", indent (2, single), text "}"]
      | _ => stack [text "{", indent (2, stack items), text "}"]
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Declarations. `structures` lists the program's structures, which become files. *)

  and binding = fn
      (PTyped (p, t), e) => cats [pat (false, true, p), text ": ", ty t, text " = ", exp e]
    | (p, e) => cats [pat (false, true, p), text " = ", exp e]

  and andGroup = fn (keyword, bindings) =>
    case bindings of
      [] => keyword
    | first :: rest =>
        let val lines = cat (keyword, first) :: SmlList.map (fn b => cat (text "and ", b)) rest in
          cat (stack lines, text ";")
        end

  and dec = fn (structures, d) =>
    case d of
      DVal (p, [], plain, []) => andGroup (atom (p, "let "), SmlList.map binding plain)
    | DVal (p, [], [], recs) => andGroup (atom (p, "let rec "), SmlList.map binding recs)
    | DVal (_, _, _, _) => unsupportedDeclaration ()
    | DType (p, [(vs, tycon, TyRecord fields)]) =>
        cats [atom (p, "record "), text (capitalize tycon ^ typeParams vs ^ " = "),
              group ("{", ",", "}", SmlList.map (fn (l, t) => cats [text (l ^ ": "), ty t]) fields),
              text ";"]
    | DType (p, binds) =>
        if SmlList.exists (fn (_, _, t) => case t of TyRecord _ => true | _ => false) binds
        then unsupportedDeclaration ()
        else
          andGroup (atom (p, "type "),
                    SmlList.map (fn (vs, tycon, t) => cats [text (capitalize tycon ^ typeParams vs ^ " = "), ty t])
                      binds)
    | DDatatype (p, binds) =>
        let
          val con = fn
              (cp, c, NONE) => atom (cp, valueName ([], c))
            | (cp, c, SOME (TyTuple ts)) => cats [atom (cp, valueName ([], c)), text "<", join (", ", SmlList.map ty ts), text ">"]
            | (cp, c, SOME t) => cats [atom (cp, valueName ([], c)), text "<", ty t, text ">"]
          val bind = fn (vs, tycon, cons) =>
            let
              val head = text (capitalize tycon ^ typeParams vs ^ " =")
              val docs = SmlList.map con cons
              val oneLine =
                case docs of
                  [single] => cats [head, text " | ", single]
                | _ => cats [head, text " ", join (" | ", docs)]
            in
              if fits oneLine then oneLine
              else stack [head, indent (2, stack (SmlList.map (fn c => cat (text "| ", c)) docs))]
            end
        in
          andGroup (atom (p, "type "), SmlList.map bind binds)
        end
    | DOpen (p, ids) =>
        if SmlList.all (fn id => SmlList.exists (fn s => [s] = id) structures) ids
        then stack (SmlList.map (fn id =>
          let val SubsetResult.Ok name = SubsetList.last id in
            atom (p, "export from \"./" ^ fileName (dotted ([], name)) ^ "\" import *;")
          end) ids)
        else unsupportedDeclaration ()
    | DLocal _ => unsupportedDeclaration ()

  (* Translate.declarationGaps checks the complete tree before invoking this printer. *)
  and unsupportedDeclaration = fn () => SubsetProcess.panic "unsupported declaration reached WM printer"

  (* `WmPrint` is in `wm_print.wm`. *)
  and fileName = fn name =>
    let
      val rec go = fn
          ([], _) => []
        | (c :: rest, first) =>
            if SubsetChar.isUpper c andalso SubsetBool.not first
            then #"_" :: SubsetChar.toLower c :: go (rest, false)
            else SubsetChar.toLower c :: go (rest, false)
    in
      CompilerText.stringOf (go (CompilerText.characters name, true)) ^ ".wm"
    end

  val decPosition = fn d =>
    case d of
      DVal (p, _, _, _) => p | DType (p, _) => p | DDatatype (p, _) => p
    | DOpen (p, _) => p | DLocal (p, _, _) => p

  (* A structure-level declaration. `local dec1 in dec2 end` is Workman's `private`: dec1's
     declarations become private, and a `local open` a plain, non-exported import. *)
  val rec moduleDec = fn (structures, hidden, d) =>
    case (d, hidden) of
      (DLocal (_, inner, body), _) =>
        stack (SubsetList.append (SmlList.map (fn x => moduleDec (structures, true, x)) inner,
                                  SmlList.map (fn x => moduleDec (structures, hidden, x)) body))
    | (DOpen (p, ids), true) =>
        stack (SmlList.map (fn id =>
          let val SubsetResult.Ok name = SubsetList.last id in
            atom (p, "from \"./" ^ fileName (dotted ([], name)) ^ "\" import *;")
          end) ids)
    | (_, true) => cat (atom (decPosition d, "private "), dec (structures, d))
    | (_, false) => dec (structures, d)

  val topdec = fn (structures, td) =>
    case td of
      TopDecs sds =>
        stack (SmlList.map (fn
                  SDec d => moduleDec (structures, false, d)
                | SStructure (_, binds) =>
                    stack (SmlList.map (fn (_, _, ds) => stack (SmlList.map (fn d => moduleDec (structures, false, d)) ds)) binds))
                sds)
    | TopExp (_, e) => cat (exp e, text ";")

  (* Comment lines in Workman syntax: `//` for one line, `/* */` for several. *)
  val commentStyle = fn
      [single] => ["// " ^ trim single]
    | lines =>
        let
          val rec decorate = fn
              ([], isFirst, acc) => SubsetList.reverse acc
            | (line :: rest, isFirst, acc) =>
                decorate (rest, false,
                  ((if isFirst then "/*" else "") ^ line ^ (if SubsetList.isEmpty rest then "*/" else "")) :: acc)
        in decorate (lines, true, []) end

end
