(* MLton adapter for host/js/debug.wm; full SML. *)
structure WmDebugHost = struct
  val message = "Result.debug: Err (the error has no portable display)"
  val errorMessage = fn _ => message
  val abort = fn _ => (TextIO.output (TextIO.stdErr, message ^ "\n"); OS.Process.exit OS.Process.failure)
end
