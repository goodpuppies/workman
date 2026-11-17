(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
*)

(* Custom Basis paired lists. Unequal lengths are reported, never silently truncated.
   Mapping validates lengths before invoking any user callback. *)
structure SubsetListPair = struct

  datatype error = UnequalLengths

  val zip = fn (left, right) =>
    let
      val rec go = fn
          ([], [], acc) => SubsetResult.Ok (SubsetList.reverse acc)
        | (x :: xs, y :: ys, acc) => go (xs, ys, (x, y) :: acc)
        | ([], y :: ys, acc) => SubsetResult.Err UnequalLengths
        | (x :: xs, [], acc) => SubsetResult.Err UnequalLengths
    in go (left, right, []) end

  val unzip = fn pairs =>
    let
      val (left, right) = SubsetList.foldLeft (pairs, ([], []),
        fn ((x, y), (left, right)) => (x :: left, y :: right))
    in (SubsetList.reverse left, SubsetList.reverse right) end

  val map = fn (left, right, f) =>
    SubsetResult.map (zip (left, right), fn pairs => SubsetList.map (pairs, f))

  datatype 'e traversalError = LengthMismatch | CallbackError of 'e

  val traverse = fn (left, right, f) =>
    case zip (left, right) of
      SubsetResult.Err error => SubsetResult.Err LengthMismatch
    | SubsetResult.Ok pairs =>
        SubsetResult.mapErr (SubsetList.traverse (pairs, f), CallbackError)

end
