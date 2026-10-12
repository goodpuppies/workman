(* Native MLton adapter for the sole text-extraction primitive; full SML, not Basis source. *)
structure SubsetTextHost = struct
  val codes = fn value => List.map (fn c => Real.fromInt (Char.ord c)) (String.explode value)
end
