(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./subset_char.sml" import * as SubsetChar;
*)

(* Shared source-only Unicode arithmetic and codec errors. No host numeric library. *)
structure SubsetUnicode = struct
  datatype reason = InvalidScalar | InvalidByte | InvalidLeadingByte | InvalidContinuation
    | Truncated | Overlong | Surrogate | OutOfRange | OddLength | UnpairedSurrogate
  datatype error = Error of reason * int

  (* Internal: nonnegative scalar codes and a positive integer divisor. *)
  val split = fn (value : int, base : int) => (value div base, value mod base)

  val isScalar = fn (value : int) =>
    value >= 0 andalso value <= 1114111
    andalso not (value >= 55296 andalso value <= 57343)
    andalso (let val (whole, residue) = split (value, 1) in residue <= 0 end)

  val scalarError = fn value =>
    if value >= 55296 andalso value <= 57343 then Surrogate
    else (if value > 1114111 then OutOfRange else InvalidScalar)

  val encodeCodes = fn (codes, index) =>
    SubsetResult.mapError (SubsetList.traverse (codes, SubsetChar.fromCode),
      fn error => Error (InvalidByte, index))
end
