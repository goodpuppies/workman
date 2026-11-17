(* @subsetml
from "./sml_list.sml" import * as SmlList;
*)

(* Portable paired-list algorithms for the custom SubsetML Basis.
   Current signatures follow their SML origins and stop at the shorter list.
   Checked variants and Result-based APIs remain to be designed (docs/basis.md). *)
structure SmlListPair = struct

  val zip = fn (xs, ys) =>
    let
      val rec go = fn
          (x :: xs, y :: ys, acc) => go (xs, ys, (x, y) :: acc)
        | ([], ys, acc) => SmlList.rev acc
        | (xs, [], acc) => SmlList.rev acc
    in go (xs, ys, []) end

  val unzip = fn pairs =>
    let
      val (xs, ys) = SmlList.foldl (fn ((x, y), (xs, ys)) => (x :: xs, y :: ys)) ([], []) pairs
    in (SmlList.rev xs, SmlList.rev ys) end

  val map = fn f => fn lists => SmlList.map f (zip lists)
  val app = fn f => fn lists => SmlList.app f (zip lists)
  val all = fn p => fn lists => SmlList.all p (zip lists)
  val exists = fn p => fn lists => SmlList.exists p (zip lists)

end
