(* @subsetml
from "./subset_list.sml" import * as SubsetList;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./types.sml" import * as Types;
from "./sml_list.sml" import * as SmlList;
*)

(* Static environments (Definition §4.2): structures, types and values, newest binding first. *)
structure Env = struct
  open SubsetOptionValue

  open Types

  (* Value identifier status: a variable or a value constructor (no exceptions in SubsetML). *)
  datatype status =
      SValue
    | SCon

  (* A type structure: a type function (arity, and a body over TGen 0 .. arity-1) and the
     value constructors when it is a datatype. *)
  datatype tystr = TyStr of int * ty * (string * scheme) list

  (* Structures (each marked if it comes from the Basis), types, and values. *)
  datatype env =
      Env of (string * (env * bool)) list * (string * tystr) list * (string * (scheme * status)) list

  val empty = Env ([], [], [])

  (* `plus (a, b)`: b's bindings shadow a's. *)
  val plus = fn (Env (s1, t1, v1), Env (s2, t2, v2)) => Env (SubsetList.append (s2, s1), SubsetList.append (t2, t1), SubsetList.append (v2, v1))

  val assoc = fn (key, entries) =>
    case SmlList.find (fn (k, _) => k = key) entries of
      SOME entry => let val (key, v) = entry in SOME v end
    | NONE => NONE

  (* The environment of a structure path, with whether it comes from the Basis. *)
  val rec structureAt = fn (env, path) =>
    case path of
      [] => SOME (env, false)
    | name :: rest =>
        let val Env (strs, _, _) = env in
          case assoc (name, strs) of
            SOME entry =>
              let val (inner, basis) = entry in (case structureAt (inner, rest) of
                 SOME foundEntry => let val (found, innerBasis) = foundEntry in SOME (found, basis orelse innerBasis) end
               | NONE => NONE) end
          | NONE => NONE
        end

  val value = fn (env, (quals, x)) =>
    case structureAt (env, quals) of
      SOME entry => let val (Env (strs, tys, vals), basis) = entry in assoc (x, vals) end
    | NONE => NONE

  val tycon = fn (env, (quals, x)) =>
    case structureAt (env, quals) of
      SOME entry => let val (Env (strs, tys, vals), basis) = entry in assoc (x, tys) end
    | NONE => NONE

  val withValues = fn vals => Env ([], [], vals)
  val withTypes = fn tys => Env ([], tys, [])
  val withStructure = fn (name, env, basis) => Env ([(name, (env, basis))], [], [])

  (* The label sets of the record type declarations in scope (spec R3), including those of the
     program structures this module imports: a Workman named import brings a record type into
     scope unqualified, and its translation refers to it through the structure. Basis
     structures are excluded. *)
  val rec recordLabelSets = fn Env (strs, tys, _) =>
    SubsetList.append (
      SmlList.concat (SmlList.map (fn (_, TyStr (_, TRecord fields, _)) => [SmlList.map (fn (l, _) => l) fields] | _ => []) tys),
      SmlList.concat (SmlList.map (fn (_, (inner, basis)) => if basis then [] else recordLabelSets inner) strs))

end
