(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./types.sml" import * as Types;
from "./env.sml" import * as Env;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./lexer.sml" import * as Lexer;
from "./unify.sml" import * as Unify;
from "./parser.sml" import * as Parser;
from "./elab.sml" import * as Elab;
from "./basis_source.sml" import * as BasisSource;
from "./sml_list.sml" import * as SmlList;
*)

(* Bootstrap compatibility environment used to check and build the compiler today.
   This table still contains SML-shaped host interfaces; it is not the custom SubsetML Basis
   API and does not imply support for the SML Basis Library. The custom library will choose
   its own names, argument order and Result-based failures (docs/basis.md, spec section 9).
   Current interface types are parsed with the SubsetML parser. *)
structure Basis = struct
  open SubsetOptionValue

  open Types
  open Env

  (* --------------------------------------------------------------------------------------- *)
  (* Types *)

  val arguments = fn tn => let val SubsetResult.Ok args = SubsetList.tabulate32 (arityOf tn, TGen) in args end
  val tyStr = fn tn => TyStr (arityOf tn, TCon (tn, arguments tn), [])

  val conEntry = fn (name, scheme) => (name, (scheme, SCon))

  val alpha = TGen 0

  val boolCons = [("true", ([], boolTy)), ("false", ([], boolTy))]
  val listCons =
    [("nil", ([KPlain], listTy alpha)),
     ("::", ([KPlain], TArrow (tupleTy [alpha, listTy alpha], listTy alpha)))]
  val orderTy = TCon (orderName, [])
  val orderCons = [("LESS", ([], orderTy)), ("EQUAL", ([], orderTy)), ("GREATER", ([], orderTy))]

  val withCons = fn (tn, cons) => TyStr (arityOf tn, TCon (tn, arguments tn), cons)

  val topTypes =
    [("unit", TyStr (0, unitTy, [])),
     ("bool", withCons (boolName, boolCons)),
     ("int", tyStr intName),
     ("real", tyStr realName),
     ("string", tyStr stringName),
     ("char", tyStr charName),
     ("list", withCons (listName, listCons)),
     ("order", withCons (orderName, orderCons))]

  (* Abstract Basis types. None is declared to admit equality: claiming equality the Basis
     does not grant would accept programs SML rejects. *)
  val instreamName = (9, "instream", 0, false)
  val outstreamName = (10, "outstream", 0, false)
  val statusName = (11, "status", 0, false)
  val substringName = (12, "substring", 0, false)

  (* --------------------------------------------------------------------------------------- *)
  (* Values, as (structure path, types the structure declares, values) *)

  val topValues =
    [("print", "string -> unit"),
     ("not", "bool -> bool"),
     ("str", "char -> string"),
     ("concat", "string list -> string"),
     ("implode", "char list -> string"),
     ("explode", "string -> char list"),
     ("^", "string * string -> string"),
     ("@", "'a list * 'a list -> 'a list"),
     ("o", "('b -> 'c) * ('a -> 'b) -> 'a -> 'c"),
     ("before", "'a * unit -> 'a"),
     ("ignore", "'a -> unit"),
     ("rev", "'a list -> 'a list"),
     ("map", "('a -> 'b) -> 'a list -> 'b list"),
     ("app", "('a -> unit) -> 'a list -> unit"),
     ("foldl", "('a * 'b -> 'b) -> 'b -> 'a list -> 'b"),
     ("foldr", "('a * 'b -> 'b) -> 'b -> 'a list -> 'b"),
     ("hd", "'a list -> 'a"),
     ("tl", "'a list -> 'a list"),
     ("null", "'a list -> bool"),
     ("valOf", "'a option -> 'a"),
     ("isSome", "'a option -> bool")]

  (* The word structures share their operations; `word` is each structure's own type. The
     entries are those Workman's std also has, so a program using them translates. *)
  val wordValues =
    [("div", "word * word -> word"),
     ("mod", "word * word -> word"),
     ("andb", "word * word -> word"),
     ("orb", "word * word -> word"),
     ("xorb", "word * word -> word"),
     ("notb", "word -> word")]

  val structures =
    [(["Word8"], [("word", word8Name)], wordValues),
     (["Word16"], [("word", word16Name)], wordValues),
     (["Word32"], [("word", word32Name)], wordValues),
     (["Word64"], [("word", word64Name)], wordValues),
     (["Int64"], [("int", int64Name)],
      [("toString", "int -> string"),
       ("div", "int * int -> int"),
       ("mod", "int * int -> int"),
       ("rem", "int * int -> int")]),
     (["Real32"], [("real", real32Name)],
      []),
     (["Int"], [],
      [("toString", "int -> string"),
       ("fromString", "string -> int option"),
       ("rem", "int * int -> int"),
       ("precision", "int option"),
       ("minInt", "int option"),
       ("maxInt", "int option")]),
     (["List"], [],
      [("null", "'a list -> bool"),
       ("hd", "'a list -> 'a"),
       ("tl", "'a list -> 'a list"),
       ("last", "'a list -> 'a"),
       ("rev", "'a list -> 'a list"),
       ("revAppend", "'a list * 'a list -> 'a list"),
       ("concat", "'a list list -> 'a list"),
       ("app", "('a -> unit) -> 'a list -> unit"),
       ("map", "('a -> 'b) -> 'a list -> 'b list"),
       ("mapPartial", "('a -> 'b option) -> 'a list -> 'b list"),
       ("find", "('a -> bool) -> 'a list -> 'a option"),
       ("filter", "('a -> bool) -> 'a list -> 'a list"),
       ("partition", "('a -> bool) -> 'a list -> 'a list * 'a list"),
       ("foldl", "('a * 'b -> 'b) -> 'b -> 'a list -> 'b"),
       ("foldr", "('a * 'b -> 'b) -> 'b -> 'a list -> 'b"),
       ("exists", "('a -> bool) -> 'a list -> bool"),
       ("all", "('a -> bool) -> 'a list -> bool")]),
     (["ListPair"], [],
      [("zip", "'a list * 'b list -> ('a * 'b) list"),
       ("unzip", "('a * 'b) list -> 'a list * 'b list"),
       ("map", "('a * 'b -> 'c) -> 'a list * 'b list -> 'c list"),
       ("app", "('a * 'b -> unit) -> 'a list * 'b list -> unit"),
       ("all", "('a * 'b -> bool) -> 'a list * 'b list -> bool"),
       ("exists", "('a * 'b -> bool) -> 'a list * 'b list -> bool")]),
     (["String"], [],
      [("concat", "string list -> string"),
       ("concatWith", "string -> string list -> string"),
       ("str", "char -> string"),
       ("implode", "char list -> string"),
       ("explode", "string -> char list"),
       ("map", "(char -> char) -> string -> string"),
       ("translate", "(char -> string) -> string -> string"),
       ("tokens", "(char -> bool) -> string -> string list"),
       ("fields", "(char -> bool) -> string -> string list"),
       ("isPrefix", "string -> string -> bool"),
       ("isSuffix", "string -> string -> bool"),
       ("isSubstring", "string -> string -> bool"),
       ("compare", "string * string -> order"),
       ("toString", "string -> string")]),
     (["Char"], [],
      [("isAlpha", "char -> bool"),
       ("isAlphaNum", "char -> bool"),
       ("isDigit", "char -> bool"),
       ("isHexDigit", "char -> bool"),
       ("isSpace", "char -> bool"),
       ("isUpper", "char -> bool"),
       ("isLower", "char -> bool"),
       ("isPrint", "char -> bool"),
       ("isPunct", "char -> bool"),
       ("toUpper", "char -> char"),
       ("toLower", "char -> char"),
       ("contains", "string -> char -> bool"),
       ("notContains", "string -> char -> bool"),
       ("toString", "char -> string"),
       ("compare", "char * char -> order")]),
     (["Real"], [],
      [("==", "real * real -> bool"),
       ("!=", "real * real -> bool"),
       ("rem", "real * real -> real"),
       ("compare", "real * real -> order"),
       ("min", "real * real -> real"),
       ("max", "real * real -> real"),
       ("abs", "real -> real"),
       ("realFloor", "real -> real"),
       ("realCeil", "real -> real"),
       ("isFinite", "real -> bool"),
       ("toString", "real -> string")]),
     (["Option"], [],
      [("map", "('a -> 'b) -> 'a option -> 'b option"),
       ("getOpt", "'a option * 'a -> 'a"),
       ("isSome", "'a option -> bool"),
       ("valOf", "'a option -> 'a")]),
     (["TextIO"], [("instream", instreamName), ("outstream", outstreamName)],
      [("print", "string -> unit"),
       ("openIn", "string -> instream"),
       ("inputAll", "instream -> string"),
       ("closeIn", "instream -> unit"),
       ("openOut", "string -> outstream"),
       ("output", "outstream * string -> unit"),
       ("flushOut", "outstream -> unit"),
       ("closeOut", "outstream -> unit"),
       ("stdOut", "outstream"),
       ("stdErr", "outstream")]),
     (["CommandLine"], [],
      [("name", "unit -> string"),
       ("arguments", "unit -> string list")]),
     (["OS", "Process"], [("status", statusName)],
      [("success", "status"),
       ("failure", "status"),
       ("exit", "status -> 'a")]),
     (["Substring"], [("substring", substringName)],
      [("full", "string -> substring"),
       ("string", "substring -> string"),
       ("dropl", "(char -> bool) -> substring -> substring"),
       ("dropr", "(char -> bool) -> substring -> substring"),
       ("takel", "(char -> bool) -> substring -> substring"),
       ("taker", "(char -> bool) -> substring -> substring")]),
     (* lib/num.sml: real-typed counterparts of the Basis functions that mention int. *)
     (["Num"], [],
      [("div", "real * real -> real"),
       ("mod", "real * real -> real"),
       ("toString", "real -> string"),
       ("fromString", "string -> real option")]),
     (["Num", "String"], [],
      [("size", "string -> real"),
       ("sub", "string * real -> char"),
       ("substring", "string * real * real -> string"),
       ("extract", "string * real * real option -> string")]),
     (["Num", "List"], [],
      [("length", "'a list -> real"),
       ("nth", "'a list * real -> 'a"),
       ("take", "'a list * real -> 'a list"),
       ("drop", "'a list * real -> 'a list"),
       ("tabulate", "real * (real -> 'a) -> 'a list")]),
     (["Num", "Char"], [],
      [("ord", "char -> real"),
       ("chr", "real -> char")]),
     (["Num", "CharVector"], [],
      [("tabulate", "real * (real -> char) -> string")])]

  (* Appendix E's overloading classes over the sized types. An unresolved class defaults to int,
     or to real when it has no int (Elab.closeBinding). *)
  val realintNames = [intName, int64Name, realName, real32Name]
  val numClass = KClass (SubsetList.append (realintNames, wordNames))
  val realintClass = KClass realintNames
  val wordintClass = KClass (intName :: int64Name :: wordNames)
  val realClass = KClass [realName, real32Name]
  val binary = fn result => TArrow (tupleTy [alpha, alpha], result)

  val special =
    [("=", (([KEq], binary boolTy), SValue)),
     ("<>", (([KEq], binary boolTy), SValue)),
     ("+", (([numClass], binary alpha), SValue)),
     ("-", (([numClass], binary alpha), SValue)),
     ("*", (([numClass], binary alpha), SValue)),
     ("<", (([numClass], binary boolTy), SValue)),
     (">", (([numClass], binary boolTy), SValue)),
     ("<=", (([numClass], binary boolTy), SValue)),
     (">=", (([numClass], binary boolTy), SValue)),
     ("~", (([realintClass], TArrow (alpha, alpha)), SValue)),
     ("abs", (([realintClass], TArrow (alpha, alpha)), SValue)),
     ("/", (([realClass], binary alpha), SValue)),
     ("div", (([wordintClass], binary alpha), SValue)),
     ("mod", (([wordintClass], binary alpha), SValue))]

  (* --------------------------------------------------------------------------------------- *)
  (* Building the environment *)

  (* The scheme of a type written in SubsetML syntax, or the reason it is malformed. *)
  val scheme = fn (env, text) =>
    case Lexer.lex text of
      Lexer.LexError (msg, _) => Unify.Err (msg, 0)
    | Lexer.Tokens (ts, _) =>
        case Parser.parseTy ts of
          Parser.Fail (message, pos) => Unify.Err (message, pos)
        | Parser.Done (t, _) =>
            let
              val vars = Elab.distinct (Elab.tyVarsOf t)
              val rec index = fn
                  (_, [], _) => NONE
                | (v, w :: rest, i) => if v = w then SOME (TGen i) else index (v, rest, i + 1)
            in
              Unify.bind (Elab.elabTy (env, fn v => index (v, vars, 0), 0, t, Unify.initial)) (fn body => fn st =>
                Unify.Ok ((SmlList.map (fn _ => KPlain) vars, body), st))
            end

  (* Puts `inner` at `path` inside `outer`, creating structures on the way. *)
  val rec nest = fn (outer, path, inner) =>
    case path of
      [] => plus (outer, inner)
    | name :: rest =>
        let
          val Env.Env (strs, tys, vals) = outer
          val existing =
            case assoc (name, strs) of
              SOME entry => let val (e, basis) = entry in e end
            | NONE => empty
        in
          Env.Env ((name, (nest (existing, rest, inner), true)) :: SmlList.filter (fn (n, _) => n <> name) strs, tys, vals)
        end

  (* The initial environment, or the first malformed entry. *)
  val build = fn (selectedTypes, selectedConstructors, selectedSpecial, selectedValues, selectedStructures) =>
    let
      val topEnv =
        Env.Env ([], selectedTypes,
             SubsetList.append (SmlList.map conEntry selectedConstructors, selectedSpecial))
      (* The structures' types, so that value types can name them (TextIO.instream). *)
      val typesEnv =
        SmlList.foldl (fn ((path, tys, _), env) =>
                      nest (env, path, withTypes (SmlList.map (fn (n, tn) => (n, tyStr tn)) tys)))
          topEnv selectedStructures
      val values = fn (scope, entries) =>
        SmlList.foldl (fn ((name, text), acc) =>
                      case acc of
                        Unify.Err (message, pos) => Unify.Err (message, pos)
                      | Unify.Ok (vals, st) =>
                          case scheme (scope, text) of
                            Unify.Ok (s, _) => Unify.Ok (SubsetList.append (vals, [(name, (s, SValue))]), st)
                          | Unify.Err (msg, _) => Unify.Err ("basis entry " ^ name ^ ": " ^ msg, 0))
          (Unify.Ok ([], Unify.initial)) entries
      (* Values are elaborated where their structure's types are in scope. *)
      val scopeOf = fn path =>
        case structureAt (typesEnv, path) of
          SOME entry => let val (inner, _) = entry in plus (typesEnv, inner) end
        | NONE => typesEnv
    in
      case values (typesEnv, selectedValues) of
        Unify.Err (message, pos) => Unify.Err (message, pos)
      | Unify.Ok (tops, _) =>
          SmlList.foldl (fn ((path, _, entries), acc) =>
                        case acc of
                          Unify.Err (message, pos) => Unify.Err (message, pos)
                        | Unify.Ok (env, st) =>
                            case values (scopeOf path, entries) of
                              Unify.Ok (vals, _) => Unify.Ok (nest (env, path, withValues vals), st)
                            | Unify.Err (message, pos) => Unify.Err (message, pos))
            (Unify.Ok (plus (typesEnv, withValues tops), Unify.initial)) selectedStructures
    end

  (* Host compatibility needs the native SML Option identity, but not another datatype
     definition. Elaborate the shared declaration at its reserved host stamp; portableInitial
     never installs these bindings. Source-imported Option still gets a fresh program stamp. *)
  val compatibilityOption =
    case Lexer.lex BasisSource.option of
      Lexer.LexError (message, pos) => Unify.Err (message, pos)
    | Lexer.Tokens (tokens, comments) =>
        (case Parser.parseTokens (tokens, comments) of
           Parser.ParseError (message, pos) => Unify.Err (message, pos)
         | Parser.Program (phrases, _) =>
             let val Unify.State (vars, _, sels, recs, sites) = Unify.initial in
               Unify.bind (Elab.programExports (Env.empty, phrases,
                 Unify.State (vars, 7, sels, recs, sites))) (fn exports => fn st =>
                   case Env.structureAt (exports, ["SubsetOptionValue"]) of
                     SOME (body, _) => Unify.Ok (body, st)
                   | NONE => Unify.Err ("source Basis is missing SubsetOptionValue", 0))
             end)

  val initial = Unify.bind compatibilityOption (fn Env.Env (_, types, constructors) => fn _ =>
    Unify.bind (build (SubsetList.append (types, topTypes),
      SubsetList.concat [boolCons, listCons, orderCons], special, topValues, structures))
      (fn env => fn st => Unify.Ok (Env.plus (env, Env.withValues constructors), st)))

  (* Portable authored source has no SML Basis structures or convenience values.
     Only representation-level operations remain; see docs/runtime-dependencies.md. *)
  val portableInitial =
    let
      (* Positive allowlists: expanding the compatibility environment must not
         silently expand the native implementation contract. *)
      val select = fn (names, entries) => SmlList.filter
        (fn (name, _) => SmlList.exists (fn candidate => candidate = name) names) entries
    in build (
      select (["unit", "bool", "int", "real", "string", "char", "list"], topTypes),
      SubsetList.append (boolCons, listCons),
      select (["=", "<>", "+", "-", "*", "<", ">", "<=", ">=", "~", "/", "div", "mod"], special),
      select (["^"], topValues),
      [])
    end

end
