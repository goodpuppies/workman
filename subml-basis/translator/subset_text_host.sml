(* Shared SML Basis adapter for the native-text primitives; full SML, not Basis source. *)
structure SubsetTextHost = struct
  val codes = fn value => List.map (fn c => Int32.fromInt (Char.ord c)) (String.explode value)
  val charCode = fn c => Int32.fromInt (Char.ord c)
  val codeChar = fn code => Char.chr (Int32.toInt code)
  val fromCodes = fn codes => String.implode (List.map (fn code => Char.chr (Int32.toInt code)) codes)
  val encodeUtf8 = fn value => value
  val decodeUtf8 = fn bytes => bytes
end
