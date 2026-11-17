(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./lexer.sml" import * as Lexer;
from "./sml_option.sml" import * as SmlOption;
from "./subset_string.sml" import * as SubsetString;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_list.sml" import * as SubsetList;
from "./sml_list.sml" import * as SmlList;
from "./subset_order.sml" import * as SubsetOrder;
from "./subset_result.sml" import * as SubsetResult;
*)

(* Parsing (docs/spec.md §3, §4, §7, §8; Definition §2, §3, Appendix B).

   SubsetML has no exceptions, so every parsing function returns a `res`: either the parsed value
   with the remaining tokens, or an error. `bind` sequences two parsing steps. *)
structure Parser = struct
  open SubsetOptionValue

  open Syntax
  open Lexer

  type toks = (token * pos) list

  datatype 'a res =
      Done of 'a * toks
    | Fail of string * pos

  val bind = fn r => fn k =>
    case r of
      Done (x, ts) => k x ts
    | Fail (message, offset) => Fail (message, offset)

  val peek = fn
      t :: _ => t
    | [] => (TEOF, 0)

  val advance = fn
      _ :: rest => rest
    | [] => []

  val posOf = fn ts => let val (_, p) = peek ts in p end

  val isKey = fn (k, ts) =>
    case peek ts of
      (TKey k', _) => k = k'
    | _ => false

  (* ---------------------------------------------------------------------------------------- *)
  (* Fixity (spec §3) *)

  (* Precedence and right associativity of the fixed infix identifiers. *)
  val fixity = fn
      "*" => SOME (7, false)
    | "/" => SOME (7, false)
    | "div" => SOME (7, false)
    | "mod" => SOME (7, false)
    | "+" => SOME (6, false)
    | "-" => SOME (6, false)
    | "^" => SOME (6, false)
    | "::" => SOME (5, true)
    | "@" => SOME (5, true)
    | "=" => SOME (4, false)
    | "<>" => SOME (4, false)
    | "<" => SOME (4, false)
    | ">" => SOME (4, false)
    | "<=" => SOME (4, false)
    | ">=" => SOME (4, false)
    | "o" => SOME (3, false)
    | "before" => SOME (0, false)
    | _ => NONE

  val isInfix = fn s => SmlOption.isSome (fixity s)

  val precedence = fn s =>
    case fixity s of
      SOME payload => let val (p, _) = payload in p end
    | NONE => ~1

  val rightAssoc = fn s =>
    case fixity s of
      SOME payload => let val (_, r) = payload in r end
    | NONE => false

  (* ---------------------------------------------------------------------------------------- *)
  (* Errors *)

  val unsupported = fn
      "abstype" => SOME "`abstype` declarations are"
    | "with" => SOME "`abstype` declarations are"
    | "as" => SOME "layered patterns (`as`) are"
    | "exception" => SOME "exceptions are"
    | "raise" => SOME "exceptions are"
    | "handle" => SOME "exceptions are"
    | "fun" => SOME "`fun` declarations (write `val rec f = fn ...`) are"
    | "infix" => SOME "fixity declarations are"
    | "infixr" => SOME "fixity declarations are"
    | "nonfix" => SOME "fixity declarations are"
    | "op" => SOME "`op` in patterns is"
    | "while" => SOME "`while` loops are"
    | "do" => SOME "`while` loops are"
    | "withtype" => SOME "`withtype` is"
    | "eqtype" => SOME "signatures are"
    | "signature" => SOME "signatures are"
    | "sig" => SOME "signatures are"
    | "include" => SOME "signatures are"
    | "sharing" => SOME "signatures are"
    | "where" => SOME "signatures are"
    | ":>" => SOME "signature ascription is"
    | "functor" => SOME "functors are"
    | "..." => SOME "flexible record patterns (`...`) are"
    | _ => NONE

  val describe = fn
      TKey k => "`" ^ k ^ "`"
    | TId s => "identifier `" ^ s ^ "`"
    | TLong (q, s) => "identifier `" ^ SubsetString.concatWith (SubsetList.append (q, [s]), ".") ^ "`"
    | TTyVar s => "type variable `" ^ s ^ "`"
    | TScon _ => "a constant"
    | TEOF => "end of input"

  (* An error at the next token, explaining it if it belongs to an omitted feature. *)
  val expected = fn (what, ts) =>
    case peek ts of
      (TKey k, p) =>
        (case unsupported k of
           SOME feature => Fail (feature ^ " not part of SubsetML", p)
         | NONE => Fail ("expected " ^ what ^ ", found `" ^ k ^ "`", p))
    | (t, p) => Fail ("expected " ^ what ^ ", found " ^ describe t, p)

  val expect = fn (k, ts) =>
    if isKey (k, ts) then Done ((), advance ts) else expected ("`" ^ k ^ "`", ts)

  (* ---------------------------------------------------------------------------------------- *)
  (* Identifiers and labels *)

  val isAlnumId = fn s => (case CompilerText.characters s of [] => false | first :: rest => SubsetChar.isAlpha first)

  (* An alphanumeric identifier that may be bound (spec F1). *)
  val bindableId = fn (what, ts) =>
    case peek ts of
      (TId s, p) =>
        (case (isInfix s, isAlnumId s) of
           (true, _) => Fail ("infix identifier `" ^ s ^ "` cannot be bound in SubsetML", p)
         | (false, true) => Done (s, advance ts)
         | (false, false) => Fail ("symbolic identifier `" ^ s ^ "` cannot be bound in SubsetML", p))
    | _ => expected (what, ts)

  (* A long structure identifier, as in `open`. *)
  val longStrId = fn ts =>
    case peek ts of
      (TId s, _) => if isAlnumId s then Done ([s], advance ts) else expected ("a structure name", ts)
    | (TLong (q, s), _) => Done (SubsetList.append (q, [s]), advance ts)
    | _ => expected ("a structure name", ts)

  val isNumericLabel = fn s =>
    case CompilerText.characters s of
      [] => false
    | first :: rest => first <> #"0" andalso SubsetList.all (first :: rest, SubsetChar.isDigit)

  (* A record label: alphanumeric only in record syntax (spec R4), numeric too after `#`. *)
  val label = fn (allowNumeric, ts) =>
    case peek ts of
      (TId s, _) =>
        if isAlnumId s then Done (s, advance ts) else expected ("a record label", ts)
    | (TScon (SInt s), p) =>
        (case (isNumericLabel s, allowNumeric) of
           (true, true) => Done (s, advance ts)
         | (true, false) => Fail ("numeric record labels are written with tuple syntax in SubsetML", p)
         | (false, _) => expected ("a record label", ts))
    | _ => expected ("a record label", ts)

  val rec duplicateLabel = fn
      [] => NONE
    | (l, _) :: rest =>
        if SmlList.exists (fn (l', _) => l = l') rest then SOME l else duplicateLabel rest

  (* `x1 sep x2 sep ... xn` with n >= 1. *)
  val separated = fn (item, sep, ts) =>
    let
      val rec loop = fn (acc, ts) =>
        case item ts of
          Done (x, rest) =>
            if isKey (sep, rest) then loop (x :: acc, advance rest)
            else Done (SmlList.rev (x :: acc), rest)
        | Fail (message, offset) => Fail (message, offset)
    in
      loop ([], ts)
    end

  (* ---------------------------------------------------------------------------------------- *)
  (* Infix resolution (Definition §2.6) *)

  datatype 'a item =
      Operand of 'a
    | Operator of string * pos

  (* Precedence climbing over `lhs (op operand)*`; `make` builds one infix application. *)
  val rec climb = fn (make, lhs, rest, minPrec) =>
    case rest of
      [] => (lhs, [])
    | (opr, p, rhs) :: more =>
        if precedence opr < minPrec then (lhs, rest)
        else
          let
            val rec absorb = fn (rhs, more) =>
              case more of
                (opr2, _, _) :: _ =>
                  (* Integer precedences have a total order. *)
                  (case (SubsetOrder.compareInt (precedence opr2, precedence opr), rightAssoc opr2) of
                     (SubsetOrder.Greater, _) => absorb (climb (make, rhs, more, precedence opr + 1))
                   | (SubsetOrder.Equal, true) => absorb (climb (make, rhs, more, precedence opr))
                   | _ => (rhs, more))
              | [] => (rhs, more)
            val (rhs', more') = absorb (rhs, more)
          in
            climb (make, make (opr, p, lhs, rhs'), more', minPrec)
          end

  (* Turns `operand (operator operand)*` into a tree. `group` combines a run of adjacent
     operands (application); it may reject the run. *)
  val resolve = fn (group, make, items, start) =>
    let
      val rec operands = fn (items, acc) =>
        case items of
          Operand x :: rest => operands (rest, x :: acc)
        | _ => (SmlList.rev acc, items)

      val rec pairs = fn (items, acc) =>
        case items of
          [] => Done (SmlList.rev acc, [])
        | Operator (opr, p) :: rest =>
            (case operands (rest, []) of
               ([], _) => Fail ("infix operator `" ^ opr ^ "` is missing its right operand", p)
             | (xs, rest') =>
                 bind (group xs) (fn x => fn _ => pairs (rest', (opr, p, x) :: acc)))
        | Operand _ :: _ => Fail ("internal error in infix resolution", start)
    in
      case operands (items, []) of
        ([], Operator (opr, p) :: _) =>
          Fail ("infix operator `" ^ opr ^ "` is missing its left operand; write `op " ^ opr ^ "` for the operator as a value", p)
      | ([], _) => Fail ("expected an expression or pattern", start)
      | (xs, rest) =>
          bind (group xs) (fn first => fn _ =>
            bind (pairs (rest, [])) (fn ps => fn _ =>
              Done (let val (tree, _) = climb (make, first, ps, 0) in tree end, [])))
    end

  val applyExp = fn
      f :: args => Done (SmlList.foldl (fn (a, f) => EApp (f, a)) f args, [])
    | [] => Fail ("internal error: empty application", 0)

  val infixExp = fn (opr, p, l, r) => EApp (EId (p, ([], opr)), ETuple [l, r])

  val infixPat = fn (opr, p, l, r) => PApp (p, ([], opr), PTuple [l, r])

  (* ---------------------------------------------------------------------------------------- *)
  (* Type expressions *)

  val startsTyCon = fn ts =>
    case peek ts of
      (TId s, _) => isAlnumId s andalso SubsetBool.not (isInfix s)
    | (TLong (_, _), _) => true
    | _ => false

  val tyConName = fn ts =>
    case peek ts of
      (TId s, _) => ([], s)
    | (TLong (q, s), _) => (q, s)
    | _ => ([], "")

  val isStar = fn ts =>
    case peek ts of
      (TId "*", _) => true
    | _ => false

  val rec parseTy = fn ts =>
    bind (parseTupleTy ts) (fn t => fn ts =>
      if isKey ("->", ts) then
        bind (parseTy (advance ts)) (fn r => fn ts => Done (TyArrow (t, r), ts))
      else Done (t, ts))

  and parseTupleTy = fn ts =>
    let
      val rec more = fn (acc, ts) =>
        if isStar ts then
          bind (parseAppTy (advance ts)) (fn t => fn ts => more (t :: acc, ts))
        else Done (SmlList.rev acc, ts)
    in
      bind (parseAppTy ts) (fn t => fn ts =>
        bind (more ([t], ts)) (fn parts => fn ts =>
          case parts of
            [single] => Done (single, ts)
          | _ => Done (TyTuple parts, ts)))
    end

  (* An atomic type followed by any number of postfix type constructors. *)
  and parseAppTy = fn ts =>
    let
      val rec postfix = fn (args, ts) =>
        if startsTyCon ts then postfix ([TyCon (args, tyConName ts)], advance ts)
        else Done (args, ts)
      val finish = fn (args, ts) =>
        bind (postfix (args, ts)) (fn result => fn ts' =>
          case result of
            [t] => Done (t, ts')
          | _ => expected ("a type constructor after a type sequence", ts'))
    in
      case peek ts of
        (TTyVar v, _) => finish ([TyVar v], advance ts)
      | (TKey "(", _) =>
          bind (separated (parseTy, ",", advance ts)) (fn args => fn ts =>
            bind (expect (")", ts)) (fn _ => fn ts => finish (args, ts)))
      | (TKey "{", p) =>
          Fail ("record types may only appear as the whole right side of a `type` binding", p)
      | _ =>
          if startsTyCon ts then finish ([TyCon ([], tyConName ts)], advance ts)
          else expected ("a type", ts)
    end

  val parseRecordTy = fn ts =>
    let
      val start = posOf ts
      val field = fn ts =>
        bind (label (false, ts)) (fn l => fn ts =>
          bind (expect (":", ts)) (fn _ => fn ts =>
            bind (parseTy ts) (fn t => fn ts => Done ((l, t), ts))))
    in
      bind (expect ("{", ts)) (fn _ => fn ts =>
        if isKey ("}", ts) then Fail ("empty record types are written `unit` in SubsetML", start)
        else
          bind (separated (field, ",", ts)) (fn fields => fn ts =>
            bind (expect ("}", ts)) (fn _ => fn ts =>
              case duplicateLabel fields of
                SOME l => Fail ("label `" ^ l ^ "` appears twice in a record type", start)
              | NONE => Done (TyRecord fields, ts))))
    end

  (* ---------------------------------------------------------------------------------------- *)
  (* Patterns *)

  val startsAtPat = fn ts =>
    case peek ts of
      (* `op` starts an atomic pattern only so parseAtPat can reject it by name. *)
      (TKey k, _) => k = "_" orelse k = "(" orelse k = "[" orelse k = "{" orelse k = "op"
    | (TId s, _) => SubsetBool.not (isInfix s)
    | (TLong (_, _), _) => true
    | (TScon _, _) => true
    | _ => false

  val rec parsePat = fn ts =>
    bind (parseInfixPat ts) (fn p => fn ts => typedPat (p, ts))

  and typedPat = fn (p, ts) =>
    case peek ts of
      (TKey ":", _) => bind (parseTy (advance ts)) (fn t => fn ts => typedPat (PTyped (p, t), ts))
    | (TKey "as", _) => expected ("", ts)
    | _ => Done (p, ts)

  and parseInfixPat = fn ts =>
    let
      val start = posOf ts
      val rec collect = fn (acc, ts) =>
        case peek ts of
          (TId s, p) =>
            if isInfix s then collect (Operator (s, p) :: acc, advance ts)
            else atom (acc, ts)
        | _ => if startsAtPat ts then atom (acc, ts) else Done (SmlList.rev acc, ts)
      and atom = fn (acc, ts) =>
        bind (parseAtPat ts) (fn p => fn ts => collect (Operand p :: acc, ts))
      val group = fn
          [x] => Done (x, [])
        | [PId (p, c), arg] => Done (PApp (p, c, arg), [])
        | [_, _] => Fail ("only a constructor can be applied in a pattern", start)
        | _ => Fail ("too many atomic patterns in a row", start)
    in
      bind (collect ([], ts)) (fn items => fn ts =>
        bind (resolve (group, infixPat, items, start)) (fn p => fn _ => Done (p, ts)))
    end

  and parseAtPat = fn ts =>
    case peek ts of
      (TKey "_", _) => Done (PWild, advance ts)
    | (TKey "op", p) => Fail ("`op` in patterns is not part of SubsetML", p)
    | (TScon (SReal _), p) => Fail ("real constants may not occur in patterns", p)
    | (TScon c, p) => Done (PScon (p, c), advance ts)
    | (TId s, p) => Done (PId (p, ([], s)), advance ts)
    | (TLong (q, s), p) => Done (PId (p, (q, s)), advance ts)
    | (TKey "(", _) =>
        if isKey (")", advance ts) then Done (PTuple [], advance (advance ts))
        else
          bind (separated (parsePat, ",", advance ts)) (fn ps => fn ts =>
            bind (expect (")", ts)) (fn _ => fn ts =>
              case ps of
                [p] => Done (p, ts)
              | _ => Done (PTuple ps, ts)))
    | (TKey "[", _) =>
        if isKey ("]", advance ts) then Done (PList [], advance (advance ts))
        else
          bind (separated (parsePat, ",", advance ts)) (fn ps => fn ts =>
            bind (expect ("]", ts)) (fn _ => fn ts => Done (PList ps, ts)))
    | (TKey "{", p) => parseRecordPat (p, advance ts)
    | _ => expected ("a pattern", ts)

  and parseRecordPat = fn (start, ts) =>
    let
      (* `lab = pat`, or the punned `lab <: ty>` (Appendix A). *)
      val field = fn ts =>
        bind (label (false, ts)) (fn l => fn ts' =>
          if isKey ("=", ts') then
            bind (parsePat (advance ts')) (fn p => fn ts => Done ((l, p), ts))
          else
            let val var = PId (posOf ts, ([], l)) in
              if isInfix l then Fail ("infix identifier `" ^ l ^ "` cannot be bound in SubsetML", posOf ts)
              else
                case peek ts' of
                  (TKey ":", _) =>
                    bind (parseTy (advance ts')) (fn t => fn ts => Done ((l, PTyped (var, t)), ts))
                | _ => Done ((l, var), ts')
            end)
    in
      if isKey ("}", ts) then Fail ("the empty record pattern is written `()` in SubsetML", start)
      else
        bind (separated (field, ",", ts)) (fn fields => fn ts =>
          bind (expect ("}", ts)) (fn _ => fn ts =>
            case duplicateLabel fields of
              SOME l => Fail ("label `" ^ l ^ "` appears twice in a record pattern", start)
            | NONE => Done (PRecord (start, fields), ts)))
    end

  (* ---------------------------------------------------------------------------------------- *)
  (* Expressions and declarations *)

  val startsAtExp = fn ts =>
    case peek ts of
      (TKey k, _) => k = "(" orelse k = "[" orelse k = "{" orelse k = "#" orelse k = "let" orelse k = "op"
    | (TId s, _) => SubsetBool.not (isInfix s)
    | (TLong (_, _), _) => true
    | (TScon _, _) => true
    | _ => false

  val startsInfixOp = fn ts =>
    case peek ts of
      (TId s, _) => isInfix s
    | (TKey "=", _) => true
    | _ => false

  (* Keywords that start an expression extending as far right as possible. *)
  val startsLowExp = fn ts => isKey ("fn", ts) orelse isKey ("case", ts) orelse isKey ("if", ts)

  val startsDec = fn ts =>
    isKey ("val", ts) orelse isKey ("type", ts) orelse isKey ("datatype", ts)
    orelse isKey ("open", ts) orelse isKey ("local", ts)

  val rec parseExp = fn ts =>
    case peek ts of
      (TKey "fn", _) =>
        bind (parseMatch (advance ts)) (fn m => fn ts => Done (EFn m, ts))
    | (TKey "case", _) =>
        bind (parseExp (advance ts)) (fn e => fn ts =>
          bind (expect ("of", ts)) (fn _ => fn ts =>
            bind (parseMatch ts) (fn m => fn ts => Done (ECase (e, m), ts))))
    | (TKey "if", _) =>
        bind (parseExp (advance ts)) (fn c => fn ts =>
          bind (expect ("then", ts)) (fn _ => fn ts =>
            bind (parseExp ts) (fn a => fn ts =>
              bind (expect ("else", ts)) (fn _ => fn ts =>
                if isKey ("if", ts) then
                  Fail ("`else if` is not part of SubsetML; write `else (if ...)` or use `case`", posOf ts)
                else
                  bind (parseExp ts) (fn b => fn ts => Done (EIf (c, a, b), ts))))))
    | _ => parseOrelse ts

  (* The right operand of `andalso`/`orelse` may itself be a `fn`, `case` or `if`. *)
  and lowOrElse = fn (next, ts) => if startsLowExp ts then parseExp ts else next ts

  and parseOrelse = fn ts =>
    let
      val rec more = fn (l, ts) =>
        if isKey ("orelse", ts) then
          bind (lowOrElse (parseAndalso, advance ts)) (fn r => fn ts => more (EOrelse (l, r), ts))
        else Done (l, ts)
    in
      bind (parseAndalso ts) (fn l => fn ts => more (l, ts))
    end

  and parseAndalso = fn ts =>
    let
      val rec more = fn (l, ts) =>
        if isKey ("andalso", ts) then
          bind (lowOrElse (parseTyped, advance ts)) (fn r => fn ts => more (EAndalso (l, r), ts))
        else Done (l, ts)
    in
      bind (parseTyped ts) (fn l => fn ts => more (l, ts))
    end

  and parseTyped = fn ts =>
    let
      val rec more = fn (e, ts) =>
        case peek ts of
          (TKey ":", _) => bind (parseTy (advance ts)) (fn t => fn ts => more (ETyped (e, t), ts))
        | (TKey "handle", _) => expected ("", ts)
        | _ => Done (e, ts)
    in
      bind (parseInfixExp ts) (fn e => fn ts => more (e, ts))
    end

  and parseInfixExp = fn ts =>
    let
      val start = posOf ts
      val rec collect = fn (acc, ts) =>
        case peek ts of
          (TId s, p) =>
            if isInfix s then collect (Operator (s, p) :: acc, advance ts)
            else atom (acc, ts)
        | (TKey "=", p) => collect (Operator ("=", p) :: acc, advance ts)
        | _ => if startsAtExp ts then atom (acc, ts) else Done (SmlList.rev acc, ts)
      and atom = fn (acc, ts) =>
        bind (parseAtExp ts) (fn e => fn ts => collect (Operand e :: acc, ts))
    in
      if startsAtExp ts orelse startsInfixOp ts then
        bind (collect ([], ts)) (fn items => fn ts =>
          bind (resolve (applyExp, infixExp, items, start)) (fn e => fn _ => Done (e, ts)))
      else expected ("an expression", ts)
    end

  and parseAtExp = fn ts =>
    case peek ts of
      (TScon c, p) => Done (EScon (p, c), advance ts)
    | (TId s, p) => Done (EId (p, ([], s)), advance ts)
    | (TLong (q, s), p) => Done (EId (p, (q, s)), advance ts)
    | (TKey "#", p) =>
        (case peek (advance ts) of
           (TScon (SInt _), q) =>
             Fail ("tuple selectors (#1, #2, ...) are not part of SubsetML; use a pattern such as (_, x)", q)
         | _ => bind (label (false, advance ts)) (fn l => fn ts => Done (ESelect (p, l), ts)))
    | (TKey "(", _) => parseParenExp (advance ts)
    (* `op` passes an infix operator as a function value: `op +` is `fn (a, b) => a + b`. *)
    | (TKey "op", p) =>
        (case peek (advance ts) of
           (TId s, _) => if isInfix s then Done (EId (p, ([], s)), advance (advance ts))
             else expected ("an infix identifier after `op`", advance ts)
         | (TKey "=", _) => Done (EId (p, ([], "=")), advance (advance ts))
         | _ => expected ("an infix identifier after `op`", advance ts))
    | (TKey "[", _) =>
        if isKey ("]", advance ts) then Done (EList [], advance (advance ts))
        else
          bind (separated (parseExp, ",", advance ts)) (fn es => fn ts =>
            bind (expect ("]", ts)) (fn _ => fn ts => Done (EList es, ts)))
    | (TKey "{", p) => parseRecordExp (p, advance ts)
    | (TKey "let", _) =>
        bind (parseDecs (advance ts)) (fn ds => fn ts =>
          bind (expect ("in", ts)) (fn _ => fn ts =>
            bind (separated (parseExp, ";", ts)) (fn es => fn ts =>
              bind (expect ("end", ts)) (fn _ => fn ts => Done (ELet (ds, es), ts)))))
    | _ => expected ("an expression", ts)

  (* After `(`: unit, a parenthesised expression, a tuple or a sequence. *)
  and parseParenExp = fn ts =>
    if isKey (")", ts) then Done (ETuple [], advance ts)
    else
      bind (parseExp ts) (fn e => fn ts =>
        case peek ts of
          (TKey ",", _) =>
            bind (separated (parseExp, ",", advance ts)) (fn es => fn ts =>
              bind (expect (")", ts)) (fn _ => fn ts => Done (ETuple (e :: es), ts)))
        | (TKey ";", _) =>
            bind (separated (parseExp, ";", advance ts)) (fn es => fn ts =>
              bind (expect (")", ts)) (fn _ => fn ts => Done (ESeq (e :: es), ts)))
        | _ => bind (expect (")", ts)) (fn _ => fn ts => Done (e, ts)))

  and parseRecordExp = fn (start, ts) =>
    let
      val field = fn ts =>
        bind (label (false, ts)) (fn l => fn ts =>
          bind (expect ("=", ts)) (fn _ => fn ts =>
            bind (parseExp ts) (fn e => fn ts => Done ((l, e), ts))))
    in
      if isKey ("}", ts) then Fail ("the empty record is written `()` in SubsetML", start)
      else
        bind (separated (field, ",", ts)) (fn fields => fn ts =>
          bind (expect ("}", ts)) (fn _ => fn ts =>
            case duplicateLabel fields of
              SOME l => Fail ("label `" ^ l ^ "` appears twice in a record expression", start)
            | NONE => Done (ERecord (start, fields), ts)))
    end

  and parseMatch = fn ts =>
    let
      val rule = fn ts =>
        bind (parsePat ts) (fn p => fn ts =>
          bind (expect ("=>", ts)) (fn _ => fn ts =>
            bind (parseExp ts) (fn e => fn ts => Done ((p, e), ts))))
    in
      separated (rule, "|", ts)
    end

  (* `'a` or `('a, ..., 'z)` before the bindings of `val`, `type` and `datatype`. *)
  and parseTyVarSeq = fn ts =>
    case (peek ts, peek (advance ts)) of
      ((TTyVar v, _), _) => Done ([v], advance ts)
    | ((TKey "(", _), (TTyVar _, _)) =>
        let
          val tyvar = fn ts =>
            case peek ts of
              (TTyVar v, _) => Done (v, advance ts)
            | _ => expected ("a type variable", ts)
        in
          bind (separated (tyvar, ",", advance ts)) (fn vs => fn ts =>
            bind (expect (")", ts)) (fn _ => fn ts => Done (vs, ts)))
        end
    | _ => Done ([], ts)

  and parseDecs = fn ts =>
    case (isKey (";", ts), startsDec ts) of
      (true, _) => parseDecs (advance ts)
    | (false, true) =>
        bind (parseDec ts) (fn d => fn ts =>
          bind (parseDecs ts) (fn ds => fn ts => Done (d :: ds, ts)))
    | (false, false) => Done ([], ts)

  and parseDec = fn ts =>
    let val p = posOf ts in
      case peek ts of
        (TKey "val", _) =>
          bind (parseTyVarSeq (advance ts)) (fn vs => fn ts =>
            bind (parseValBind (false, [], [], ts)) (fn (plain, recs) => fn ts =>
              Done (DVal (p, vs, plain, recs), ts)))
      | (TKey "type", _) =>
          bind (separated (parseTypBind, "and", advance ts)) (fn bs => fn ts =>
            Done (DType (p, bs), ts))
      | (TKey "datatype", _) =>
          bind (separated (parseDatBind, "and", advance ts)) (fn bs => fn ts =>
            Done (DDatatype (p, bs), ts))
      | (TKey "open", _) =>
          let
            val rec more = fn (acc, ts) =>
              case peek ts of
                (TId s, _) =>
                  if isAlnumId s andalso SubsetBool.not (isInfix s)
                  then bind (longStrId ts) (fn id => fn ts => more (id :: acc, ts))
                  else Done (SmlList.rev acc, ts)
              | (TLong (_, _), _) => bind (longStrId ts) (fn id => fn ts => more (id :: acc, ts))
              | _ => Done (SmlList.rev acc, ts)
          in
            bind (longStrId (advance ts)) (fn first => fn ts =>
              bind (more ([first], ts)) (fn ids => fn ts => Done (DOpen (p, ids), ts)))
          end
      | (TKey "local", _) =>
          bind (parseDecs (advance ts)) (fn hidden => fn ts =>
            bind (expect ("in", ts)) (fn _ => fn ts =>
              bind (parseDecs ts) (fn body => fn ts =>
                bind (expect ("end", ts)) (fn _ => fn ts => Done (DLocal (p, hidden, body), ts)))))
      | _ => expected ("a declaration", ts)
    end

  (* valbind ::= pat = exp <and valbind> | rec valbind. Bindings after `rec` are recursive. *)
  and parseValBind = fn (isRec, plain, recs, ts) =>
    if isKey ("rec", ts) then parseValBind (true, plain, recs, advance ts)
    else
      bind (parsePat ts) (fn pat => fn ts =>
        bind (expect ("=", ts)) (fn _ => fn ts =>
          let val bodyPos = posOf ts in
            bind (parseExp ts) (fn e => fn ts =>
              let
                val ok =
                  case e of
                    EFn _ => true
                  | _ => SubsetBool.not isRec
                val plain' = if isRec then plain else (pat, e) :: plain
                val recs' = if isRec then (pat, e) :: recs else recs
              in
                case (ok, isKey ("and", ts)) of
                  (false, _) => Fail ("the right side of a `rec` binding must be `fn match`", bodyPos)
                | (true, true) => parseValBind (isRec, plain', recs', advance ts)
                | (true, false) => Done ((SmlList.rev plain', SmlList.rev recs'), ts)
              end)
          end))

  and parseTypBind = fn ts =>
    bind (parseTyVarSeq ts) (fn vs => fn ts =>
      bind (bindableId ("a type constructor name", ts)) (fn tycon => fn ts =>
        bind (expect ("=", ts)) (fn _ => fn ts =>
          if isKey ("{", ts) then
            bind (parseRecordTy ts) (fn t => fn ts => Done ((vs, tycon, t), ts))
          else
            bind (parseTy ts) (fn t => fn ts => Done ((vs, tycon, t), ts)))))

  and parseDatBind = fn ts =>
    let
      val conbind = fn ts =>
        bind (bindableId ("a constructor name", ts)) (fn con => fn ts' =>
          if isKey ("of", ts') then
            bind (parseTy (advance ts')) (fn t => fn ts' => Done ((posOf ts, con, SOME t), ts'))
          else Done ((posOf ts, con, NONE), ts'))
    in
      bind (parseTyVarSeq ts) (fn vs => fn ts =>
        bind (bindableId ("a type constructor name", ts)) (fn tycon => fn ts =>
          bind (expect ("=", ts)) (fn _ => fn ts =>
            if isKey ("datatype", ts) then
              Fail ("datatype replication is not part of SubsetML", posOf ts)
            else
              bind (separated (conbind, "|", ts)) (fn cons => fn ts =>
                Done ((vs, tycon, cons), ts)))))
    end

  (* ---------------------------------------------------------------------------------------- *)
  (* Structures and programs *)

  (* Restriction M2: only `structure Name = Target`, and only before the body's declarations. *)
  val rec parseStructureAliases = fn (aliases, ts) =>
    case (isKey (";", ts), isKey ("structure", ts)) of
      (true, _) => parseStructureAliases (aliases, advance ts)
    | (false, false) => Done (SubsetList.reverse aliases, ts)
    | (false, true) =>
        let val pos = posOf ts in
          bind (bindableId ("a structure name", advance ts)) (fn name => fn ts =>
            bind (expect ("=", ts)) (fn _ => fn ts =>
              case (isKey ("struct", ts), SubsetList.exists (aliases, fn (_, other, _) => other = name)) of
                (true, _) => Fail ("nested structures are not part of SubsetML", posOf ts)
              | (false, true) => Fail ("duplicate structure alias " ^ name, pos)
              | (false, false) =>
                  bind (bindableId ("the name of a program structure", ts)) (fn target => fn ts =>
                    parseStructureAliases ((pos, name, target) :: aliases, ts))))
        end

  val parseStrBind = fn ts =>
    bind (bindableId ("a structure name", ts)) (fn name => fn ts =>
      if isKey (":", ts) then Fail ("signature ascription is not part of SubsetML", posOf ts)
      else
        bind (expect ("=", ts)) (fn _ => fn ts =>
          if SubsetBool.not (isKey ("struct", ts)) then
            (* An alias module, `structure A = B`, is `structure A = struct open B end`: it
               declares B's bindings, with B's types, under the name A. *)
            (case peek ts of
               (TId target, p) =>
                 if isAlnumId target then Done ((name, [], [DOpen (p, [[target]])]), advance ts)
                 else Fail ("only `struct ... end` and alias structure expressions are part of SubsetML", p)
             | (_, p) => Fail ("only `struct ... end` and alias structure expressions are part of SubsetML", p))
          else
            bind (parseStructureAliases ([], advance ts)) (fn aliases => fn ts =>
              bind (parseDecs ts) (fn ds => fn ts =>
                if isKey ("structure", ts) then
                  Fail ("nested structures are not part of SubsetML; a structure alias must precede the structure's declarations", posOf ts)
                else
                  bind (expect ("end", ts)) (fn _ => fn ts => Done ((name, aliases, ds), ts))))))

  val rec parseStrDecs = fn ts =>
    case (isKey ("structure", ts), startsDec ts) of
      (true, _) =>
        bind (separated (parseStrBind, "and", advance ts)) (fn bs => fn ts' =>
          bind (parseStrDecs ts') (fn rest => fn ts' =>
            Done (SStructure (posOf ts, bs) :: rest, ts')))
    | (false, true) =>
        bind (parseDec ts) (fn d => fn ts =>
          bind (parseStrDecs ts) (fn rest => fn ts => Done (SDec d :: rest, ts)))
    | (false, false) => Done ([], ts)

  val endOfPhrase = fn ts =>
    isKey (";", ts) orelse (case peek ts of (TEOF, _) => true | _ => false)

  (* program ::= topdec ; <program> | exp ; <program> (Definition §8). *)
  val parseProgram = fn ts =>
    let
      val rec phrases = fn (acc, ts) =>
        if isKey (";", ts) then phrases (acc, advance ts)
        else
          case peek ts of
            (TEOF, _) => Done (SmlList.rev acc, ts)
          | (_, p) =>
              if isKey ("structure", ts) orelse startsDec ts then
                bind (parseStrDecs ts) (fn sds => fn ts =>
                  if endOfPhrase ts then phrases (TopDecs sds :: acc, ts)
                  else expected ("a declaration or `;`", ts))
              else
                bind (parseExp ts) (fn e => fn ts =>
                  if endOfPhrase ts then phrases (TopExp (p, e) :: acc, ts)
                  else expected ("`;` after a top-level expression", ts))
    in
      phrases ([], ts)
    end

  (* Spec M1: a file contains at most one structure. *)
  val checkFile = fn prog =>
    let
      val structures =
        SmlList.concat (SmlList.map (fn
            TopDecs sds =>
              SmlList.concat (SmlList.map (fn
                  SStructure (p, binds) => SmlList.map (fn _ => p) binds
                | SDec _ => []) sds)
          | TopExp (_, _) => []) prog)
    in
      case structures of
        _ :: second :: _ => SOME ("a file may contain only one structure", second)
      | _ => NONE
    end

  datatype result =
      Program of topdec list * comment list
    | ParseError of string * pos

  (* A separate token entry point lets procedures preserve lexical vs parse failures. *)
  val parseTokens = fn (ts, comments) =>
    case parseProgram ts of
      Done (prog, _) =>
        (case checkFile prog of
           NONE => Program (prog, comments)
         | SOME error => let val (message, offset) = error in ParseError (message, offset) end)
    | Fail (message, offset) => ParseError (message, offset)

  val parse = fn src =>
    case Lexer.lex src of
      LexError (message, offset) => ParseError (message, offset)
    | Tokens (ts, comments) => parseTokens (ts, comments)

end
