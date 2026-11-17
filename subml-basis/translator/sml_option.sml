(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
*)

(* Portable option algorithms for the custom SubsetML Basis.
   Current SML-shaped signatures are transitional; checked APIs will use Result. *)
structure SmlOption = struct
  open SubsetOptionValue

  val getOpt = fn (opt, fallback) => case opt of NONE => fallback | SOME x => x
  val isSome = fn NONE => false | SOME _ => true
  val map = fn f => fn opt => case opt of NONE => NONE | SOME x => SOME (f x)
  val mapPartial = fn f => fn opt => case opt of NONE => NONE | SOME x => f x
  val join = fn NONE => NONE | SOME opt => opt
  val filter = fn p => fn x => if p x then SOME x else NONE
  val compose = fn (f, g) => fn x => map f (g x)
  val composePartial = fn (f, g) => fn x => mapPartial f (g x)

end
