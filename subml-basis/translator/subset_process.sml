(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_host.sml" import * as SubsetHost;
from "./subset_io.sml" import * as SubsetIo;
from "./subset_list.sml" import * as SubsetList;
*)

(* OS.Process with data-first arguments and Result instead of exceptions. Process arguments,
   commands and environment values are host byte strings. atExit needs host state and sleep needs
   a Time type, so neither is here yet. *)
structure SubsetProcess = struct
  (* An exit code. Abstract in the SML Basis, but exit codes are worth being able to use: a status
     from system keeps its code when passed to exit, and a program can choose its own. *)
  datatype status = Status of int
  val success = Status 0
  val failure = Status 1
  val isSuccess = fn Status code => code = 0

  val arguments = fn () =>
    SubsetResult.andThen (
      SubsetResult.mapErr (SubsetHost.arguments (), fn message => SubsetIo.HostError message),
      fn values => SubsetList.traverse (values, fn value =>
        SubsetResult.map (SubsetIo.bytes value, fn bytes => value)))
  (* Runs the command through the host's shell, with this process's standard streams. *)
  val system = fn command =>
    SubsetResult.andThen (SubsetIo.bytes command, fn bytes =>
      SubsetResult.map (
        SubsetResult.mapErr (SubsetHost.system command, fn message => SubsetIo.HostError message),
        fn code => Status code))
  val getEnv = fn name => SubsetHost.getEnv name

  (* Exit never returns, including in the portable type system. *)
  val exit = fn status =>
    let
      val Status code = status
      val () = SubsetHost.exit code
      val rec unreachable = fn () => unreachable ()
    in unreachable () end
  (* Without atExit actions there is nothing for terminate to skip beyond the host's own cleanup. *)
  val terminate = fn status =>
    let
      val Status code = status
      val () = SubsetHost.terminate code
      val rec unreachable = fn () => unreachable ()
    in unreachable () end

  (* Invariant failure: report the byte-string message and a newline, then stop.
     A failed validation/write must still terminate; panic cannot recover through Result. *)
  val panic = fn (message : string) =>
    case SubsetResult.andThen (SubsetIo.bytes message, fn bytes =>
      SubsetIo.writeStderr (SubsetList.append (bytes, [#"\n"]))) of
      SubsetResult.Ok () => exit failure
    | SubsetResult.Err _ => exit failure
end
