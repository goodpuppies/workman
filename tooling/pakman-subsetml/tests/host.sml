fun check (name, true) = print ("PASS " ^ name ^ "\n")
  | check (name, false) = raise Fail name
fun ok (SubsetResult.Ok value) = value
  | ok (SubsetResult.Err message) = raise Fail message
fun failed (SubsetResult.Err _) = true | failed _ = false
val literal = "a ' quote; $(touch INJECTION); `touch INJECTION2`\nlast"
val (success, code, output, errors) = ok (PakmanHost.runCapture
  ("/bin/sh", ["-c", "printf '%s' \"$1\"; printf problem >&2; exit 7", "sh", literal], "/tmp"))
val _ = check ("literal argv, separate captures and exit code",
  not success andalso code = "7" andalso output = literal andalso errors = "problem")
val (success, code, _, _) = ok (PakmanHost.runCapture ("/bin/sh", ["-c", "exit 255"], "/"))
val _ = check ("full exit-code range", not success andalso code = "255")
val _ = check ("NUL argument rejected", failed (PakmanHost.runCapture
  ("/bin/echo", ["bad\000suffix"], "/")))
val _ = check ("signaled process reported", failed (PakmanHost.runCapture
  ("/bin/sh", ["-c", "kill -TERM $$"], "/")))
val _ = check ("bounded captures", failed (PakmanHost.runCapture
  ("/bin/sh", ["-c", "head -c 65537 /dev/zero"], "/")))
val _ = check ("missing executable fails", let
  val (success, _, _, _) = ok (PakmanHost.runCapture
    ("/pakman-nonexistent-executable", [], "/")) in not success end)
val _ = check ("missing path classified", ok (PakmanHost.kind "/pakman-nonexistent-file") = "missing")
val _ = print "PAKMAN_HOST_OK\n"
