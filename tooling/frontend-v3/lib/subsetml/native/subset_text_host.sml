(* Shared SML Basis adapter for native-text extraction; full SML, not Basis source. *)
structure SubsetTextHost = struct
  val codes = fn value => List.map (fn c => Int32.fromInt (Char.ord c)) (String.explode value)
end
