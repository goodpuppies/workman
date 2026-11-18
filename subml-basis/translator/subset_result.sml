(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./subset_result_value.sml" import * as SubsetResultValue;
from "./subset_monad.sml" import * as SubsetMonad;
*)

(* Custom Basis Result. Core operations take data first; procedure adapters are curried.
   Errors are ordinary datatype values. *)
structure SubsetResult = struct
  open SubsetResultValue

  local
    open SubsetOptionValue
  in
  val map = fn (value, f) =>
    case value of Ok x => Ok (f x) | Err error => Err error

  val mapErr = fn (value, f) =>
    case value of Ok x => Ok x | Err error => Err (f error)

  val andThen = fn (value, f) =>
    case value of Ok x => f x | Err error => Err error

  (* Procedure adapters are curried so a stage can be named before it is called. *)
  val via = fn transform => fn wrapped => andThen (wrapped, transform)

  val viaErr = fn inject => fn transform => fn wrapped =>
    andThen (wrapped, fn value => mapErr (transform value, inject))

  val getOr = fn (value, fallback) =>
    case value of Ok x => x | Err error => fallback

  val isOk = fn Ok x => true | Err error => false

  val isErr = fn Ok x => false | Err error => true

  val toOption = fn Ok x => SOME x | Err error => NONE

  val succeed = fn value => Ok value

  val map2 = fn (left, right, f) =>
    case (left, right) of
      (Ok l, Ok r) => Ok (f (l, r))
    | (Err error, _) => Err error
    | (_, Err error) => Err error

  (* Direct tail recursion is portable to SML and compiles to a loop on JS. *)
  val rec loop = fn (state, advance) => case advance state of
      Err error => Err error
    | Ok (SubsetMonad.Stop output) => Ok output
    | Ok (SubsetMonad.Continue next) => loop (next, advance)

  (* Result's carrier record, the value a bare `Result` stands for in Workman value position, a
     `SubsetMonad.carrier`. *)
  val carrier : (
      'a -> ('b, 'e) result, ('a, 'e) result -> ('b, 'e) result,
      'f -> 'g, ('c -> ('d, 'f) result) -> ('c, 'g) result -> ('d, 'g) result,
      'h, ('h, 'i) result,
      ('j, 'k) result, 'j -> 'l, ('l, 'k) result,
      ('m, 'n) result, ('o, 'n) result, 'm * 'o -> 'p, ('p, 'n) result,
      ('q, 'r) result, 'q -> ('s, 'r) result, ('s, 'r) result,
      ('t, 'u) result, 'u -> 'v, ('t, 'v) result,
      'state * ('state -> (('state, 'output) SubsetMonad.step, 'loopError) result) -> ('output, 'loopError) result) SubsetMonad.carrier = {
    via = via, viaErr = viaErr, succeed = succeed, map = map, map2 = map2,
    andThen = andThen, mapErr = mapErr, loop = loop
  }
  end

end
