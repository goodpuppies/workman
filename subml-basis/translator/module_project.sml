(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./module_imports.sml" import * as ModuleImports;
from "./subset_io.sml" import * as SubsetIo;
from "./subset_list.sml" import * as SubsetList;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_string.sml" import * as SubsetString;
from "./subset_result.sml" import * as SubsetResult;
from "./translate.sml" import * as Translate;
from "./env.sml" import * as Env;
from "./elab.sml" import * as Elab;
from "./unify.sml" import * as Unify;
*)

(* Entry-file loading with explicit imports, canonical identity and private working scope. *)
structure ModuleProject = struct
  open SubsetOptionValue

  (* The canonical key is constructed only at the resolver boundary. *)
  datatype moduleId = ModuleId of string
  datatype resolved = Resolved of moduleId * string
  datatype source = Source of string * string * Syntax.topdec list * Syntax.comment list
  datatype edge = Edge of ModuleImports.dependency * moduleId
  datatype node = Node of moduleId * string * source * edge list
  datatype graph = Graph of moduleId * node list
  datatype 'e error =
      LoadFailure of 'e
    | ResolutionFailure of string * SubsetIo.error
    | ImportFailure of string * string * string * Syntax.pos
    | CheckFailure of string * string * string * Syntax.pos

  val same = fn (ModuleId left, ModuleId right) => left = right
  val location = fn Resolved (_, path) => path
  val find = fn (id, nodes) => SubsetList.find (nodes, fn Node (key, _, _, _) => same (id, key))

  val dirname = fn path =>
    CompilerText.stringOf (SubsetList.reverse (SubsetList.dropWhile
      (SubsetList.reverse (CompilerText.characters path), fn c => c <> #"/")))

  (* Like Workman's URL resolution, remove dot segments before following symlinks. *)
  val normalize = fn path =>
    let
      val pieces = CompilerText.fields (path, fn c => c = #"/")
      val arcs = SubsetList.foldLeft (pieces, [], fn (piece, acc) =>
        case piece of
          "" => acc
        | "." => acc
        | ".." => (case acc of [] => [] | _ :: rest => rest)
        | _ => piece :: acc)
    in "/" ^ SubsetString.concatWith (SubsetList.reverse arcs, "/") end

  val identify = fn path =>
    SubsetResult.andThen (SubsetIo.canonicalPath path, fn canonical =>
      if CompilerText.firstIs (canonical, fn c => c = #"/") then SubsetResult.Ok (Resolved (ModuleId canonical, canonical))
      else SubsetResult.Err (SubsetIo.HostError "the initial source resolver supports POSIX filesystem paths only"))

  val resolve = fn (referrer, specifier) => identify (normalize (dirname (location referrer) ^ specifier))

  val firstPosition = fn (prog, src) =>
    case prog of
      [] => CompilerText.size src
    | Syntax.TopExp (pos, _) :: _ => pos
    | Syntax.TopDecs declarations :: _ =>
        (case declarations of
           Syntax.SStructure (pos, _) :: _ => pos
         | Syntax.SDec dec :: _ =>
             (case dec of Syntax.DVal (pos, _, _, _) => pos | Syntax.DType (pos, _) => pos
              | Syntax.DDatatype (pos, _) => pos | Syntax.DOpen (pos, _) => pos
              | Syntax.DLocal (pos, _, _) => pos)
         | [] => CompilerText.size src)

  val cycle = fn (active, repeated) =>
    let
      val Resolved (repeatedId, _) = repeated
      val ordered = SubsetList.dropWhile (SubsetList.reverse active,
        fn Resolved (id, _) => SubsetBool.not (same (id, repeatedId)))
    in
      "import cycle: " ^ SubsetString.concatWith
        (SubsetList.map (SubsetList.append (ordered, [repeated]), location), " -> ")
    end

  (* The injected loader returns source or its own typed read/lex/parse error. *)
  val discover = fn (entry, load) =>
    let
      val rec visit = fn (resolved, display, active, completed) =>
        let val Resolved (id, physical) = resolved in
        case find (id, completed) of
          SOME _ => SubsetResult.Ok completed
        | NONE =>
            SubsetResult.andThen (SubsetResult.mapErr (load display, LoadFailure), fn source =>
              let val Source (path, src, prog, comments) = source in
                case ModuleImports.parse (firstPosition (prog, src), comments) of
                  ModuleImports.Error (message, pos) => SubsetResult.Err (ImportFailure (path, src, message, pos))
                | ModuleImports.Imports imports =>
                    let
                      val rec walk = fn (imports, completed, edges) =>
                        case imports of
                          [] => SubsetResult.Ok (Node (id, physical, source, SubsetList.reverse edges) :: completed)
                        | ModuleImports.Import (specifier, name, pos) :: rest =>
                            (case resolve (resolved, specifier) of
                               SubsetResult.Err error => SubsetResult.Err (ImportFailure (path, src,
                                 "cannot resolve import \"" ^ specifier ^ "\": " ^ SubsetIo.errorText error, pos))
                             | SubsetResult.Ok child =>
                               let val Resolved (target, targetPath) = child in
                                 if SubsetList.exists (resolved :: active, fn Resolved (key, _) => same (key, target)) then
                                   SubsetResult.Err (ImportFailure (path, src, cycle (resolved :: active, child), pos))
                                 else SubsetResult.andThen
                                   (visit (child, targetPath, resolved :: active, completed), fn checked =>
                                     case find (target, checked) of
                                       NONE => SubsetResult.Err (ImportFailure (path, src, "internal error: dependency not loaded", pos))
                                     | SOME (Node (_, _, Source (_, _, childProg, _), _)) =>
                                         if Translate.structureOf childProg = [name] then
                                           walk (rest, checked, Edge (ModuleImports.Import (specifier, name, pos), target) :: edges)
                                         else SubsetResult.Err (ImportFailure (path, src,
                                           "import name " ^ name ^ " must match the dependency's declared structure", pos)))
                               end)
                    in walk (imports, completed, []) end
              end)
        end
    in
      SubsetResult.andThen (SubsetResult.mapErr (identify entry, fn error => ResolutionFailure (entry, error)), fn root =>
        let val Resolved (rootId, _) = root in
          SubsetResult.map (visit (root, entry, [], []), fn completed => Graph (rootId, SubsetList.reverse completed))
        end)
    end

  val check = fn (Graph (_, nodes), basis) =>
    let
      val rec loop = fn (nodes, cache, st) =>
        case nodes of
          [] => SubsetResult.Ok ()
        | Node (id, _, Source (path, src, prog, _), edges) :: rest =>
            let
              val rec working = fn (edges, env) =>
                case edges of
                  [] => SubsetResult.Ok env
                | Edge (ModuleImports.Import (_, name, pos), target) :: rest =>
                    (case SubsetList.find (cache, fn (key, _) => same (key, target)) of
                       NONE => SubsetResult.Err (CheckFailure (path, src, "internal error: dependency not checked", pos))
                     | SOME entry =>
                         let
                           val (_, exports) = entry
                           val Env.Env (_, topTypes, topValues) = exports
                         in
                           if SubsetBool.not (SubsetList.isEmpty topTypes andalso SubsetList.isEmpty topValues) then
                             SubsetResult.Err (CheckFailure (path, src,
                               "namespace imports do not yet support named top-level declarations outside the dependency's structure", pos))
                           else case Env.structureAt (exports, [name]) of
                             NONE => SubsetResult.Err (CheckFailure (path, src, "imported structure is missing", pos))
                           | SOME payload =>
                               let val (body, _) = payload in
                                 working (rest, Env.plus (env, Env.withStructure (name, body, false)))
                               end
                         end)
            in
              case working (edges, basis) of
                SubsetResult.Err error => SubsetResult.Err error
              | SubsetResult.Ok env =>
                  case Elab.programExports (env, prog, st) of
                    Unify.Err (message, pos) => SubsetResult.Err (CheckFailure (path, src, message, pos))
                  | Unify.Ok (exports, next) => loop (rest, (id, exports) :: cache, next)
            end
    in loop (nodes, [], Unify.initial) end
end
