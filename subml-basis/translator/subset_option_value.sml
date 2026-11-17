(* Optional values are an ordinary source datatype, independent of Result.
   Kept separate from SubsetOption helpers to avoid a Result/Option import cycle. *)
structure SubsetOptionValue = struct
  datatype 'a option = NONE | SOME of 'a
end
