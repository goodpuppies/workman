(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./subset_char.sml" import * as SubsetChar;
*)

(* Shared source-only Unicode arithmetic and codec errors. No host numeric library. *)
structure SubsetUnicode = struct
  datatype reason = InvalidScalar | InvalidByte | InvalidLeadingByte | InvalidContinuation
    | Truncated | Overlong | Surrogate | OutOfRange | OddLength | UnpairedSurrogate
  datatype error = Error of reason * real

  (* Internal arithmetic for nonnegative codes <= 1114111 and positive integral bases.
     Fixed binary weights keep division bounded; fractional residue remains visible. *)
  val split = fn (value : real, base : real) =>
    let
      val rec go = fn (weight, remaining, quotient) =>
        if weight < 1.0 then (quotient, remaining)
        else
          let val amount = base * weight in
            if remaining >= amount then go (weight / 2.0, remaining - amount, quotient + weight)
            else go (weight / 2.0, remaining, quotient)
          end
    in go (1048576.0, value, 0.0) end

  val isScalar = fn (value : real) =>
    value >= 0.0 andalso value <= 1114111.0
    andalso not (value >= 55296.0 andalso value <= 57343.0)
    andalso (let val (whole, residue) = split (value, 1.0) in residue <= 0.0 end)

  val scalarError = fn value =>
    if value >= 55296.0 andalso value <= 57343.0 then Surrogate
    else (if value > 1114111.0 then OutOfRange else InvalidScalar)

  val encodeCodes = fn (codes, index) =>
    SubsetResult.mapError (SubsetList.traverse (codes, SubsetChar.fromCode),
      fn error => Error (InvalidByte, index))
end
