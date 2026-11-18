(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./doc.sml" import * as Doc;
from "./subset_string.sml" import * as SubsetString;
from "./subset_list.sml" import * as SubsetList;
from "./compiler_text.sml" import * as CompilerText;
from "./sml_list.sml" import * as SmlList;
from "./parser.sml" import * as Parser;
*)

(* Prints abstract syntax as SubsetML source. Used for the wm-to-SML direction and for the
   constructs that have no Workman form. Parentheses follow the precedence of the parser. *)
structure SmlPrint = struct
  open SubsetOptionValue

  open Syntax
  open Doc

  val longid = fn (qs, s) => SubsetString.concatWith (SubsetList.append (qs, [s]), ".")

  val scon = fn
      SInt s => s
    | SWord s => s
    | SReal s => s
    | SString s => "\"" ^ CompilerText.escapeSmlString s ^ "\""
    | SChar c => "#\"" ^ CompilerText.escapeSmlChar c ^ "\""

  (* --------------------------------------------------------------------------------------- *)
  (* Types: arrow 0, tuple 1, application 2, atom 3 *)

  val parenAt = fn (need : int, (level, d)) =>
    if level >= need then d else cats [text "(", d, text ")"]

  val rec tyL = fn
      TyVar v => (3, text v)
    | TyCon ([], id) => (3, text (longid id))
    | TyCon ([arg], id) => (2, cats [parenAt (2, tyL arg), text " ", text (longid id)])
    | TyCon (args, id) =>
        (2, cats [text "(", join (", ", SmlList.map (fn t => parenAt (0, tyL t)) args), text ") ",
                  text (longid id)])
    | TyTuple ts => (1, join (" * ", SmlList.map (fn t => parenAt (2, tyL t)) ts))
    | TyArrow (a, b) => (0, cats [parenAt (1, tyL a), text " -> ", parenAt (0, tyL b)])
    | TyRecord fields =>
        (3, group ("{", ",", "}", SmlList.map (fn (l, t) => cats [text (l ^ " : "), ty t]) fields))

  and ty = fn t => let val (_, d) = tyL t in d end

  (* --------------------------------------------------------------------------------------- *)
  (* Patterns: typed 0, infix 1, constructor application 2, atom 3 *)

  val rec patL = fn
      PWild => (3, text "_")
    | PScon (p, c) => (3, atom (p, scon c))
    | PId (p, id) => (3, atom (p, longid id))
    | PPinned (p, id) => (3, atom (p, "UNLOWERED_PIN_" ^ longid id))
    | PComputed (p, _) => (3, atom (p, "UNLOWERED_COMPUTED_PATTERN"))
    | PRecord (p, fields) =>
        (3, cats [atom (p, ""),
                  group ("{", ",", "}", SmlList.map (fn (l, q) => cats [text (l ^ " = "), pat q]) fields)])
    | PTuple ps => (3, group ("(", ",", ")", SmlList.map pat ps))
    | PList ps => (3, group ("[", ",", "]", SmlList.map pat ps))
    | PApp (p, ([], "::"), PTuple [h, t]) =>
        (1, cats [parenAt (2, patL h), atom (p, " :: "), parenAt (1, patL t)])
    | PApp (p, id, arg) => (2, cats [atom (p, longid id), text " ", parenAt (3, patL arg)])
    | PTyped (q, t) => (0, cats [parenAt (1, patL q), text " : ", ty t])

  and pat = fn p => let val (_, d) = patL p in d end

  (* --------------------------------------------------------------------------------------- *)
  (* Expressions *)

  (* Levels: fn/case/if 0, orelse 1, andalso 2, typed 3, infix 10 + precedence, application 20,
     atom 30. *)
  val infixLevel = fn s => 10 + Parser.precedence s

  (* An expression whose last part is a match, which would capture a following `|`. *)
  val rec endsInMatch = fn
      ECase (_, _) => true
    | EFn _ => true
    | EIf (_, _, b) => endsInMatch b
    | _ => false

  val tyvarseq = fn
      [] => empty
    | [v] => text (v ^ " ")
    | vs => text ("(" ^ SubsetString.concatWith (vs, ", ") ^ ") ")

  val rec expL = fn
      EScon (p, c) => (30, atom (p, scon c))
    (* An infix operator outside an application is a value only as `op +`. *)
    | EId (p, ([], opr)) =>
        if Parser.isInfix opr orelse opr = "=" then (30, atom (p, "(op " ^ opr ^ ")"))
        else (30, atom (p, longid ([], opr)))
    | EId (p, id) => (30, atom (p, longid id))
    | ERecord (p, fields) =>
        (30, cats [atom (p, ""),
                   group ("{", ",", "}", SmlList.map (fn (l, e) => cats [text (l ^ " = "), exp e]) fields)])
    | ESelect (p, l) => (30, atom (p, "#" ^ l))
    | ECopy (_, source, _, _) => expL source
    | ETuple es => (30, group ("(", ",", ")", SmlList.map exp es))
    | EList es => (30, group ("[", ",", "]", SmlList.map exp es))
    | ESeq es => (30, group ("(", ";", ")", SmlList.map exp es))
    | ELet (ds, es) =>
        (30, stack [text "let",
                    indent (2, stack (SmlList.map dec ds)),
                    text "in",
                    indent (2, join ("; ", SmlList.map exp es)),
                    text "end"])
    | EApp (EId (p, ([], opr)), ETuple [l, r]) =>
        if Parser.isInfix opr then
          let
            val level = infixLevel opr
            val (leftNeed, rightNeed) =
              if Parser.rightAssoc opr then (level + 1, level) else (level, level + 1)
          in
            (level, cats [parenAt (leftNeed, expL l), atom (p, " " ^ opr ^ " "),
                          parenAt (rightNeed, expL r)])
          end
        else application (EId (p, ([], opr)), ETuple [l, r])
    | EApp (f, a) => application (f, a)
    | ETyped (e, t) => (3, cats [parenAt (3, expL e), text " : ", ty t])
    | EAndalso (a, b) => (2, cats [parenAt (2, expL a), text " andalso ", parenAt (3, expL b)])
    | EOrelse (a, b) => (1, cats [parenAt (1, expL a), text " orelse ", parenAt (2, expL b)])
    | EIf (c, a, b) =>
        let
          (* A nested `if` in the else branch keeps its parentheses (spec C1). *)
          val elseDoc =
            case b of
              EIf (_, _, _) => parenAt (1, expL b)
            | _ => exp b
          val oneLine = cats [text "if ", exp c, text " then ", exp a, text " else ", elseDoc]
        in
          if fits oneLine then (0, oneLine)
          else (0, stack [cats [text "if ", exp c, text " then"], indent (2, exp a), text "else", indent (2, elseDoc)])
        end
    | ECase (e, rules) => (0, stack [cats [text "case ", exp e, text " of"], indent (2, matchRules (true, rules))])
    | EFn [(p, body)] =>
        (* A body that does not fit goes on the next lines: `f (fn x =>` then the body. *)
        let
          val head = cats [text "fn ", pat p, text " =>"]
          val bodyDoc =
            case body of
              EFn [_] => exp body
            | _ => if endsInMatch body then parenAt (1, expL body) else exp body
          val oneLine = cats [head, text " ", bodyDoc]
        in
          case (fits oneLine, body) of
            (true, _) => (0, oneLine)
          | (false, EFn [_]) => (0, cats [head, text " ", bodyDoc])
          | (false, _) => (0, stack [head, indent (2, bodyDoc)])
        end
    | EFn rules => (0, stack [text "fn", indent (2, matchRules (true, rules))])

  and application = fn (f, a) => (20, cats [parenAt (20, expL f), text " ", parenAt (30, expL a)])

  and exp = fn e => let val (_, d) = expL e in d end

  (* Match rules one per line; `aligned` indents the first so that its pattern lines up with
     the others after their `| `. *)
  and matchRules = fn (aligned, rules) =>
    let
      val count = SubsetList.length32 rules
      val rule = fn (i, (p, e)) =>
        let
          val body = if i < count - 1 andalso endsInMatch e then parenAt (1, expL e) else exp e
          val head = cats [text (if i > 0 then "| " else (if aligned then "  " else "")), pat p, text " =>"]
          val oneLine = cats [head, text " ", body]
        in
          if fits oneLine then oneLine else stack [head, indent (4, body)]
        end
      val rec number = fn (i, rs) =>
        case rs of
          [] => []
        | r :: rest => rule (i, r) :: number (i + 1, rest)
    in
      stack (number (0, rules))
    end

  and binding = fn (p, e) => cats [pat p, text " = ", exp e]

  and dec = fn
      DVal (p, vs, plain, recs) =>
        let
          val bindings =
            SubsetList.append (SmlList.map binding plain,
              case recs of
                 [] => []
               | first :: rest => cat (text "rec ", binding first) :: SmlList.map binding rest)
        in
          andGroup (cats [atom (p, "val "), tyvarseq vs], bindings)
        end
    | DType (p, binds) =>
        andGroup (atom (p, "type "),
                  SmlList.map (fn (vs, tycon, t) => cats [tyvarseq vs, text (tycon ^ " = "), ty t]) binds)
    | DDatatype (p, binds) =>
        let
          val con = fn
              (cp, c, NONE) => atom (cp, c)
            | (cp, c, SOME t) => cats [atom (cp, c ^ " of "), ty t]
          val bind = fn (vs, tycon, cons) =>
            let val oneLine = cats [tyvarseq vs, text (tycon ^ " = "), join (" | ", SmlList.map con cons)] in
              if fits oneLine then oneLine
              else
                stack [cats [tyvarseq vs, text (tycon ^ " =")],
                       indent (4, stack (case SmlList.map con cons of
                                           [] => []
                                         | first :: rest =>
                                             first :: SmlList.map (fn c => cat (text "| ", c)) rest))]
            end
        in
          andGroup (atom (p, "datatype "), SmlList.map bind binds)
        end
    | DOpen (p, ids) => atom (p, "open " ^ SubsetString.concatWith (SubsetList.map (ids, fn id => SubsetString.concatWith (id, ".")), " "))
    | DLocal (p, hidden, body) =>
        stack [atom (p, "local"), indent (2, stack (SmlList.map dec hidden)), text "in",
               indent (2, stack (SmlList.map dec body)), text "end"]

  (* `keyword b1 and b2 ...` with each binding on its own line. *)
  and andGroup = fn (keyword, bindings) =>
    case bindings of
      [] => keyword
    | first :: rest => stack (cat (keyword, first) :: SmlList.map (fn b => cat (text "and ", b)) rest)

  val strdec = fn
      SDec d => dec d
    | SStructure (p, binds) =>
        let
          val alias = fn (q, name, target) => atom (q, "structure " ^ name ^ " = " ^ target)
          val bind = fn (i, (name, aliases, ds)) =>
            stack [cats [if (i = 0) then atom (p, "structure ") else text "and ", text (name ^ " = struct")],
                   indent (2, stack (SubsetList.append (SmlList.map alias aliases, SmlList.map dec ds))),
                   text "end"]
          val rec number = fn (i, bs) =>
            case bs of
              [] => []
            | b :: rest => bind (i, b) :: number (i + 1, rest)
        in
          stack (number (0, binds))
        end

  val topdec = fn
      TopDecs sds => stack (SmlList.map strdec sds)
    | TopExp (_, e) => cat (exp e, text ";")

  (* Comment lines in SML syntax. *)
  val commentStyle = fn
      [] => ["(**)"]
    | [single] => ["(* " ^ trim single ^ " *)"]
    | lines =>
        let
          val rec decorate = fn
              ([], isFirst, acc) => SubsetList.reverse acc
            | (line :: rest, isFirst, acc) =>
                decorate (rest, false,
                  ((if isFirst then "(*" else "") ^ line ^ (if SubsetList.isEmpty rest then "*)" else "")) :: acc)
        in decorate (lines, true, []) end

end
