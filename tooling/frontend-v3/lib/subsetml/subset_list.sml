(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
*)

(* Custom Basis lists. No host library calls, references or exceptions.
   Adapted from the existing portable SmlList algorithms; callbacks take data first. *)
structure SubsetList = struct

  datatype error = EmptyList | InvalidCount | InvalidIndex | OutOfBounds

  val isEmpty = fn [] => true | x :: xs => false

  val rec reverseAppend = fn (xs, ys) =>
    case xs of [] => ys | x :: rest => reverseAppend (rest, x :: ys)
  val reverse = fn xs => reverseAppend (xs, [])
  val append = fn (xs, ys) => reverseAppend (reverse xs, ys)

  val rec foldLeft = fn (xs, initial, f) =>
    case xs of [] => initial | x :: rest => foldLeft (rest, f (x, initial), f)
  val foldRight = fn (xs, initial, f) => foldLeft (reverse xs, initial, f)
  val concat = fn lists =>
    reverse (foldLeft (lists, [], fn (xs, acc) => reverseAppend (xs, acc)))

  val rec forEach = fn (xs, f) =>
    case xs of [] => () | x :: rest => let val () = f x in forEach (rest, f) end
  val map = fn (xs, f) => reverse (foldLeft (xs, [], fn (x, acc) => f x :: acc))
  val filterMap = fn (xs, f) =>
    reverse (foldLeft (xs, [], fn (x, acc) => case f x of NONE => acc | SOME y => y :: acc))
  val filter = fn (xs, predicate) =>
    reverse (foldLeft (xs, [], fn (x, acc) => if predicate x then x :: acc else acc))
  val partition = fn (xs, predicate) =>
    let
      val (yes, no) = foldLeft (xs, ([], []), fn (x, (yes, no)) =>
        if predicate x then (x :: yes, no) else (yes, x :: no))
    in (reverse yes, reverse no) end

  val rec find = fn (xs, predicate) =>
    case xs of [] => NONE | x :: rest => if predicate x then SOME x else find (rest, predicate)
  val rec exists = fn (xs, predicate) =>
    case xs of [] => false | x :: rest => predicate x orelse exists (rest, predicate)
  val rec all = fn (xs, predicate) =>
    case xs of [] => true | x :: rest => predicate x andalso all (rest, predicate)

  val length = fn xs => foldLeft (xs, 0, fn (x, count) => count + 1)
  val rec dropWhile = fn (xs, predicate) =>
    case xs of [] => [] | x :: rest => if predicate x then dropWhile (rest, predicate) else xs

  (* Signed integer counts are valid exactly when nonnegative. *)
  val validCount = fn (count : int) => count >= 0

  val repeat = fn (value, count) =>
    let
      val rec build = fn (remaining, acc) =>
        if remaining <= 0 then acc else build (remaining - 1, value :: acc)
    in if validCount count then SubsetResult.Ok (build (count, [])) else SubsetResult.Err InvalidCount end

  val splitAt = fn (xs, index) =>
    let
      val rec go = fn (rest, remaining, acc) =>
        if remaining <= 0 then SubsetResult.Ok (reverse acc, rest)
        else case rest of [] => SubsetResult.Err OutOfBounds
          | x :: tail => go (tail, remaining - 1, x :: acc)
    in if validCount index then go (xs, index, []) else SubsetResult.Err InvalidIndex end
  val at = fn (xs, index) =>
    SubsetResult.andThen (splitAt (xs, index), fn (prefix, rest) =>
      case rest of [] => SubsetResult.Err OutOfBounds | x :: tail => SubsetResult.Ok x)
  val take = fn (xs, count) => SubsetResult.map (splitAt (xs, count), fn (prefix, rest) => prefix)
  val drop = fn (xs, count) => SubsetResult.map (splitAt (xs, count), fn (prefix, rest) => rest)
  val tabulate = fn (count, f) =>
    let
      val rec go = fn (index, acc) =>
        if index >= count then SubsetResult.Ok (reverse acc)
        else go (index + 1, f index :: acc)
    in if validCount count then go (0, []) else SubsetResult.Err InvalidCount end

  val head = fn [] => SubsetResult.Err EmptyList | x :: xs => SubsetResult.Ok x
  val tail = fn [] => SubsetResult.Err EmptyList | x :: xs => SubsetResult.Ok xs
  val rec last = fn
      [] => SubsetResult.Err EmptyList
    | [x] => SubsetResult.Ok x
    | x :: rest => last rest

  (* Invoke callbacks left to right, stopping at the first Err. *)
  val traverse = fn (xs, f) =>
    let
      val rec go = fn
          ([], acc) => SubsetResult.Ok (reverse acc)
        | (x :: rest, acc) =>
            case f x of
              SubsetResult.Err error => SubsetResult.Err error
            | SubsetResult.Ok y => go (rest, y :: acc)
    in go (xs, []) end

end
