(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./types.sml" import * as Types;
from "./syntax.sml" import * as Syntax;
from "./int_map.sml" import * as IntMap;
from "./sml_list.sml" import * as SmlList;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_result.sml" import * as SubsetResult;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_string.sml" import * as SubsetString;
from "./subset_list.sml" import * as SubsetList;
*)

(* Unification over a substitution threaded as state (SubsetML has no references).

   Type variables carry a kind (Types.kind) and a level. A variable created while elaborating
   the right side of a `val` at level n has level n + 1; unification lowers levels so that a
   variable's level is the outermost declaration it escapes to. At the end of the declaration,
   variables still above level n are free in no enclosing context and may be generalized. *)
structure Unify = struct
  open SubsetOptionValue

  open Types

  datatype var =
      Free of kind * int                (* kind, level *)
    | Bound of ty

  (* A `# lab` selection waiting for its record type to be known (Definition §4.11):
     position, level, record type, label, field type. *)
  type selection = Syntax.pos * int * ty * string * ty

  (* A recorded site: an operand with its type, a Workman literal, or a type variable a
     binding's scheme generalized. *)
  datatype site =
      Operand of Syntax.pos * ty
    (* A Workman integer literal and its type: an int-or-real class until context decides,
       as in Workman, whose integer literals take a real type from their context. *)
    | Literal of Syntax.pos * ty
    (* A type variable some binding's scheme took. One never generalized and never decided, in
       a closed value, stands for no value at all (Translate.displayOf). *)
    | Generalized of int
    (* A `# lab` whose record type was known only from the one declared record type with that
       label, as Workman resolves `user.score`: the selection's position and the labels. *)
    | FieldRecord of Syntax.pos * string list
    (* A record pattern naming some of its annotated record type's fields, as Workman allows
       (`.{ succeed, map }: Carrier<...>`): the pattern's position and all the type's labels. *)
    | PatternRecord of Syntax.pos * string list

  (* Variables, the next fresh number (also used for type name stamps), pending selections,
     the label sets of the record type declarations so far (spec R2), and, when translating
     from Workman, equality sites plus resolved numeric/library identifier sites
     used by native integer emission (see `lenient`). *)
  datatype state =
      State of var IntMap.map * int * selection list * (string list * int * ty) list * site list option

  val initial = State (IntMap.empty, firstStamp, [], [], NONE)

  (* For translating Workman, whose `==` also compares numbers: `=` and `<>` accept any
     operands, and each use is recorded with its operand type, so that the uses on real can
     become Real.== and Real.!= (Translate.realEquality). Elab also records numeric
     identifier function types here for NativeInt; these are distinct from equality
     operand entries and are ignored by the real-equality rewrite. *)
  val lenient = State (IntMap.empty, firstStamp, [], [], SOME [])

  datatype 'a res =
      Ok of 'a * state
    | Err of string * Syntax.pos

  val bind = fn r => fn k =>
    case r of
      Ok (x, st) => k x st
    | Err (message, pos) => Err (message, pos)

  (* The result of a unification: failures carry a reason, possibly empty. *)
  datatype outcome =
      Unified of state
    | Mismatch of string

  val andThen = fn (r, k) =>
    case r of
      Unified st => k st
    | Mismatch m => Mismatch m

  val fresh = fn (State (vars, next, sels, recs, eqs), kind, level) =>
    (TVar next, State (IntMap.insert (vars, next, Free (kind, level)), next + 1, sels, recs, eqs))

  val freshStamp = fn State (vars, next, sels, recs, eqs) => (next, State (vars, next + 1, sels, recs, eqs))

  val lookup = fn (State (vars, _, _, _, _), v) =>
    case IntMap.find (vars, v) of
      SOME info => info
    | NONE => Free (KPlain, 0)

  val set = fn (State (vars, next, sels, recs, eqs), v, info) =>
    State (IntMap.insert (vars, v, info), next, sels, recs, eqs)

  (* Follows bound variables at the head of a type. *)
  val rec prune = fn (st, t) =>
    case t of
      TVar v =>
        (case lookup (st, v) of
           Bound t' => prune (st, t')
         | Free (_, _) => t)
    | _ => t

  (* Whether a numeric class variable is the type of a Workman integer literal. Its default,
     int, then agrees with Workman's Int32 literal default. *)
  val literalVar = fn (st, v) =>
    let val State (_, _, _, _, sites) = st in
      case sites of
        NONE => false
      | SOME xs => SmlList.exists (fn site => case site of
          Literal (_, t) => (case prune (st, t) of TVar w => w = v | _ => false)
        | _ => false) xs
    end

  (* Applies the substitution throughout a type. *)
  val rec resolve = fn (st, t) =>
    case prune (st, t) of
      TCon (n, ts) => TCon (n, SmlList.map (fn a => resolve (st, a)) ts)
    | TArrow (a, b) => TArrow (resolve (st, a), resolve (st, b))
    | TRecord fields => TRecord (SmlList.map (fn (l, a) => (l, resolve (st, a))) fields)
    | t' => t'

  (* The free variables of a type, in order of appearance, without repeats. *)
  val freeVars = fn (st, t) =>
    let
      val rec go = fn (t, acc) =>
        case prune (st, t) of
          TVar v => if SmlList.exists (fn w => (w = v)) acc then acc else SubsetList.append (acc, [v])
        | TCon (_, ts) => SmlList.foldl go acc ts
        | TArrow (a, b) => go (b, go (a, acc))
        | TRecord fields => SmlList.foldl (fn ((_, a), acc) => go (a, acc)) acc fields
        | _ => acc
    in
      go (t, [])
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Printing *)

  val varName = fn i =>
    "'" ^ (if i < 26 then (case SubsetChar.fromCode (97 + i) of SubsetResult.Ok c => CompilerText.str c | SubsetResult.Err error => "t" ^ CompilerText.natural i) else "t" ^ CompilerText.natural i)

  (* Prints types, naming their free variables consistently across the list. *)
  val showAll = fn (st, ts) =>
    let
      val ts' = SmlList.map (fn t => resolve (st, t)) ts
      val vars = SmlList.foldl (fn (t, acc) => SubsetList.append (acc,
        SmlList.filter (fn v => SubsetBool.not (SmlList.exists (fn w => (w = v)) acc)) (freeVars (st, t)))) [] ts'
      val rec indexOf = fn
          (_, [], _) => 0
        | (v, w :: rest, i) => if (v = w) then i else indexOf (v, rest, i + 1)
      (* Explicit type variables keep their names, so free variables avoid them. *)
      val rec rigids = fn
          TRigid name => [name]
        | TCon (_, ts) => SmlList.concat (SmlList.map rigids ts)
        | TArrow (a, b) => SubsetList.append (rigids a, rigids b)
        | TRecord fields => SmlList.concat (SmlList.map (fn (_, a) => rigids a) fields)
        | _ => []
      val taken = SmlList.concat (SmlList.map rigids ts')
      val rec nth = fn (i, candidate) =>
        if SmlList.exists (fn r => r = varName candidate) taken then nth (i, candidate + 1)
        else (if (i = 0) then varName candidate else nth (i - 1, candidate + 1))
      val varText = fn v =>
        let val name = nth (indexOf (v, vars, 0), 0) in
          case lookup (st, v) of
            Free (KEq, _) => "'" ^ name
          | Free (KClass names, _) => name ^ " (" ^ SubsetString.concatWith ((SmlList.map nameOf names), " or ") ^ ")"
          | _ => name
        end
      (* Levels: arrow 0, tuple 1, application 2. *)
      val rec show = fn (level, t) =>
        let val paren = fn (need, s) => if level > need then "(" ^ s ^ ")" else s in
          case t of
            TVar v => varText v
          | TGen i => varName i
          | TRigid name => name
          | TCon (n, []) => nameOf n
          | TCon (n, [a]) => show (2, a) ^ " " ^ nameOf n
          | TCon (n, args) => "(" ^ SubsetString.concatWith (SmlList.map (fn a => show (0, a)) args, ", ") ^ ") " ^ nameOf n
          | TArrow (a, b) => paren (0, show (1, a) ^ " -> " ^ show (0, b))
          | TRecord [] => "unit"
          | TRecord fields =>
              (case tupleComponents fields of
                 SOME parts => paren (1, SubsetString.concatWith (SmlList.map (fn a => show (2, a)) parts, " * "))
               | NONE => "{" ^ SubsetString.concatWith (SmlList.map (fn (l, a) => l ^ " : " ^ show (0, a)) fields, ", ") ^ "}")
        end
    in
      SmlList.map (fn t => show (0, t)) ts'
    end

  val show = fn (st, t) =>
    case showAll (st, [t]) of
      [s] => s
    | _ => ""

  (* --------------------------------------------------------------------------------------- *)
  (* Unification *)

  val sameName = fn (a, b) => (stampOf a = stampOf b)

  (* The kind of a variable that must satisfy both kinds. *)
  val combine = fn
      (KPlain, k) => SOME k
    | (k, KPlain) => SOME k
    | (KEq, KEq) => SOME KEq
    | (KEq, KClass ns) => (case SmlList.filter (fn (_, _, _, eq) => eq) ns of [] => NONE | ns' => SOME (KClass ns'))
    | (KClass ns, KEq) => (case SmlList.filter (fn (_, _, _, eq) => eq) ns of [] => NONE | ns' => SOME (KClass ns'))
    | (KClass a, KClass b) =>
        (case SmlList.filter (fn n => SmlList.exists (fn m => sameName (n, m)) b) a of
           [] => NONE
         | ns => SOME (KClass ns))

  val kindText = fn
      KEq => "an equality type"
    | KClass ns => "one of " ^ SubsetString.concatWith ((SmlList.map nameOf ns), ", ")
    | KPlain => "a type"

  (* Lowers the levels of the variables in t to at most `level`. *)
  val rec adjust = fn (st, level, t) =>
    case prune (st, t) of
      TVar v =>
        (case lookup (st, v) of
           Free (k, l) => if l > level then set (st, v, Free (k, level)) else st
         | Bound _ => st)
    | TCon (_, ts) => SmlList.foldl (fn (a, st) => adjust (st, level, a)) st ts
    | TArrow (a, b) => adjust (adjust (st, level, a), level, b)
    | TRecord fields => SmlList.foldl (fn ((_, a), st) => adjust (st, level, a)) st fields
    | _ => st

  val rec occurs = fn (st, v, t) =>
    case prune (st, t) of
      TVar w => (v = w)
    | TCon (_, ts) => SmlList.exists (fn a => occurs (st, v, a)) ts
    | TArrow (a, b) => occurs (st, v, a) orelse occurs (st, v, b)
    | TRecord fields => SmlList.exists (fn (_, a) => occurs (st, v, a)) fields
    | _ => false

  (* Makes t satisfy kind k. *)
  val rec requireKind = fn (st, k, t) =>
    case (k, prune (st, t)) of
      (KPlain, _) => Unified st
    | (_, TVar w) =>
        (case lookup (st, w) of
           Free (k2, l) =>
             (case combine (k, k2) of
                SOME k' => Unified (set (st, w, Free (k', l)))
              | NONE =>
                  (case (k, k2) of
                     (KEq, KClass (n :: _)) => Mismatch ("type " ^ nameOf n ^ " does not admit equality")
                   | (KClass (n :: _), KEq) => Mismatch ("type " ^ nameOf n ^ " does not admit equality")
                   | _ => Mismatch ("it must be " ^ kindText k ^ " and " ^ kindText k2)))
         | Bound _ => Unified st)
    | (KEq, TCon ((_, name, _, eq), args)) =>
        if eq then requireAll (st, k, args)
        else Mismatch ("type " ^ name ^ " does not admit equality")
    | (KEq, TRecord fields) => requireAll (st, k, SmlList.map (fn (_, t) => t) fields)
    | (KEq, TArrow (_, _)) => Mismatch "function types do not admit equality"
    | (KEq, TRigid name) => Mismatch ("type variable " ^ name ^ " does not admit equality")
    | (KClass ns, TCon (n, [])) =>
        if SmlList.exists (fn m => sameName (n, m)) ns then Unified st
        else Mismatch ("the overloaded operation needs " ^ kindText k)
    | (KClass _, _) => Mismatch ("the overloaded operation needs " ^ kindText k)
    | (_, TGen _) => Unified st

  and requireAll = fn (st, k, ts) =>
    case ts of
      [] => Unified st
    | t :: rest => andThen (requireKind (st, k, t), fn st => requireAll (st, k, rest))

  val rec unify = fn (st, a, b) =>
    case (prune (st, a), prune (st, b)) of
      (TVar v, TVar w) => if (v = w) then Unified st else bindVar (st, v, TVar w)
    | (TVar v, t) => bindVar (st, v, t)
    | (t, TVar v) => bindVar (st, v, t)
    | (TCon (n, args), TCon (m, args')) =>
        if sameName (n, m) then unifyAll (st, args, args') else Mismatch ""
    | (TArrow (a1, r1), TArrow (a2, r2)) => andThen (unify (st, a1, a2), fn st => unify (st, r1, r2))
    | (TRecord f1, TRecord f2) =>
        if SmlList.map (fn (l, _) => l) f1 = SmlList.map (fn (l, _) => l) f2
        then unifyAll (st, SmlList.map (fn (_, t) => t) f1, SmlList.map (fn (_, t) => t) f2)
        else Mismatch ""
    | (TRigid x, TRigid y) => if x = y then Unified st else Mismatch ""
    | _ => Mismatch ""

  and unifyAll = fn (st, xs, ys) =>
    case (xs, ys) of
      (x :: xs', y :: ys') => andThen (unify (st, x, y), fn st => unifyAll (st, xs', ys'))
    | _ => Unified st

  and bindVar = fn (st, v, t) =>
    case lookup (st, v) of
      Bound t' => unify (st, t', t)
    | Free (k, level) =>
        if occurs (st, v, t) then Mismatch "the type would be circular"
        else
          andThen (requireKind (st, k, t), fn st =>
            Unified (set (adjust (st, level, t), v, Bound t)))

  (* --------------------------------------------------------------------------------------- *)
  (* Schemes *)

  val instantiate = fn (st, level, (kinds, body)) =>
    let
      val (args, st') =
        SmlList.foldl (fn (k, (acc, st)) => let val (t, st') = fresh (st, k, level) in (SubsetList.append (acc, [t]), st') end)
          ([], st) kinds
    in
      (substGen (args, body), st')
    end

  (* Generalizes the variables above `level` and the given explicit type variables. *)
  val generalize = fn (st, level, rigid, t) =>
    let
      val t' = resolve (st, t)
      val vars =
        SmlList.filter (fn v => case lookup (st, v) of Free (_, l) => l > level | Bound _ => false)
          (freeVars (st, t'))
      val kinds = SmlList.map (fn v => case lookup (st, v) of Free (k, _) => k | Bound _ => KPlain) vars
      val count = SubsetList.length vars
      (* The position of x in a list, by the given equality. *)
      val indexIn = fn (same, x, xs) =>
        let
          val rec go = fn
              ([], _) => NONE
            | (y :: rest, i) => if same (x, y) then SOME i else go (rest, i + 1)
        in
          go (xs, 0)
        end
      val rec go = fn t =>
        case t of
          TVar v => (case indexIn ((fn (left : int, right : int) => left = right), v, vars) of SOME i => TGen i | NONE => t)
        | TRigid name => (case indexIn (fn (a, b) => a = b, name, rigid) of SOME i => TGen (count + i) | NONE => t)
        | TCon (n, ts) => TCon (n, SmlList.map go ts)
        | TArrow (a, b) => TArrow (go a, go b)
        | TRecord fields => TRecord (SmlList.map (fn (l, a) => (l, go a)) fields)
        | TGen _ => t
    in
      (SubsetList.append (kinds, SmlList.map (fn _ => KPlain) rigid), go t')
    end

end
