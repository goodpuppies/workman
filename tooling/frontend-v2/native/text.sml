(* Native implementation of host/text.wm, for MLton. Full SML, not SubsetML. An SML string holds
   UTF-8 bytes, so offsets count bytes; they agree with the JS build's UTF-16 code units for
   ASCII text. native/text.wm is the checker interface. *)
structure FrontendText = struct
  (* JS gives NaN past the end; the parser maps every negative or NaN code to -1. *)
  val charCodeAt = fn (text, offset) =>
    if offset >= 0.0 andalso offset < Real.fromInt (String.size text)
    then Real.fromInt (Char.ord (String.sub (text, Real.trunc offset)))
    else ~1.0

  (* String.prototype.slice for the offsets the parser passes: non-negative, clamped to the
     text, and an empty range gives "". *)
  val slice = fn (text, start, finish) =>
    let
      val size = String.size text
      val clamp = fn x => if x < 0.0 then 0 else if x > Real.fromInt size then size else Real.trunc x
      val first = clamp start
      val last = clamp finish
    in
      if last <= first then "" else String.substring (text, first, last - first)
    end

  val textLength = fn text => Real.fromInt (String.size text)
end
