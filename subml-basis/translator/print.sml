(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./subset_string.sml" import * as SubsetString;
from "./subset_list.sml" import * as SubsetList;
from "./compiler_text.sml" import * as CompilerText;
from "./sml_list.sml" import * as SmlList;
*)

(* Prints abstract syntax as S-expressions, for tests and debugging. *)
structure Print = struct
  open SubsetOptionValue

  open Syntax

  val node = fn (name, parts) => "(" ^ SubsetString.concatWith (name :: parts, " ") ^ ")"

  val longid = fn (quals, id) => SubsetString.concatWith (SubsetList.append (quals, [id]), ".")

  val scon = fn
      SInt s => s
    | SWord s => s
    | SReal s => s
    | SString s => "\"" ^ CompilerText.escapeSmlString s ^ "\""
    | SChar c => "#\"" ^ CompilerText.escapeSmlChar c ^ "\""

  val rec ty = fn
      TyVar v => v
    | TyCon ([], id) => longid id
    | TyCon (args, id) => node (longid id, SmlList.map ty args)
    | TyTuple ts => node ("*", SmlList.map ty ts)
    | TyArrow (a, b) => node ("->", [ty a, ty b])
    | TyRecord fields => node ("record", SmlList.map (fn (l, t) => node (l, [ty t])) fields)

  val rec pat = fn
      PWild => "_"
    | PScon (_, c) => scon c
    | PId (_, id) => longid id
    | PPinned (_, id) => node ("pin", [longid id])
    | PComputed (_, _) => node ("computed", [])
    | PRecord (_, fields) => node ("record", SmlList.map (fn (l, p) => node (l, [pat p])) fields)
    | PTuple ps => node ("tuple", SmlList.map pat ps)
    | PList ps => node ("list", SmlList.map pat ps)
    | PApp (_, id, arg) => node (longid id, [pat arg])
    | PTyped (p, t) => node (":", [pat p, ty t])

  val tyvars = fn vs => node ("tyvars", vs)

  val con = fn
      (_, c, NONE) => c
    | (_, c, SOME t) => node (c, [ty t])

  val rec exp = fn
      EScon (_, c) => scon c
    | EId (_, id) => longid id
    | ERecord (_, fields) => node ("record", SmlList.map (fn (l, e) => node (l, [exp e])) fields)
    | ESelect (_, l) => "#" ^ l
    | ECopy (_, source, _, _) => exp source
    | ETuple es => node ("tuple", SmlList.map exp es)
    | EList es => node ("list", SmlList.map exp es)
    | ESeq es => node ("seq", SmlList.map exp es)
    | ELet (ds, es) => node ("let", [node ("decs", SmlList.map dec ds), node ("in", SmlList.map exp es)])
    | EApp (f, a) => node ("app", [exp f, exp a])
    | ETyped (e, t) => node (":", [exp e, ty t])
    | EAndalso (a, b) => node ("andalso", [exp a, exp b])
    | EOrelse (a, b) => node ("orelse", [exp a, exp b])
    | EIf (c, a, b) => node ("if", [exp c, exp a, exp b])
    | ECase (e, m) => node ("case", exp e :: SmlList.map rule m)
    | EFn m => node ("fn", SmlList.map rule m)

  and rule = fn (p, e) => node ("=>", [pat p, exp e])

  and binding = fn (p, e) => node ("=", [pat p, exp e])

  and dec = fn
      DVal (_, vs, plain, recs) =>
        node ("val", SubsetList.concat [[tyvars vs], SmlList.map binding plain,
          (if SmlList.null recs then [] else [node ("rec", SmlList.map binding recs)])])
    | DType (_, bs) =>
        node ("type", SmlList.map (fn (vs, tycon, t) => node (tycon, [tyvars vs, ty t])) bs)
    | DDatatype (_, bs) =>
        node ("datatype",
              SmlList.map (fn (vs, tycon, cs) => node (tycon, tyvars vs :: SmlList.map con cs)) bs)
    | DOpen (_, ids) => node ("open", SubsetList.map (ids, fn id => SubsetString.concatWith (id, ".")))
    | DLocal (_, hidden, body) => node ("local", [node ("hidden", SmlList.map dec hidden), node ("body", SmlList.map dec body)])

  val strdec = fn
      SDec d => dec d
    | SStructure (_, bs) =>
        node ("structure", SmlList.map (fn (name, aliases, ds) => node (name,
          SubsetList.append (SmlList.map (fn (_, alias, target) => node ("alias", [alias, target])) aliases,
            SmlList.map dec ds))) bs)

  val topdec = fn
      TopDecs sds => SubsetString.concatWith (SubsetList.map (sds, strdec), " ")
    | TopExp (_, e) => node ("it", [exp e])

end
