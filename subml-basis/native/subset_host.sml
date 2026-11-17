(* MLton adapter: binary contents, byte paths, checked OS failures. *)
structure SubsetHost = struct
  fun protect f = SubsetResult.Ok (f ())
    handle error => SubsetResult.Err (General.exnMessage error)
  fun canonicalPath path = protect (fn () => OS.FileSys.fullPath path)
  fun readFile path = protect (fn () =>
    let
      val input = BinIO.openIn path
      val data = (BinIO.inputAll input handle error => (BinIO.closeIn input; raise error))
      val () = BinIO.closeIn input
    in Byte.bytesToString data end)
  fun writeFile (data, path) = protect (fn () =>
    let
      val output = BinIO.openOut path
      val () = (BinIO.output (output, Byte.stringToBytes data)
        handle error => (BinIO.closeOut output; raise error))
    in BinIO.closeOut output end)
  val stdout = Posix.FileSys.stdout
  val stderr = Posix.FileSys.stderr
  fun writeAll (fd, text) =
    let
      val data = Byte.stringToBytes text
      val size = Word8Vector.length data
      fun go offset = if offset = size then () else
        let val count = Posix.IO.writeVec (fd, Word8VectorSlice.slice (data, offset, NONE))
        in if count = 0 then raise Fail "zero-length host write" else go (offset + count) end
    in go 0 end
  fun writeStdout data = protect (fn () => writeAll (stdout, data))
  fun writeStderr data = protect (fn () => writeAll (stderr, data))
  fun arguments () = protect CommandLine.arguments
  fun withoutNul value =
    if List.exists (fn c => c = #"\000") (String.explode value)
    then raise Fail "NUL in command" else value
  (* An exit code, not OS.Process.status: MLton's system returns a raw wait status, which its own
     exit rejects, so the code has to be recovered here to survive the trip from system to exit. *)
  fun exitCode status = case Unix.fromStatus status of
      Unix.W_EXITED => 0
    | Unix.W_EXITSTATUS code => Word8.toInt code
    | Unix.W_SIGNALED _ => 1
    | Unix.W_STOPPED _ => 1
  fun system command = protect (fn () => exitCode (OS.Process.system (withoutNul command)))
  fun getEnv name = case OS.Process.getEnv name of
      Option.NONE => SubsetOptionValue.NONE
    | Option.SOME value => SubsetOptionValue.SOME value
  fun exit status : unit =
    if status = 0 then OS.Process.exit OS.Process.success
    else if status = 1 then OS.Process.exit OS.Process.failure
    else Unix.exit (Word8.fromInt status)
  fun terminate status : unit =
    if status = 0 then OS.Process.terminate OS.Process.success
    else if status = 1 then OS.Process.terminate OS.Process.failure
    else Unix.exit (Word8.fromInt status)
end
