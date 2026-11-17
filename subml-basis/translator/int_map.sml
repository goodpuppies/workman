(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./subset_natural.sml" import * as SubsetNatural;
*)

(* Persistent binary trie over nonnegative signed integers. Each child stores
   the remaining key bits, so insertion never constructs a 2^31 scale. *)
structure IntMap = struct
  open SubsetOptionValue

  datatype 'a map = Empty | Leaf of int * 'a | Branch of 'a map * 'a map
  val empty = Empty
  val rec find = fn (tree, key) => case tree of
      Empty => NONE
    | Leaf (stored, value) => if stored = key then SOME value else NONE
    | Branch (left, right) => find (if key mod 2 = 0 then left else right, key div 2)
  val rec insert = fn (tree, key, value) => case tree of
      Empty => Leaf (key, value)
    | Leaf (stored, old) => if stored = key then Leaf (key, value)
        else insert (insert (Branch (Empty, Empty), stored, old), key, value)
    | Branch (left, right) =>
        if key mod 2 = 0 then Branch (insert (left, key div 2, value), right)
        else Branch (left, insert (right, key div 2, value))
end
