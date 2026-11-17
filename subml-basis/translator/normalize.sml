(* @subsetml
from "./syntax.sml" import * as Syntax;
from "./sml_list.sml" import * as SmlList;
*)

(* Canonical forms for comparing syntax trees across a translation round trip. Some SML
   spellings share one Workman spelling, so they come back as the canonical one:

     nil, x :: [y]         become  [], [x, y]
     let in e end          becomes e
     open A B              becomes open A; open B *)
structure Normalize = struct

  open Syntax

  val rec pat = fn p =>
    case p of
      PId (_, ([], "nil")) => PList []
    | PRecord (pos, fields) => PRecord (pos, SmlList.map (fn (l, q) => (l, pat q)) fields)
    | PTuple ps => PTuple (SmlList.map pat ps)
    | PList ps => PList (SmlList.map pat ps)
    | PApp (pos, ([], "::"), PTuple [h, t]) =>
        (case (pat h, pat t) of
           (h', PList items) => PList (h' :: items)
         | (h', t') => PApp (pos, ([], "::"), PTuple [h', t']))
    | PApp (pos, id, q) => PApp (pos, id, pat q)
    | PTyped (q, t) => PTyped (pat q, t)
    | _ => p

  val rules = fn (f, g, rs) => SmlList.map (fn (p, e) => (f p, g e)) rs

  val rec exp = fn e =>
    case e of
      EId (_, ([], "nil")) => EList []
    | ERecord (pos, fields) => ERecord (pos, SmlList.map (fn (l, x) => (l, exp x)) fields)
    | ETuple es => ETuple (SmlList.map exp es)
    | EList es => EList (SmlList.map exp es)
    | ESeq es => ESeq (SmlList.map exp es)
    | ELet ([], [single]) => exp single
    | ELet (ds, es) => ELet (decs ds, SmlList.map exp es)
    | EApp (EId (pos, ([], "::")), ETuple [h, t]) =>
        (case (exp h, exp t) of
           (h', EList items) => EList (h' :: items)
         | (h', t') => EApp (EId (pos, ([], "::")), ETuple [h', t']))
    | EApp (EId (p, (["Real"], opr)), ETuple [ETyped (x, TyCon ([], ([], "real"))), y]) =>
        if opr = "==" orelse opr = "!=" then EApp (EId (p, (["Real"], opr)), ETuple [exp x, exp y])
        else EApp (EId (p, (["Real"], opr)), ETuple [exp (ETyped (x, TyCon ([], ([], "real")))), exp y])
    | EApp (f, a) => EApp (exp f, exp a)
    | ETyped (x, t) => ETyped (exp x, t)
    | ECopy (_, source, _, _) => exp source
    | EAndalso (a, b) => EIf (exp a, exp b, EId (0, ([], "false")))
    | EOrelse (a, b) => EIf (exp a, EId (0, ([], "true")), exp b)
    | EIf (c, a, b) => EIf (exp c, exp a, exp b)
    | ECase (x, rs) => ECase (exp x, rules (pat, exp, rs))
    (* First-class real comparisons are expanded to typed Workman lambdas. Contract
       their exact eta expansion for comparison; both operands must be the bound names. *)
    | EFn [(PTuple [PTyped (PId (_, ([], x)), TyCon ([], ([], "real"))),
                          PTyped (PId (_, ([], y)), TyCon ([], ([], "real")))],
                  EApp (EId (p, (["Real"], opr)),
                        ETuple [EId (_, ([], a)), EId (_, ([], b))]))] =>
        if (opr = "==" orelse opr = "!=") andalso x = a andalso y = b andalso x <> y
        then EId (p, (["Real"], opr))
        else (case e of EFn rs => EFn (rules (pat, exp, rs)) | _ => e)
    | EFn rs => EFn (rules (pat, exp, rs))
    | _ => e

  and decs = fn ds =>
    SmlList.concat (SmlList.map (fn
        DVal (pos, vs, plain, recs) => [DVal (pos, vs, rules (pat, exp, plain), rules (pat, exp, recs))]
      | DOpen (pos, ids) => SmlList.map (fn id => DOpen (pos, [id])) ids
      | DLocal (pos, hidden, body) => [DLocal (pos, decs hidden, decs body)]
      | d => [d]) ds)

end
