(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./sml_list.sml" import * as SmlList;
from "./compiler_text.sml" import * as CompilerText;
from "./backend_names.sml" import * as BackendNames;
from "./unify.sml" import * as Unify;
from "./types.sml" import * as Types;
from "./elab.sml" import * as Elab;
from "./translate.sml" import * as Translate;
from "./subset_list.sml" import * as SubsetList;
from "./basis.sml" import * as Basis;
*)

(* Native SML emission makes the int32 choice explicit, independently of the
   host compiler's default int. Source formatting remains source formatting. *)
structure NativeInt = struct
  open SubsetOptionValue

  open Syntax

  val basename = fn path => case SmlList.rev (CompilerText.fields (path, fn c => c = #"/")) of
    name :: _ => name | [] => path

  val project = fn files =>
    let
      val prefix = BackendNames.prefix (SmlList.map (fn (path, src, _, _) => (path, src)) files)
      val runtime = prefix ^ "Int32"
      val integerTy = TyCon ([], ([runtime], "int"))
      val header = "(* Generated native SML: SubsetML int is signed 32-bit. *)\n" ^
        "structure " ^ runtime ^ " = struct\n" ^
        "  open Int32\n  val precision = SOME (32 : Int32.int)\nend\n"
      (* Keep authored type syntax: an initial SML type alias preserves local
         aliases, shadowing and opens without changing the host's operators. *)
      val rec lowerPat = fn p => case p of
        PScon (_, SInt _) => PTyped (p, integerTy)
      | PRecord (q, fs) => PRecord (q, SmlList.map (fn (l, p) => (l, lowerPat p)) fs)
      | PTuple ps => PTuple (SmlList.map lowerPat ps)
      | PList ps => PList (SmlList.map lowerPat ps)
      | PApp (q, id, p) => PApp (q, id, lowerPat p)
      | PTyped (p, t) => PTyped (lowerPat p, t)
      | _ => p
      val process = fn (prog, st) =>
        let
          val Unify.State (_, _, _, _, sites) = st
          val site = fn pos => case sites of NONE => NONE | SOME xs =>
            (case SmlList.mapPartial (fn Unify.Operand (p, t) => if p = pos then SOME (p, t) else NONE
                                       | _ => NONE) xs of
               [] => NONE
             | first :: _ => SOME first)
          val rec integer = fn t => case Unify.prune (st, t) of
            Types.TCon (n, []) => Unify.sameName (n, Types.intName)
          | Types.TVar v => (case Unify.lookup (st, v) of
              Unify.Free (Types.KClass ns, _) => SmlList.exists (fn n => Unify.sameName (n, Types.intName)) ns
            | _ => false)
          | Types.TArrow (a, _) => integer a
          | Types.TRecord ((_, t) :: _) => integer t
          | _ => false
          val id = fn (q, original) => case site q of
            NONE => original
          | SOME (_, t) => case original of
              (["Int"], name) => ([runtime], name)
            | ([], name) => if name <> "=" andalso name <> "<>" andalso integer t then ([runtime], name) else original
            | _ => original
          val rec exp = fn e =>
            let val rules = fn rs => SmlList.map (fn (p, e) => (lowerPat p, exp e)) rs
            in case e of
              EScon (_, SInt _) => ETyped (e, integerTy)
            | EId (q, name) => EId (q, id (q, name))
            | ERecord (q, fs) => ERecord (q, SmlList.map (fn (l, e) => (l, exp e)) fs)
            | ECopy (q, a, b, t) => ECopy (q, exp a, exp b, t)
            | ETuple es => ETuple (SmlList.map exp es)
            | EList es => EList (SmlList.map exp es)
            | ESeq es => ESeq (SmlList.map exp es)
            | ELet (ds, es) => ELet (SmlList.map dec ds, SmlList.map exp es)
            | EApp (a, b) => EApp (exp a, exp b)
            | ETyped (e, t) => ETyped (exp e, t)
            | EAndalso (a, b) => EAndalso (exp a, exp b)
            | EOrelse (a, b) => EOrelse (exp a, exp b)
            | EIf (c, a, b) => EIf (exp c, exp a, exp b)
            | ECase (e, rs) => ECase (exp e, rules rs)
            | EFn rs => EFn (rules rs)
            | _ => e end
          and dec = fn d => case d of
            DVal (q, vs, plain, recs) =>
              let val rules = fn rs => SmlList.map (fn (p, e) => (lowerPat p, exp e)) rs
              in DVal (q, vs, rules plain, rules recs) end
          | DLocal (q, hidden, body) => DLocal (q, SmlList.map dec hidden, SmlList.map dec body)
          | _ => d
          val top = fn td => case td of
            TopExp (q, e) => TopExp (q, exp e)
          | TopDecs ds => TopDecs (SmlList.map (fn sd => case sd of
              SDec d => SDec (dec d)
            | SStructure (q, bs) => SStructure (q, SmlList.map
                (fn (name, aliases, ds) => (name, aliases, SmlList.map dec ds)) bs)) ds)
        in SmlList.map top prog end

      val rec loop = fn (env, st, files, acc) => case files of
        [] => Unify.Ok (SmlList.rev acc, st)
      | (path, src, prog, cs) :: rest =>
          (* Strict validation before the recording pass, whose equality mode
             exists for WM recovery and must not weaken SML source checking. *)
          Unify.bind (Elab.program (env, prog, st)) (fn _ => fn _ =>
            let val Unify.State (vs, nx, sels, recs, _) = st in
              Unify.bind (Elab.program (env, prog, Unify.State (vs, nx, sels, recs, SOME [])))
                (fn nextEnv => fn next =>
                  let val Unify.State (vs, nx, sels, recs, _) = next
                      val native = process (prog, next)
                  in loop (nextEnv, Unify.State (vs, nx, sels, recs, NONE), rest,
                    (path, Translate.toSml (src, native, cs)) :: acc) end)
            end)
      val names = SmlList.map (fn (path, _, _, _) => basename path) files
      val duplicate = SmlList.find (fn name =>
        SubsetList.length32 (SmlList.filter (fn other => name = other) names) > 1) names
    in case duplicate of SOME name => Unify.Err ("duplicate native output filename: " ^ name, 0)
      | NONE => Unify.bind Basis.initial (fn env => fn st =>
          Unify.bind (loop (env, st, files, [])) (fn outputs => fn next =>
            Unify.Ok ((header ^ "type int = " ^ runtime ^ ".int\n", outputs), next))) end

  (* Legacy source-list command keeps its prelude in the first output file. *)
  val emit = fn files => Unify.bind (project files) (fn (prelude, outputs) => fn st =>
    Unify.Ok ((case outputs of [] => [] | (path, text) :: rest => (path, prelude ^ text) :: rest), st))
end
