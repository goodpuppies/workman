(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
*)

(* Abstract syntax of SubsetML (docs/spec.md §4, §7, §8).

   Derived forms are kept as written so diagnostics can talk about the source; the elaborator
   expands them as in Appendix A of the Definition. Infix applications are already resolved:
   `a + b` is EApp (EId "+", ETuple [a, b]) and `x :: xs` is PApp ("::", PTuple [x, xs]). *)
structure Syntax = struct
  open SubsetOptionValue

  (* Byte offset into the source text. *)
  type pos = int

  (* A comment's position, its text without the delimiters, and whether code precedes it on its
     line (a trailing comment). Comments are kept beside the syntax tree for translation. *)
  type comment = pos * string * bool

  (* Structure qualifiers and the final identifier. *)
  type longid = string list * string

  datatype scon =
      SInt of string      (* source text, e.g. "~0x1F" *)
    | SWord of string     (* source text, e.g. "0w7", "0wx1F" *)
    | SReal of string     (* source text *)
    | SString of string   (* decoded contents *)
    | SChar of char

  datatype ty =
      TyVar of string
    | TyCon of ty list * longid
    | TyTuple of ty list                (* two or more components *)
    | TyArrow of ty * ty
    | TyRecord of (string * ty) list    (* only as the right side of a type binding *)

  datatype pat =
      PWild
    | PScon of pos * scon
    | PId of pos * longid               (* variable or constructor *)
    (* Internal reverse-WM pattern; resolved and lowered before target checking. *)
    | PPinned of pos * longid
    | PComputed of pos * exp
    | PRecord of pos * (string * pat) list
    | PTuple of pat list                (* [] is (); never one component *)
    | PList of pat list
    | PApp of pos * longid * pat        (* constructor application *)
    | PTyped of pat * ty

  and exp =
      EScon of pos * scon
    | EId of pos * longid
    | ERecord of pos * (string * exp) list
    | ESelect of pos * string           (* # lab *)
    | ETuple of exp list                (* [] is (); never one component *)
    | EList of exp list
    | ESeq of exp list                  (* (e1; ...; en), two or more *)
    | ELet of dec list * exp list       (* let dec in e1; ...; en end *)
    | EApp of exp * exp
    | ETyped of exp * ty
    | EAndalso of exp * exp
    | EOrelse of exp * exp
    | EIf of exp * exp * exp
    | ECase of exp * (pat * exp) list
    | EFn of (pat * exp) list
    (* Internal WM lowering plan: checked ordered construction, pure final fields, layout.
       Not surface SubsetML syntax; printers retain the checked fallback if not lowered. *)
    | ECopy of pos * exp * exp * ty

  and dec =
      (* val tyvarseq valbind: the bindings before and after `rec` *)
      DVal of pos * string list * (pat * exp) list * (pat * exp) list
    | DType of pos * (string list * string * ty) list
    | DDatatype of pos * (string list * string * (pos * string * ty option) list) list
    | DOpen of pos * string list list
    (* local dec1 in dec2 end: dec1's bindings are visible only in dec2 (Definition §4.10 rule 23). *)
    | DLocal of pos * dec list * dec list

  (* `structure Name = Target` at the start of a `struct`: position, name, target. It lives here
     rather than in `dec`, so no other declaration context can hold one (spec restriction M2). *)
  type structureAlias = pos * string * string

  datatype strdec =
      SDec of dec
    | SStructure of pos * (string * structureAlias list * dec list) list

  (* One program phrase, terminated by `;` (§8). *)
  datatype topdec =
      TopDecs of strdec list
    | TopExp of pos * exp

end
