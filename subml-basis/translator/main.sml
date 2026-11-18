(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./subset_io.sml" import * as SubsetIo;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_process.sml" import * as SubsetProcess;
from "./syntax.sml" import * as Syntax;
from "./lexer.sml" import * as Lexer;
from "./parser.sml" import * as Parser;
from "./sml_list.sml" import * as SmlList;
from "./subset_list.sml" import * as SubsetList;
from "./subset_string.sml" import * as SubsetString;
from "./subset_bool.sml" import * as SubsetBool;
from "./translate.sml" import * as Translate;
from "./sml_list_pair.sml" import * as SmlListPair;
from "./wm_project.sml" import * as WmProject;
from "./wm_scope.sml" import * as WmScope;
from "./wm_parse.sml" import * as WmParse;
from "./wm_lexer.sml" import * as WmLexer;
from "./backend_names.sml" import * as BackendNames;
from "./unify.sml" import * as Unify;
from "./module_project.sml" import * as ModuleProject;
from "./print.sml" import * as Print;
from "./normalize.sml" import * as Normalize;
from "./basis.sml" import * as Basis;
from "./elab.sml" import * as Elab;
from "./native_int.sml" import * as NativeInt;
from "./sml_target.sml" import * as SmlTarget;
*)

(* Command-line driver.

     subsetml check-portable ENTRY.sml  check without the SML Basis compatibility environment
     subsetml check ENTRY.sml       check the entry file's explicit import graph
     subsetml check FILE1 FILE2 ... legacy sequential source-list checking
     subsetml parse FILE...         print the abstract syntax of each file
     subsetml fmt FILE...           reprint each file as SubsetML
     subsetml wm OUTDIR FILE...     translate the program's files to Workman modules in OUTDIR
     subsetml sml OUTDIR FILE.wm... translate Workman modules to SubsetML files in OUTDIR
     subsetml sml-entry OUTDIR [--basis DIR] ENTRY.wm discover and translate the supported import graph;
       "basis/x.wm" imports resolve to DIR/subset_x.wm
     subsetml sml OUTDIR --panic-runtime R.wm FILE.wm... select the native panic provider
     subsetml roundtrip FILE...     check that SML -> Workman -> SML preserves each file's syntax *)
structure Main = struct
  open SubsetOptionValue

  val eprint = fn text =>
    case SubsetIo.writeStderr (CompilerText.characters text) of
      SubsetResult.Ok result => result
    | SubsetResult.Err error => SubsetProcess.exit SubsetProcess.failure
  val fatal = fn message => (eprint (message ^ "\n"); SubsetProcess.exit SubsetProcess.failure)
  val readFile = fn path =>
    case SubsetIo.readFile path of
      SubsetResult.Ok bytes => CompilerText.stringOf bytes
    | SubsetResult.Err error => fatal (path ^ ": " ^ SubsetIo.errorText error)
  val writeFile = fn (path, text) =>
    case SubsetIo.writeFile (CompilerText.characters text, path) of
      SubsetResult.Ok result => result
    | SubsetResult.Err error => fatal (path ^ ": " ^ SubsetIo.errorText error)
  val output = fn text =>
    case SubsetIo.writeStdout (CompilerText.characters text) of
      SubsetResult.Ok result => result
    | SubsetResult.Err error => fatal (SubsetIo.errorText error)

  (* 1-based line and column of a byte offset. *)
  val lineCol = fn (src, offset) =>
    let
      val rec go = fn (bytes, i, line, col) =>
        if i >= offset then (line, col)
        else case bytes of [] => (line, col) | c :: rest =>
          let val newline = c = #"\n" in
            go (rest, i + 1, if newline then line + 1 else line, if newline then 1 else col + 1)
          end
    in
      go (CompilerText.characters src, 0, 1, 1)
    end

  val errorLineKind = fn (path, src, kind, msg, pos) =>
    let val (line, col) = lineCol (src, pos) in
      path ^ ":" ^ CompilerText.natural line ^ ":" ^ CompilerText.natural col ^ ": " ^ kind ^ ": " ^ msg ^ "\n"
    end

  val errorLine = fn (path, src, msg, pos) => errorLineKind (path, src, "error", msg, pos)

  datatype parsed =
      Parsed of string * string * Syntax.topdec list * Syntax.comment list

  (* Keep causes and source context until the CLI reporting boundary. *)
  datatype sourceError =
      ReadFailure of string * SubsetIo.error
    | LexFailure of string * string * string * Syntax.pos
    | ParseFailure of string * string * string * Syntax.pos

  val lexSource = fn (path, src) =>
    case Lexer.lex src of
      Lexer.LexError (msg, pos) => SubsetResult.Err (LexFailure (path, src, msg, pos))
    | Lexer.Tokens (tokens, comments) => SubsetResult.Ok (path, src, tokens, comments)

  val parseSource = fn (path, src, tokens, comments) =>
    case Parser.parseTokens (tokens, comments) of
      Parser.ParseError (msg, pos) => SubsetResult.Err (ParseFailure (path, src, msg, pos))
    | Parser.Program (phrases, comments) => SubsetResult.Ok (Parsed (path, src, phrases, comments))

  (* No reporting or exit inside the procedure; later transformations skip on Err. *)
  val load = fn path =>
    let
      val read = SubsetResult.viaErr (fn error => ReadFailure (path, error))
        (fn file => SubsetResult.map (SubsetIo.readFile file,
          fn bytes => (file, CompilerText.stringOf bytes)))
      val lex = SubsetResult.via lexSource
      val parse = SubsetResult.via parseSource

      val loaded = read (SubsetResult.Ok path)
      val lexed = lex loaded
    in
      parse lexed
    end

  val sourceErrorText = fn
      ReadFailure (path, error) => path ^ ": " ^ SubsetIo.errorText error ^ "\n"
    | LexFailure (path, src, msg, pos) => errorLineKind (path, src, "lex error", msg, pos)
    | ParseFailure (path, src, msg, pos) => errorLineKind (path, src, "parse error", msg, pos)

  val usage = fn () =>
    (eprint "usage: subsetml (check-portable | check | parse | fmt | roundtrip) FILE...\n       subsetml native OUTDIR FILE.sml...\n       subsetml sml-target (mlton | mlworks) OUTDIR [--adapter CHECKER.sml NATIVE.sml]... FILE.sml...\n       subsetml wm OUTDIR FILE...\n       subsetml sml OUTDIR [--panic-runtime R.wm] FILE.wm...\n       subsetml sml-entry OUTDIR [--basis DIR] [--panic-runtime R.wm] [--native-adapter[-if-used] CHECKER.wm NATIVE.sml STRUCTURE]... ENTRY.wm\n";
     SubsetProcess.exit SubsetProcess.failure)

  val finish = fn ok => SubsetProcess.exit (if ok then SubsetProcess.success else SubsetProcess.failure)

  (* Runs `f` on every file once all of them have parsed. *)
  val withParsed = fn (files, f) =>
    let
      val loaded = SmlList.map load files
      val parsed = SmlList.concat (SmlList.map (fn
          SubsetResult.Ok value =>
            (case value of Parsed (path, src, prog, comments) => [(path, src, prog, comments)])
        | SubsetResult.Err error => (eprint (sourceErrorText error); [])) loaded)
    in
      if SmlList.null files then usage ()
      else (if (SubsetList.length32 parsed = SubsetList.length32 files) then finish (f parsed) else finish false)
    end

  val translate = fn (outDir, parsed) =>
    let
      val structures = SmlList.concat (SmlList.map (fn (_, _, prog, _) => Translate.structureOf prog) parsed)
      val results =
        SmlList.map (fn (path, src, prog, comments) =>
                    Translate.toWm (structures, path, src, prog, comments)) parsed
      val errors =
        SmlList.concat (SmlList.map (fn Translate.TranslateError e => [e] | Translate.Output (_, _, _) => []) results)
      val warn = fn ((path, src, _, _), result) =>
        case result of
          Translate.Output (_, _, warnings) =>
            SmlList.app (fn (pos, msg) =>
                        eprint (errorLineKind (path, src, "warning", msg, pos))) warnings
        | Translate.TranslateError _ => ()
    in
      case errors of
        [] =>
          (SmlList.app (fn Translate.Output (name, text, _) => writeFile (outDir ^ "/" ^ name, text)
                      | Translate.TranslateError _ => ()) results;
           SmlListPair.app warn (parsed, results);
           true)
      | _ => (SmlList.app (fn e => eprint ("error: " ^ e ^ "\n")) errors; false)
    end

  (* Reverse translation uses the same canonical resolver as SML metadata loading.
     Explicit source lists and entry discovery share preparation, resolution and checking. *)
  val fromWmLoaded = fn (outDir, basis, runtimePath, entryPath, adapterSpecs, sources) =>
    let
      val keywordPrefix = Translate.keywordPrefix sources
      val rec traverse = fn (items, f) =>
        case items of
          [] => SubsetResult.Ok []
        | item :: rest => SubsetResult.andThen (f item, fn value =>
            SubsetResult.map (traverse (rest, f), fn values => value :: values))
      val translate = fn (units, adapters) =>
        let
          (* The selected runtime is the first canonical source. Its closure is checked first;
             resolution adds it as a private dependency only where the built-in is used. *)
          val runtime = case (runtimePath, units) of
            (SOME _, unit :: _) => SOME (WmProject.name unit) | _ => NONE
          val dependenciesOf = fn name => fn planned =>
            case SubsetList.find (planned, fn (key, _, _) => key = name) of
              NONE => [] | SOME (_, dependencies, _) => dependencies
          val unitsNamed = fn names => traverse (names, fn name =>
            case SubsetList.find (units, fn unit => WmProject.name unit = name) of
              NONE => WmProject.failure ("translation", "", "missing runtime dependency " ^ name, 0)
            | SOME unit => SubsetResult.Ok unit)
          val parseGraph = fn (sources, layouts) =>
            let val rec parse = fn (sources, scopes) => case sources of
                [] => SubsetResult.Ok ([], [])
              | WmProject.Source (unit, edges, aliases, tokens) :: rest =>
                  let
                    val owner = WmProject.name unit
                    val path = WmProject.pathOf unit
                    val src = WmProject.textOf unit
                    val (values, types, namespaces) = WmProject.defaultScope (basis, units, unit)
                    val records = WmScope.recordResolver (owner, scopes, types, namespaces, tokens)
                  in case WmParse.parseModuleRecordScope (layouts, owner, src, tokens, keywordPrefix, records) of
                    WmParse.ParseError (message, pos) => WmProject.failure (path, src, message, pos)
                  | WmParse.Module (ds, es, cs) =>
                      let
                        val errors = SubsetList.map (WmScope.projectionErrors (scopes, ds),
                          fn (p, message) => (Translate.located (path, message), p))
                        val (ds, scope) = WmScope.resolve (owner, values, types, namespaces, scopes, ds)
                        val scope = WmScope.exported (scope, aliases)
                        val WmScope.Scope (_, _, names) = scope
                        val aliases = SubsetList.map (names, fn (alias, path) =>
                          (0, alias, SubsetString.concatWith (path, ".")))
                        val program = Syntax.TopDecs [Syntax.SStructure (0, [(owner, aliases, ds)])] ::
                          SubsetList.map (es, fn e => Syntax.TopExp (0, e))
                      in SubsetResult.andThen (WmProject.imported (units, unit, edges), fn dependencies =>
                        SubsetResult.map (parse (rest, (owner, scope) :: scopes), fn (rest, moreErrors) =>
                          ((owner, SubsetList.map (dependencies, WmProject.name), (path, src, program, cs)) :: rest,
                            SubsetList.append (errors, moreErrors)))) end
                  end
            in parse (sources, []) end
        in SubsetResult.andThen (traverse (units, fn unit => WmProject.prepare (basis, units, unit)), fn prepared =>
          SubsetResult.andThen (WmProject.order prepared, fn ordered =>
            let
              val declarations = traverse (ordered, fn WmProject.Source (unit, _, _, tokens) =>
                case WmParse.recordLayoutsTokens (WmProject.name unit, WmProject.textOf unit, tokens) of
                  WmParse.Done (layouts, _) => SubsetResult.Ok layouts
                | WmParse.Fail (message, pos) => WmProject.failure (WmProject.pathOf unit, WmProject.textOf unit, message, pos))
            in SubsetResult.andThen (declarations, fn groups =>
              SubsetResult.andThen (parseGraph (ordered, SmlList.concat groups), fn (modules, projectionErrors) =>
                let
                  val libraries = case basis of NONE => [] | SOME directory =>
                    SubsetList.map (SubsetList.filter (units,
                      fn u => WmProject.inside (directory ^ "/std", WmProject.pathOf u)), WmProject.name)
                  val modules = WmScope.pruneLibraries (libraries, modules)
                  val modules = SubsetList.map (modules, fn (owner, deps, (path, src, prog, cs)) =>
                    let
                      val source = SubsetList.find (ordered,
                        fn source => WmProject.name (WmProject.sourceUnit source) = owner)
                      val unit = SubsetList.find (units, fn u => WmProject.name u = owner)
                      val types = case unit of NONE => [] | SOME unit =>
                        let val (_, types, _) = WmProject.defaultScope (basis, units, unit)
                        in SubsetList.concat (SubsetList.map (types,
                          fn (_, (qs, _)) => case qs of [n] => [n] | _ => [])) end
                      val referenced = WmScope.moduleReferences prog
                      val explicit = fn target => case source of NONE => true | SOME source =>
                        SubsetList.exists (WmProject.edgesOf source,
                          fn edge => let val WmProject.Edge (_, _, _, id) = edge in
                            SubsetList.exists (units, fn u => WmProject.name u = target andalso
                              ModuleProject.same (WmProject.identity u, id)) andalso
                            SubsetBool.not (WmProject.isDefaultEdge (WmProject.sourceUnit source, edge)) end)
                      val deps = SubsetList.filter (deps, fn n => explicit n orelse
                        WmScope.member (referenced, n) orelse WmScope.member (types, n))
                      (* Constructor projections can refer directly to an ancestor's datatype.
                         Those references need the same canonical private build dependency. *)
                      val deps = SubsetList.foldLeft (referenced, deps, fn (n, found) =>
                        if n = owner orelse WmScope.member (found, n) orelse
                           SubsetBool.not (SubsetList.exists (units, fn u => WmProject.name u = n))
                        then found else SubsetList.append (found, [n]))
                    in (owner, deps, (path, src, prog, cs)) end)
                  val roots = case entryPath of
                      NONE => SubsetList.map (modules, fn (owner, _, _) => owner)
                    | SOME entry => SubsetList.map (SubsetList.filter (units, fn u =>
                        (case WmProject.canonical entry of SOME path => WmProject.pathOf u = path | NONE => false)
                        orelse (case runtime of SOME n => n = WmProject.name u | NONE => false)), WmProject.name)
                  val rec reachable = fn (todo, seen) => case todo of
                      [] => seen
                    | n :: rest => if WmScope.member (seen, n) then reachable (rest, seen)
                      else reachable (SubsetList.append (dependenciesOf n modules, rest), n :: seen)
                  val used = reachable (roots, [])
                  val modules = SubsetList.filter (modules, fn (owner, _, _) => WmScope.member (used, owner))
                  val ordered = SubsetList.filter (ordered,
                    fn source => WmScope.member (used, WmProject.name (WmProject.sourceUnit source)))
                  val (renamed, names) = BackendNames.projectWithRuntime (runtime, keywordPrefix, modules)
                  val checked = case projectionErrors of
                    (message, pos) :: _ => Unify.Err (message, pos)
                  | [] => (case BackendNames.failure names of
                      NONE => Translate.recoverProjectWithRuntime (runtime, renamed)
                    | SOME (_, pos, message) => Unify.Err (message, pos))
                in case checked of
                  Unify.Err (message, pos) =>
                    (case Translate.unlocated message of
                       SOME (path, message) =>
                         (case SmlList.find (fn unit => WmProject.pathOf unit = path) units of
                            SOME unit => WmProject.failure (path, WmProject.textOf unit, BackendNames.diagnostic (names, message), pos)
                          | NONE => WmProject.failure (path, "", BackendNames.diagnostic (names, message), pos))
                     | NONE => WmProject.failure ("translation", "", BackendNames.diagnostic (names, message), pos))
                | Unify.Ok (recovered, _) =>
                    SubsetResult.andThen (traverse (SmlListPair.zip (ordered, recovered),
                      fn (WmProject.Source (unit, _, _, _), (_, src, prog, cs)) =>
                        SubsetResult.map (unitsNamed (dependenciesOf (WmProject.name unit) renamed), fn dependencies =>
                          let val (_, phrases) = Translate.module prog
                              val (ds, es) = Translate.parts phrases
                          in (outDir ^ "/" ^ WmProject.output unit,
                            WmProject.metadata dependencies ^ Translate.fromWmNamed (WmProject.name unit, Translate.structureAliases prog, src, ds, es, cs)) end)), fn results =>
                      case entryPath of NONE => SubsetResult.Ok results
                      | SOME path => (case ModuleProject.identify path of
                          SubsetResult.Err error => WmProject.failure (path, "", SubsetIo.errorText error, 0)
                        | SubsetResult.Ok (ModuleProject.Resolved (id, _)) =>
                            (case SubsetList.find (units, fn unit => ModuleProject.same (WmProject.identity unit, id)) of
                              NONE => WmProject.failure (path, "", "missing build entry", 0)
                            | SOME entry =>
                                let val runsMain = SubsetList.exists (SmlListPair.zip (ordered, recovered),
                                      fn (WmProject.Source (unit, _, _, _), (_, _, prog, _)) =>
                                        ModuleProject.same (WmProject.identity unit, WmProject.identity entry) andalso
                                        (let val (_, phrases) = Translate.module prog
                                             val (ds, _) = Translate.parts phrases
                                         in WmProject.declaresMain ds end))
                                    val runner = if runsMain
                                      then [(outDir ^ "/" ^ WmProject.mainFile, WmProject.mainCall entry)] else []
                                in SubsetResult.map (WmProject.mlb (units, ordered, renamed, entry, adapters, runsMain),
                                  fn text => SubsetList.append (results, SubsetList.append (runner, [(outDir ^ "/project.mlb", text)]))) end))) end)) end)) end
    in
      case SubsetResult.andThen (WmProject.plan sources, fn units =>
        SubsetResult.andThen (WmProject.adapters (units, adapterSpecs), fn adapters => translate (units, adapters))) of
        SubsetResult.Err (WmProject.Error (path, src, message, pos)) =>
          (eprint (errorLine (path, src, message, pos)); false)
      | SubsetResult.Ok results => (SmlList.app writeFile results; true)
    end

  val fromWm = fn (outDir, runtimePath, files) =>
    fromWmLoaded (outDir, NONE, runtimePath, NONE, [], SmlList.map (fn path => (path, readFile path))
      (case runtimePath of NONE => files | SOME path => path :: files))

  (* Whether any discovered module spells `Panic`. A shadowing binding still counts; the runtime
     is then only an unused dependency. *)
  val mentionsPanic = fn sources =>
    SmlList.exists (fn (_, src) =>
      case WmLexer.lex src of
        WmLexer.Tokens (tokens, _) => SmlList.exists (fn (token, _) => token = WmLexer.WName ["Panic"]) tokens
      | WmLexer.LexError _ => false) sources

  val fromWmEntry = fn (outDir, basis, runtimePath, adapterSpecs, entry) =>
    let
      val report = fn (WmProject.Error (path, src, message, pos)) => (eprint (errorLine (path, src, message, pos)); false)
      (* With --basis, the Basis process module is the default Panic runtime, but only for a
         graph that uses Panic: the runtime brings its host adapter with it. *)
      val defaultRuntime = fn sources => case basis of
          NONE => NONE
        | SOME directory =>
            if mentionsPanic sources then
              (case ModuleProject.identify (directory ^ "/subset_process.wm") of
                SubsetResult.Ok _ => SOME (directory ^ "/subset_process.wm")
              | SubsetResult.Err _ => NONE)
            else NONE
      val withRuntime = fn runtime =>
        case WmProject.discover (basis, [runtime, entry]) of
          SubsetResult.Err error => report error
        | SubsetResult.Ok sources => fromWmLoaded (outDir, basis, SOME runtime, SOME entry, adapterSpecs, sources)
    in
      case runtimePath of
        SOME runtime => withRuntime runtime
      | NONE =>
          case WmProject.discover (basis, [entry]) of
            SubsetResult.Err error => report error
          | SubsetResult.Ok sources =>
              (case defaultRuntime sources of
                 SOME runtime => withRuntime runtime
               | NONE => fromWmLoaded (outDir, basis, NONE, SOME entry, adapterSpecs, sources))
    end

  (* SML -> Workman -> SML must give back the same declarations, up to Normalize. *)
  val roundTrip = fn parsed =>
    let
      val structures = SmlList.concat (SmlList.map (fn (_, _, prog, _) => Translate.structureOf prog) parsed)
      val loaded = SmlList.map (fn (path, src, prog, comments) =>
        case Translate.toWm (structures, path, src, prog, comments) of
          Translate.TranslateError msg => (eprint (msg ^ "\n"); NONE)
        | Translate.Output (name, text, _) =>
            case WmParse.parseModule text of
              WmParse.ParseError (msg, pos) => (eprint (errorLine (path, text, msg, pos)); NONE)
            | WmParse.Module (ds, es, cs) => SOME (path, text,
                Syntax.TopDecs [Syntax.SStructure (0, [(WmParse.structureName name, WmParse.structureAliases text, ds)])] ::
                SmlList.map (fn e => Syntax.TopExp (0, e)) es, cs)) parsed
      val modules = SmlList.concat (SmlList.map (fn SOME m => [m] | NONE => []) loaded)
      val show = fn prog =>
        let val (_, phrases) = Translate.module prog
            val (ds, es) = Translate.parts phrases
        in SubsetList.append (SmlList.map (fn (_, name, target) => name ^ " = " ^ target) (Translate.structureAliases prog),
             SubsetList.append (SmlList.map Print.dec (Normalize.decs ds), SmlList.map (fn e => Print.exp (Normalize.exp e)) es)) end
      val check = fn (path, _, prog, _) =>
        case SmlList.find (fn (p, _, _, _) => p = path) modules of
          NONE => false
        | SOME m =>
            case Translate.recover (modules, m) of
              Unify.Err (msg, _) => (eprint (path ^ ": round trip: " ^ msg ^ "\n"); false)
            | Unify.Ok ((_, _, actual, _), _) =>
                if show prog = show actual then true
                else (eprint (path ^ ": syntax changed in the round trip\n"); false)
    in
      SmlList.all (fn ok => ok) (SmlList.map check parsed)
    end

  (* Elaborates the files in order, each extending the environment, and reports the first
     error. *)
  val typeCheckWith = fn (initial, parsed) =>
    case initial of
      Unify.Err (msg, _) => (eprint ("internal error in the basis: " ^ msg ^ "\n"); false)
    | Unify.Ok (basis, _) =>
        let
          val rec go = fn
              (_, [], _) => true
            | (env, (path, src, prog, _) :: rest, st) =>
                case Elab.program (env, prog, st) of
                  Unify.Ok (env', st') => go (env', rest, st')
                | Unify.Err (msg, pos) => (eprint (errorLine (path, src, msg, pos)); false)
        in
          go (basis, parsed, Unify.initial)
        end

  val typeCheck = fn parsed => typeCheckWith (Basis.initial, parsed)

  (* An entry file has only its explicit import environment; legacy source lists remain
     available for bootstrap checking and ordinary SML compilation-unit order. *)
  val checkProjectWith = fn (initial, path) =>
    let
      val source = fn file => SubsetResult.map (load file,
        fn Parsed (path, src, prog, comments) => ModuleProject.Source (path, src, prog, comments))
      val checked = SubsetResult.andThen (ModuleProject.discover (path, source), fn graph =>
        case initial of
          Unify.Err (message, _) => SubsetResult.Err
            (ModuleProject.CheckFailure (path, "", "internal error in the basis: " ^ message, 0))
        | Unify.Ok (basis, _) => ModuleProject.check (graph, basis))
      val report = fn
          ModuleProject.LoadFailure error => sourceErrorText error
        | ModuleProject.ResolutionFailure (path, error) => path ^ ": " ^ SubsetIo.errorText error ^ "\n"
        | ModuleProject.ImportFailure (path, src, message, pos) => errorLineKind (path, src, "import error", message, pos)
        | ModuleProject.CheckFailure (path, src, message, pos) => errorLine (path, src, message, pos)
    in
      case checked of
        SubsetResult.Ok _ => finish true
      | SubsetResult.Err error => (eprint (report error); finish false)
    end

  val main = fn () =>
    let
      val args = case SubsetProcess.arguments () of
        SubsetResult.Ok values => values
      | SubsetResult.Err error => fatal (SubsetIo.errorText error)
    in case args of
      "check-portable" :: [file] => checkProjectWith (Basis.portableInitial, file)
    | "check-portable" :: files => withParsed (files, fn parsed => typeCheckWith (Basis.portableInitial, parsed))
    | "check" :: [file] => checkProjectWith (Basis.initial, file)
    | "check" :: files => withParsed (files, typeCheck)
    | "parse-only" :: files => withParsed (files, fn _ => true)
    | "parse" :: files =>
        withParsed (files, fn parsed =>
          (SmlList.app (fn (_, _, prog, _) => SmlList.app (fn p => output (Print.topdec p ^ "\n")) prog) parsed;
           true))
    | "fmt" :: files =>
        withParsed (files, fn parsed =>
          (SmlList.app (fn (_, src, prog, comments) => output (Translate.toSml (src, prog, comments))) parsed;
           true))
    | "native" :: outDir :: files => withParsed (files, fn parsed =>
        case NativeInt.emit parsed of
          Unify.Err (message, pos) => (eprint ("native error: " ^ message ^ "\n"); false)
        | Unify.Ok (outputs, _) =>
            (SmlList.app (fn (path, text) => writeFile (outDir ^ "/" ^ NativeInt.basename path, text)) outputs; true))
    | "sml-target" :: target :: outDir :: options =>
        let val rec parse = fn (remaining, adapters) => case remaining of
            "--adapter" :: checker :: native :: rest => parse (rest, (checker, native) :: adapters)
          | [] => usage ()
          | files => withParsed (files, fn parsed =>
              case SmlTarget.emit (target, SmlList.rev adapters, parsed) of
                SubsetResult.Err message => (eprint ("SML target error: " ^ message ^ "\n"); false)
              | SubsetResult.Ok outputs =>
                  (SmlList.app (fn (name, text) => writeFile (outDir ^ "/" ^ name, text)) outputs; true))
        in parse (options, []) end
    | "wm" :: outDir :: files => withParsed (files, fn parsed => translate (outDir, parsed))
    | "sml-entry" :: outDir :: options =>
        let val rec parse = fn (remaining, basis, runtime, adapters) => case remaining of
            [entry] => finish (fromWmEntry (outDir, basis, runtime, SmlList.rev adapters, entry))
          | "--basis" :: directory :: rest =>
              (case basis of NONE => parse (rest, SOME directory, runtime, adapters) | SOME _ => usage ())
          | "--panic-runtime" :: path :: rest =>
              (case runtime of NONE => parse (rest, basis, SOME path, adapters) | SOME _ => usage ())
          | "--native-adapter" :: checker :: native :: exported :: rest =>
              parse (rest, basis, runtime, (checker, native, exported, true) :: adapters)
          | "--native-adapter-if-used" :: checker :: native :: exported :: rest =>
              parse (rest, basis, runtime, (checker, native, exported, false) :: adapters)
          | _ => usage ()
        in parse (options, NONE, NONE, []) end
    | "sml" :: outDir :: "--panic-runtime" :: runtime :: files =>
        if SmlList.null files then usage () else finish (fromWm (outDir, SOME runtime, files))
    | "sml" :: outDir :: files => if SmlList.null files then usage () else finish (fromWm (outDir, NONE, files))
    | "roundtrip" :: files => withParsed (files, roundTrip)
    | _ => usage ()
    end

end

val _ = Main.main ()
