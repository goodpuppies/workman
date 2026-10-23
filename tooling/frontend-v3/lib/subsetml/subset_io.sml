(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_string.sml" import * as SubsetString;
from "./subset_list.sml" import * as SubsetList;
from "./subset_host.sml" import * as SubsetHost;
*)

(* Whole-file byte I/O. Conversion and validation are ordinary source algorithms. *)
structure SubsetIo = struct
  datatype error = HostError of string | NonByte of int | InvalidPath
  val bytes = fn value =>
    SubsetResult.mapError (SubsetString.fromNative value,
      fn SubsetString.NonByte offset => NonByte offset)
  val native = fn value =>
    SubsetResult.mapError (SubsetString.toNative value,
      fn SubsetString.NonByte offset => NonByte offset)
  val host = fn result => SubsetResult.mapError (result, fn message => HostError message)

  (* Paths are byte strings interpreted by the host; NUL cannot name a file. *)
  val path = fn value =>
    SubsetResult.andThen (bytes value, fn codes =>
      if SubsetList.exists (codes, fn c => c = #"\000") then SubsetResult.Err InvalidPath
      else SubsetResult.Ok value)
  val readFile = fn file =>
    SubsetResult.andThen (path file, fn valid =>
      SubsetResult.andThen (host (SubsetHost.readFile valid), bytes))
  (* Filesystem identity, not lexical path cleanup. Validate both byte boundaries. *)
  val canonicalPath = fn file =>
    SubsetResult.andThen (path file, fn valid =>
      SubsetResult.andThen (host (SubsetHost.canonicalPath valid), fn resolved =>
        SubsetResult.map (bytes resolved, fn _ => resolved)))
  val writeFile = fn (data, file) =>
    SubsetResult.andThen (path file, fn valid =>
      SubsetResult.andThen (native data, fn text => host (SubsetHost.writeFile (text, valid))))
  val writeStdout = fn data =>
    SubsetResult.andThen (native data, fn text => host (SubsetHost.writeStdout text))
  val writeStderr = fn data =>
    SubsetResult.andThen (native data, fn text => host (SubsetHost.writeStderr text))
  val errorText = fn
      HostError message => message
    | NonByte offset => "non-byte I/O value"
    | InvalidPath => "a file path cannot contain NUL"
end
