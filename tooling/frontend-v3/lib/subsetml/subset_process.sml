(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_host.sml" import * as SubsetHost;
from "./subset_io.sml" import * as SubsetIo;
from "./subset_list.sml" import * as SubsetList;
*)

(* Process arguments are host byte strings; exit accepts success/failure only. *)
structure SubsetProcess = struct
  val arguments = fn () =>
    SubsetResult.andThen (
      SubsetResult.mapError (SubsetHost.arguments (), fn message => SubsetIo.HostError message),
      fn values => SubsetList.traverse (values, fn value =>
        SubsetResult.map (SubsetIo.bytes value, fn bytes => value)))
  (* Exit never returns, including in the portable type system. *)
  val exit = fn success =>
    let
      val () = SubsetHost.exit success
      val rec unreachable = fn () => unreachable ()
    in unreachable () end

  (* Invariant failure: report the byte-string message and a newline, then stop.
     A failed validation/write must still terminate; panic cannot recover through Result. *)
  val panic = fn (message : string) =>
    case SubsetResult.andThen (SubsetIo.bytes message, fn bytes =>
      SubsetIo.writeStderr (SubsetList.append (bytes, [#"\n"]))) of
      SubsetResult.Ok () => exit false
    | SubsetResult.Err _ => exit false
end
