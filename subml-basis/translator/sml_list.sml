(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
*)

(* Portable list algorithms for the custom SubsetML Basis.
   Current signatures follow their SML origins; API migration is pending (docs/basis.md).
   This module needs no host List functions or numeric primitives. *)
structure SmlList = struct
  open SubsetOptionValue

  val null = fn [] => true | x :: xs => false

  val rec revAppend = fn (xs, ys) =>
    case xs of [] => ys | x :: rest => revAppend (rest, x :: ys)

  val rev = fn xs => revAppend (xs, [])

  val rec foldl = fn f => fn acc => fn xs =>
    case xs of [] => acc | x :: rest => foldl f (f (x, acc)) rest

  val foldr = fn f => fn acc => fn xs => foldl f acc (rev xs)

  val concat = fn lists =>
    rev (foldl (fn (xs, acc) => revAppend (xs, acc)) [] lists)

  val rec app = fn f => fn xs =>
    case xs of
      [] => ()
    | x :: rest => let val () = f x in app f rest end

  val map = fn f => fn xs =>
    rev (foldl (fn (x, acc) => f x :: acc) [] xs)

  val mapPartial = fn f => fn xs =>
    rev (foldl (fn (x, acc) => case f x of NONE => acc | SOME y => y :: acc) [] xs)

  val rec find = fn p => fn xs =>
    case xs of [] => NONE | x :: rest => if p x then SOME x else find p rest

  val filter = fn p => fn xs =>
    rev (foldl (fn (x, acc) => if p x then x :: acc else acc) [] xs)

  val partition = fn p => fn xs =>
    let
      val (yes, no) = foldl (fn (x, (yes, no)) =>
        if p x then (x :: yes, no) else (yes, x :: no)) ([], []) xs
    in (rev yes, rev no) end

  val rec exists = fn p => fn xs =>
    case xs of [] => false | x :: rest => p x orelse exists p rest

  val rec all = fn p => fn xs =>
    case xs of [] => true | x :: rest => p x andalso all p rest

end
