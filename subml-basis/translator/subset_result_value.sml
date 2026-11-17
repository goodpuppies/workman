(* Results are an ordinary source datatype, independent of Option and the helper modules. *)
structure SubsetResultValue = struct
  datatype ('a, 'e) result = Ok of 'a | Err of 'e
end
