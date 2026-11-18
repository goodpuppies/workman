(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_string.sml" import * as SubsetString;
from "./subset_list.sml" import * as SubsetList;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_bool.sml" import * as SubsetBool;
*)

(* Workman's module scope: the library module an import path names, the namespace each library
   module opens as, and the names every module has in scope without an import.

   This is the one statement of these rules. Workman's compiler imports the WM that `make wm`
   generates from this file (through wm-mini's src/module_scope.wm). SubsetML's WM reader uses
   these rules to resolve library imports and default bindings. Change the rules here.

   Paths are library paths as Workman's compiler names them: `std/list.wm`,
   `subml-basis/subset_list.wm`, `host/js/table.wm`. An import path or library path that is not
   a byte string names no library module. *)
structure WmModuleScope = struct
  open SubsetOptionValue

  (* A library module an import path names, and how to describe it in errors. *)
  type libraryImport = {path : string, description : string}

  (* A name in every module's scope: `name` binds `sourceName` of the library module
     `modulePath`. *)
  type pervasive = {modulePath : string, name : string, sourceName : string}

  val bytes = fn text => case SubsetString.fromNative text of
      SubsetResult.Ok cs => SOME cs
    | SubsetResult.Err _ => NONE

  (* Every list here came from bytes, so it converts back. *)
  val text = fn cs => case SubsetString.toNative cs of
      SubsetResult.Ok value => value
    | SubsetResult.Err _ => ""

  val rec stripPrefix = fn (cs, prefix) => case (cs, prefix) of
      (rest, []) => SOME rest
    | (c :: rest, p :: more) => if c = p then stripPrefix (rest, more) else NONE
    | ([], _ :: _) => NONE

  val stripSuffix = fn (cs, suffix) =>
    case stripPrefix (SubsetList.reverse cs, SubsetList.reverse suffix) of
      SOME rest => SOME (SubsetList.reverse rest)
    | NONE => NONE

  val chars = fn literal => case bytes literal of SOME cs => cs | NONE => []

  (* `prefix` + NAME + `.wm`, where NAME is a lower-case letter then lower-case letters, digits
     and underscores: NAME. *)
  val moduleFile = fn (cs, prefix) =>
    case stripPrefix (cs, chars prefix) of
      NONE => NONE
    | SOME rest => (case stripSuffix (rest, chars ".wm") of
        SOME (first :: more) =>
          if SubsetChar.isLower first andalso
             SubsetList.all (more, fn c => SubsetChar.isLower c orelse SubsetChar.isDigit c orelse c = #"_")
          then SOME (text (first :: more)) else NONE
      | _ => NONE)

  val quoted = fn value =>
    "\"" ^ text (SubsetList.foldRight (chars value, [], fn (c, acc) =>
      if c = #"\"" orelse c = #"\\" then #"\\" :: c :: acc else c :: acc)) ^ "\""

  (* The prefix of a `js.host("name")` import path, which names `host/js/name.wm`. *)
  val jsHostImportPrefix = "js.host:"

  (* A host helper's path. Unlike an ordinary module file name, a host name is opaque: the
     JavaScript boundary can pass native Unicode strings here without byte classification. *)
  val jsHostModulePath = fn name => "host/js/" ^ name ^ ".wm"

  (* The library module an import path names, or NONE for a file import. A local folder of the
     same name is imported with an explicit relative path (`"./basis/..."`).

     - `js.host("table")` (path `js.host:table`) names the host helper `host/js/table.wm`.
     - `"host/c/x.wm"` names `host/c/x.wm`; `"std/x.wm"` names `std/x.wm`.
     - `"pakman/x.wm"` names `tooling/pakman/api/x.wm`; `"testman/x.wm"` names
       `tooling/testman/x.wm`.
     - `"basis/x.wm"` names the SubsetML Basis module `subml-basis/subset_x.wm`. *)
  val libraryImport = fn specifier =>
    case bytes specifier of
      NONE => NONE
    | SOME cs =>
        let
          val named = fn (prefix, path, kind) => case moduleFile (cs, prefix) of
              SOME file => SOME {path = path file, description = kind ^ " " ^ quoted specifier}
            | NONE => NONE
          val first = fn candidates => SubsetList.foldLeft (candidates, NONE, fn (candidate, found) =>
            case found of SOME _ => found | NONE => candidate ())
        in
          case stripPrefix (cs, chars jsHostImportPrefix) of
            SOME host =>
              SOME {path = jsHostModulePath (text host),
                    description = "host module js.host(" ^ quoted (text host) ^ ")"}
          | NONE => first [
              fn () => named ("host/c/", fn file => "host/c/" ^ file ^ ".wm", "C host module"),
              fn () => named ("std/", fn file => "std/" ^ file ^ ".wm", "library module"),
              fn () => named ("pakman/", fn file => "tooling/pakman/api/" ^ file ^ ".wm", "pakman module"),
              fn () => named ("testman/", fn file => "tooling/testman/" ^ file ^ ".wm", "testman module"),
              fn () => named ("basis/", fn file => "subml-basis/subset_" ^ file ^ ".wm", "Basis module")]
        end

  (* Basis modules that implement other Basis modules for a host, not a public interface. *)
  val internalBasisModules = ["host", "text_host", "real_host"]

  (* `subml-basis/subset_x.wm`: x, for any word x. *)
  val basisModuleName = fn path =>
    case bytes path of
      NONE => NONE
    | SOME cs => (case stripPrefix (cs, chars "subml-basis/subset_") of
        NONE => NONE
      | SOME rest => (case stripSuffix (rest, chars ".wm") of
          SOME (first :: more) =>
            if SubsetList.all (first :: more, fn c => SubsetChar.isAlphaNum c orelse c = #"_")
            then SOME (text (first :: more)) else NONE
        | _ => NONE))

  val publicBasisModuleName = fn path => case basisModuleName path of
      SOME name => if SubsetList.exists (internalBasisModules, fn n => n = name) then NONE else SOME name
    | NONE => NONE

  (* The file name of a path without its directories and its `.wm` extension. *)
  val baseName = fn cs =>
    let val file = SubsetList.foldLeft (cs, [], fn (c, acc) => if c = #"/" then [] else c :: acc)
        val file = SubsetList.reverse file
    in case stripSuffix (file, chars ".wm") of SOME stem => stem | NONE => file end

  (* snake_case to PascalCase: `word8_vector` is `Word8Vector`. *)
  val pascal = fn cs =>
    let val rec go = fn (cs, start, acc) => case cs of
        [] => SubsetList.reverse acc
      | #"_" :: rest => go (rest, true, acc)
      | c :: rest => go (rest, false, (if start then SubsetChar.toUpper c else c) :: acc)
    in text (go (cs, true, [])) end

  (* The namespace a library module opens as, from its snake_case file name: `std/list.wm` is
     `List`, `std/word8_vector.wm` is `Word8Vector`, and the Basis module
     `subml-basis/subset_string_cvt.wm` is `StringCvt` (`subset_os.wm` is SML's `OS`). *)
  val moduleAlias = fn path =>
    case publicBasisModuleName path of
      SOME "os" => "OS"
    | SOME name => pascal (chars name)
    | NONE => pascal (case bytes path of SOME cs => baseName cs | NONE => [])

  (* `std/` modules and the public Basis modules are opened as namespaces in every program. A
     Basis module that a std module of the same name extends is opened through that std module
     instead (wm-mini markdown/basis-authority-plan.md). The Basis's host adapters and the host
     helper modules (`host/js/`) are never opened implicitly. `libraryPaths` are the library's
     module paths. *)
  val isAutoOpened = fn (path, libraryPaths) =>
    case bytes path of
      NONE => false
    | SOME cs => (case stripPrefix (cs, chars "std/") of
        SOME _ => true
      | NONE => (case publicBasisModuleName path of
          SOME name => SubsetBool.not (SubsetList.exists (libraryPaths, fn p => p = "std/" ^ name ^ ".wm"))
        | NONE => false))

  (* The auto-opened library module that opens as namespace `name`. *)
  val namespaceModule = fn (name, libraryPaths) =>
    SubsetList.find (libraryPaths, fn path => isAutoOpened (path, libraryPaths) andalso moduleAlias path = name)

  (* Compatibility for a bare --basis directory without an inventory. A candidate still has
     to pass the forward namespace rule; arbitrary uppercase spellings are not module aliases. *)
  val basisNamespaceCandidate = fn name =>
    let
      val rec snake = fn (cs, previous, acc) => case cs of
          [] => SubsetList.reverse acc
        | c :: rest =>
            let val separated = SubsetChar.isUpper c andalso
                  (SubsetChar.isLower previous orelse SubsetChar.isDigit previous)
            in snake (rest, c, if separated then SubsetChar.toLower c :: #"_" :: acc
                              else SubsetChar.toLower c :: acc) end
      val path = "subml-basis/subset_" ^ text (snake (chars name, #"_", [])) ^ ".wm"
    in namespaceModule (name, [path]) end

  (* Library modules a program loads only when it imports one of them (`"pakman/…"`,
     `"testman/…"`, `"host/c/…"`), so other programs don't pay for them. *)
  val isLoadedOnDemand = fn path =>
    case bytes path of
      NONE => false
    | SOME cs => SubsetList.exists (["tooling/pakman/api/", "tooling/testman/", "host/c/"],
        fn prefix => case stripPrefix (cs, chars prefix) of SOME _ => true | NONE => false)

  val namesOf = fn (modulePath, names) =>
    SubsetList.map (names, fn name => {modulePath = modulePath, name = name, sourceName = name})
  val renamed = fn (modulePath, name, sourceName) =>
    {modulePath = modulePath, name = name, sourceName = sourceName}

  (* The kernel's source-owned datatypes. The compiler installs these identities separately
     from the ordinary pervasive projections; the reader must use their defining modules too. *)
  val builtinValues = SubsetList.concat [
    namesOf ("subml-basis/subset_option_value.wm", ["Some", "None"]),
    namesOf ("subml-basis/subset_result_value.wm", ["Ok", "Err"])]
  val builtinTypes = SubsetList.concat [
    namesOf ("subml-basis/subset_option_value.wm", ["Option"]),
    namesOf ("subml-basis/subset_result_value.wm", ["Result"])]

  (* The compiler's own unqualified types (wm-mini src/basis_manifest.ts, BASIS_TYPES). A bare
     name in type position is a namespace's `Self` only after ordinary type lookup fails
     (wm-mini docs/modules.md), so `(name: String)` is the type String, never the String
     namespace. *)
  val primitiveTypeNames =
    ["Bool", "CStorage", "Char", "List", "Opaque", "Option", "Ptr", "Result", "String", "Task", "Void"]

  (* Unqualified library values in every module. Portable operations belong to the SubsetML
     Basis; std contributes only its extra facilities. *)
  val pervasives = SubsetList.concat [
    namesOf ("std/list.wm", ["length"]),
    namesOf ("subml-basis/subset_list.wm", ["length32"]),
    namesOf ("subml-basis/subset_list.wm",
      ["map", "filter", "forEach", "foldLeft", "foldRight", "head", "tail", "isEmpty",
       "reverse", "concat"]),
    namesOf ("subml-basis/subset_option.wm", ["getOr", "isSome", "toResult"]),
    namesOf ("subml-basis/subset_bool.wm", ["not"]),
    namesOf ("subml-basis/subset_order.wm", ["Less", "Equal", "Greater"]),
    [renamed ("subml-basis/subset_char.wm", "chr", "fromCode"),
     renamed ("subml-basis/subset_char.wm", "ord", "toCode"),
     renamed ("subml-basis/subset_string.wm", "explode", "fromNative"),
     renamed ("subml-basis/subset_string.wm", "implode", "toNative")],
    namesOf ("std/string.wm", ["size"]),
    namesOf ("subml-basis/subset_string.wm", ["size32", "str"]),
    namesOf ("std/general.wm", ["before", "ignore", "o"]),
    namesOf ("std/real64.wm", ["ceil", "floor", "round", "trunc"]),
    [renamed ("std/vector.wm", "vector", "fromList")],
    namesOf ("std/string.wm", ["toList"])]

  (* Unqualified library types in every module. The carrier records are here so a
     `.{ succeed, map, … }` literal finds them by its fields without an import. *)
  val pervasiveTypes = SubsetList.concat [
    namesOf ("subml-basis/subset_order.wm", ["Order"]),
    namesOf ("subml-basis/subset_monad.wm", ["Carrier", "Applicative"])]
end
