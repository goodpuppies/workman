(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./module_project.sml" import * as ModuleProject;
from "./syntax.sml" import * as Syntax;
from "./wm_lexer.sml" import * as WmLexer;
from "./subset_result.sml" import * as SubsetResult;
from "./compiler_text.sml" import * as CompilerText;
from "./module_imports.sml" import * as ModuleImports;
from "./subset_list.sml" import * as SubsetList;
from "./subset_io.sml" import * as SubsetIo;
from "./wm_parse.sml" import * as WmParse;
from "./basis.sml" import * as Basis;
from "./unify.sml" import * as Unify;
from "./env.sml" import * as Env;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_option.sml" import * as SubsetOption;
from "./subset_string.sml" import * as SubsetString;
from "./lexer.sml" import * as Lexer;
from "./wm_module_scope.sml" import * as WmModuleScope;
*)

(* Source-list reverse translation shares the source loader's canonical identities.
   Backend names are chosen separately; they are never filesystem identities. *)
structure WmProject = struct
  open SubsetOptionValue

  datatype input = Input of ModuleProject.resolved * string * string
  datatype projectUnit = Unit of input * string * string
  datatype edge = Edge of string * Syntax.pos * string * ModuleProject.moduleId
  datatype source = Source of projectUnit * edge list * Syntax.structureAlias list * WmLexer.result
  datatype error = Error of string * string * string * Syntax.pos

  val failure = fn (path, src, message, pos) => SubsetResult.Err (Error (path, src, message, pos))
  val identity = fn Unit (Input (ModuleProject.Resolved (id, _), _, _), _, _) => id
  val name = fn Unit (_, name, _) => name
  val output = fn Unit (_, _, output) => output
  val pathOf = fn Unit (Input (_, path, _), _, _) => path
  val textOf = fn Unit (Input (_, _, src), _, _) => src
  val sourceUnit = fn Source (unit, _, _, _) => unit
  val edgesOf = fn Source (_, edges, _, _) => edges

  (* The file that runs the entry's `main`, as Workman's runner does; no module's output takes it. *)
  val mainStem = "project_main"
  val mainFile = mainStem ^ ".sml"

  (* Default aliases are hygienic: their exact spelling never appears in authored tokens.
     Explicit imports and translator form dependencies always retain their effects. *)
  val isDefaultEdge = fn (unit, Edge (_, _, alias, _)) =>
    (CompilerText.size alias >= 13 andalso CompilerText.slice (alias, 0, 13) = "SubsetDefault") andalso
    (case WmLexer.lex (textOf unit) of
      WmLexer.Tokens (tokens, _) => SubsetBool.not (SubsetList.exists (tokens,
        fn (token, _) => token = WmLexer.WName [alias]))
    | _ => false)

  (* "basis/won.wm" names the Basis module subset_won.wm, as in Workman. *)
  val basisModule = fn specifier =>
    case WmModuleScope.libraryImport specifier of
      NONE => NONE
    | SOME {path, description} =>
        SubsetOption.map (WmModuleScope.basisModuleName path,
          fn name => "subset_" ^ name ^ ".wm")

  val validSpecifier = fn specifier =>
    SubsetOption.isSome (WmModuleScope.libraryImport specifier) orelse
    (CompilerText.isSuffix (specifier, ".wm") andalso
     ModuleImports.validPath (CompilerText.slice (specifier, 0, CompilerText.size specifier - 3) ^ ".sml"))

  (* basis is the directory holding the generated Basis modules, if the build supplies one. *)
  val resolve = fn (basis, referrer, specifier) =>
    case WmModuleScope.libraryImport specifier of
      NONE => ModuleProject.resolve (referrer, specifier)
    | SOME {path, description} => (case basis of
        NONE => SubsetResult.Err (SubsetIo.HostError "basis/ imports need --basis DIR")
      | SOME directory => (case WmModuleScope.basisModuleName path of
          SOME name => ModuleProject.identify (directory ^ "/subset_" ^ name ^ ".wm")
        | NONE => ModuleProject.identify (directory ^ "/" ^ path)))

  val librarySpecifier = fn path => case WmModuleScope.basisModuleName path of
      SOME name => "basis/" ^ name ^ ".wm"
    | NONE => path

  val libraryFile = fn (directory, path) => case basisModule (librarySpecifier path) of
      SOME file => directory ^ "/" ^ file
    | NONE => directory ^ "/" ^ path

  val canonical = fn path => case ModuleProject.identify path of
      SubsetResult.Ok (ModuleProject.Resolved (_, canonical)) => SOME canonical
    | SubsetResult.Err _ => NONE
  val inside = fn (directory, path) => case (canonical directory, canonical path) of
      (SOME directory, SOME file) => CompilerText.size file > CompilerText.size directory + 1 andalso
        CompilerText.slice (file, 0, CompilerText.size directory + 1) = directory ^ "/"
    | _ => false
  val librarySource = fn (directory, path) => inside (directory, path) andalso
    SubsetBool.not (inside (directory ^ "/std", path))

  (* The driver supplies an inventory of staged library modules. Older --basis callers can
     still use their flat Basis directory; candidates are verified by the shared scope rules. *)
  val libraryPaths = fn (directory, tokens) =>
    let
      val candidates = SubsetList.concat (SubsetList.map (tokens, fn (token, _) => case token of
        WmLexer.WName (head :: _) => (case WmModuleScope.basisNamespaceCandidate head of
          SOME path => [path] | NONE => []) | _ => []))
      val bindings = SubsetList.concat [WmModuleScope.builtinValues, WmModuleScope.builtinTypes,
        WmModuleScope.pervasives, WmModuleScope.pervasiveTypes]
      val paths = case SubsetIo.readFile (directory ^ "/module-scope.paths") of
          SubsetResult.Ok bytes => CompilerText.fields (CompilerText.stringOf bytes, fn c => c = #"\n")
        | SubsetResult.Err _ => SubsetList.append (candidates,
            SubsetList.map (bindings, fn {modulePath, name, sourceName} => modulePath))
      val paths = SubsetList.foldLeft (paths, [], fn (path, found) =>
        if SubsetList.exists (found, fn p => p = path) then found else path :: found)
    in SubsetList.filter (paths, fn path =>
      case canonical (libraryFile (directory, path)) of SOME _ => true | NONE => false) end

  val implicitBasis = fn (basis, path, tokens) => case basis of
      NONE => tokens
    | SOME directory => if librarySource (directory, path) then tokens else
        let
          val paths = libraryPaths (directory, tokens)
          val std = inside (directory ^ "/std", path)
          val singleton = fn name => SubsetList.exists (tokens, fn (token, _) =>
            token = WmLexer.WName [name])
          val mentioned = fn name => SubsetList.exists (tokens, fn (token, _) => case token of
            WmLexer.WName (head :: _) => head = name | _ => false)
          (* A namespace use. Tokens don't tell types from expressions, so this over-approximates,
             except for a bare type name the compiler owns (`String`, `List`): that names the
             type wherever a type may stand, and the namespace only as a carrier, in `via X` or a
             group `X|a, b|`. *)
          (* `Int32.Int`, `Int32.div`: paths the parser reads as SML builtins use no module. *)
          val builtinPath = fn path => case path of
              [head, last] =>
                let val (typeQualifiers, _) = WmParse.tyConName ([head], last)
                    val (valueQualifiers, _) = WmParse.valueName ([head], last)
                in SubsetList.isEmpty typeQualifiers orelse SubsetList.isEmpty valueQualifiers end
            | _ => false
          val rec namespaceUse = fn (name, tokens) => case tokens of
              [] => false
            | (WmLexer.WName (head :: second :: more), _) :: rest =>
                (head = name andalso SubsetBool.not (builtinPath (head :: second :: more))) orelse namespaceUse (name, rest)
            | (WmLexer.WName ["via"], _) :: (WmLexer.WName [head], _) :: rest =>
                head = name orelse namespaceUse (name, rest)
            | (WmLexer.WName [head], _) :: (WmLexer.WKey "|", _) :: rest =>
                head = name orelse namespaceUse (name, rest)
            (* A bare name between argument delimiters is a value, the carrier in
               `Monad.map(x, Result, f)`; as a type argument it would be followed by `<` or `>`. *)
            | (WmLexer.WKey opening, _) :: (WmLexer.WName [head], _) :: (WmLexer.WKey closing, p) :: rest =>
                (head = name andalso (opening = "(" orelse opening = ",") andalso (closing = ")" orelse closing = ","))
                orelse namespaceUse (name, (WmLexer.WName [head], 0) :: (WmLexer.WKey closing, p) :: rest)
            | (WmLexer.WName [head], _) :: rest =>
                (head = name andalso SubsetBool.not (SubsetList.exists (WmModuleScope.primitiveTypeNames,
                  fn n => n = name))) orelse namespaceUse (name, rest)
            | _ :: rest => namespaceUse (name, rest)
          val builtin = SubsetList.append (WmModuleScope.builtinValues, WmModuleScope.builtinTypes)
          val projected = if std then builtin else SubsetList.concat [builtin,
            WmModuleScope.pervasives, WmModuleScope.pervasiveTypes]
          val needed = SubsetList.map (SubsetList.filter (projected,
              fn {modulePath, name, sourceName} => singleton name orelse
                SubsetList.exists (WmModuleScope.pervasiveTypes, fn binding => binding =
                  {modulePath = modulePath, name = name, sourceName = sourceName})),
            fn {modulePath, name, sourceName} => modulePath)
          val namespaces = if std then [] else SubsetList.filter (paths, fn modulePath =>
            WmModuleScope.isAutoOpened (modulePath, paths) andalso
            namespaceUse (WmModuleScope.moduleAlias modulePath, tokens))
          val needed = SubsetList.foldLeft (SubsetList.append (needed, namespaces), [], fn (p, acc) =>
            if SubsetList.exists (acc, fn n => n = p) orelse
               SubsetBool.not (SubsetList.exists (paths, fn n => n = p)) then acc else p :: acc)
          val rec fresh = fn name => if mentioned name then fresh (name ^ "_") else name
          val header = fn (specifier, alias) =>
            [(WmLexer.WKey "from", 0), (WmLexer.WScon (Syntax.SString specifier), 0),
             (WmLexer.WKey "import", 0), (WmLexer.WKey "*", 0), (WmLexer.WKey "as", 0),
             (WmLexer.WName [alias], 0), (WmLexer.WKey ";", 0)]
          val defaults = SubsetList.concat (SubsetList.map (needed, fn p =>
            header (librarySpecifier p, fresh ("SubsetDefault" ^ WmParse.structureName p))))
          (* These are translation dependencies, rather than source default bindings. *)
          val formImport = fn (file, alias, forms) =>
            if SubsetList.exists (tokens, fn (token, _) => SubsetList.exists (forms, fn form => form = token)) andalso
               (case canonical (directory ^ "/subset_" ^ file ^ ".wm") of SOME _ => true | NONE => false)
            then header ("basis/" ^ file ^ ".wm", fresh alias) else []
          val print = WmLexer.WName ["print"]
          val text = WmLexer.WKey "`("
          val forms = SubsetList.concat [
            formImport ("bool", "SubsetBool", [WmLexer.WKey "!", WmLexer.WKey "!=", print]),
            formImport ("int32", "SubsetInt32", [WmLexer.WKey "%", text, print]),
            formImport ("real64", "SubsetReal64", [WmLexer.WKey "%", WmLexer.WKey "==", WmLexer.WKey "!=", text, print]),
            formImport ("string", "SubsetString", [text, print]),
            formImport ("io", "SubsetIo", [print]),
            formImport ("list", "SubsetList", [text, print]),
            formImport ("option_value", "SubsetOptionValue", [text, print]),
            formImport ("result_value", "SubsetResultValue", [text, print])]
        in SubsetList.concat [defaults, forms, tokens] end

  (* Bindings point at the canonical module allocated by the project planner. They are applied
     after parsing, where lexical declarations and patterns can shadow them correctly. *)
  val defaultScope = fn (basis, units, unit) => case basis of
      NONE => ([], [], [])
    | SOME directory => if librarySource (directory, pathOf unit) then ([], [], []) else
        let
          val tokens = case WmLexer.lex (textOf unit) of WmLexer.Tokens (ts, _) => ts | _ => []
          val paths = libraryPaths (directory, tokens)
          val std = inside (directory ^ "/std", pathOf unit)
          val target = fn path => case ModuleProject.identify (libraryFile (directory, path)) of
              SubsetResult.Err _ => NONE
            | SubsetResult.Ok (ModuleProject.Resolved (id, _)) =>
                SubsetOption.map (SubsetList.find (units, fn u => ModuleProject.same (id, identity u)), name)
          val bindings = fn (items, typeNames) => SubsetList.concat (SubsetList.map (items,
            fn {modulePath, name, sourceName} => case target modulePath of
              NONE => []
            | SOME moduleName =>
                let val translate = if typeNames then WmParse.tyConName else WmParse.valueName
                    val (_, source) = translate ([], name)
                in [(source, translate ([moduleName], sourceName))] end))
          val values = bindings (if std then WmModuleScope.builtinValues else
            SubsetList.append (WmModuleScope.builtinValues, WmModuleScope.pervasives), false)
          val types = bindings (if std then WmModuleScope.builtinTypes else
            SubsetList.append (WmModuleScope.builtinTypes, WmModuleScope.pervasiveTypes), true)
          val namespaces = if std then [] else SubsetList.concat (SubsetList.map (paths, fn p =>
            if WmModuleScope.isAutoOpened (p, paths)
            then (case target p of SOME target => [(WmModuleScope.moduleAlias p, target)] | NONE => [])
            else []))
        in (values, types, namespaces) end

  (* Discovery reads only the supported import header. Preparation still validates aliases,
     private scope and later imports using the same canonical identities. *)
  val headerPaths = fn (path, src, tokens) =>
    let val rec scan = fn tokens => case tokens of
        (WmLexer.WKey "from", pos) :: (WmLexer.WScon (Syntax.SString specifier), _) ::
        (WmLexer.WKey "import", _) :: (WmLexer.WKey "*", _) :: rest =>
          let val remaining = case rest of
                (WmLexer.WKey "as", _) :: (WmLexer.WName [_], _) :: (WmLexer.WKey ";", _) :: tail => SOME tail
              | (WmLexer.WKey ";", _) :: tail => SOME tail | _ => NONE
          in case remaining of
            NONE => failure (path, src, "reverse discovery requires header namespace imports", pos)
          | SOME tail => if SubsetBool.not (validSpecifier specifier) then
              failure (path, src, "imports require explicit relative .wm paths or basis/ modules in the local source profile", pos)
            else SubsetResult.map (scan tail, fn paths => (specifier, pos) :: paths) end
      | (WmLexer.WKey "from", pos) :: (WmLexer.WScon (Syntax.SString specifier), _) ::
        (WmLexer.WKey "import", _) :: (WmLexer.WKey "{", _) :: rest =>
          let val rec close = fn tokens => case tokens of
              (WmLexer.WKey "}", _) :: (WmLexer.WKey ";", _) :: tail => SOME tail
            | (WmLexer.WKey "}", _) :: _ => NONE
            | [] => NONE
            | _ :: tail => close tail
          in case close rest of
            NONE => failure (path, src, "unterminated `import { ... }`", pos)
          | SOME tail => if SubsetBool.not (validSpecifier specifier) then
              failure (path, src, "imports require explicit relative .wm paths or basis/ modules in the local source profile", pos)
            else SubsetResult.map (scan tail, fn paths => (specifier, pos) :: paths) end
      | (WmLexer.WKey "from", pos) :: (WmLexer.WName ("js" :: _), _) :: _ =>
          failure (path, src, "JavaScript imports (`from js...`) have no SML translation", pos)
      | (WmLexer.WKey "from", pos) :: _ =>
          failure (path, src, "reverse discovery requires header namespace imports", pos)
      | (WmLexer.WName ["export"], _) :: (WmLexer.WKey "from", pos) :: rest =>
          scan ((WmLexer.WKey "from", pos) :: rest)
      | _ => SubsetResult.Ok []
    in scan tokens end

  val discover = fn (basis, roots) =>
    let
      val rec visit = fn (resolved, active, seen) =>
        let val ModuleProject.Resolved (id, path) = resolved in
          if SubsetList.exists (seen, fn (key, _, _) => ModuleProject.same (key, id)) then SubsetResult.Ok seen
          else SubsetResult.andThen (SubsetResult.mapErr (SubsetIo.readFile path,
            fn error => Error (path, "", SubsetIo.errorText error, 0)), fn bytes =>
            let val src = CompilerText.stringOf bytes in
              case WmLexer.lex src of
                WmLexer.LexError (message, pos) => failure (path, src, message, pos)
              | WmLexer.Tokens (tokens, _) =>
                  SubsetResult.andThen (headerPaths (path, src, implicitBasis (basis, path, tokens)), fn paths =>
                    let val rec walk = fn (paths, seen) => case paths of
                        [] => SubsetResult.Ok seen
                      | (specifier, pos) :: rest =>
                          (case resolve (basis, resolved, specifier) of
                            SubsetResult.Err error => failure (path, src,
                              "cannot resolve import \"" ^ specifier ^ "\": " ^ SubsetIo.errorText error, pos)
                          | SubsetResult.Ok child =>
                              let val ModuleProject.Resolved (target, _) = child in
                                if SubsetList.exists (resolved :: active, fn ModuleProject.Resolved (key, _) =>
                                  ModuleProject.same (key, target)) then
                                  failure (path, src, ModuleProject.cycle (resolved :: active, child), pos)
                                else SubsetResult.andThen (visit (child, resolved :: active, seen),
                                  fn seen => walk (rest, seen)) end)
                    in walk (paths, (id, path, src) :: seen) end)
            end)
        end
      val rec loadRoots = fn (roots, seen) => case roots of
          [] => SubsetResult.Ok (SubsetList.map (SubsetList.reverse seen, fn (_, path, src) => (path, src)))
        | path :: rest => (case ModuleProject.identify path of
            SubsetResult.Err error => failure (path, "", SubsetIo.errorText error, 0)
          | SubsetResult.Ok resolved => SubsetResult.andThen (visit (resolved, [], seen),
              fn seen => loadRoots (rest, seen)))
    in loadRoots (roots, []) end

  val plan = fn sources =>
    let
      val rec identify = fn (sources, inputs) =>
        case sources of
          [] => SubsetResult.Ok (SubsetList.reverse inputs)
        | (path, src) :: rest =>
            (case ModuleProject.identify path of
               SubsetResult.Err error => failure (path, src, SubsetIo.errorText error, 0)
             | SubsetResult.Ok resolved =>
                 let val ModuleProject.Resolved (id, _) = resolved in
                   if SubsetList.exists (inputs, fn Input (ModuleProject.Resolved (key, _), _, _) => ModuleProject.same (key, id))
                   then identify (rest, inputs)
                   else identify (rest, Input (resolved, path, src) :: inputs)
                 end)
      val rec allocate = fn (inputs, used, units) =>
        case inputs of
          [] => SubsetList.reverse units
        | input :: rest =>
            let
              val Input (_, path, _) = input
              val stem = if CompilerText.isSuffix (path, ".wm") then
                CompilerText.slice (translateBase path, 0, CompilerText.size (translateBase path) - 3)
                else translateBase path
              val rec choose = fn suffix =>
                let val candidate = stem ^ suffix
                    val structureName = WmParse.structureName (candidate ^ ".wm") in
                  if SubsetList.exists (used, fn (n, f) => n = structureName orelse f = candidate)
                     orelse SubsetList.exists (rest, fn Input (_, path, _) =>
                       WmParse.structureName path = structureName) then choose (suffix ^ "Module")
                  else (structureName, candidate)
                end
              val (structureName, filename) = choose ""
            in allocate (rest, (structureName, filename) :: used, Unit (input, structureName, filename ^ ".sml") :: units) end
      and translateBase = fn path =>
        case SubsetList.reverse (CompilerText.fields (path, fn c => c = #"/")) of
          base :: _ => base | [] => path
    in
      case Basis.initial of
        Unify.Err (message, pos) => failure ("translation", "", message, pos)
      | Unify.Ok (Env.Env (structures, _, _), _) =>
          SubsetResult.map (identify (sources, []), fn inputs =>
            allocate (inputs, ("", mainStem) :: SubsetList.map (structures, fn (name, _) => (name, "")), []))
    end

  (* Inline record types, `Point{ a: Int32 }` in a type, are shorthand for a `record Point`
     declared just before the statement (docs/syntax-guide.md). Each one is hoisted before its
     top-level statement and replaced by `Point` (with its parameters, `Box<T>`). A repeated or
     already declared name is reused. One inside a block is hoisted as `private`, since Workman
     keeps it out of the module's surface. *)
  val hoistInlineRecords = fn tokens =>
    let
      val rec declaredNames = fn ts =>
        case ts of
          (WmLexer.WKey "record", _) :: (WmLexer.WName [name], _) :: rest => name :: declaredNames rest
        | _ :: rest => declaredNames rest
        | [] => []
      (* Type parameters after `<`, up to and including `>`. *)
      val rec angle = fn (ts, acc) =>
        case ts of
          (WmLexer.WKey ">", p) :: rest => SOME (SubsetList.reverse ((WmLexer.WKey ">", p) :: acc), rest)
        | (WmLexer.WName [v], p) :: rest => angle (rest, (WmLexer.WName [v], p) :: acc)
        | (WmLexer.WKey ",", p) :: rest => angle (rest, (WmLexer.WKey ",", p) :: acc)
        | _ => NONE
      (* The tokens before the `}` closing a field list, and the tokens after it. *)
      val rec fieldList = fn (ts, depth, acc) =>
        case ts of
          (WmLexer.WKey "}", p) :: rest =>
            if depth = 0 then SOME (SubsetList.reverse acc, rest)
            else fieldList (rest, depth - 1, (WmLexer.WKey "}", p) :: acc)
        | (WmLexer.WKey "{", p) :: rest => fieldList (rest, depth + 1, (WmLexer.WKey "{", p) :: acc)
        | (WmLexer.WKey ".{", p) :: rest => fieldList (rest, depth + 1, (WmLexer.WKey ".{", p) :: acc)
        | (WmLexer.WEOF, _) :: _ => NONE
        | [] => NONE
        | t :: rest => fieldList (rest, depth, t :: acc)
      (* An empty inline record `Empty{}` is only recognized after `:` or `->`. *)
      val typePosition = fn prev =>
        case prev of SOME (WmLexer.WKey ":") => true | SOME (WmLexer.WKey "->") => true | _ => false
      val inlineRecord = fn (prev, ts) =>
        case ts of
          (WmLexer.WName [name], p) :: rest =>
            if SubsetBool.not (CompilerText.firstIs (name, SubsetChar.isUpper)) then NONE
            else
              let
                val parameters = case rest of
                    (WmLexer.WKey "<", q) :: more =>
                      (case angle (more, []) of
                         SOME (ps, after) => SOME ((WmLexer.WKey "<", q) :: ps, after)
                       | NONE => NONE)
                  | _ => SOME ([], rest)
              in
                case parameters of
                  NONE => NONE
                | SOME (params, after) =>
                    case after of
                      (WmLexer.WKey "{", _) :: (WmLexer.WName [label], lp) :: (WmLexer.WKey ":", cp) :: more =>
                        (case fieldList ((WmLexer.WName [label], lp) :: (WmLexer.WKey ":", cp) :: more, 0, []) of
                           SOME (fields, remaining) => SOME (name, p, params, fields, remaining)
                         | NONE => NONE)
                    | (WmLexer.WKey "{", _) :: (WmLexer.WKey "}", _) :: remaining =>
                        if typePosition prev then SOME (name, p, params, [], remaining) else NONE
                    | _ => NONE
              end
        | _ => NONE
      (* Rewrites one statement: its tokens reversed, the hoisted declarations in order, and the
         names declared so far. *)
      val rec rewrite = fn (ts, prev, braces, out, hoisted, seen) =>
        case ts of
          [] => (out, hoisted, seen)
        | (token, p) :: rest =>
            case inlineRecord (prev, ts) of
              SOME (name, q, params, fields, remaining) =>
                let
                  val (fieldsOut, hoisted, seen) = rewrite (fields, NONE, braces, [], hoisted, seen)
                  val known = SubsetList.exists (seen, fn n => n = name)
                  val declaration = SubsetList.concat [
                    (if braces > 0 then [(WmLexer.WName ["private"], q)] else []),
                    [(WmLexer.WKey "record", q), (WmLexer.WName [name], q)], params,
                    [(WmLexer.WKey "=", q), (WmLexer.WKey "{", q)], SubsetList.reverse fieldsOut,
                    [(WmLexer.WKey "}", q), (WmLexer.WKey ";", q)]]
                  val hoisted = if known then hoisted else SubsetList.append (hoisted, [declaration])
                  val seen = if known then seen else name :: seen
                  val reference = (WmLexer.WName [name], q) :: params
                in
                  rewrite (remaining, SOME (WmLexer.WName [name]), braces,
                           SubsetList.append (SubsetList.reverse reference, out), hoisted, seen)
                end
            | NONE =>
                let
                  val braces = case token of
                      WmLexer.WKey "{" => braces + 1
                    | WmLexer.WKey ".{" => braces + 1
                    | WmLexer.WKey "}" => braces - 1
                    | _ => braces
                in rewrite (rest, SOME token, braces, (token, p) :: out, hoisted, seen) end
      (* Top-level statements end at a `;` outside brackets. *)
      val opens = fn token => case token of
          WmLexer.WKey "{" => true | WmLexer.WKey ".{" => true | WmLexer.WKey "(" => true
        | WmLexer.WKey "[" => true | _ => false
      val closes = fn token => case token of
          WmLexer.WKey "}" => true | WmLexer.WKey ")" => true | WmLexer.WKey "]" => true | _ => false
      val rec statements = fn (ts, depth, current, acc) =>
        case ts of
          [] => SubsetList.reverse (if SubsetList.isEmpty current then acc else SubsetList.reverse current :: acc)
        | (token, p) :: rest =>
            if depth = 0 andalso token = WmLexer.WKey ";" then
              statements (rest, 0, [], SubsetList.reverse ((token, p) :: current) :: acc)
            else
              statements (rest,
                (if opens token then depth + 1 else (if closes token then depth - 1 else depth)),
                (token, p) :: current, acc)
      val (output, _) = SubsetList.foldLeft (statements (tokens, 0, [], []), ([], declaredNames tokens),
        fn (statement, (output, seen)) =>
          let val (out, hoisted, seen) = rewrite (statement, NONE, 0, [], [], seen)
          in (SubsetList.append (output, SubsetList.append (SubsetList.concat hoisted, SubsetList.reverse out)), seen) end)
    in output end

  val prepare = fn (basis, units, unit) =>
    let
      val Unit (Input (resolved, path, src), _, _) = unit
      val (_, _, defaultNamespaces) = defaultScope (basis, units, unit)
      val dependency = fn (specifier, pos) =>
        if SubsetBool.not (validSpecifier specifier) then
          failure (path, src, "imports require explicit relative .wm paths or basis/ modules in the local source profile", pos)
        else case resolve (basis, resolved, specifier) of
          SubsetResult.Err error => failure (path, src, "cannot resolve import \"" ^ specifier ^ "\": " ^ SubsetIo.errorText error, pos)
        | SubsetResult.Ok (ModuleProject.Resolved (target, _)) =>
            case SubsetList.find (units, fn child => ModuleProject.same (identity child, target)) of
              NONE => failure (path, src, "import dependency is not in the supplied source list: " ^ specifier, pos)
            | SOME child => SubsetResult.Ok child
      (* The items of `{ a, B as C, }` after its `{`, as (original, alias, position), and the
         tokens after the closing `};`. *)
      val rec namedItems = fn (tokens, items) =>
        case tokens of
          (WmLexer.WKey "}", _) :: (WmLexer.WKey ";", _) :: rest =>
            SubsetResult.Ok (SubsetList.reverse items, rest)
        | (WmLexer.WName [original], pos) :: (WmLexer.WKey "as", _) :: (WmLexer.WName [alias], _) :: rest =>
            namedItem (rest, (original, alias, pos) :: items)
        | (WmLexer.WName [original], pos) :: rest => namedItem (rest, (original, original, pos) :: items)
        | (_, pos) :: _ => failure (path, src, "expected an imported name in `import { ... }`", pos)
        | [] => failure (path, src, "unterminated `import { ... }`", 0)
      and namedItem = fn (tokens, items) =>
        case tokens of
          (WmLexer.WKey ",", _) :: rest => namedItems (rest, items)
        | _ => namedItems (tokens, items)
      (* Whether an earlier named import already bound this value: `opens` holds the injected
         `let name = X.original;` tokens in reverse. *)
      val rec boundValue = fn (opens, alias) =>
        case opens of
          (WmLexer.WName [n], _) :: (WmLexer.WKey "let", _) :: rest => n = alias orelse boundValue (rest, alias)
        | _ :: rest => boundValue (rest, alias)
        | [] => false
      (* `import *` opens the module. A plain import is private in Workman, so its open is
         marked `private`; `export from` keeps it public. *)
      val rec openAll = fn (specifier, pos, hidden, rest, edges, aliases, named, opens, exported) =>
        SubsetResult.andThen (dependency (specifier, pos), fn child =>
          let
            val marked = if hidden then (WmLexer.WName ["private"], pos) :: opens else opens
            val opened = (WmLexer.WOpen [[name child]], pos) :: marked
            val known = SubsetList.exists (edges, fn Edge (_, _, _, target) =>
              ModuleProject.same (target, identity child))
          in
            if known then imports (rest, edges, aliases, named, opened, exported)
            (* No alias: an open alone doesn't make the module's name usable as a qualifier. *)
            else imports (rest, Edge (specifier, pos, name child, identity child) :: edges, aliases, named, opened, exported)
          end)
      and imports = fn (tokens, edges, aliases, named, opens, exported) =>
        case tokens of
          (WmLexer.WKey "from", pos) ::
          (WmLexer.WScon (Syntax.SString specifier), _) ::
          (WmLexer.WKey "import", _) :: (WmLexer.WKey "*", _) ::
          (WmLexer.WKey "as", _) :: (WmLexer.WName [alias], _) ::
          (WmLexer.WKey ";", _) :: rest =>
            if SubsetBool.not (CompilerText.firstIs (alias, SubsetChar.isUpper)) then
              failure (path, src, "namespace aliases must start with an uppercase letter in the initial translation profile", pos)
            else (if SubsetList.exists (aliases, fn (a, _) => a = alias) then
              failure (path, src, "duplicate namespace alias " ^ alias, pos)
            else SubsetResult.andThen (dependency (specifier, pos), fn child =>
              imports (rest, Edge (specifier, pos, alias, identity child) :: edges,
                (alias, name child) :: aliases, named, opens, exported)))
        | (WmLexer.WKey "from", pos) ::
          (WmLexer.WScon (Syntax.SString specifier), _) ::
          (WmLexer.WKey "import", _) :: (WmLexer.WKey "*", _) ::
          (WmLexer.WKey ";", _) :: rest =>
            openAll (specifier, pos, true, rest, edges, aliases, named, opens, exported)
        (* `open` already adds to the module's public environment, so this needs nothing further. *)
        | (WmLexer.WName ["export"], _) :: (WmLexer.WKey "from", pos) ::
          (WmLexer.WScon (Syntax.SString specifier), _) ::
          (WmLexer.WKey "import", _) :: (WmLexer.WKey "*", _) ::
          (WmLexer.WKey ";", _) :: rest =>
            openAll (specifier, pos, false, rest, edges, aliases, named, opens, exported)
        (* Keep selective exports until parsed module interfaces are available. They become
           ordinary public value/type aliases, rather than opening the dependency's API. *)
        | (WmLexer.WName ["export"], _) :: (WmLexer.WKey "from", pos) ::
          (WmLexer.WScon (Syntax.SString specifier), _) ::
          (WmLexer.WKey "import", _) :: (WmLexer.WKey "{", _) :: rest =>
            SubsetResult.andThen (dependency (specifier, pos), fn child =>
              SubsetResult.andThen (namedItems (rest, []), fn (items, rest) =>
                let
                  val rec add = fn (items, named, encoded) => case items of
                      [] => SubsetResult.Ok (named, SubsetList.reverse encoded)
                    | (original, alias, itemPos) :: more =>
                        if SubsetList.exists (named, fn (n, _) => n = alias) orelse
                           SubsetList.exists (aliases, fn (n, _) => n = alias) orelse boundValue (opens, alias)
                        then failure (path, src, "duplicate imported name " ^ alias, itemPos)
                        else add (more, (alias, []) :: named, alias :: original :: encoded)
                  val known = SubsetList.exists (edges, fn Edge (_, _, _, key) =>
                    ModuleProject.same (key, identity child))
                  val edges = if known then edges else Edge (specifier, pos, name child, identity child) :: edges
                in SubsetResult.andThen (add (items, named, []), fn (named, encoded) =>
                  imports (rest, edges, aliases, named,
                    (WmLexer.WOpen [SubsetList.append (["`export", name child], encoded)], pos) :: opens, exported)) end))
        (* Named imports use the same lexical projections as named exports. Keeping them
           private avoids token rewrites that could capture a later local datatype/binder. *)
        | (WmLexer.WKey "from", pos) ::
          (WmLexer.WScon (Syntax.SString specifier), _) ::
          (WmLexer.WKey "import", _) :: (WmLexer.WKey "{", _) :: rest =>
            SubsetResult.andThen (dependency (specifier, pos), fn child =>
              SubsetResult.andThen (namedItems (rest, []), fn (items, rest) =>
                let
                  val rec add = fn (items, named, encoded) => case items of
                      [] => SubsetResult.Ok (named, SubsetList.reverse encoded)
                    | (original, alias, itemPos) :: more =>
                        if SubsetList.exists (named, fn (n, _) => n = alias) orelse
                           SubsetList.exists (aliases, fn (n, _) => n = alias) orelse boundValue (opens, alias)
                        then failure (path, src, "duplicate imported name " ^ alias, itemPos)
                        else add (more, (alias, []) :: named, alias :: original :: encoded)
                  val known = SubsetList.exists (edges, fn Edge (_, _, _, key) =>
                    ModuleProject.same (key, identity child))
                  val edges = if known then edges else Edge (specifier, pos, name child, identity child) :: edges
                in SubsetResult.andThen (add (items, named, []), fn (named, encoded) =>
                  imports (rest, edges, aliases, named,
                    (WmLexer.WOpen [SubsetList.append (["`import", name child], encoded)], pos) ::
                    (WmLexer.WName ["private"], pos) :: opens, exported)) end))
        | (WmLexer.WKey "from", pos) :: _ =>
            failure (path, src, "reverse translation currently requires header namespace imports: from \"./file.wm\" import * as Name;", pos)
        (* `structure Alias = Target`. The body's uses are rewritten like a private alias's. *)
        | (WmLexer.WName ["export"], _) :: (WmLexer.WKey "from", pos) ::
          (WmLexer.WScon (Syntax.SString specifier), specifierPos) ::
          (WmLexer.WKey "import", importPos) :: (WmLexer.WKey "*", starPos) ::
          (WmLexer.WKey "as", asPos) :: (WmLexer.WName [alias], aliasPos) ::
          (WmLexer.WKey ";", endPos) :: rest =>
            SubsetResult.andThen (dependency (specifier, pos), fn child =>
              imports ((WmLexer.WKey "from", pos) ::
                (WmLexer.WScon (Syntax.SString specifier), specifierPos) ::
                (WmLexer.WKey "import", importPos) :: (WmLexer.WKey "*", starPos) ::
                (WmLexer.WKey "as", asPos) :: (WmLexer.WName [alias], aliasPos) ::
                (WmLexer.WKey ";", endPos) :: rest, edges, aliases, named, opens, (pos, alias, name child) :: exported))
        | (WmLexer.WName ["export"], _) :: (WmLexer.WKey "from", pos) :: _ =>
            failure (path, src, "only `export from \"./file.wm\" import *;` and `import * as Name;` have an SML counterpart", pos)
        | _ =>
            let
              val rec rewrite = fn (tokens, acc) =>
                case tokens of
                  [] => SubsetResult.Ok (SubsetList.reverse acc)
                | (WmLexer.WKey "from", pos) :: _ =>
                    failure (path, src, "imports must precede ordinary declarations in the initial translation profile", pos)
                | (WmLexer.WName (head :: tail), pos) :: rest =>
                    (case SubsetList.find (named, fn (alias, _) => alias = head) of
                       SOME (_, []) => rewrite (rest, (WmLexer.WName (head :: tail), pos) :: acc)
                     | SOME (_, qualified) =>
                         rewrite (rest, (WmLexer.WName (SubsetList.append (qualified, tail)), pos) :: acc)
                     | NONE =>
                    case SubsetList.find (aliases, fn (alias, _) => alias = head) of
                       NONE =>
                         (* `Int32.Int`, `Int32.div`: paths the parser reads as SML builtins name
                            no module, whatever modules exist. *)
                         let val builtin = case tail of
                               [last] =>
                                 let val (typeQualifiers, _) = WmParse.tyConName ([head], last)
                                     val (valueQualifiers, _) = WmParse.valueName ([head], last)
                                 in SubsetList.isEmpty typeQualifiers orelse SubsetList.isEmpty valueQualifiers end
                             | _ => false
                         in
                         if SubsetBool.not (SubsetList.isEmpty tail) andalso SubsetBool.not builtin andalso
                            SubsetList.exists (units, fn u => name u = head) andalso
                            SubsetBool.not (SubsetList.exists (defaultNamespaces, fn (alias, _) => alias = head)) then
                           failure (path, src, "namespace " ^ head ^ " is not explicitly imported under that name", pos)
                         else rewrite (rest, (WmLexer.WName (head :: tail), pos) :: acc)
                         end
                     | SOME (_, target) =>
                         (* A carrier group's namespace, `Result|a, b|`, is the module. Any other
                            bare alias keeps its spelling, marked with its target: as a value it
                            stands for the module's carrier, while in a type or pattern it is the
                            plain name (WmParse.peek). *)
                         if SubsetList.isEmpty tail then
                           (case rest of
                              (WmLexer.WKey "|", _) :: _ => rewrite (rest, (WmLexer.WName [target], pos) :: acc)
                            | (WmLexer.WKey "<", _) :: _ => rewrite (rest, (WmLexer.WName [head], pos) :: acc)
                            | _ => rewrite (rest, (WmLexer.WName ["`alias", head, target], pos) :: acc))
                         else rewrite (rest, (WmLexer.WName (target :: tail), pos) :: acc))
                | token :: rest => rewrite (rest, token :: acc)
            in SubsetResult.map (rewrite (tokens, []), fn body =>
              (SubsetList.reverse edges, SubsetList.reverse exported, SubsetList.append (SubsetList.reverse opens, body))) end
    in
      case WmLexer.lex src of
        WmLexer.LexError (message, pos) => failure (path, src, message, pos)
      | WmLexer.Tokens (tokens, comments) =>
          SubsetResult.map (imports (implicitBasis (basis, path, tokens), [], [], [], [], []), fn (edges, exported, body) =>
            Source (unit, edges, exported, WmLexer.Tokens (hoistInlineRecords body,
              SubsetList.filter (comments, fn (_, body, _) =>
                (case ModuleImports.marked body of NONE => true | SOME _ => false) andalso
                SubsetBool.not (ModuleImports.isGeneratedHeader body)))))
    end

  val order = fn sources =>
    let
      val rec visit = fn (source, active, completed) =>
        let val unit = sourceUnit source in
          if SubsetList.exists (completed, fn s => ModuleProject.same (identity (sourceUnit s), identity unit))
          then SubsetResult.Ok completed
          else let
            val rec walk = fn (edges, completed) =>
              case edges of
                [] => SubsetResult.Ok (source :: completed)
              | Edge (specifier, pos, _, target) :: rest =>
                  if SubsetList.exists (unit :: active, fn u => ModuleProject.same (identity u, target)) then
                    failure (pathOf unit, textOf unit, "import cycle: " ^
                      SubsetString.concatWith (SubsetList.append (SubsetList.map (SubsetList.reverse (unit :: active), pathOf), [specifier]), " -> "), pos)
                  else (case SubsetList.find (sources, fn s => ModuleProject.same (identity (sourceUnit s), target)) of
                    NONE => failure (pathOf unit, textOf unit, "internal error: missing resolved dependency", pos)
                  | SOME child => SubsetResult.andThen (visit (child, unit :: active, completed), fn done => walk (rest, done)))
          in walk (edgesOf source, completed) end
        end
      val rec roots = fn (remaining, completed) =>
        case remaining of [] => SubsetResult.Ok (SubsetList.reverse completed)
        | source :: rest => SubsetResult.andThen (visit (source, [], completed), fn done => roots (rest, done))
    in roots (sources, []) end

  val imported = fn (units, unit, edges) =>
    let
      val rec loop = fn (edges, seen) =>
        case edges of
          [] => SubsetResult.Ok (SubsetList.reverse seen)
        | Edge (_, pos, _, target) :: rest =>
            case SubsetList.find (units, fn child => ModuleProject.same (identity child, target)) of
              NONE => failure (pathOf unit, textOf unit, "internal error: missing resolved dependency", pos)
            | SOME child =>
                loop (rest, if SubsetList.exists (seen, fn u => ModuleProject.same (identity u, target)) then seen else child :: seen)
    in loop (edges, []) end

  datatype adapter = Adapter of ModuleProject.moduleId * string * string

  val structureIdentifier = fn value => case Lexer.lex value of
      Lexer.Tokens ([(Lexer.TId identifier, _), (Lexer.TEOF, _)], _) =>
        identifier = value andalso SubsetChar.isAlpha (CompilerText.sub (CompilerText.source identifier, 0))
    | _ => false

  val adapters = fn (units, specifications) =>
    let val rec resolve = fn (remaining, seen) => case remaining of
        [] => SubsetResult.Ok (SubsetList.reverse seen)
      | (checker, native, exported, required) :: rest =>
          if SubsetBool.not (structureIdentifier exported) then
            failure (checker, "", "native adapter export must be an SML structure identifier", 0)
          else SubsetResult.andThen (case ModuleProject.identify checker of
                SubsetResult.Err error => failure (checker, "", SubsetIo.errorText error, 0)
              | SubsetResult.Ok (ModuleProject.Resolved (id, _)) =>
                  if SubsetBool.not (SubsetList.exists (units, fn unit => ModuleProject.same (identity unit, id))) then
                    (if required then failure (checker, "", "native adapter checker is not in the entry graph", 0)
                     else SubsetResult.Ok NONE)
                  else (if SubsetList.exists (seen, fn Adapter (key, _, _) => ModuleProject.same (id, key)) then
                    failure (checker, "", "duplicate native adapter selection", 0)
                  else (case ModuleProject.identify native of
                    SubsetResult.Err error => failure (native, "", SubsetIo.errorText error, 0)
                  | SubsetResult.Ok (ModuleProject.Resolved (_, path)) =>
                      case SubsetIo.readFile path of
                        SubsetResult.Err error => failure (native, "", SubsetIo.errorText error, 0)
                      | SubsetResult.Ok _ => SubsetResult.Ok (SOME (Adapter (id, path, exported))))),
                fn adapter => case adapter of
                  NONE => resolve (rest, seen)
                | SOME selected => resolve (rest, selected :: seen))
    in resolve (specifications, []) end

  (* One basis instance per canonical module. A module's body receives the standard Basis
     and only its direct dependencies; the `in` part exports only its own structure.
     Native implementations use source import aliases in separately captured basis scopes. *)
  (* The entry's `main` call, in `mainFile`. *)
  val mainCall = fn entry => "val _ = " ^ name entry ^ ".main ()\n"

  (* Whether a module's declarations bind `main` at the top level to a `() => ...` function,
     the form Workman's runner calls without arguments. *)
  val declaresMain = fn decs =>
    let val rec named = fn pat => case pat of
          Syntax.PId (_, ([], "main")) => true
        | Syntax.PTyped (inner, _) => named inner
        | _ => false
        val rec runnable = fn exp => case exp of
          Syntax.EFn [(Syntax.PTuple [], _)] => true
        | Syntax.ETyped (inner, _) => runnable inner
        | _ => false
    in SubsetList.exists (decs, fn dec => case dec of
        Syntax.DVal (_, _, plain, recursive) =>
          SubsetList.exists (SubsetList.append (plain, recursive), fn (pat, exp) => named pat andalso runnable exp)
      | _ => false) end

  val mlb = fn (units, sources, modules, entry, adapters, runsMain) =>
    let
      val scopeName = fn name => "SubsetBuild_" ^ name
      val rec emit = fn modules => case modules of
          [] => SubsetResult.Ok ""
        | (name, dependencies, _) :: rest =>
            (case SubsetList.find (units, fn unit => nameOf unit = name) of
              NONE => failure ("translation", "", "missing build module " ^ name, 0)
            | SOME unit =>
                let
                  val selected = SubsetList.find (adapters, fn Adapter (id, _, _) => ModuleProject.same (identity unit, id))
                  val body = case selected of
                    NONE => SubsetResult.Ok (
                      "      open SubsetBuild_Standard" ^
                      SubsetString.concat (SubsetList.map (dependencies, fn name => " " ^ scopeName name)) ^
                      "\n    in\n      \"" ^ CompilerText.escapeSmlString (output unit) ^ "\"\n")
                  | SOME (Adapter (_, native, exported)) =>
                      case SubsetList.find (sources, fn source => ModuleProject.same (identity (sourceUnit source), identity unit)) of
                        NONE => failure (pathOf unit, "", "missing native adapter imports", 0)
                      | SOME source =>
                          (* A native adapter names its dependencies by its source imports; the
                             hygienic default aliases never appear in it. *)
                          let val rec aliases = fn edges => case edges of
                              [] => SubsetResult.Ok ("", "")
                            | edge :: rest =>
                                let val Edge (_, pos, alias, target) = edge in
                                if isDefaultEdge (sourceUnit source, edge) then aliases rest
                                else (if SubsetBool.not (structureIdentifier alias) then
                                  failure (pathOf unit, textOf unit, "native adapter import alias must be an SML structure identifier", pos)
                                else (case SubsetList.find (units, fn child => ModuleProject.same (identity child, target)) of
                                  NONE => failure (pathOf unit, "", "missing native adapter dependency", 0)
                                | SOME child => SubsetResult.map (aliases rest, fn (declarations, opens) =>
                                    ("      basis SubsetNative_" ^ alias ^ " = bas local open " ^ scopeName (nameOf child) ^
                                     " in structure " ^ alias ^ " = " ^ nameOf child ^ " end end\n" ^ declarations,
                                     " SubsetNative_" ^ alias ^ opens))))
                                end
                          in SubsetResult.map (aliases (edgesOf source), fn (declarations, opens) =>
                            "      open SubsetBuild_Standard\n" ^ declarations ^ "      open SubsetBuild_Standard" ^ opens ^
                            "\n    in\n      local\n        \"" ^ CompilerText.escapeSmlString native ^
                            "\"\n      in\n        structure " ^ name ^ " = " ^ exported ^ "\n      end\n") end
                in SubsetResult.andThen (body, fn body => SubsetResult.map (emit rest, fn text =>
                  "  basis " ^ scopeName name ^ " = bas\n    local\n" ^ body ^ "    end\n  end\n" ^ text)) end)
      and nameOf = fn unit => name unit
    in SubsetResult.map (emit modules, fn text =>
      "local\n  basis SubsetBuild_Standard = bas $(SML_LIB)/basis/basis.mlb end\n" ^ text ^
      "in\n  open SubsetBuild_Standard " ^ scopeName (name entry) ^ "\n" ^
      (if runsMain then "  \"" ^ mainFile ^ "\"\n" else "") ^ "end\n") end

  val metadata = fn dependencies =>
    if SubsetList.isEmpty dependencies then "" else
      "(* @subsetml\n" ^ SubsetString.concat (SubsetList.map (dependencies, fn unit =>
        "from \"./" ^ output unit ^ "\" import * as " ^ name unit ^ ";\n")) ^ "*)\n\n"
end
