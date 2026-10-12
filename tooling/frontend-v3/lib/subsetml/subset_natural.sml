(* @subsetml
from "./subset_list.sml" import * as SubsetList;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_string.sml" import * as SubsetString;
*)

(* Exact nonnegative integer arithmetic over the current real-number profile. *)
structure SubsetNatural = struct
  datatype error = InvalidNatural | InvalidDivisor
  val isValid = SubsetList.validCount

  (* Internal: operands are exact integers below 2^53 and base is positive.
     Binary weights make division bounded by 53 steps, without floor/div/mod. *)
  val split = fn (value : real, base : real) =>
    let
      val rec go = fn (weight, remaining, quotient) =>
        if weight < 1.0 then (quotient, remaining)
        else
          let val amount = base * weight in
            if remaining >= amount then go (weight / 2.0, remaining - amount, quotient + weight)
            else go (weight / 2.0, remaining, quotient)
          end
    in go (4503599627370496.0, value, 0.0) end

  val divide = fn (value, base) =>
    if not (isValid value) then SubsetResult.Err InvalidNatural
    else (if not (isValid base) orelse base <= 0.0 then SubsetResult.Err InvalidDivisor
    else SubsetResult.Ok (split (value, base)))

  val toString = fn value =>
    let
      val rec digit = fn (index, entries) =>
        case entries of [] => "" | first :: rest =>
          if index <= 0.0 then first else digit (index - 1.0, rest)
      val rec go = fn (remaining, acc) =>
        let
          val (whole, residue) = split (remaining, 10.0)
          val text = digit (residue, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"])
        in if whole <= 0.0 then SubsetString.concat (text :: acc)
           else go (whole, text :: acc) end
    in if isValid value then SubsetResult.Ok (go (value, [])) else SubsetResult.Err InvalidNatural end
end
