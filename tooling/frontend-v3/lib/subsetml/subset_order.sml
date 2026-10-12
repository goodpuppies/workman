(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
*)

(* Custom ordering is ordinary source data, shared with generated Workman. *)
structure SubsetOrder = struct
  datatype order = Less | Equal | Greater
  datatype error = Unordered

  (* IEEE comparisons are unordered when either operand is NaN. *)
  val compareReal = fn (left : real, right : real) =>
    if left < right then SubsetResult.Ok Less
    else (if left > right then SubsetResult.Ok Greater
    else (if left <= right then SubsetResult.Ok Equal else SubsetResult.Err Unordered))

  val reverse = fn Less => Greater | Equal => Equal | Greater => Less
end
