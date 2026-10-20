(* Unix target adapter shared by MLton and MLWorks. Authored WM sees Result.
 * The shared byte/file adapter is loaded first. Commands use POSIX shell
 * quoting for each argv item, closed stdin and separate bounded captures.
 * This trusted-local prototype does not provide an OS process sandbox. *)
structure PakmanHost = struct
  open SubsetHost
  fun envOr (name, fallback) = case OS.Process.getEnv name of
      SOME value => value | NONE => fallback
  fun checked value = path value
  fun quote value = "'" ^ String.translate
    (fn #"'" => "'\\''" | c => String.str c) (checked value) ^ "'"

  (* Permission and I/O failures must not look absent. *)
  fun kind name =
    SubsetResult.Ok
      (if OS.FileSys.isLink (path name) then "link"
       else if OS.FileSys.isDir name then "dir"
       else if OS.Process.isSuccess (OS.Process.system ("test -f " ^ quote name))
       then "file" else "other")
    handle OS.SysErr (message, SOME code) =>
      if OS.errorName code = "ENOENT" orelse OS.errorName code = "noent"
      then SubsetResult.Ok "missing"
      else SubsetResult.Err ("kind: " ^ message)
      | error => SubsetResult.Err ("kind: " ^ General.exnMessage error)

  fun freshDirectory parent =
    let
      val token = OS.FileSys.tmpName ()
      val leaf = OS.Path.file token
      val () = (OS.FileSys.remove token handle _ => ())
      fun attempt n =
        if n = 1024 then raise Fail "cannot allocate a fresh directory"
        else let
          val directory = path parent ^ "/pakman-" ^ leaf ^ "-" ^ Int.toString n
        in (OS.FileSys.mkDir directory;
            if OS.Process.isSuccess (OS.Process.system ("chmod 700 " ^ quote directory))
            then directory
            else (OS.FileSys.rmDir directory; raise Fail "cannot make private directory"))
          handle OS.SysErr (message, SOME code) =>
            if OS.errorName code = "EEXIST" orelse OS.errorName code = "exist"
            then attempt (n + 1) else raise OS.SysErr (message, SOME code)
        end
    in attempt 0 end
  fun tempDir parent = protect "tempDir" (fn () => freshDirectory parent)

  fun readCapture name =
    let
      val input = BinIO.openIn name
      val bytes = BinIO.inputN (input, 65537)
        handle error => (closeQuietly BinIO.closeIn input; raise error)
      val () = BinIO.closeIn input
    in if Word8Vector.length bytes > 65536
       then raise Fail "process capture exceeds 64 KiB"
       else Byte.bytesToString bytes end

  fun runCapture (program, args, cwd) = protect "runCapture" (fn () =>
    let
      (* Validate before allocating a capture directory or starting a child. *)
      val command = String.concat (List.map (fn arg => quote arg ^ " ") (program :: args))
      val directoryArg = quote cwd
      val () = if program = "" then raise Fail "empty executable" else ()
      val directory = freshDirectory (envOr ("TMPDIR", "/tmp"))
      val stdout = directory ^ "/stdout"
      val stderr = directory ^ "/stderr"
      fun cleanup () = (
        (OS.FileSys.remove stdout handle _ => ());
        (OS.FileSys.remove stderr handle _ => ());
        (OS.FileSys.rmDir directory handle _ => ()))
      fun execute () =
        let
          val status = OS.Process.system
            ("exec </dev/null >" ^ quote stdout ^ " 2>" ^ quote stderr ^
             "; cd " ^ directoryArg ^ " && exec " ^ command)
          val output = readCapture stdout
          val errors = readCapture stderr
          val code = case Unix.fromStatus status of
              Unix.W_EXITED => 0
            | Unix.W_EXITSTATUS value => Word8.toInt value
            | Unix.W_SIGNALED _ => raise Fail ("child signaled: " ^ errors)
            | Unix.W_STOPPED _ => raise Fail ("child stopped: " ^ errors)
        in (OS.Process.isSuccess status, Int.toString code, output, errors) end
      val result = execute () handle error => (cleanup (); raise error)
      val () = cleanup ()
    in result end)

  fun requireSuccess (program, args) =
    case runCapture (program, args, "/") of
        SubsetResult.Err message => raise Fail message
      | SubsetResult.Ok (true, _, output, _) => output
      | SubsetResult.Ok (false, code, _, errors) =>
          raise Fail (program ^ " exited " ^ code ^ ": " ^ errors)
  fun sha256File name = protect "sha256File" (fn () =>
    let
      val absolute = OS.FileSys.fullPath (path name)
      val output = requireSuccess ("sha256sum", [absolute])
      val digest = String.substring (output, 0, 64)
      val () = if List.all Char.isHexDigit (String.explode digest)
               then () else raise Fail "invalid sha256sum output"
    in digest end)
  fun setExecutable name = protect "setExecutable" (fn () =>
    ignore (requireSuccess ("chmod", ["755", OS.FileSys.fullPath (path name)])))
  (* Images can be several MiB. Do not materialize a whole image twice in the
   * manager's heap while copying it on a machine with 27 MiB RAM. *)
  fun copyFile (source, destination) = protect "copyFile" (fn () =>
    let
      val input = BinIO.openIn (path source)
      val output = BinIO.openOut (path destination)
        handle error => (closeQuietly BinIO.closeIn input; raise error)
      fun loop () = let val bytes = BinIO.inputN (input, 65536)
        in if Word8Vector.length bytes = 0 then ()
           else (BinIO.output (output, bytes); loop ()) end
      val () = loop () handle error =>
        (closeQuietly BinIO.closeIn input;
         closeQuietly BinIO.closeOut output; raise error)
      val () = BinIO.closeIn input
        handle error => (closeQuietly BinIO.closeOut output; raise error)
    in BinIO.closeOut output end)
end
