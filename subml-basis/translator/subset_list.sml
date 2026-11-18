(* @subsetml
from "./subset_numeric.sml" import * as SubsetNumeric;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./subset_result.sml" import * as SubsetResult;
*)

(* Custom Basis lists. No host library calls, references or exceptions.
   Adapted from the existing portable SmlList algorithms; callbacks take data first. *)
structure SubsetList = struct
  local
    open SubsetOptionValue
  in

  datatype error = EmptyList | InvalidCount | InvalidIndex | OutOfBounds

  val isEmpty = fn [] => true | x :: xs => false

  val rec reverseAppend = fn (xs, ys) =>
    case xs of [] => ys | x :: rest => reverseAppend (rest, x :: ys)
  val reverse = fn xs => reverseAppend (xs, [])
  val append = fn (xs, ys) => reverseAppend (reverse xs, ys)

  val rec foldLeft = fn (xs, initial, f) =>
    case xs of [] => initial | x :: rest => foldLeft (rest, f (x, initial), f)
  val foldRight = fn (xs, initial, f) => foldLeft (reverse xs, initial, f)

  val sumWith = fn (xs, math : 'a SubsetNumeric.arithmetic) =>
    foldLeft (xs, #zero math, fn (value, total) => #add math (total, value))
  val productWith = fn (xs, math : 'a SubsetNumeric.arithmetic) =>
    foldLeft (xs, #one math, fn (value, total) => #mul math (total, value))
  val concat = fn lists =>
    reverse (foldLeft (lists, [], fn (xs, acc) => reverseAppend (xs, acc)))

  (* State is independent of list indices. NONE is ordinary end-of-input. *)
  val unfold = fn (initial, step) =>
    let
      val rec go = fn (state, acc) =>
        case step state of
          NONE => reverse acc
        | SOME (value, next) => go (next, value :: acc)
    in go (initial, []) end

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

  val lengthWith = fn (xs, zero, next) => foldLeft (xs, zero, fn (x, count) => next count)
  val length32 = fn xs => lengthWith (xs, 0, fn count => count + 1)
  val rec dropWhile = fn (xs, predicate) =>
    case xs of [] => [] | x :: rest => if predicate x then dropWhile (rest, predicate) else xs

  (* Signed integer counts are valid exactly when nonnegative. *)
  val validCount32 = fn (count : int) => count >= 0

  (* Traversal cores receive arithmetic from their sized wrappers. *)
  val repeatWith = fn (value, count, done, previous) =>
    let val rec go = fn (remaining, acc) =>
      if done remaining then acc else go (previous remaining, value :: acc)
    in go (count, []) end
  val repeat32 = fn (value, count) =>
    if validCount32 count then SubsetResult.Ok (repeatWith (value, count, fn n => n <= 0, fn n => n - 1))
    else SubsetResult.Err InvalidCount

  val splitAtWith = fn (xs, index, done, previous) =>
    let val rec go = fn (rest, remaining, acc) =>
      if done remaining then SubsetResult.Ok (reverse acc, rest)
      else case rest of [] => SubsetResult.Err OutOfBounds
        | x :: tail => go (tail, previous remaining, x :: acc)
    in go (xs, index, []) end
  val splitAt32 = fn (xs, index) =>
    if validCount32 index then splitAtWith (xs, index, fn n => n <= 0, fn n => n - 1)
    else SubsetResult.Err InvalidIndex
  val at32 = fn (xs, index) =>
    SubsetResult.andThen (splitAt32 (xs, index), fn (prefix, rest) =>
      case rest of [] => SubsetResult.Err OutOfBounds | x :: tail => SubsetResult.Ok x)
  val take32 = fn (xs, count) => SubsetResult.map (splitAt32 (xs, count), fn (prefix, rest) => prefix)
  val drop32 = fn (xs, count) => SubsetResult.map (splitAt32 (xs, count), fn (prefix, rest) => rest)
  val tabulateWith = fn (zero, next, done, f) =>
    let val rec go = fn (index, acc) =>
      if done index then reverse acc else go (next index, f index :: acc)
    in go (zero, []) end
  val tabulate32 = fn (count, f) =>
    if validCount32 count then SubsetResult.Ok (tabulateWith (0, fn n => n + 1, fn n => n >= count, f))
    else SubsetResult.Err InvalidCount

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
end
