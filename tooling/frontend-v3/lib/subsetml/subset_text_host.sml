(* The sole native-text primitive. Checker/roundtrip stub; native SML adapter is lib/subset_text_host.sml.
   The Workman target adapter
   lives in lib/subset_text_host.wm. The portable wrapper validates its output. *)
structure SubsetTextHost = struct
  val codes = fn value => List.map Num.Char.ord (String.explode value)
end
