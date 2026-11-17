(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_result.sml" import * as SubsetResult;
from "./module_project.sml" import * as ModuleProject;
from "./subset_io.sml" import * as SubsetIo;
from "./native_int.sml" import * as NativeInt;
from "./unify.sml" import * as Unify;
from "./subset_list.sml" import * as SubsetList;
from "./sml_list.sml" import * as SmlList;
*)

(* SML source-list targets. Build descriptions and native adapters are distinct
   from portable source semantics; the complete plan precedes all file writes. *)
structure SmlTarget = struct
  open SubsetOptionValue

  val quote = fn text => "\"" ^ CompilerText.escapeSmlString text ^ "\""
  val error = fn text => SubsetResult.Err text
  val identify = fn path => SubsetResult.mapErr (ModuleProject.identify path,
    fn failure => path ^ ": " ^ SubsetIo.errorText failure)
  val read = fn path => SubsetResult.mapErr (
    SubsetResult.map (SubsetIo.readFile path, CompilerText.stringOf),
    fn failure => path ^ ": " ^ SubsetIo.errorText failure)
  val rec traverse = fn (items, f) => case items of
      [] => SubsetResult.Ok []
    | item :: rest => SubsetResult.andThen (f item, fn value =>
        SubsetResult.map (traverse (rest, f), fn values => value :: values))

  val emit = fn (target, specifications, files) =>
    if target <> "mlton" andalso target <> "mlworks" then error ("unknown SML target: " ^ target)
    else case NativeInt.project files of
      Unify.Err (message, _) => error message
    | Unify.Ok ((prelude, outputs), _) =>
      let
        val rec select = fn (remaining, identities, selected) => case remaining of
            [] => SubsetResult.Ok selected
          | (checker, native) :: rest => SubsetResult.andThen (identify checker,
              fn ModuleProject.Resolved (id, _) =>
                if SubsetList.exists (selected, fn (key, _) => ModuleProject.same (key, id))
                then error ("duplicate native adapter: " ^ checker)
                else (if SubsetBool.not (SubsetList.exists (identities, fn (_, key) => ModuleProject.same (key, id)))
                then error ("native adapter checker is not in the source list: " ^ checker)
                else SubsetResult.andThen (read native, fn text => select (rest, identities, (id, text) :: selected))))
        val names = SmlList.map (fn (path, _) => NativeInt.basename path) outputs
        val reserved = SubsetList.find (names, fn name => SubsetList.exists
          (["prelude.sml", "project.mlb", "bootstrap.sml", "load.sml"], fn reserved => name = reserved))
      in case reserved of SOME name => error ("reserved SML target output filename: " ^ name)
        | NONE => SubsetResult.andThen (traverse (outputs, fn (path, _) =>
            SubsetResult.map (identify path, fn ModuleProject.Resolved (id, _) => (path, id))), fn identities =>
          SubsetResult.andThen (select (specifications, identities, []), fn selected =>
            let
              val adapted = SmlList.map (fn (path, text) =>
                let val chosen = case SubsetList.find (identities, fn (source, _) => source = path) of
                      NONE => NONE
                    | SOME (_, id) => SubsetList.find (selected, fn (key, _) => ModuleProject.same (key, id))
                in (NativeInt.basename path, case chosen of NONE => text | SOME (_, native) => native) end) outputs
              val ordered = "prelude.sml" :: names
              val build = if target = "mlton" then
                [("project.mlb", "$(SML_LIB)/basis/basis.mlb\n" ^
                  SubsetList.foldLeft (ordered, "", fn (name, text) => text ^ quote name ^ "\n"))]
                else [("bootstrap.sml", "(* Load once from the MLWorks target-objects directory. *)\nShell.Project.load \"require_all\";\n"),
                  ("load.sml", "(* Full SML startup adapter; call SubsetTarget.load with application arguments. *)\n" ^
                    "structure SubsetTarget = struct\n" ^
                    "  val arguments = ref ([] : string list)\n" ^
                    "  fun load values = (arguments := values; List.app use [" ^
                    SubsetList.foldLeft (ordered, "", fn (name, text) =>
                      text ^ (if text = "" then "" else ", ") ^ quote name) ^ "])\nend;\n" ^
                    "structure CommandLine = struct\n  val name = CommandLine.name\n" ^
                    "  fun arguments () = !SubsetTarget.arguments\nend;\n")]
            in SubsetResult.Ok (("prelude.sml", prelude) :: SubsetList.append (adapted, build)) end))
      end
end
