(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_list.sml" import * as SubsetList;
from "./subset_order.sml" import * as SubsetOrder;
*)

(* Byte sequences and immutable sequential readers; no native-string access. *)
structure SubsetBytes = struct
  datatype error = InvalidIndex | OutOfBounds | NonByte of real
  datatype reader = Reader of char list * real

  val validate = fn bytes =>
    let
      val rec go = fn
          ([], index) => SubsetResult.Ok bytes
        | (c :: rest, index) =>
            case SubsetChar.toCode c of
              SubsetResult.Err error => SubsetResult.Err (NonByte index)
            | SubsetResult.Ok code => go (rest, index + 1.0)
    in go (bytes, 0.0) end

  (* Validate complete operands, then compare unsigned byte codes lexicographically. *)
  (* Internal error adapter lets native strings retain their own error type. *)
  val compareWith = fn (left, right, nonByte) =>
    let
      val codes = fn bytes =>
        let
          val rec go = fn
              ([], offset, acc) => SubsetResult.Ok (SubsetList.reverse acc)
            | (c :: rest, offset, acc) =>
                case SubsetChar.toCode c of
                  SubsetResult.Err error => SubsetResult.Err (nonByte offset)
                | SubsetResult.Ok code => go (rest, offset + 1.0, code :: acc)
        in go (bytes, 0.0, []) end
      val rec order = fn
          ([], []) => SubsetOrder.Equal
        | ([], rest) => SubsetOrder.Less
        | (rest, []) => SubsetOrder.Greater
        | ((a : real) :: xs, b :: ys) =>
            if a < b then SubsetOrder.Less
            else (if a > b then SubsetOrder.Greater else order (xs, ys))
    in
      SubsetResult.andThen (codes left, fn xs =>
        SubsetResult.map (codes right, fn ys => order (xs, ys)))
    end

  val compare = fn (left, right) => compareWith (left, right, fn offset => NonByte offset)

  val length = fn bytes => SubsetList.foldLeft (bytes, 0.0, fn (c, n) => n + 1.0)
  val trim = fn (bytes, predicate) =>
    SubsetList.reverse (SubsetList.dropWhile (
      SubsetList.reverse (SubsetList.dropWhile (bytes, predicate)), predicate))
  val fields = fn (bytes, delimiter) =>
    let
      val rec go = fn
          ([], field, acc) => SubsetList.reverse (SubsetList.reverse field :: acc)
        | (c :: rest, field, acc) =>
            if delimiter c then go (rest, [], SubsetList.reverse field :: acc)
            else go (rest, c :: field, acc)
    in go (bytes, [], []) end

  val reader = fn bytes => SubsetResult.map (validate bytes, fn valid => Reader (valid, 0.0))
  val position = fn Reader (bytes, offset) => offset
  val peek = fn Reader ([], offset) => NONE | Reader (c :: rest, offset) => SOME c
  val next = fn Reader ([], offset) => NONE
    | Reader (c :: rest, offset) => SOME (c, Reader (rest, offset + 1.0))

  (* Bounds derived from the actual list avoid narrowing counts to scalar-code ranges.
     Fractional indices are detected by countdown; NaN/infinity fail the bounds test. *)
  val splitAt = fn (bytes, index : real) =>
    if index >= 0.0 andalso index <= length bytes then
      let
        val rec go = fn (rest, remaining, acc) =>
          if remaining <= 0.0 then
            (if remaining >= 0.0 then SubsetResult.Ok (SubsetList.reverse acc, rest)
             else SubsetResult.Err InvalidIndex)
          else case rest of
              [] => SubsetResult.Err OutOfBounds
            | c :: tail => go (tail, remaining - 1.0, c :: acc)
      in go (bytes, index, []) end
    else SubsetResult.Err InvalidIndex

  val at = fn (bytes, index) =>
    SubsetResult.andThen (splitAt (bytes, index), fn (prefix, rest) =>
      case rest of [] => SubsetResult.Err OutOfBounds | c :: tail => SubsetResult.Ok c)
  val slice = fn (bytes, start, count) =>
    SubsetResult.andThen (splitAt (bytes, start), fn (prefix, rest) =>
      SubsetResult.map (splitAt (rest, count), fn (selected, suffix) => selected))
end
