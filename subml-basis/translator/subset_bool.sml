(* Boolean operations as ordinary first-class library values. *)
structure SubsetBool = struct
  val not = fn value => if value then false else true
end
