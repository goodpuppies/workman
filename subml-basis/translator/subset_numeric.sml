(* Arithmetic dictionaries are ordinary values, independent of a host numeric representation.
   Operations retain the supplied domain's overflow and rounding behavior. *)
structure SubsetNumeric = struct
  type 'a arithmetic = {
    zero : 'a,
    one : 'a,
    add : 'a * 'a -> 'a,
    mul : 'a * 'a -> 'a
  }
end
