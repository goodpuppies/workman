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
  fun exit success : unit = OS.Process.exit (if success then OS.Process.success else OS.Process.failure)
end
