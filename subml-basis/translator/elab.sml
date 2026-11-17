(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./types.sml" import * as Types;
from "./unify.sml" import * as Unify;
from "./env.sml" import * as Env;
from "./sml_list.sml" import * as SmlList;
from "./subset_string.sml" import * as SubsetString;
from "./subset_list.sml" import * as SubsetList;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_char.sml" import * as SubsetChar;
from "./sml_list_pair.sml" import * as SmlListPair;
from "./subset_result.sml" import * as SubsetResult;
*)

(* Elaboration: the static semantics of the Core and of SubsetML's top-level structures
   (Definition §4, §5), plus the SubsetML restrictions that need types (spec §6, §7, §9).

   Errors stop elaboration: each function returns Unify.res. Declarations elaborate the right
   sides of `val` one level deeper than their context, so that the type variables left above
   the context's level at the end can be generalized (Unify). *)
structure Elab = struct
  open SubsetOptionValue

  open Syntax
  open Types
  open Unify
  open Env

  (* The context: environment, level, and the explicit type variables in scope. *)
  type context = env * int * string list

  val envOf = fn (env, _, _) => env
  val scopedOf = fn (_, _, scoped) => scoped

  (* --------------------------------------------------------------------------------------- *)
  (* Helpers *)

  val concatMap = fn (f, xs) => SmlList.concat (SmlList.map f xs)

  val member = fn (x, xs) => SmlList.exists (fn y => y = x) xs

  val memberInt = fn (x, xs) => SmlList.exists (fn y => (y = x)) xs

  val longName = fn (qs, x) => SubsetString.concatWith ((SubsetList.append (qs, [x])), ".")

  (* Folds a res-returning step over a list. *)
  val rec foldRes = fn (f, acc, xs, st) =>
    case xs of
      [] => Ok (acc, st)
    | x :: rest => bind (f (acc, x, st)) (fn acc' => fn st' => foldRes (f, acc', rest, st'))

  val mapRes = fn (f, xs, st) =>
    bind (foldRes (fn (acc, x, st) => bind (f (x, st)) (fn y => fn st => Ok (SubsetList.append (acc, [y]), st)), [], xs, st))
      (fn ys => fn st => Ok (ys, st))

  (* The first source position inside a phrase, if any. *)
  val rec patPos = fn p =>
    case p of
      PScon (q, _) => SOME q
    | PId (q, _) => SOME q
    | PPinned (q, _) => SOME q
    | PComputed (q, _) => SOME q
    | PRecord (q, _) => SOME q
    | PApp (q, _, _) => SOME q
    | PTuple ps => SmlList.foldl (fn (x, acc) => case acc of SOME _ => acc | NONE => patPos x) NONE ps
    | PList ps => SmlList.foldl (fn (x, acc) => case acc of SOME _ => acc | NONE => patPos x) NONE ps
    | PTyped (q, _) => patPos q
    | PWild => NONE

  val rec expPos = fn e =>
    let val first = fn es => SmlList.foldl (fn (x, acc) => case acc of SOME _ => acc | NONE => expPos x) NONE es in
      case e of
        EScon (q, _) => SOME q
      | EId (q, _) => SOME q
      | ERecord (q, _) => SOME q
      | ESelect (q, _) => SOME q
      | ECopy (q, _, _, _) => SOME q
      | ETuple es => first es
      | EList es => first es
      | ESeq es => first es
      | ELet (_, es) => first es
      | EApp (f, a) => first [f, a]
      | ETyped (x, _) => expPos x
      | EAndalso (a, b) => first [a, b]
      | EOrelse (a, b) => first [a, b]
      | EIf (c, a, b) => first [c, a, b]
      | ECase (x, _) => expPos x
      | EFn rules => (case rules of (p, x) :: _ => (case patPos p of SOME q => SOME q | NONE => expPos x) | [] => NONE)
    end

  val at = fn (fallback, found) =>
    case found of
      SOME q => q
    | NONE => fallback

  (* Unifies, or reports `what` with both types. *)
  val unifyAt = fn (st, pos, what, expected, found) =>
    case unify (st, expected, found) of
      Unified st' => Ok ((), st')
    | Mismatch reason =>
        (case showAll (st, [expected, found]) of
           [e, f] =>
             Err (what ^ ": expected " ^ e ^ ", found " ^ f ^ (if reason = "" then "" else " (" ^ reason ^ ")"), pos)
         | _ => Err (what, pos))

  (* --------------------------------------------------------------------------------------- *)
  (* Type expressions. `tyvar` resolves explicit type variables. *)

  val rec elabTy = fn (env, tyvar, pos, t, st) =>
    case t of
      TyVar v =>
        (case tyvar v of
           SOME t' => Ok (t', st)
         | NONE => Err ("unbound type variable " ^ v, pos))
    | TyCon (args, id) =>
        (case Env.tycon (env, id) of
           NONE => Err ("unbound type constructor " ^ longName id, pos)
         | SOME (TyStr (arity, body, _)) =>
             if (arity <> SubsetList.length args) then
               Err ("type constructor " ^ longName id ^ " takes " ^ CompilerText.natural arity ^ " argument(s), given "
                    ^ CompilerText.natural (SubsetList.length args), pos)
             else
               bind (mapRes (fn (a, st) => elabTy (env, tyvar, pos, a, st), args, st)) (fn args' => fn st =>
                 Ok (substGen (args', body), st)))
    | TyTuple ts =>
        bind (mapRes (fn (a, st) => elabTy (env, tyvar, pos, a, st), ts, st)) (fn ts' => fn st =>
          Ok (tupleTy ts', st))
    | TyArrow (a, b) =>
        bind (elabTy (env, tyvar, pos, a, st)) (fn a' => fn st =>
          bind (elabTy (env, tyvar, pos, b, st)) (fn b' => fn st => Ok (TArrow (a', b'), st)))
    | TyRecord fields =>
        bind (mapRes (fn ((l, a), st) => bind (elabTy (env, tyvar, pos, a, st)) (fn a' => fn st => Ok ((l, a'), st)),
                      fields, st)) (fn fields' => fn st =>
          Ok (TRecord (sortFields fields'), st))

  (* An explicit type variable in scope stands for itself. *)
  val scopedTy = fn ((env, _, scoped), pos, t, st) =>
    elabTy (env, fn v => if member (v, scoped) then SOME (TRigid v) else NONE, pos, t, st)

  (* --------------------------------------------------------------------------------------- *)
  (* Explicit type variables occurring unguarded in a value declaration (Definition §4.6):
     those in its annotations, not counting nested value declarations. *)

  val rec tyVarsOf = fn t =>
    case t of
      TyVar v => [v]
    | TyCon (args, _) => concatMap (tyVarsOf, args)
    | TyTuple ts => concatMap (tyVarsOf, ts)
    | TyArrow (a, b) => SubsetList.append (tyVarsOf a, tyVarsOf b)
    | TyRecord fields => concatMap (fn (_, a) => tyVarsOf a, fields)

  val rec patTyVars = fn p =>
    case p of
      PRecord (_, fields) => concatMap (fn (_, q) => patTyVars q, fields)
    | PTuple ps => concatMap (patTyVars, ps)
    | PList ps => concatMap (patTyVars, ps)
    | PApp (_, _, q) => patTyVars q
    | PTyped (q, t) => SubsetList.append (patTyVars q, tyVarsOf t)
    | _ => []

  val rec expTyVars = fn e =>
    case e of
      ERecord (_, fields) => concatMap (fn (_, x) => expTyVars x, fields)
    | ETuple es => concatMap (expTyVars, es)
    | EList es => concatMap (expTyVars, es)
    | ESeq es => concatMap (expTyVars, es)
    | ELet (_, es) => concatMap (expTyVars, es)
    | EApp (f, a) => SubsetList.append (expTyVars f, expTyVars a)
    | ETyped (x, t) => SubsetList.append (expTyVars x, tyVarsOf t)
    | EAndalso (a, b) => SubsetList.append (expTyVars a, expTyVars b)
    | EOrelse (a, b) => SubsetList.append (expTyVars a, expTyVars b)
    | EIf (c, a, b) => SubsetList.concat [expTyVars c, expTyVars a, expTyVars b]
    | ECase (x, rules) => SubsetList.append (expTyVars x, concatMap (fn (p, y) => SubsetList.append (patTyVars p, expTyVars y), rules))
    | EFn rules => concatMap (fn (p, y) => SubsetList.append (patTyVars p, expTyVars y), rules)
    | ECopy (_, source, _, _) => expTyVars source
    | _ => []

  val distinct = fn xs => SmlList.foldl (fn (x, acc) => if member (x, acc) then acc else SubsetList.append (acc, [x])) [] xs

  (* --------------------------------------------------------------------------------------- *)
  (* SubsetML restrictions *)

  (* Spec B1: the full Basis binds these as constructors; SubsetML leaves them out, so binding
     them as variables would give a program SML reads differently. *)
  val omittedConstructors =
    ["ref", "Match", "Bind", "Chr", "Div", "Domain", "Empty", "Fail", "Option", "Overflow", "Size",
     "Span", "Subscript", "Io"]

  (* The Definition (§2.9) forbids binding these. *)
  val unbindable = ["true", "false", "nil", "::", "ref"]

  (* Spec R3: a record's labels must be those of a record type declaration in scope. *)
  val checkRecordLabels = fn (env, pos, labels, st) =>
    let val sorted = SmlList.map (fn (l, _) => l) (sortFields (SmlList.map (fn l => (l, ())) labels)) in
      if SmlList.exists (fn set => set = sorted) (recordLabelSets env) then Ok ((), st)
      else
        Err ("no record type with the labels {" ^ SubsetString.concatWith (sorted, ", ")
             ^ "} is in scope; SubsetML records must have a declared type (spec R3)", pos)
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Patterns: their type and the variables they bind. *)

  val constTy = fn
      SInt _ => intTy
    | SWord _ => intTy
    | SReal _ => realTy
    | SString _ => stringTy
    | SChar _ => charTy

  (* Appendix E: an integer constant is int or Int64.int by context and defaults to int; beyond
     the int range only Int64.int remains. A word constant is one of the word types; SubsetML
     has no `word` type to default to, so context must decide it. *)
  val checkConst = fn (pos, c, level, st) =>
    case c of
      SInt text =>
        if CompilerText.int32Literal text then Ok (fresh (st, KClass [intName, int64Name], level))
        else (if CompilerText.int64Literal text then Ok (fresh (st, KClass [int64Name], level))
        else Err ("integer constant outside signed 64-bit range: " ^ text, pos))
    | SWord _ => let val (t, st') = fresh (st, KClass wordNames, level) in Ok (t, st') end
    | SReal _ => let val (t, st') = fresh (st, KClass [realName, real32Name], level) in Ok (t, st') end
    | _ => Ok (constTy c, st)

  val mergeVars = fn (pos, a, b, st) =>
    case SmlList.find (fn (x, _) => SmlList.exists (fn (y, _) => x = y) a) b of
      SOME entry => let val (x, _) = entry in Err ("variable " ^ x ^ " is bound twice in a pattern", pos) end
    | NONE => Ok (SubsetList.append (a, b), st)

  (* A constant in an expression or pattern. Read from Workman, an in-range integer literal takes
     any numeric type by context and a larger one any but int, and a decimal literal real or
     Real32.real; the site is recorded, since Workman's own default decides it. *)
  val literalConst = fn (q, c, level, inPattern, st) =>
    case (c, st) of
      (SInt text, State (_, _, _, _, SOME _)) =>
        let
          (* A real constant is no pattern (SML's real does not admit equality). *)
          val numeric = SubsetList.append ((if inPattern then [intName, int64Name] else [intName, int64Name, realName, real32Name]), wordNames)
          val (t, st') = if CompilerText.int32Literal text
            then fresh (st, KClass numeric, level)
            else fresh (st, KClass (SmlList.filter (fn n => SubsetBool.not (sameName (n, intName))) numeric), level)
          val State (vs, nx, sels, recs, sites) = st'
        in Ok (t, State (vs, nx, sels, recs,
            SOME (Literal (q, t) :: (case sites of SOME xs => xs | NONE => [])))) end
    | (SReal _, State (_, _, _, _, SOME _)) =>
        let
          val (t, st') = fresh (st, KClass [realName, real32Name], level)
          val State (vs, nx, sels, recs, sites) = st'
        in Ok (t, State (vs, nx, sels, recs,
            SOME (Literal (q, t) :: (case sites of SOME xs => xs | NONE => [])))) end
    | _ => checkConst (q, c, level, st)

  val constructorScheme = fn entry =>
    case entry of NONE => NONE | SOME value =>
      let val (scheme, status) = value in
        case status of SCon => SOME scheme | SValue => NONE
      end

  val rec pat = fn (ctx, p, st) =>
    let val (env, level, _) = ctx in
      case p of
        PWild => let val (t, st') = fresh (st, KPlain, level) in Ok ((t, []), st') end
      | PScon (q, c) => bind (literalConst (q, c, level, true, st)) (fn t => fn st => Ok ((t, []), st))
      | PPinned (q, _) => Err ("internal pinned pattern was not lowered", q)
      | PComputed (q, _) => Err ("internal computed pattern was not lowered", q)
      | PId (q, id) =>
          (case (constructorScheme (Env.value (env, id)), id) of
             (SOME scheme, _) =>
               let val (t, st') = instantiate (st, level, scheme) in
                 case prune (st', t) of
                   TArrow (_, _) => Err ("constructor " ^ longName id ^ " needs an argument", q)
                 | _ => Ok ((t, []), st')
               end
           | (_, ([], x)) =>
               if member (x, omittedConstructors) then
                 Err ("`" ^ x ^ "` is a constructor in the SML Basis, which SubsetML omits; it cannot be "
                      ^ "bound as a variable (spec B1)", q)
               else let val (t, st') = fresh (st, KPlain, level) in Ok ((t, [(x, t)]), st') end
           | _ => Err ("unbound constructor " ^ longName id, q))
      | PRecord (q, fields) =>
          bind (checkRecordLabels (env, q, SmlList.map (fn (l, _) => l) fields, st)) (fn _ => fn st =>
            bind (foldRes (fn ((fs, vars), (l, f), st) =>
                             bind (pat (ctx, f, st)) (fn (t, vs) => fn st =>
                               bind (mergeVars (q, vars, vs, st)) (fn vars' => fn st => Ok ((SubsetList.append (fs, [(l, t)]), vars'), st))),
                           ([], []), fields, st)) (fn (fs, vars) => fn st =>
              Ok ((TRecord (sortFields fs), vars), st)))
      | PTuple ps =>
          bind (pats (ctx, at (0, patPos p), ps, st)) (fn (ts, vars) => fn st =>
            Ok ((if SmlList.null ts then unitTy else tupleTy ts, vars), st))
      | PList ps =>
          let val (elem, st0) = fresh (st, KPlain, level) in
            bind (pats (ctx, at (0, patPos p), ps, st0)) (fn (ts, vars) => fn st =>
              bind (foldRes (fn (_, (t, x), st) => unifyAt (st, at (0, patPos x), "list pattern element", elem, t),
                             (), SmlListPair.zip (ts, ps), st)) (fn _ => fn st =>
                Ok ((listTy elem, vars), st)))
          end
      | PApp (q, id, arg) =>
          (case constructorScheme (Env.value (env, id)) of
             SOME scheme =>
               let val (t, st') = instantiate (st, level, scheme) in
                 case prune (st', t) of
                   TArrow (dom, cod) =>
                     bind (pat (ctx, arg, st')) (fn (ta, vars) => fn st =>
                       bind (unifyAt (st, at (q, patPos arg), "argument of constructor " ^ longName id, dom, ta))
                         (fn _ => fn st => Ok ((cod, vars), st)))
                 | _ => Err ("constructor " ^ longName id ^ " takes no argument", q)
               end
           | _ => Err ("`" ^ longName id ^ "` is not a constructor", q))
      | PTyped (PRecord (q, fields), t) =>
          (* Reading Workman, a record pattern annotated with a record type may name only some
             of its fields; the others match anything. SubsetML writes every label (R3). *)
          bind (scopedTy (ctx, at (0, SOME q), t, st)) (fn annotated => fn st =>
            let
              val named = SmlList.map (fn (l, _) => l) fields
              val missing = case (st, resolve (st, annotated)) of
                  (State (_, _, _, _, SOME _), TRecord declared) =>
                    let val labels = SmlList.map (fn (l, _) => l) declared in
                      if SmlList.all (fn l => SmlList.exists (fn m => m = l) labels) named
                      then SmlList.filter (fn l => SubsetBool.not (SmlList.exists (fn m => m = l) named)) labels
                      else []
                    end
                | _ => []
            in
              case missing of
                [] => typedPat (ctx, PRecord (q, fields), t, st)
              | _ =>
                  let
                    val st = case st of
                        State (vs, nx, sels, rs, SOME xs) =>
                          State (vs, nx, sels, rs, SOME (PatternRecord (q, missing) :: xs))
                      | _ => st
                  in typedPat (ctx, PRecord (q, SubsetList.append (fields, SmlList.map (fn l => (l, PWild)) missing)), t, st) end
            end)
      | PTyped (inner, t) => typedPat (ctx, inner, t, st)
    end

  and typedPat = fn (ctx, inner, t, st) =>
    let val (env, level, _) = ctx in
          bind (pat (ctx, inner, st)) (fn (ti, vars) => fn st =>
            bind (scopedTy (ctx, at (0, patPos inner), t, st)) (fn t' => fn st =>
              bind (unifyAt (st, at (0, patPos inner), "type annotation", t', ti)) (fn _ => fn st =>
                Ok ((t', vars), st))))
    end

  and pats = fn (ctx, pos, ps, st) =>
    foldRes (fn ((ts, vars), p, st) =>
               bind (pat (ctx, p, st)) (fn (t, vs) => fn st =>
                 bind (mergeVars (at (pos, patPos p), vars, vs, st)) (fn vars' => fn st =>
                   Ok ((SubsetList.append (ts, [t]), vars'), st))),
             ([], []), ps, st)

  (* --------------------------------------------------------------------------------------- *)
  (* Non-expansive expressions (Definition §4.7), which may be generalized. *)

  val rec nonExpansive = fn (env, e) =>
    case e of
      EScon (_, _) => true
    | EId (_, _) => true
    | EFn _ => true
    | ESelect (_, _) => true
    | ERecord (_, fields) => SmlList.all (fn (_, x) => nonExpansive (env, x)) fields
    | ETuple es => SmlList.all (fn x => nonExpansive (env, x)) es
    | EList es => SmlList.all (fn x => nonExpansive (env, x)) es
    | ETyped (x, _) => nonExpansive (env, x)
    | EApp (EId (_, id), arg) =>
        (case constructorScheme (Env.value (env, id)) of
           SOME _ => nonExpansive (env, arg)
         | _ => false)
    | _ => false

  (* --------------------------------------------------------------------------------------- *)
  (* Expressions *)

  val rec exp = fn (ctx, e, st) =>
    let val (env, level, _) = ctx in
      case e of
        EScon (q, c) => literalConst (q, c, level, false, st)
      (* A backtick string's `${ e }`, read from Workman: the value's text, resolved by type during
         translation (Translate.templateText). *)
      | EId (q, ([], "`show")) =>
          let
            (* With the SubsetML Basis a value shows as `print` shows it; without, SML has text only
               for the primitive types. *)
            val kind = case Env.structureAt (env, ["SubsetList"]) of
                SOME _ => KPlain
              | NONE => KClass [stringName, charName, intName, int64Name, realName, boolName]
            val (a, st') = fresh (st, kind, level)
            val t = TArrow (a, stringTy)
            val State (vs, nx, sels, recs, sites) = st'
          in
            case sites of
              SOME xs => Ok (t, State (vs, nx, sels, recs, SOME (Operand (q, t) :: xs)))
            (* The target check: a marker translation left has a type with no display. *)
            | NONE => Err ("the type of a value in a backtick string's ${ } or `Text.of` is undecided in part, or has no "
                           ^ "portable display; annotate it, or show text, numbers, booleans, characters, void, "
                           ^ "tuples, lists, records, Option, Result or datatypes", q)
          end
      (* Workman's `print`, read from Workman: any value, shown by type during translation
         (Translate.printing). A marker left in place has a type with no portable display. *)
      (* Workman's `!`, read from Workman: SubsetBool.not, or SML's `not` without the Basis
         (Translate.portableSpellings). *)
      | EId (q, ([], "`not")) => Ok (TArrow (boolTy, boolTy), st)
      (* Without the SubsetML Basis there is no portable display: `print` is SML's, on text. *)
      | EId (q, ([], "`print")) =>
          (case Env.structureAt (env, ["SubsetIo"]) of
             NONE => Ok (TArrow (stringTy, unitTy), st)
           | SOME _ =>
          let
            val (a, st') = fresh (st, KPlain, level)
            val t = TArrow (a, unitTy)
            val State (vs, nx, sels, recs, sites) = st'
          in
            case sites of
              SOME xs => Ok (t, State (vs, nx, sels, recs, SOME (Operand (q, t) :: xs)))
            | NONE => Err ("print: this value's type is undecided in part, or has no portable display; "
                           ^ "annotate it, or print text, numbers, booleans, characters, void, tuples, "
                           ^ "lists, records, Option, Result or datatypes", q)
          end)
      (* Workman's `%`, read from Workman: remainder truncated toward zero on an int, Int64 or
         real, resolved by type during translation (Translate.remainders). *)
      | EId (q, ([], "`rem")) =>
          let
            val (a, st') = fresh (st, KClass [intName, int64Name, realName], level)
            val t = TArrow (tupleTy [a, a], a)
            val State (vs, nx, sels, recs, sites) = st'
          in
            case sites of
              SOME xs => Ok (t, State (vs, nx, sels, recs, SOME (Operand (q, t) :: xs)))
            | NONE => Err ("Workman's `%` has no SML counterpart outside translation from Workman", q)
          end
      (* A record update read from Workman, `.{ ..source, x = e }`: the identity on the
         source's record type, expanded by Translate.recordUpdates once that type is known. *)
      | EId (q, ([], "`update")) =>
          let
            val (a, st') = fresh (st, KPlain, level)
            val t = TArrow (a, a)
            val State (vs, nx, sels, recs, sites) = st'
          in
            case sites of
              SOME xs => Ok (t, State (vs, nx, sels, recs, SOME (Operand (q, t) :: xs)))
            | NONE => Err ("a record update has no SML counterpart outside translation from Workman", q)
          end
      | EId (q, id) =>
          (case Env.value (env, id) of
             SOME entry =>
               let
                 val (scheme, _) = entry
                 val (kinds, _) = scheme
                 val (t, st') = instantiate (st, level, scheme)
                 val numeric = SmlList.exists (fn k => case k of KClass _ => true | _ => false) kinds
                 val primitive = numeric orelse id = ([], "div") orelse id = ([], "mod")
                 val integerLibrary = case id of (["Int"], _) =>
                   (case Env.structureAt (env, ["Int"]) of SOME (_, isBasis) => isBasis | NONE => false)
                   | _ => false
                 val State (vs, nx, sels, recs, sites) = st'
                 val st'' = if primitive orelse integerLibrary then
                   (case sites of SOME xs => State (vs, nx, sels, recs, SOME (Operand (q, t) :: xs)) | NONE => st')
                   else st'
               in Ok (t, st'') end
           | NONE => Err ("unbound identifier " ^ longName id, q))
      | ECopy (_, source, _, _) => exp (ctx, source, st)
      | ERecord (q, fields) =>
          bind (checkRecordLabels (env, q, SmlList.map (fn (l, _) => l) fields, st)) (fn _ => fn st =>
            bind (mapRes (fn ((l, x), st) => bind (exp (ctx, x, st)) (fn t => fn st => Ok ((l, t), st)), fields, st))
              (fn fs => fn st =>
                let
                  val t = TRecord (sortFields fs)
                  val State (_, _, _, rs, sites) = st
                  val labels = SmlList.map (fn (l, _) => l) fields
                  val same = fn declared =>
                    SubsetList.length declared = SubsetList.length labels andalso
                    SmlList.all (fn l => SmlList.exists (fn m => m = l) declared) labels
                  (* Reading Workman, a record literal is the one declared record type with
                     exactly its fields, as Workman infers `.{ x = 1, y = 2 }`; its fields take
                     that type's field types, so `1` is a real where the field is Real64. *)
                  val matches = case sites of
                      NONE => []
                    | SOME _ => SmlList.filter (fn (declared, _, _) => same declared) rs
                in
                  case matches of
                    [(_, arity, body)] =>
                      let
                        val rec fresh' = fn (n, acc, st) =>
                          if n = 0 then (SmlList.rev acc, st)
                          else let val (a, st) = fresh (st, KPlain, level) in fresh' (n - 1, a :: acc, st) end
                        val (args, st) = fresh' (arity, [], st)
                      in bind (unifyAt (st, q, "record of type with fields {" ^ SubsetString.concatWith (labels, ", ") ^ "}", t, substGen (args, body)))
                           (fn _ => fn st => Ok (t, st)) end
                  | _ => Ok (t, st)
                end))
      | ESelect (q, l) =>
          let
            val (r, st1) = fresh (st, KPlain, level)
            val (f, st2) = fresh (st1, KPlain, level)
            val State (vars, next, sels, recs, eqs) = st2
          in
            Ok (TArrow (r, f), State (vars, next, (q, level, r, l, f) :: sels, recs, eqs))
          end
      | ETuple [] => Ok (unitTy, st)
      | ETuple es => bind (mapRes (fn (x, st) => exp (ctx, x, st), es, st)) (fn ts => fn st => Ok (tupleTy ts, st))
      | EList es =>
          let val (elem, st0) = fresh (st, KPlain, level) in
            bind (foldRes (fn (_, x, st) =>
                             bind (exp (ctx, x, st)) (fn t => fn st =>
                               unifyAt (st, at (0, expPos x), "list element", elem, t)), (), es, st0))
              (fn _ => fn st => Ok (listTy elem, st))
          end
      | ESeq es =>
          bind (foldRes (fn (_, x, st) => exp (ctx, x, st), unitTy, es, st)) (fn t => fn st => Ok (t, st))
      | ELet (ds, es) =>
          let val State (_, start, _, _, _) = st in
            bind (decs (ctx, ds, st)) (fn delta => fn st =>
              bind (foldRes (fn (_, x, st) => exp ((plus (env, delta), level, scopedOf ctx), x, st), unitTy, es, st))
                (fn t => fn st =>
                  if SmlList.exists (fn s => s >= start) (tynames (resolve (st, t))) then
                    Err ("the type of this `let` mentions a type declared inside it", at (0, expPos e))
                  else Ok (t, st)))
          end
      | EApp (EId (q, ([], opr)), a) =>
          (case (opr = "=" orelse opr = "<>", st) of
             (true, State (_, _, _, _, SOME _)) =>
               bind (exp (ctx, a, st)) (fn ta => fn st =>
                 let val (operand, st1) = fresh (st, KPlain, level) in
                   bind (unifyAt (st1, q, "operands of " ^ opr, tupleTy [operand, operand], ta)) (fn _ => fn st =>
                     let val State (vars, next, sels, recs, sites) = st in
                       Ok (boolTy, State (vars, next, sels, recs,
                                          SOME (Operand (q, operand) :: (case sites of SOME l => l | NONE => []))))
                     end)
                 end)
           | _ => application (ctx, EId (q, ([], opr)), a, st))
      | EApp (f, a) => application (ctx, f, a, st)
      | ETyped (x, t) =>
          bind (exp (ctx, x, st)) (fn tx => fn st =>
            bind (scopedTy (ctx, at (0, expPos x), t, st)) (fn t' => fn st =>
              bind (unifyAt (st, at (0, expPos x), "type annotation", t', tx)) (fn _ => fn st => Ok (t', st))))
      | EAndalso (a, b) => boolOp (ctx, "andalso", a, b, st)
      | EOrelse (a, b) => boolOp (ctx, "orelse", a, b, st)
      | EIf (c, a, b) =>
          bind (exp (ctx, c, st)) (fn tc => fn st =>
            bind (unifyAt (st, at (0, expPos c), "condition of `if`", boolTy, tc)) (fn _ => fn st =>
              bind (exp (ctx, a, st)) (fn ta => fn st =>
                bind (exp (ctx, b, st)) (fn tb => fn st =>
                  bind (unifyAt (st, at (0, expPos b), "branches of `if` differ", ta, tb)) (fn _ => fn st =>
                    Ok (ta, st))))))
      | ECase (x, rules) =>
          bind (exp (ctx, x, st)) (fn tx => fn st =>
            bind (matchRules (ctx, rules, st)) (fn (tp, tr) => fn st =>
              bind (unifyAt (st, at (0, expPos x), "`case` patterns do not fit the value", tp, tx)) (fn _ => fn st =>
                Ok (tr, st))))
      | EFn rules => bind (matchRules (ctx, rules, st)) (fn (tp, tr) => fn st => Ok (TArrow (tp, tr), st))
    end

  and application = fn (ctx, f, a, st) =>
    let val (_, level, _) = ctx in
      bind (exp (ctx, f, st)) (fn tf => fn st =>
        bind (exp (ctx, a, st)) (fn ta => fn st =>
          let
            val what =
              case f of
                EId (_, ([], "`show")) => "value in a backtick string's ${ }"
              | EId (_, id) => "argument of " ^ longName id
              | _ => "function argument"
            val pos = at (0, case expPos a of SOME q => SOME q | NONE => expPos f)
          in
            case prune (st, tf) of
              TArrow (dom, cod) => bind (unifyAt (st, pos, what, dom, ta)) (fn _ => fn st => Ok (cod, st))
            | _ =>
                let val (r, st') = fresh (st, KPlain, level) in
                  bind (unifyAt (st', at (pos, expPos f), "applied expression", TArrow (ta, r), tf))
                    (fn _ => fn st => Ok (r, st))
                end
          end))
    end

  and boolOp = fn (ctx, name, a, b, st) =>
    bind (exp (ctx, a, st)) (fn ta => fn st =>
      bind (unifyAt (st, at (0, expPos a), "operand of " ^ name, boolTy, ta)) (fn _ => fn st =>
        bind (exp (ctx, b, st)) (fn tb => fn st =>
          bind (unifyAt (st, at (0, expPos b), "operand of " ^ name, boolTy, tb)) (fn _ => fn st =>
            Ok (boolTy, st)))))

  (* A match: the type of its patterns and of its results. *)
  and matchRules = fn (ctx, rules, st) =>
    let
      val (env, level, scoped) = ctx
      val (tp, st1) = fresh (st, KPlain, level)
      val (tr, st2) = fresh (st1, KPlain, level)
    in
      bind (foldRes (fn (_, (p, x), st) =>
                       bind (pat (ctx, p, st)) (fn (t, vars) => fn st =>
                         bind (unifyAt (st, at (0, patPos p), "patterns of a match differ", tp, t)) (fn _ => fn st =>
                           bind (exp ((plus (env, withValues (SmlList.map (fn (v, vt) => (v, (([], vt), SValue))) vars)),
                                       level, scoped), x, st)) (fn tx => fn st =>
                             unifyAt (st, at (0, expPos x), "results of a match differ", tr, tx)))),
                     (), rules, st2))
        (fn _ => fn st => Ok ((tp, tr), st))
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Declarations: each returns the environment it declares. *)

  and decs = fn (ctx, ds, st) =>
    let val (env, level, scoped) = ctx in
      foldRes (fn (delta, d, st) =>
                 bind (dec ((plus (env, delta), level, scoped), d, st)) (fn more => fn st => Ok (plus (delta, more), st)),
               empty, ds, st)
    end

  and dec = fn (ctx, d, st) =>
    case d of
      DVal (pos, tyvars, plain, recs) => valDec (ctx, pos, tyvars, plain, recs, st)
    | DType (pos, binds) => typeDec (ctx, pos, binds, st)
    | DDatatype (pos, binds) => datatypeDec (ctx, pos, binds, st)
    | DOpen (pos, paths) =>
        foldRes (fn (delta, path, st) =>
                   case structureAt (envOf ctx, path) of
                     SOME entry =>
                       let val (found, isBasis) = entry in
                         if isBasis then Err ("SubsetML can only open structures the program declares, not Basis structure "
                            ^ SubsetString.concatWith (path, ".") ^ " (spec F2)", pos)
                         else Ok (plus (delta, found), st)
                       end
                   | NONE => Err ("unbound structure " ^ SubsetString.concatWith (path, "."), pos),
                 empty, paths, st)
    (* Definition §4.10 rule 23: dec2 sees dec1, and only dec2's bindings are declared.
       Restriction (spec §7, L1): a type dec1 declares may not occur in what dec2 makes visible,
       since Workman's `private` hides it from importers. *)
    | DLocal (pos, hidden, body) =>
        let val (env, level, scoped) = ctx
            val priorState = st in
          bind (decs (ctx, hidden, st)) (fn private => fn st =>
            bind (decs ((plus (env, private), level, scoped), body, st)) (fn visible => fn st =>
              case localLeak (private, visible, priorState, st) of
                NONE => Ok (visible, st)
              | SOME (binding, tyName) =>
                  Err (binding ^ " mentions type " ^ tyName ^ ", which this `local` declares privately; "
                       ^ "declare the type outside the `local` (spec L1)", pos)))
        end

  (* The first binding of `visible` whose type mentions a datatype or record type declared in
     `private`, with that type's name. A record type is a label set, as Workman's nominal
     records are named by their declaration. An open only aliases existing types: stamps and
     record label sets present before the hidden declarations cannot be private declarations. *)
  and localLeak = fn (private, visible, priorState, st) =>
    let
      val State (_, first, _, existingRecords, _) = priorState
      val Env (_, hiddenTypes, _) = private
      val Env (_, visibleTypes, visibleValues) = visible
      val sameLabels = fn (a, b) =>
        SubsetList.length a = SubsetList.length b andalso SmlList.all (fn l => SmlList.exists (fn m => m = l) b) a
      val datatypes = SmlList.mapPartial (fn (n, TyStr (_, t, cons)) =>
        case (t, cons) of (TCon (name, _), _ :: _) =>
          if stampOf name >= first then SOME (n, name) else NONE
        | _ => NONE) hiddenTypes
      val labelsOf = fn fields => SmlList.map (fn (l, _) => l) fields
      val records = SmlList.mapPartial (fn (n, TyStr (_, t, _)) =>
        case t of
          TRecord fields => (case tupleComponents fields of NONE =>
            if SmlList.exists (fn (labels, _, _) => sameLabels (labels, labelsOf fields)) existingRecords
            then NONE else SOME (n, labelsOf fields)
          | SOME _ => NONE)
        | _ => NONE) hiddenTypes
      val rec mentions = fn t =>
        case prune (st, t) of
          TCon (name, args) =>
            (case SmlList.find (fn (_, hiddenName) => sameName (name, hiddenName)) datatypes of
               SOME found => let val (n, _) = found in SOME n end
             | NONE => first args)
        | TArrow (a, b) => first [a, b]
        | TRecord fields =>
            (case (tupleComponents fields, SmlList.find (fn (_, labels) => sameLabels (labels, labelsOf fields)) records) of
               (NONE, SOME found) => let val (n, _) = found in SOME n end
             | _ => first (SmlList.map (fn (_, x) => x) fields))
        | _ => NONE
      and first = fn ts => case ts of [] => NONE | t :: rest => (case mentions t of SOME n => SOME n | NONE => first rest)
      val rec scan = fn entries => case entries of
          [] => NONE
        | (name, t) :: rest => (case mentions t of SOME n => SOME (name, n) | NONE => scan rest)
      (* A visible type alias of a hidden type leaks it too. A datatype the visible part
         declares again has a fresh name, so it never matches. *)
      val typeEntries = SmlList.map (fn (n, TyStr (_, t, _)) => ("type " ^ n, t)) visibleTypes
      val valueEntries = SmlList.map (fn (name, ((_, t), _)) => ("`" ^ name ^ "`", t)) visibleValues
    in
      scan (SubsetList.append (valueEntries, typeEntries))
    end

  (* `val`: Definition §4.10 rules 15-16 and the closure of §4.8. *)
  and valDec = fn ((env, level, scoped), pos, tyvars, plain, recs, st) =>
    let
      val bindings = SubsetList.append (plain, recs)
      val implicit =
        SmlList.filter (fn v => SubsetBool.not (member (v, scoped)))
          (distinct (concatMap (fn (p, e) => SubsetList.append (patTyVars p, expTyVars e), bindings)))
      val explicit = distinct (SubsetList.append (tyvars, implicit))
      val inner = (env, level + 1, SubsetList.append (scoped, explicit))
      (* A binding's pattern, its type and variables, checked against its expression's type. *)
      val plainBinding = fn ((p, e), st) =>
        bind (exp (inner, e, st)) (fn te => fn st =>
          bind (pat (inner, p, st)) (fn (tp, vars) => fn st =>
            bind (unifyAt (st, at (pos, patPos p), "value binding", tp, te)) (fn _ => fn st =>
              Ok ((vars, nonExpansive (env, e)), st))))
      (* SubsetML only allows a variable (SML would also let `val rec` rebind a constructor). *)
      val recPattern = fn ((p, _), st) =>
        let val single = fn (_, vars) => fn st =>
          case vars of
            [_] => Ok (vars, st)
          | _ => Err ("a `val rec` binding must bind a variable, not a constructor", at (pos, patPos p))
        in
          case p of
            PId (_, ([], _)) => bind (pat (inner, p, st)) single
          | PTyped (PId (_, ([], _)), _) => bind (pat (inner, p, st)) single
          | _ => Err ("a `val rec` binding must bind a single variable", at (pos, patPos p))
        end
    in
      if SmlList.exists (fn v => member (v, scoped)) tyvars then
        Err ("a type variable is already scoped by an enclosing `val`", pos)
      else
        bind (mapRes (plainBinding, plain, st)) (fn plainResults => fn st =>
          bind (mapRes (recPattern, recs, st)) (fn recVars => fn st =>
            let
              val recEnv = withValues (SmlList.map (fn (v, t) => (v, (([], t), SValue))) (SmlList.concat recVars))
              val recInner = (plus (env, recEnv), level + 1, SubsetList.append (scoped, explicit))
            in
              bind (foldRes (fn (_, ((_, e), vars), st) =>
                               case vars of
                                 [(_, t)] =>
                                   bind (exp (recInner, e, st)) (fn te => fn st =>
                                     unifyAt (st, at (pos, expPos e), "recursive binding", t, te))
                               | _ => Ok ((), st),
                             (), SmlListPair.zip (recs, recVars), st)) (fn _ => fn st =>
                let
                  val results = SubsetList.append (plainResults, SmlList.map (fn vars => (vars, true)) recVars)
                in
                  closeValBindings (level, explicit, pos, results, st)
                end)
            end))
    end

  (* Closes a `val`'s bindings: each variable's scheme, given whether its expression may be
     generalized. *)
  and closeValBindings = fn (level, explicit, pos, results, st) =>
    let val names = concatMap (fn (vars, _) => SmlList.map (fn (x, _) => x) vars, results) in
      case (SmlList.find (fn x => SubsetList.length (SmlList.filter (fn y => y = x) names) > 1) names,
            SmlList.find (fn x => member (x, unbindable)) names) of
        (SOME x, _) => Err ("`" ^ x ^ "` is bound twice in this declaration", pos)
      | (_, SOME x) => Err ("`" ^ x ^ "` cannot be rebound", pos)
      | (NONE, NONE) =>
          bind (closeDeclaration (level, st)) (fn _ => fn st =>
            bind (foldRes (fn (acc, (vars, generalizable), st) =>
                             foldRes (fn (acc, (x, t), st) =>
                                        bind (closeBinding (level, explicit, generalizable, pos, x, t, st))
                                          (fn entry => fn st => Ok (SubsetList.append (acc, [entry]), st)),
                                      acc, vars, st),
                           [], results, st))
              (fn entries => fn st => Ok (withValues (SmlList.map (fn (x, s) => (x, (s, SValue))) entries), st)))
    end

  (* Settles what the declaration's context must settle (spec §10): pending `# lab`
     selections, and overloaded type variables, which default to int (Appendix E). *)
  and closeDeclaration = fn (level, st) =>
    bind (settleSelections (level, st)) (fn _ => fn st => Ok ((), st))

  and settleSelections = fn (level, st) =>
    let
      val State (vars, next, sels, recs, eqs) = st
      (* One pass: resolves each selection whose record type is known. *)
      val step = fn ((pending, progress), sel, st) =>
        let val (q, l, r, lab, f) = sel in
          case prune (st, r) of
            TRecord fields =>
              (case SmlList.find (fn (l', _) => l' = lab) fields of
                 SOME entry => let val (_, ft) = entry in bind (unifyAt (st, q, "field " ^ lab, ft, f)) (fn _ => fn st => Ok ((pending, true), st)) end
               | NONE => Err ("the record has no field " ^ lab ^ ": " ^ show (st, r), q))
          | TVar v =>
              (* A field belongs to its receiver's type, even while the flexible row is
                 pending. Preserve that context dependency before closing inner vals. *)
              let val receiverLevel = case lookup (st, v) of Free (_, level) => level | Bound _ => l
                  val escaped = SmlList.exists (fn w => case lookup (st, w) of
                    Free (_, fieldLevel) => fieldLevel > receiverLevel | Bound _ => false) (freeVars (st, f))
              in Ok ((SubsetList.append (pending, [sel]), progress orelse escaped), adjust (st, receiverLevel, f)) end
          | _ => Err ("`#" ^ lab ^ "` is applied to a non-record: " ^ show (st, r), q)
        end
      val rec loop = fn st =>
        let val State (vs, nx, sels, rs, eq) = st in
          bind (foldRes (step, ([], false), sels, State (vs, nx, [], rs, eq))) (fn (pending, progress) => fn st =>
            let val State (vs', nx', _, rs', eq') = st in
              if progress then loop (State (vs', nx', pending, rs', eq')) else Ok (pending, State (vs', nx', pending, rs', eq'))
            end)
        end
      (* Reading Workman, a field names its record type when one declared record type has it,
         as Workman resolves `user.score`; SML would need the receiver annotated. One pass
         resolves the first such selection, then the loop settles what follows from it. *)
      val byLabel = fn st =>
        let val State (_, _, pending, rs, sites) = st in
          case sites of
            NONE => NONE
          | SOME _ =>
              (* Only where SML would give up: a receiver this declaration must decide. *)
              SmlList.find (fn (_, _, r, lab, _) => case prune (st, r) of
                  TVar v => (case lookup (st, v) of Free (_, l) => l > level | Bound _ => false) andalso
                    SubsetList.length (SmlList.filter (fn (labels, _, _) =>
                      SmlList.exists (fn m => m = lab) labels) rs) = 1
                | _ => false) pending
        end
      val rec settle = fn st =>
        bind (loop st) (fn pending => fn st =>
          case byLabel st of
            NONE => Ok (pending, st)
          | SOME sel =>
              let
                val (q, l, r, lab, _) = sel
                val State (_, _, _, rs, _) = st
                val SOME declared = SmlList.find (fn (labels, _, _) => SmlList.exists (fn m => m = lab) labels) rs
                val (labels, arity, body) = declared
                val rec fresh' = fn (n, acc, st) =>
                  if n = 0 then (SmlList.rev acc, st)
                  else let val (t, st) = fresh (st, KPlain, l) in fresh' (n - 1, t :: acc, st) end
                val (args, st) = fresh' (arity, [], st)
                (* Translation writes the selection as a complete record pattern. *)
                val st = case st of
                    State (vs, nx, sels, rs, SOME xs) => State (vs, nx, sels, rs, SOME (FieldRecord (q, labels) :: xs))
                  | _ => st
              in
                bind (unifyAt (st, q, "record of field " ^ lab, r, substGen (args, body))) (fn _ => fn st => settle st)
              end)
    in
      bind (settle (State (vars, next, sels, recs, eqs))) (fn pending => fn st =>
        case SmlList.find (fn (_, _, r, _, _) =>
                          case prune (st, r) of
                            TVar v => (case lookup (st, v) of Free (_, l) => l > level | Bound _ => false)
                          | _ => false) pending of
          SOME sel => let val (q, _, _, lab, _) = sel in Err ("cannot determine the record type for `#" ^ lab ^ "`; add a type annotation", q) end
        | NONE => Ok ((), st))
    end

  (* The scheme of one bound variable. *)
  and closeBinding = fn (level, explicit, generalizable, pos, x, t, st) =>
    let
      (* Appendix E: default unresolved numeric classes at declaration closure. The surrounding
         text that may resolve them is "no larger than the smallest enclosing structure-level
         declaration"; SubsetML takes the smallest enclosing `val` (spec §10). Reading Workman,
         it takes the structure-level declaration, as Workman does, so a local `let r = 235;`
         used as a real is a real: a local binding leaves its classes open, monomorphic, and
         the structure-level binding defaults every literal and operand still undecided. *)
      val undecided = fn v => case lookup (st, v) of Free (KClass _, l) => l > level | _ => false
      val sites = case st of State (_, _, _, _, SOME xs) => SOME xs | _ => NONE
      val siteVars = fn xs => SmlList.foldl (fn (site, acc) =>
        case site of
          Literal (_, ty) => (case prune (st, ty) of TVar v => if undecided v andalso SubsetBool.not (member (v, acc)) then v :: acc else acc | _ => acc)
        | Operand (_, ty) => (case prune (st, ty) of TVar v => if undecided v andalso SubsetBool.not (member (v, acc)) then v :: acc else acc | _ => acc)
        | _ => acc) [] xs
      val own = SmlList.filter undecided (freeVars (st, t))
      val (defaults, st) = case sites of
          NONE => (own, st)
        | SOME xs =>
            if level > 0 then
              ([], SmlList.foldl (fn (v, st) => case lookup (st, v) of
                  Free (k, _) => set (st, v, Free (k, level)) | _ => st) st own)
            else (SubsetList.append (own, SmlList.filter (fn v => SubsetBool.not (member (v, own))) (siteVars xs)), st)
      val rec settle = fn (vars, st) => case vars of
        [] => Ok ((), st)
      | v :: rest =>
          let val names = case lookup (st, v) of Free (KClass ns, _) => ns | _ => [intName]
              val has = fn n => SmlList.exists (fn m => sameName (m, n)) names
          in
            (* Only a backtick string's `${ }` has string in its class: SML has no generic
               text conversion, so its type must be known. *)
            if has stringName then
              Err ("the type of a value in a backtick string's ${ } is undecided; annotate it as "
                   ^ "String, Char, Int32, Int64, Real64 or Bool", pos)
            else (if has intName then bind (unifyAt (st, pos, "integer default", TVar v, intTy)) (fn _ => fn st => settle (rest, st))
            else (if has realName then bind (unifyAt (st, pos, "real default", TVar v, realTy)) (fn _ => fn st => settle (rest, st))
            else (case names of
                [only] => if sameName (only, int64Name)
                  then Err ("integer constant outside signed 32-bit range; annotate it as Int64.int", pos)
                  else Err ("the type of this numeric constant or operation is undecided; annotate it as " ^ nameOf only, pos)
              | _ => Err ("the type of this numeric constant or operation is undecided; annotate it as one of "
                      ^ SubsetString.concatWith (SmlList.map nameOf names, ", "), pos))))
          end
    in
      bind (settle (defaults, st)) (fn _ => fn st =>
        let val rigid = SmlList.filter (fn v => member (v, explicit)) (rigidNames (resolve (st, t))) in
          case (generalizable, rigid) of
            (true, _) =>
              let
                val taken = SmlList.filter (fn v => case lookup (st, v) of Free (_, l) => l > level | Bound _ => false)
                  (freeVars (st, resolve (st, t)))
                val st' = case st of
                    State (vs, nx, sels, recs, SOME xs) =>
                      State (vs, nx, sels, recs, SOME (SubsetList.append (SmlList.map Generalized taken, xs)))
                  | _ => st
              in Ok ((x, generalize (st, level, explicit, t)), st') end
          | (false, v :: _) =>
              Err ("type variable " ^ v ^ " cannot be generalized: the value is expansive (Definition, section 4.8)", pos)
          | (false, []) => Ok ((x, ([], resolve (st, t))), adjust (st, level, t))
        end)
    end

  and rigidNames = fn t =>
    case t of
      TRigid v => [v]
    | TCon (_, ts) => concatMap (rigidNames, ts)
    | TArrow (a, b) => SubsetList.append (rigidNames a, rigidNames b)
    | TRecord fields => concatMap (fn (_, a) => rigidNames a, fields)
    | _ => []

  (* `type`: Definition §4.10 rule 17, plus spec R2 for record types. *)
  and typeDec = fn ((env, _, _), pos, binds, st) =>
    let
      val names = SmlList.map (fn (_, name, _) => name) binds
      val dup = SmlList.find (fn n => SubsetList.length (SmlList.filter (fn m => m = n) names) > 1) names
    in
      case dup of
        SOME n => Err ("type " ^ n ^ " is bound twice", pos)
      | NONE =>
          bind (foldRes (fn (acc, (params, name, t), st) =>
                           bind (paramScope (pos, params, st)) (fn tyvar => fn st =>
                             bind (elabTy (env, tyvar, pos, t, st)) (fn body => fn st =>
                               bind (case t of
                                       TyRecord _ => recordDeclared (pos, SubsetList.length params, body, st)
                                     | _ => Ok ((), st)) (fn _ => fn st =>
                                 Ok (SubsetList.append (acc, [(name, TyStr (SubsetList.length params, body, []))]), st)))),
                         [], binds, st))
            (fn tys => fn st => Ok (withTypes tys, st))
    end

  (* Maps a declaration's type parameters to TGen. *)
  and paramScope = fn (pos, params, st) =>
    case SmlList.find (fn v => SubsetList.length (SmlList.filter (fn w => w = v) params) > 1) params of
      SOME v => Err ("type parameter " ^ v ^ " appears twice", pos)
    | NONE =>
        let
          val rec index = fn
              (_, [], _) => NONE
            | (v, w :: rest, i) => if v = w then SOME (TGen i) else index (v, rest, i + 1)
        in
          Ok (fn v => index (v, params, 0), st)
        end

  and recordDeclared = fn (pos, arity, body, st) =>
    case body of
      TRecord fields =>
        let
          val labels = SmlList.map (fn (l, _) => l) fields
          val State (vars, next, sels, recs, eqs) = st
        in
          if SmlList.exists (fn (declared, _, _) => declared = labels) recs then
            Err ("another record type already has the labels {" ^ SubsetString.concatWith (labels, ", ") ^ "} (spec R2)", pos)
          else Ok ((), State (vars, next, sels, (labels, arity, body) :: recs, eqs))
        end
    | _ => Ok ((), st)

  (* `datatype`: Definition §4.10 rule 19 and §4.9 for the equality attribute. *)
  and datatypeDec = fn ((env, _, _), pos, binds, st) =>
    let
      val names = SmlList.map (fn (_, name, _) => name) binds
      val cons = concatMap (fn (_, _, cs) => SmlList.map (fn (_, c, _) => c) cs, binds)
      val dupIn = fn xs => SmlList.find (fn n => SubsetList.length (SmlList.filter (fn m => m = n) xs) > 1) xs
      (* Fresh type names, first assuming every one admits equality. *)
      val (stamps, st1) =
        SmlList.foldl (fn (_, (acc, st)) => let val (s, st') = freshStamp st in (SubsetList.append (acc, [s]), st') end) ([], st) binds
      val nameFor = fn (eqs, (params, name, _), s) => (s, name, SubsetList.length params, memberInt (s, eqs))
      val tyFor = fn tn => let val SubsetResult.Ok args = SubsetList.tabulate (arityOf tn, TGen) in TCon (tn, args) end
      (* The constructors' argument types, with the group's names given the equality flags. *)
      val elabCons = fn (eqs, st) =>
        let
          val group = SmlListPair.map (fn (b, s) => nameFor (eqs, b, s)) (binds, stamps)
          val groupEnv = plus (env, withTypes (SmlList.map (fn tn => (nameOf tn, TyStr (arityOf tn, tyFor tn, []))) group))
        in
          bind (mapRes (fn (((params, _, cs), tn), st) =>
                          bind (paramScope (pos, params, st)) (fn tyvar => fn st =>
                            bind (mapRes (fn ((cp, c, arg), st) =>
                                            case arg of
                                              NONE => Ok ((c, NONE), st)
                                            | SOME t => bind (elabTy (groupEnv, tyvar, cp, t, st))
                                                          (fn t' => fn st => Ok ((c, SOME t'), st)),
                                          cs, st)) (fn cs' => fn st => Ok ((tn, cs'), st))),
                        SmlListPair.zip (binds, group), st)) (fn result => fn st => Ok (result, st))
        end
      (* Whether a type admits equality, assuming `eqs` for the group (Definition §4.9). *)
      val rec admits = fn (eqs, t) =>
        case t of
          TCon ((s, _, _, eq), args) =>
            (if memberInt (s, stamps) then memberInt (s, eqs) else eq) andalso SmlList.all (fn a => admits (eqs, a)) args
        | TArrow (_, _) => false
        | TRecord fields => SmlList.all (fn (_, a) => admits (eqs, a)) fields
        | TGen _ => true
        | _ => false
      val rec fixpoint = fn (eqs, st) =>
        bind (elabCons (eqs, st)) (fn group => fn st =>
          let
            val eqs' =
              SmlList.filter (fn s =>
                             SmlList.all (fn ((s', _, _, _), cs) =>
                                         (s' <> s) orelse SmlList.all (fn (_, arg) => case arg of NONE => true
                                                                                          | SOME t => admits (eqs, t)) cs)
                               group) eqs
          in
            if (SubsetList.length eqs' = SubsetList.length eqs) then Ok (group, st) else fixpoint (eqs', st)
          end)
    in
      case (dupIn names, dupIn cons, SmlList.find (fn c => member (c, unbindable) orelse c = "it") cons) of
        (SOME n, _, _) => Err ("type " ^ n ^ " is bound twice", pos)
      | (_, SOME c, _) => Err ("constructor " ^ c ^ " is bound twice", pos)
      | (_, _, SOME c) => Err ("`" ^ c ^ "` cannot be bound by a datatype", pos)
      | _ =>
          bind (fixpoint (stamps, st1)) (fn group => fn st =>
            let
              val conEntries =
                concatMap (fn (tn, cs) =>
                             SmlList.map (fn (c, arg) =>
                                         let val SubsetResult.Ok kinds = SubsetList.tabulate (arityOf tn, fn _ => KPlain) in
                                           case arg of
                                             NONE => (c, ((kinds, tyFor tn), SCon))
                                           | SOME t => (c, ((kinds, TArrow (t, tyFor tn)), SCon))
                                         end) cs, group)
              val tyEntries =
                SmlList.map (fn (tn, cs) =>
                            (nameOf tn, TyStr (arityOf tn, tyFor tn,
                                           SmlList.map (fn (c, _) => (c, let val SOME entry = assoc (c, conEntries) val (scheme, _) = entry in scheme end)) cs)))
                  group
            in
              Ok (Env.Env ([], tyEntries, conEntries), st)
            end)
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Top-level phrases (Definition §8) *)

  (* Restriction M2: an alias names a whole program structure, as a Workman file's import does. *)
  val structureAliases = fn (env, aliases, st) =>
    foldRes (fn (delta, (pos, name, target), st) =>
               case structureAt (env, [target]) of
                 SOME entry =>
                   let val (found, isBasis) = entry in
                     if isBasis then Err ("SubsetML can only alias structures the program declares, not Basis structure " ^ target ^ " (spec M2)", pos)
                     else Ok (plus (delta, withStructure (name, found, false)), st)
                   end
               | NONE => Err ("unbound structure " ^ target, pos),
             empty, aliases, st)

  val strdec = fn (env, sd, st) =>
    case sd of
      SDec d => dec ((env, 0, []), d, st)
    | SStructure (_, binds) =>
        foldRes (fn (delta, (name, aliases, ds), st) =>
                   bind (structureAliases (env, aliases, st)) (fn nested => fn st =>
                     bind (decs ((plus (env, nested), 0, []), ds, st)) (fn body => fn st =>
                       Ok (plus (delta, withStructure (name, plus (nested, body), false)), st))),
                 empty, binds, st)

  val topdec = fn (env, td, st) =>
    case td of
      TopDecs sds =>
        foldRes (fn (delta, sd, st) =>
                   bind (strdec (plus (env, delta), sd, st)) (fn more => fn st => Ok (plus (delta, more), st)),
                 empty, sds, st)
    | TopExp (pos, e) => dec ((env, 0, []), DVal (pos, [], [(PId (pos, ([], "it")), e)], []), st)

  (* Return only declarations owned by this file, without its incoming environment. *)
  val programExports = fn (env, phrases, st) =>
    foldRes (fn (owned, td, st) =>
      bind (topdec (plus (env, owned), td, st)) (fn delta => fn st => Ok (plus (owned, delta), st)),
      empty, phrases, st)

  (* The existing explicit-file workflow extends the supplied environment. *)
  val program = fn (env, phrases, st) =>
    bind (programExports (env, phrases, st)) (fn owned => fn st => Ok (plus (env, owned), st))

end
