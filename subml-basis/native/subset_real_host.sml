(* Shared SML Basis adapter for the real primitives; full SML, not Basis source. *)
structure SubsetRealHost = struct
  val rem = Real.rem
  val fromInt = Real.fromInt
  (* The caller has checked that the value is integral and within the int range. *)
  val toInt = Real.trunc

  (* JavaScript's Number#toString over the shortest round-trip digits: value = 0.d1...dk * 10^n. *)
  fun toString value =
    if Real.isNan value then "NaN"
    else if Real.isFinite value then
      let
        val {sign, digits, exp = n, ...} = Real.toDecimal value
        val k = length digits
        val text = String.concat (map Int.toString digits)
        fun zeros count = CharVector.tabulate (count, fn _ => #"0")
        fun exponent e = (if e < 0 then "-" ^ Int.toString (~e) else "+" ^ Int.toString e)
        val body =
          if k = 0 then "0"
          else if k <= n andalso n <= 21 then text ^ zeros (n - k)
          else if 0 < n andalso n <= 21 then String.substring (text, 0, n) ^ "." ^ String.extract (text, n, NONE)
          else if ~6 < n andalso n <= 0 then "0." ^ zeros (~n) ^ text
          else if k = 1 then text ^ "e" ^ exponent (n - 1)
          else String.substring (text, 0, 1) ^ "." ^ String.extract (text, 1, NONE) ^ "e" ^ exponent (n - 1)
      in if sign andalso k > 0 then "-" ^ body else body end
    else if value > 0.0 then "Infinity" else "-Infinity"
end
