(* @subsetml
from "./subset_list.sml" import * as SubsetList;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_string.sml" import * as SubsetString;
*)

(* Checked nonnegative arithmetic over signed 32-bit integers. *)
structure SubsetNatural = struct
  datatype error = InvalidNatural | InvalidDivisor
  val isValid = SubsetList.validCount

  (* Internal: nonnegative integer operands and a positive divisor. *)
  val split = fn (value : int, base : int) => (value div base, value mod base)

  val divide = fn (value, base) =>
    if not (isValid value) then SubsetResult.Err InvalidNatural
    else (if not (isValid base) orelse base <= 0 then SubsetResult.Err InvalidDivisor
    else SubsetResult.Ok (split (value, base)))

  val toString = fn value =>
    let
      val rec digit = fn (index, entries) =>
        case entries of [] => "" | first :: rest =>
          if index <= 0 then first else digit (index - 1, rest)
      val rec go = fn (remaining, acc) =>
        let
          val (whole, residue) = split (remaining, 10)
          val text = digit (residue, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"])
        in if whole <= 0 then SubsetString.concat (text :: acc)
           else go (whole, text :: acc) end
    in if isValid value then SubsetResult.Ok (go (value, [])) else SubsetResult.Err InvalidNatural end
end
