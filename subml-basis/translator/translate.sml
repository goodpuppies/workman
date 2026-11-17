(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_list.sml" import * as SubsetList;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./sml_list.sml" import * as SmlList;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_char.sml" import * as SubsetChar;
from "./unify.sml" import * as Unify;
from "./types.sml" import * as Types;
from "./doc.sml" import * as Doc;
from "./wm_print.sml" import * as WmPrint;
from "./basis.sml" import * as Basis;
from "./elab.sml" import * as Elab;
from "./subset_string.sml" import * as SubsetString;
from "./backend_names.sml" import * as BackendNames;
from "./env.sml" import * as Env;
from "./wm_lexer.sml" import * as WmLexer;
from "./sml_print.sml" import * as SmlPrint;
from "./wm_parse.sml" import * as WmParse;
*)

(* Whole-file translation. By spec M1 a file has at most one structure, so each SubsetML file
   becomes one Workman module: `structure FooBar` in foo_bar.sml becomes foo_bar.wm, and the
   file's other top-level declarations join the module. *)
structure Translate = struct
  open SubsetOptionValue

  open Syntax

  (* --------------------------------------------------------------------------------------- *)
  (* The structures a phrase refers to: the first qualifier of each long identifier. *)

  val head = fn
      [] => []
    | q :: _ => [q]

  val concatMap = fn (f, xs) => SmlList.concat (SmlList.map f xs)

  val rec tyQuals = fn
      TyVar _ => []
    | TyCon (args, (qs, _)) => SubsetList.append (head qs, concatMap (tyQuals, args))
    | TyTuple ts => concatMap (tyQuals, ts)
    | TyArrow (a, b) => SubsetList.append (tyQuals a, tyQuals b)
    | TyRecord fields => concatMap (fn (_, t) => tyQuals t, fields)

  val rec patQuals = fn
      PWild => []
    | PScon (_, _) => []
    | PId (_, (qs, _)) => head qs
    | PPinned (_, (qs, _)) => head qs
    | PComputed (_, e) => expQuals e
    | PRecord (_, fields) => concatMap (fn (_, p) => patQuals p, fields)
    | PTuple ps => concatMap (patQuals, ps)
    | PList ps => concatMap (patQuals, ps)
    | PApp (_, (qs, _), p) => SubsetList.append (head qs, patQuals p)
    | PTyped (p, t) => SubsetList.append (patQuals p, tyQuals t)

  and expQuals = fn
      EScon (_, _) => []
    | EId (_, (qs, _)) => head qs
    | ERecord (_, fields) => concatMap (fn (_, e) => expQuals e, fields)
    | ESelect (_, _) => []
    | ECopy (_, source, target, t) => SubsetList.concat [expQuals source, expQuals target, tyQuals t]
    | ETuple es => concatMap (expQuals, es)
    | EList es => concatMap (expQuals, es)
    | ESeq es => concatMap (expQuals, es)
    | ELet (ds, es) => SubsetList.append (concatMap (decQuals, ds), concatMap (expQuals, es))
    | EApp (f, a) => SubsetList.append (expQuals f, expQuals a)
    | ETyped (e, t) => SubsetList.append (expQuals e, tyQuals t)
    | EAndalso (a, b) => SubsetList.append (expQuals a, expQuals b)
    | EOrelse (a, b) => SubsetList.append (expQuals a, expQuals b)
    | EIf (c, a, b) => SubsetList.concat [expQuals c, expQuals a, expQuals b]
    | ECase (e, rules) => SubsetList.append (expQuals e, ruleQuals rules)
    | EFn rules => ruleQuals rules

  and ruleQuals = fn rules => concatMap (fn (p, e) => SubsetList.append (patQuals p, expQuals e), rules)

  and decQuals = fn
      DVal (_, _, plain, recs) => ruleQuals (SubsetList.append (plain, recs))
    | DType (_, binds) => concatMap (fn (_, _, t) => tyQuals t, binds)
    | DDatatype (_, binds) =>
        concatMap (fn (_, _, cons) =>
                     concatMap (fn (_, _, NONE) => [] | (_, _, SOME t) => tyQuals t, cons), binds)
    | DOpen (_, ids) => concatMap (head, ids)
    | DLocal (_, hidden, body) => concatMap (decQuals, SubsetList.append (hidden, body))

  val decPos = fn
      DVal (p, _, _, _) => p
    | DType (p, _) => p
    | DDatatype (p, _) => p
    | DOpen (p, _) => p
    | DLocal (p, _, _) => p

  (* --------------------------------------------------------------------------------------- *)
  (* Dropping a qualifier. Outside its structure, `Main.main` refers to a binding of the same
     Workman module, where it is plain `main`. *)

  val unqualify = fn (self, id) =>
    case id of
      (q :: rest, x) => if q = self then (rest, x) else id
    | _ => id

  val rec tyStrip = fn (self, t) =>
    case t of
      TyVar _ => t
    | TyCon (args, id) => TyCon (SmlList.map (fn a => tyStrip (self, a)) args, unqualify (self, id))
    | TyTuple ts => TyTuple (SmlList.map (fn a => tyStrip (self, a)) ts)
    | TyArrow (a, b) => TyArrow (tyStrip (self, a), tyStrip (self, b))
    | TyRecord fields => TyRecord (SmlList.map (fn (l, a) => (l, tyStrip (self, a))) fields)

  val rec patStrip = fn (self, p) =>
    let val go = fn q => patStrip (self, q) in
      case p of
        PId (pos, id) => PId (pos, unqualify (self, id))
      | PRecord (pos, fields) => PRecord (pos, SmlList.map (fn (l, q) => (l, go q)) fields)
      | PTuple ps => PTuple (SmlList.map go ps)
      | PList ps => PList (SmlList.map go ps)
      | PApp (pos, id, q) => PApp (pos, unqualify (self, id), go q)
      | PTyped (q, t) => PTyped (go q, tyStrip (self, t))
      | _ => p
    end

  val rec expStrip = fn (self, e) =>
    let
      val go = fn x => expStrip (self, x)
      val rules = fn rs => SmlList.map (fn (p, x) => (patStrip (self, p), go x)) rs
    in
      case e of
        EId (pos, id) => EId (pos, unqualify (self, id))
      | ERecord (pos, fields) => ERecord (pos, SmlList.map (fn (l, x) => (l, go x)) fields)
      | ETuple es => ETuple (SmlList.map go es)
      | EList es => EList (SmlList.map go es)
      | ESeq es => ESeq (SmlList.map go es)
      | ELet (ds, es) => ELet (SmlList.map (fn d => decStrip (self, d)) ds, SmlList.map go es)
      | EApp (f, a) => EApp (go f, go a)
      | ETyped (x, t) => ETyped (go x, tyStrip (self, t))
      | ECopy (p, source, target, t) => ECopy (p, go source, go target, tyStrip (self, t))
      | EAndalso (a, b) => EAndalso (go a, go b)
      | EOrelse (a, b) => EOrelse (go a, go b)
      | EIf (c, a, b) => EIf (go c, go a, go b)
      | ECase (x, rs) => ECase (go x, rules rs)
      | EFn rs => EFn (rules rs)
      | _ => e
    end

  and decStrip = fn (self, d) =>
    let val rules = fn rs => SmlList.map (fn (p, x) => (patStrip (self, p), expStrip (self, x))) rs in
      case d of
        DVal (pos, vs, plain, recs) => DVal (pos, vs, rules plain, rules recs)
      | DType (pos, binds) => DType (pos, SmlList.map (fn (vs, n, t) => (vs, n, tyStrip (self, t))) binds)
      | DDatatype (pos, binds) =>
          DDatatype (pos, SmlList.map (fn (vs, n, cons) =>
            (vs, n, SmlList.map (fn (cp, c, NONE) => (cp, c, NONE)
                               | (cp, c, SOME t) => (cp, c, SOME (tyStrip (self, t)))) cons)) binds)
      | DOpen (_, _) => d
      | DLocal (pos, hidden, body) =>
          DLocal (pos, SmlList.map (fn d => decStrip (self, d)) hidden, SmlList.map (fn d => decStrip (self, d)) body)
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Coding conventions (docs/conventions.md). Breaking one gives a warning, because the
     Workman output would be invalid or mean something else. *)

  (* Workman keywords that SML treats as ordinary identifiers. *)
  val wmKeywords = ["match", "record", "from", "import", "void"]

  val isUpper = fn s => CompilerText.firstIs (s, SubsetChar.isUpper)

  (* Every identifier written in a phrase, with the nearest known position. *)
  val rec patNames = fn (pos, p) =>
    case p of
      PId (q, (_, x)) => [(q, x)]
    | PRecord (q, fields) => concatMap (fn (l, f) => (q, l) :: patNames (q, f), fields)
    | PTuple ps => concatMap (fn f => patNames (pos, f), ps)
    | PList ps => concatMap (fn f => patNames (pos, f), ps)
    | PApp (q, (_, c), f) => (q, c) :: patNames (q, f)
    | PTyped (f, _) => patNames (pos, f)
    | _ => []

  val rec expNames = fn (pos, e) =>
    let val go = fn x => expNames (pos, x) in
      case e of
        EId (q, (_, x)) => [(q, x)]
      | ERecord (q, fields) => concatMap (fn (l, x) => (q, l) :: expNames (q, x), fields)
      | ESelect (q, l) => [(q, l)]
      | ECopy (_, source, target, _) => SubsetList.append (go source, go target)
      | ETuple es => concatMap (go, es)
      | EList es => concatMap (go, es)
      | ESeq es => concatMap (go, es)
      | ELet (ds, es) => SubsetList.append (concatMap (decNames, ds), concatMap (go, es))
      | EApp (f, a) => SubsetList.append (go f, go a)
      | ETyped (x, _) => go x
      | EAndalso (a, b) => SubsetList.append (go a, go b)
      | EOrelse (a, b) => SubsetList.append (go a, go b)
      | EIf (c, a, b) => SubsetList.concat [go c, go a, go b]
      | ECase (x, rules) => SubsetList.append (go x, ruleNames (pos, rules))
      | EFn rules => ruleNames (pos, rules)
      | EScon (_, _) => []
    end

  and ruleNames = fn (pos, rules) => concatMap (fn (p, e) => SubsetList.append (patNames (pos, p), expNames (pos, e)), rules)

  and decNames = fn
      DVal (pos, _, plain, recs) => ruleNames (pos, SubsetList.append (plain, recs))
    | DType (pos, binds) => SmlList.map (fn (_, tycon, _) => (pos, tycon)) binds
    | DDatatype (pos, binds) =>
        concatMap (fn (_, tycon, cons) => (pos, tycon) :: SmlList.map (fn (cp, c, _) => (cp, c)) cons, binds)
    | DOpen (_, _) => []
    | DLocal (_, hidden, body) => concatMap (decNames, SubsetList.append (hidden, body))

  (* Warnings for one module's declarations and expressions. *)
  val conventionWarnings = fn (decs, exps) =>
    let
      val keyword = fn (pos, x) =>
        if SmlList.exists (fn k => k = x) wmKeywords
        then [(pos, "`" ^ x ^ "` is a Workman keyword; the translation will not parse")]
        else []
      val casing = fn
          DType (pos, binds) =>
            concatMap (fn (_, tycon, _) =>
                         if isUpper tycon then [(pos, "type `" ^ tycon ^ "` should start lowercase")] else [],
                       binds)
        | DDatatype (pos, binds) =>
            concatMap (fn (_, tycon, cons) =>
                         SubsetList.append (
                         (if isUpper tycon then [(pos, "type `" ^ tycon ^ "` should start lowercase")] else []),
                         concatMap (fn (cp, c, _) =>
                                        if isUpper c then []
                                        else [(cp, "constructor `" ^ c ^ "` should start uppercase")], cons)),
                       binds)
        | _ => []
    in
      SubsetList.append (concatMap (keyword, SubsetList.append (concatMap (decNames, decs), concatMap (fn e => expNames (0, e), exps))),
        concatMap (casing, decs))
    end

  val distinct = fn xs =>
    SmlList.foldl (fn (x, acc) => if SmlList.exists (fn y => y = x) acc then acc else SubsetList.append (acc, [x])) [] xs

  (* --------------------------------------------------------------------------------------- *)
  (* Files *)

  (* The file name without directory and extension. *)
  val baseName = fn path =>
    let
      val file =
        case SmlList.rev (CompilerText.fields (path, fn c => c = #"/")) of
          last :: _ => last
        | [] => path
    in
      if CompilerText.isSuffix (file, ".sml") then CompilerText.slice (file, 0, CompilerText.size file - 4) else file
    end

  (* The file's structure name, or "" when it has none. *)
  val structureOf = fn prog =>
    concatMap (fn
        TopDecs sds => concatMap (fn SStructure (_, binds) => SmlList.map (fn (name, _, _) => name) binds | SDec _ => [], sds)
      | TopExp (_, _) => [], prog)

  val structureAliases = fn prog =>
    concatMap (fn
        TopDecs sds => concatMap (fn
            SStructure (_, binds) => concatMap (fn (_, aliases, _) => aliases, binds)
          | SDec _ => [], sds)
      | TopExp (_, _) => [], prog)

  datatype result =
      Output of string * string * (pos * string) list   (* file name, contents, warnings *)
    | TranslateError of string

  (* The file as one module: its structure's name ("" if none), and its phrases in source
     order, with the structure's declarations in place and other phrases unqualified. *)
  val module = fn prog =>
    let
      val self =
        case structureOf prog of
          name :: _ => name
        | [] => ""
      val phrases =
        concatMap (fn
            TopDecs sds =>
              concatMap (fn
                  SStructure (_, binds) => concatMap (fn (_, _, ds) => SmlList.map (fn d => TopDecs [SDec d]) ds, binds)
                | SDec d => [TopDecs [SDec (decStrip (self, d))]], sds)
          | TopExp (p, e) => [TopDecs [SDec
              (DVal (p, [], [(PId (p, ([], "it")), expStrip (self, e))], []))]], prog)
    in
      (self, phrases)
    end

  (* The declarations and expressions of a module's phrases. *)
  val parts = fn phrases =>
    (concatMap (fn TopDecs sds => concatMap (fn SDec d => [d] | SStructure (_, _) => [], sds)
                 | TopExp (_, _) => [], phrases),
     concatMap (fn TopExp (_, e) => [e] | TopDecs _ => [], phrases))

  (* Declaration forms without a WM representation are errors, including inside functions.
     Expression compatibility operators remain supported independently of declarations. *)
  val declarationGaps = fn (structures, prog) =>
    let
      val rec expressions = fn es => concatMap (expression, es)
      and rules = fn rs => SubsetList.append (expressions (SmlList.map (fn (_, e) => e) rs), concatMap (fn (p, _) => patterns p, rs))
      and expression = fn e => case e of
          EScon _ => [] | EId _ => [] | ESelect _ => []
        | ERecord (_, fields) => expressions (SmlList.map (fn (_, e) => e) fields)
        | ETuple es => expressions es | EList es => expressions es | ESeq es => expressions es
        | ELet (ds, es) => SubsetList.append (concatMap (declaration, ds), expressions es)
        | EApp (a, b) => expressions [a, b] | ETyped (e, _) => expression e
        | EAndalso (a, b) => expressions [a, b] | EOrelse (a, b) => expressions [a, b]
        | EIf (a, b, c) => expressions [a, b, c]
        | ECase (e, rs) => SubsetList.append (expression e, rules rs) | EFn rs => rules rs
        | ECopy (_, a, b, _) => expressions [a, b]
      and patterns = fn p => case p of
          PTyped (p, _) => patterns p
        | PRecord (_, fs) => concatMap (fn (_, p) => patterns p, fs)
        | PTuple ps => concatMap (patterns, ps) | PList ps => concatMap (patterns, ps)
        | PApp (_, _, p) => patterns p | _ => []
      and declaration = fn d => case d of
          DVal (_, variables, plain, recs) =>
            SubsetList.append ((if SubsetBool.not (SmlList.null variables) then ["explicit val type variables"]
             else (if SubsetBool.not (SmlList.null plain) andalso SubsetBool.not (SmlList.null recs)
             then ["mixed plain/recursive val bindings"] else [])), rules (SubsetList.append (plain, recs)))
        | DType (_, binds) =>
            (if (case binds of [] => false | [_] => false | _ => true) andalso
              SmlList.exists (fn (_, _, t) => case t of TyRecord _ => true | _ => false) binds
            then ["type groups containing records"] else [])
        | DDatatype _ => []
        | DOpen (_, ids) => if SmlList.all (fn id => SmlList.exists (fn s => [s] = id) structures) ids
            then [] else ["open of a non-project structure"]
        (* Workman has no local blocks: only a structure-level `local` translates (to `private`). *)
        | DLocal _ => ["`local` declarations inside expressions"]
      val rec moduleDeclaration = fn d => case d of
          DLocal (_, hidden, body) => concatMap (moduleDeclaration, SubsetList.append (hidden, body))
        | _ => declaration d
      val top = fn td => case td of
          TopExp (_, e) => expression e
        | TopDecs ds => concatMap (fn SDec d => moduleDeclaration d
            | SStructure (_, binds) => concatMap (fn (_, _, ds) => concatMap (moduleDeclaration, ds), binds), ds)
    in concatMap (top, prog) end

  (* SML and Workman both close an unresolved numeric class to its default (int, or real for `/`)
     at the declaration, so a default carries over. An operand whose class is still open after
     elaboration has no type to translate at; it must be annotated. *)
  val defaultedSite = fn st =>
    let
      val rec unresolved = fn t => case Unify.prune (st, t) of
          Types.TCon (_, ts) => SmlList.exists unresolved ts
        | Types.TVar v => (case Unify.lookup (st, v) of
            Unify.Free (Types.KClass _, _) => SubsetBool.not (Unify.literalVar (st, v))
          | _ => false)
        | Types.TArrow (a, b) => unresolved a orelse unresolved b
        | Types.TRecord fs => SmlList.exists (fn (_, t) => unresolved t) fs
        | _ => false
      val Unify.State (_, _, _, _, sites) = st
    in
      case sites of NONE => NONE | SOME xs =>
        (case SmlList.mapPartial (fn Unify.Operand (pos, t) => if unresolved t then SOME pos else NONE
                                   | _ => NONE) xs of
           [] => NONE
         | pos :: _ => SOME pos)
    end

  val defaultedMessage = "the type of this numeric operation is undecided; annotate it"

  val wmNumbers = fn st => case defaultedSite st of
    NONE => Unify.Ok ((), st)
  | SOME pos => Unify.Err (defaultedMessage, pos)

  (* Bottom-up rewrites of a program's expressions (f) and patterns (g). *)
  val rec mapPat = fn (g, p) =>
    let val go = fn x => mapPat (g, x) in
      g (case p of
           PRecord (q, fs) => PRecord (q, SmlList.map (fn (l, x) => (l, go x)) fs)
         | PTuple ps => PTuple (SmlList.map go ps)
         | PList ps => PList (SmlList.map go ps)
         | PApp (q, id, x) => PApp (q, id, go x)
         | PTyped (x, t) => PTyped (go x, t)
         | _ => p)
    end

  val rec mapExp = fn (f, g, e) =>
    let
      val go = fn x => mapExp (f, g, x)
      val rules = fn rs => SmlList.map (fn (p, x) => (mapPat (g, p), go x)) rs
    in
      f (case e of
           ERecord (p, fs) => ERecord (p, SmlList.map (fn (l, x) => (l, go x)) fs)
         | ETuple es => ETuple (SmlList.map go es)
         | EList es => EList (SmlList.map go es)
         | ESeq es => ESeq (SmlList.map go es)
         | ELet (ds, es) => ELet (SmlList.map (fn d => mapDec (f, g, d)) ds, SmlList.map go es)
         | EApp (a, b) => EApp (go a, go b)
         | ETyped (x, t) => ETyped (go x, t)
         | ECopy (p, source, target, t) => ECopy (p, go source, go target, t)
         | EAndalso (a, b) => EAndalso (go a, go b)
         | EOrelse (a, b) => EOrelse (go a, go b)
         | EIf (c, a, b) => EIf (go c, go a, go b)
         | ECase (x, rs) => ECase (go x, rules rs)
         | EFn rs => EFn (rules rs)
         | _ => e)
    end

  and mapDec = fn (f, g, d) =>
    case d of
      DVal (p, vs, plain, recs) =>
        let val rules = fn rs => SmlList.map (fn (pat, e) => (mapPat (g, pat), mapExp (f, g, e))) rs in
          DVal (p, vs, rules plain, rules recs)
        end
    | DLocal (p, hidden, body) =>
        DLocal (p, SmlList.map (fn d => mapDec (f, g, d)) hidden, SmlList.map (fn d => mapDec (f, g, d)) body)
    | _ => d

  val mapProgramWith = fn (f, g, prog) =>
    SmlList.map (fn
        TopDecs sds => TopDecs (SmlList.map (fn
            SDec d => SDec (mapDec (f, g, d))
          | SStructure (p, binds) => SStructure (p, SmlList.map (fn (n, aliases, ds) =>
              (n, aliases, SmlList.map (fn d => mapDec (f, g, d)) ds)) binds)) sds)
      | TopExp (p, e) => TopExp (p, mapExp (f, g, e))) prog

  val mapProgram = fn (f, prog) => mapProgramWith (f, fn p => p, prog)

  (* The structure that owns a sized numeric type: `Word16` for `Word16.word`. *)
  val sizedStructure = fn t =>
    case t of
      Types.TCon (n, []) =>
        if SmlList.exists (fn m => Unify.sameName (n, m)) (Types.int64Name :: Types.wordNames)
        then SOME (CompilerText.slice (Types.nameOf n, 0, CompilerText.size (Types.nameOf n) - 5))
        else NONE
    | _ => NONE

  (* Workman spells `div` and `mod` per type: an operation the elaboration resolved to a word
     type or Int64.int names that structure's function, `Word16.div`. *)
  val sizedDivision = fn (st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val resolved = SmlList.mapPartial (fn site => case site of
          Unify.Operand (p, t) => (case Unify.prune (st, t) of
             Types.TArrow (_, result) => (case sizedStructure (Unify.prune (st, result)) of
               SOME q => SOME (p, q) | NONE => NONE)
           | _ => NONE)
        | _ => NONE) (case sites of SOME xs => xs | NONE => [])
      val rewrite = fn e =>
        case e of
          EId (p, ([], opr)) =>
            if opr = "div" orelse opr = "mod" then
              (case SmlList.find (fn (q, _) => (p = q)) resolved of
                 SOME found => let val (_, owner) = found in EId (p, ([owner], opr)) end
               | NONE => e)
            else e
        | _ => e
    in
      mapProgram (rewrite, prog)
    end

  (* Translates one parsed file. `structures` names every structure of the program. *)
  val toWm = fn (structures, path, src, source, comments) =>
    let
      (* The file's standalone elaboration, when its environment can be resolved, decides
         numeric defaults and the per-type spelling of `div` and `mod`. *)
      val lenient = case Basis.initial of Unify.Err _ => NONE | Unify.Ok (basis, _) =>
        (case Elab.program (basis, source, Unify.lenient) of Unify.Err _ => NONE
         | Unify.Ok (_, st) => SOME st)
      val prog = case lenient of SOME st => sizedDivision (st, source) | NONE => source
      val (self, phrases) = module prog
      val (decs, exps) = parts phrases
      val used = distinct (SubsetList.append (concatMap (decQuals, decs), concatMap (expQuals, exps)))
      val start =
        case prog of
          TopDecs (SStructure (p, _) :: _) :: _ => p
        | _ => 0
      val aliases = structureAliases prog
      val isAlias = fn q => SmlList.exists (fn (_, name, _) => name = q) aliases
      val imports = SubsetList.append (
        SmlList.map (fn q => Doc.atom (start, "from \"./" ^ WmPrint.fileName q ^ "\" import * as " ^ q ^ ";"))
          (SmlList.filter (fn q => q <> self andalso SubsetBool.not (isAlias q) andalso SmlList.exists (fn s => s = q) structures) used),
        SmlList.map (fn (p, name, target) =>
          Doc.atom (p, "export from \"./" ^ WmPrint.fileName target ^ "\" import * as " ^ name ^ ";")) aliases)
      (* Reject a numeric default when the file's standalone environment can be resolved. *)
      val defaulted = case lenient of NONE => false | SOME st =>
        (case defaultedSite st of SOME _ => true | NONE => false)
      val gaps = SubsetList.append (declarationGaps (structures, phrases),
        (if defaulted then [defaultedMessage] else []))
      val doc = if SmlList.null gaps then Doc.stack (SmlList.map (fn td => WmPrint.topdec (structures, td)) phrases) else Doc.text ""
      val body =
        case imports of
          [] => doc
        | _ => Doc.stack [Doc.stack imports, Doc.text "", doc]
      val expected = WmPrint.fileName self
    in
      if SubsetBool.not (SmlList.null gaps) then
        TranslateError (path ^ ": unsupported WM translation: " ^ SubsetString.concatWith (gaps, ", ") ^
          "; embedded SML declarations are not supported")
      else (if self <> "" andalso expected <> baseName path ^ ".wm" then
        TranslateError (path ^ ": structure " ^ self ^ " must be in a file named "
                        ^ CompilerText.slice (expected, 0, CompilerText.size expected - 3) ^ ".sml")
      else
        Output (baseName path ^ ".wm",
                WmLexer.generatedHeader (baseName path) ^ Doc.render (src, comments, WmPrint.commentStyle, body),
                conventionWarnings (decs, exps)))
    end

  (* Traverse expressions without changing source positions or declaration layout. *)

  (* Native source spelling is a backend mapping, not a change to WM names or FFI keys.
     One project-wide prefix is absent from every input byte string. *)
  val keywordPrefix = BackendNames.prefix

  (* Compatibility entry: the source-list backend uses project-wide binding resolution. *)
  val keywordProgram = fn (prefix, prog) =>
    let val (prog, _, _) = BackendNames.module ("", [], prog, BackendNames.Supply (prefix, 0, []))
    in prog end

  (* Workman equality is ambiguous until elaboration. Only a scalar real comparison is
     rewritten; a second, strict elaboration rejects every remaining invalid SML equality. *)
  (* Whether the module's environment has a structure: the reader's Basis spellings need theirs,
     and translation without the SubsetML Basis keeps the SML Basis spellings. *)
  val hasStructure = fn (env, name) =>
    case Env.structureAt (env, [name]) of SOME _ => true | NONE => false

  (* A type, with a numeric class that only literals decided closed to Workman's literal
     default: Int32 for integer literals, Real64 for real ones. *)
  val decided = fn (st, t) =>
    case Unify.prune (st, t) of
      Types.TVar v => (case Unify.lookup (st, v) of
          Unify.Free (Types.KClass names, _) =>
            let val has = fn m => SmlList.exists (fn n => Unify.sameName (n, m)) names in
              if has Types.intName then Types.TCon (Types.intName, [])
              else (if has Types.realName then Types.TCon (Types.realName, []) else Types.TVar v)
            end
        | _ => Types.TVar v)
    | resolved => resolved

  val realEquality = fn (env, st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val positions = SmlList.mapPartial (fn
          Unify.Operand (p, t) => (case decided (st, t) of
             Types.TCon (n, []) => if Unify.sameName (n, Types.realName) then SOME p else NONE
           | _ => NONE)
        | _ => NONE) (case sites of SOME xs => xs | NONE => [])
      val rewrite = fn e =>
        case e of
          EApp (EId (p, ([], opr)), a) =>
            if (opr = "=" orelse opr = "<>") andalso SmlList.exists (fn q => (p = q)) positions
            then
              (if hasStructure (env, "SubsetReal64") then
                 let val equal = EApp (EId (p, (["SubsetReal64"], "equal")), a) in
                   if opr = "=" then equal else EApp (EId (p, (["SubsetBool"], "not")), equal)
                 end
               else EApp (EId (p, (["Real"], if opr = "=" then "==" else "!=")), a))
            else e
        | _ => e
    in
      mapProgram (rewrite, prog)
    end

  (* A record update read from Workman, `.{ ..source, x = e }`, once the source's record type is
     known: `let val u = source val x' = e in {x = x', y = #y u, ...} end`. The source and the
     replacements are evaluated once, in source order. *)
  val recordUpdates = fn (st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val resolved = SmlList.mapPartial (fn site => case site of
          Unify.Operand (p, t) => (case Unify.prune (st, t) of
             Types.TArrow (a, _) => (case Unify.prune (st, a) of
               Types.TRecord fields => SOME (p, SmlList.map (fn (l, _) => l) fields)
             | _ => NONE)
           | _ => NONE)
        | _ => NONE) (case sites of SOME xs => xs | NONE => [])
      val update = fn check => case check of
          EList [EApp (ESelect (_, label), _), value] => SOME (label, value)
        | _ => NONE
      val rewrite = fn e =>
        case e of
          EApp (EId (p, ([], "`update")),
                ELet ([DVal (q, [], [(PId (_, ([], u)), source)], [])], items)) =>
            (case (SmlList.find (fn (r, _) => (p = r)) resolved, SubsetList.reverse items) of
               (SOME found, _ :: reversedChecks) =>
                 let
                   val (_, labels) = found
                   val updates = SmlList.mapPartial update (SubsetList.reverse reversedChecks)
                   val temporary = fn label => u ^ "_" ^ label
                   val bindings = SmlList.map (fn (label, value) =>
                     DVal (q, [], [(PId (p, ([], temporary label)), value)], [])) updates
                   val fieldFor = fn label =>
                     if SmlList.exists (fn (l, _) => l = label) updates then (label, EId (p, ([], temporary label)))
                     else (label, EApp (ESelect (p, label), EId (p, ([], u))))
                 in
                   ELet (DVal (q, [], [(PId (p, ([], u)), source)], []) :: bindings,
                         [ERecord (p, SmlList.map fieldFor labels)])
                 end
             | _ => e)
        | _ => e
    in
      mapProgram (rewrite, prog)
    end

  (* A backtick string's `${ e }`: the text of e by its resolved type. *)
  (* Workman's `%`, once its operand type is known: `SubsetInt32.rem` or `SubsetReal64.rem`.
     Int64 is MLton-only, like the other sized numbers, and keeps `Int64.rem`. *)
  val remainders = fn (env, st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val resolved = SmlList.mapPartial (fn site => case site of
          Unify.Operand (p, t) => (case Unify.prune (st, t) of
             Types.TArrow (_, r) => (case decided (st, r) of
               Types.TCon (n, []) => SOME (p, n)
             | _ => NONE)
           | _ => NONE)
        | _ => NONE) (case sites of SOME xs => xs | NONE => [])
      val integer = fn p =>
        EId (p, (if hasStructure (env, "SubsetInt32") then ["SubsetInt32"] else ["Int"], "rem"))
      val rewrite = fn e =>
        case e of
          EId (p, ([], "`not")) =>
            EId (p, if hasStructure (env, "SubsetBool") then (["SubsetBool"], "not") else ([], "not"))
        | EId (p, ([], "`rem")) =>
            (case SmlList.find (fn (q, _) => (p = q)) resolved of
               (* Operands that are only literals: Workman's literal default, Int32. *)
               NONE => integer p
             | SOME found =>
                 let val (_, n) = found in
                   if Unify.sameName (n, Types.realName) then
                     EId (p, (if hasStructure (env, "SubsetReal64") then ["SubsetReal64"] else ["Real"], "rem"))
                   else (if Unify.sameName (n, Types.int64Name) then EId (p, (["Int64"], "rem"))
                   else integer p)
                 end)
        | _ => e
    in
      mapProgram (rewrite, prog)
    end

  (* A `user.score` whose record type only the one declared record with `score` decides
     (Elab.settleSelections): SML resolves `#score` from its receiver's type, so the selection
     is written as a complete record pattern, `(fn {level = _, score = v} => v) user`. *)
  val fieldRecords = fn (st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val resolved = SmlList.mapPartial (fn Unify.FieldRecord (p, labels) => SOME (p, labels) | _ => NONE)
        (case sites of SOME xs => xs | NONE => [])
      val rewrite = fn e =>
        case e of
          EApp (ESelect (q, lab), receiver) =>
            (case SmlList.find (fn (p, _) => p = q) resolved of
               NONE => e
             | SOME found =>
                 let
                   val (_, labels) = found
                   val value = (q, ([], "fieldValue"))
                   val pattern = PRecord (q, SmlList.map (fn l => (l, if l = lab then PId value else PWild)) labels)
                 in EApp (EFn [(pattern, EId value)], receiver) end)
        | _ => e
    in
      mapProgram (rewrite, prog)
    end

  (* A Workman record pattern that names some of its annotated record type's fields writes the
     others as wildcards, since a SubsetML record pattern has every label (R3). *)
  val patternRecords = fn (st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val partial = SmlList.mapPartial (fn Unify.PatternRecord (p, labels) => SOME (p, labels) | _ => NONE)
        (case sites of SOME xs => xs | NONE => [])
      val rewrite = fn pat =>
        case pat of
          PRecord (q, fields) =>
            (case SmlList.find (fn (p, _) => p = q) partial of
               NONE => pat
             | SOME found =>
                 let val (_, missing) = found
                 in PRecord (q, SubsetList.append (fields, SmlList.map (fn l => (l, PWild)) missing)) end)
        | _ => pat
    in
      mapProgramWith (fn e => e, rewrite, prog)
    end

  (* The structures a program declares: a translated module is one. *)
  val ownStructures = fn prog =>
    concatMap (fn TopDecs sds => concatMap (fn SStructure (_, bs) => SmlList.map (fn (n, _, _) => n) bs | _ => [], sds)
                | TopExp _ => [], prog)

  (* Workman's display of a value as text, as `print` and backtick strings show it: a function
     from the type's values to their text, or NONE for a type with no portable display. *)
  val displayOf = fn (env, own, st) =>
    let
      val generalized = case st of
          Unify.State (_, _, _, _, SOME sites) => SmlList.mapPartial (fn Unify.Generalized v => SOME v | _ => NONE) sites
        | _ => []
      val text = fn (p, value) => EScon (p, SString value)
      (* A datatype's constructors, and the path that names them here: a type of this module's
         own structure is named unqualified, since its constructors are in scope. *)
      val datatypeOf = fn nominal =>
        let
          val rec find = fn (Env.Env (structures, types, _), path) =>
            case SmlList.find (fn (_, Env.TyStr (_, body, constructors)) => case body of
                Types.TCon (name, _) => Unify.sameName (name, nominal) andalso SubsetBool.not (SmlList.null constructors)
              | _ => false) types of
              SOME entry => let val (_, Env.TyStr (_, _, constructors)) = entry in SOME (path, constructors) end
            | NONE =>
                let val rec inner = fn structures => case structures of
                    [] => NONE
                  | (n, (body, _)) :: rest =>
                      (case find (body, SubsetList.append (path, [n])) of
                         SOME found => SOME found
                       | NONE => inner rest)
                in inner structures end
          val unqualified = fn path => case path of
              first :: rest => if SmlList.exists (fn n => n = first) own then rest else path
            | [] => []
        in
          case find (env, []) of
            SOME found => let val (path, constructors) = found in SOME (unqualified path, constructors) end
          | NONE => NONE
        end
      val rec sameType = fn (a, b) => case (Unify.prune (st, a), Unify.prune (st, b)) of
          (Types.TCon (m, xs), Types.TCon (n, ys)) => Unify.sameName (m, n) andalso sameTypes (xs, ys)
        | (Types.TRecord xs, Types.TRecord ys) =>
            sameTypes (SmlList.map (fn (_, t) => t) xs, SmlList.map (fn (_, t) => t) ys)
            andalso SmlList.map (fn (l, _) => l) xs = SmlList.map (fn (l, _) => l) ys
        | (Types.TArrow (a1, b1), Types.TArrow (a2, b2)) => sameType (a1, a2) andalso sameType (b1, b2)
        | (Types.TVar v, Types.TVar w) => v = w
        | _ => false
      and sameTypes = fn (xs, ys) => case (xs, ys) of
          ([], []) => true
        | (x :: xs, y :: ys) => sameType (x, y) andalso sameTypes (xs, ys)
        | _ => false
      val rec join = fn (p, pieces) => case pieces of
          [] => text (p, "")
        | [only] => only
        | first :: rest => EApp (EId (p, ([], "^")), ETuple [first, join (p, rest)])
      val name = fn (depth, index) =>
        "printValue" ^ CompilerText.natural depth ^ "_" ^ CompilerText.natural index
      val named = fn (t, n) => Types.nameOf n = t
      (* A function from the type's values to their display, or NONE. *)
      val rec display = fn (p, depth, t, active) =>
        let
          val variable = fn index => (p, ([], name (depth, index)))
          val apply = fn (f, index) => EApp (f, EId (variable index))
          val one = fn body => SOME (EFn [(PId (variable 0), body)])
          (* A datatype shows as `Ctor`, `Ctor(x)` or `Ctor(a, b)`, through a recursive helper, so a
             recursive type refers back to it. Helpers are named by depth, which grows inward, so
             an inner helper never shadows an outer one. *)
          val userType = fn (n, args) =>
            case SmlList.find (fn (u, _) => sameType (u, Types.TCon (n, args))) active of
              SOME entry => let val (_, helper) = entry in SOME (EId (p, ([], helper))) end
            | NONE =>
                (case datatypeOf n of
                   NONE => NONE
                 | SOME found =>
                     let
                       val (path, constructors) = found
                       val helper = "printType" ^ CompilerText.natural depth
                       val active' = (Types.TCon (n, args), helper) :: active
                       val rec arms = fn constructors => case constructors of
                           [] => SOME []
                         | (c, (_, body)) :: rest =>
                             let
                               val arm = case Types.substGen (args, body) of
                                   Types.TArrow (argument, _) =>
                                     (case display (p, depth + 1, argument, active') of
                                        NONE => NONE
                                      | SOME f =>
                                          let
                                            val tuple = case Unify.prune (st, argument) of
                                                Types.TRecord fields => SmlList.exists (fn (l, _) => l = "1") fields
                                              | _ => false
                                            val shown = apply (f, 0)
                                          in
                                            SOME (PApp (p, (path, c), PId (variable 0)),
                                                  if tuple then join (p, [text (p, c), shown])
                                                  else join (p, [text (p, c ^ "("), shown, text (p, ")")]))
                                          end)
                                 | _ => SOME (PId (p, (path, c)), text (p, c))
                             in
                               case (arm, arms rest) of
                                 (SOME a, SOME more) => SOME (a :: more)
                               | _ => NONE
                             end
                     in
                       case arms constructors of
                         NONE => NONE
                       | SOME cases =>
                           SOME (ELet ([DVal (p, [], [], [(PId (p, ([], helper)), EFn cases)])],
                                       [EId (p, ([], helper))]))
                     end)
        in
          case decided (st, t) of
            Types.TCon (n, []) =>
              if Unify.sameName (n, Types.stringName) then one (EId (variable 0))
              else (if Unify.sameName (n, Types.charName) then SOME (EId (p, (["SubsetString"], "fromChar")))
              else (if Unify.sameName (n, Types.intName) then SOME (EId (p, (["SubsetInt32"], "toString")))
              else (if Unify.sameName (n, Types.int64Name) then SOME (EId (p, (["Int64"], "toString")))
              else (if Unify.sameName (n, Types.realName) then SOME (EId (p, (["SubsetReal64"], "toString")))
              else (if Unify.sameName (n, Types.boolName)
                then one (EIf (EId (variable 0), text (p, "true"), text (p, "false")))
              else userType (n, []))))))
          | Types.TRecord [] => SOME (EFn [(PWild, text (p, "void"))])
          | Types.TRecord fields =>
              let
                val tuple = SmlList.exists (fn (l, _) => l = "1") fields
                val rec parts = fn (fields, index) => case fields of
                    [] => SOME []
                  | (label, ft) :: rest =>
                      (case (display (p, depth + 1, ft, active), parts (rest, index + 1)) of
                         (SOME f, SOME more) => SOME ((label, index, f) :: more)
                       | _ => NONE)
              in
                case parts (fields, 0) of
                  NONE => NONE
                | SOME ps =>
                    let
                      val shown = SmlList.map (fn (label, index, f) =>
                        if tuple then apply (f, index)
                        else join (p, [text (p, label ^ " = "), apply (f, index)])) ps
                      val rec separated = fn xs => case xs of
                          [] => [] | [x] => [x] | x :: rest => x :: text (p, ", ") :: separated rest
                      val pattern = if tuple then PTuple (SmlList.map (fn (_, index, _) => PId (variable index)) ps)
                        else PRecord (p, SmlList.map (fn (label, index, _) => (label, PId (variable index))) ps)
                    in
                      SOME (EFn [(pattern, join (p, SubsetList.concat [
                        [text (p, if tuple then "(" else "{ ")], separated shown, [text (p, if tuple then ")" else " }")]]))])
                    end
              end
          | Types.TCon (n, [element]) =>
              if Unify.sameName (n, Types.listName) then
                (case display (p, depth + 1, element, active) of
                   NONE => NONE
                 | SOME f => one (join (p, [text (p, "["),
                     EApp (EId (p, (["SubsetString"], "concatWith")), ETuple [
                       EApp (EId (p, (["SubsetList"], "map")), ETuple [EId (variable 0), f]),
                       text (p, ", ")]),
                     text (p, "]")])))
              else (if named ("option", n) then
                (case display (p, depth + 1, element, active) of
                   NONE => NONE
                 | SOME f => SOME (EFn [
                     (PApp (p, (["SubsetOptionValue"], "SOME"), PId (variable 0)),
                      join (p, [text (p, "Some("), apply (f, 0), text (p, ")")])),
                     (PId (p, (["SubsetOptionValue"], "NONE")), text (p, "None"))]))
              else userType (n, [element]))
          | Types.TCon (n, [okType, errType]) =>
              if named ("result", n) then
                (case (display (p, depth + 1, okType, active), display (p, depth + 1, errType, active)) of
                   (SOME f, SOME g) => SOME (EFn [
                     (PApp (p, (["SubsetResultValue"], "Ok"), PId (variable 0)),
                      join (p, [text (p, "Ok("), apply (f, 0), text (p, ")")])),
                     (PApp (p, (["SubsetResultValue"], "Err"), PId (variable 0)),
                      join (p, [text (p, "Err("), apply (g, 0), text (p, ")")]))])
                 | _ => NONE)
              else userType (n, [okType, errType])
          | Types.TCon (n, args) => userType (n, args)
          (* A variable no binding generalized and nothing decided, as in `print(None)`: a closed
             value has no part of that type, so this display is never applied. *)
          | Types.TVar v => if SmlList.exists (fn w => w = v) generalized then NONE
              else SOME (EFn [(PWild, text (p, ""))])
          | _ => NONE
        end
    in fn (p, depth, t) => display (p, depth, t, []) end

  (* Workman's `print`, once its argument type is known: `SubsetIo.printLine` of the value's
     display, as Workman shows it. Text and characters appear as they are, numbers as Workman
     writes them, `void` as `void`, and tuples, lists, records, Option and Result structurally:
     `(1, a)`, `[1, 2]`, `{ x = 1 }`, `Some(2)`. A tuple argument is several arguments,
     `print(a, b)`. A type with no display here keeps the marker, which the target check reports. *)
  val printing = fn (env, st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val resolved = SmlList.mapPartial (fn site => case site of
          Unify.Operand (p, t) => (case Unify.prune (st, t) of
             Types.TArrow (a, _) => SOME (p, a)
           | _ => NONE)
        | _ => NONE) (case sites of SOME xs => xs | NONE => [])
      val display = displayOf (env, ownStructures prog, st)
      val line = fn (p, shown) => EApp (EId (p, (["SubsetIo"], "printLine")), shown)
      val rewrite = fn e =>
        case e of
          (* Without the SubsetML Basis, `print` is SML's, on text. *)
          EId (p, ([], "`print")) =>
            if SubsetBool.not (hasStructure (env, "SubsetIo")) then EId (p, ([], "print")) else
            (case SmlList.find (fn (q, _) => (p = q)) resolved of
               NONE => e
             | SOME found =>
                 let val (_, t) = found in
                   case display (p, 0, t) of
                     NONE => e
                   | SOME f => EFn [(PId (p, ([], "printArgument")), line (p, EApp (f, EId (p, ([], "printArgument")))))]
                 end)
        | EApp (EId (p, ([], "`print")), value) =>
            if SubsetBool.not (hasStructure (env, "SubsetIo")) then EApp (EId (p, ([], "print")), value) else
            (case SmlList.find (fn (q, _) => (p = q)) resolved of
               NONE => e
             | SOME found =>
                 let val (_, t) = found in
                   case display (p, 0, t) of
                     NONE => e
                   | SOME f => line (p, EApp (f, value))
                 end)
        | _ => e
    in
      mapProgram (rewrite, prog)
    end

  val templateText = fn (env, st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val resolved = SmlList.mapPartial (fn site => case site of
          Unify.Operand (p, t) => (case Unify.prune (st, t) of
             Types.TArrow (a, _) => SOME (p, a)
           | _ => NONE)
        | _ => NONE) (case sites of SOME xs => xs | NONE => [])
      val display = displayOf (env, ownStructures prog, st)
      val call = fn (p, path, e) => EApp (EId (p, path), e)
      val spelled = fn (structureName, name, fallback) =>
        if hasStructure (env, structureName) then ([structureName], name) else fallback
      val rewrite = fn e =>
        case e of
          EApp (EId (p, ([], "`show")), value) =>
            (case SmlList.find (fn (q, _) => (p = q)) resolved of
               NONE => e
             | SOME found =>
                 let
                   val (_, t) = found
                   (* Other types show as `print` shows them, with the Basis. *)
                   val shown = fn () =>
                     if SubsetBool.not (hasStructure (env, "SubsetList")) then e else
                     (case display (p, 0, t) of NONE => e | SOME f => EApp (f, value))
                 in
                   case decided (st, t) of
                     Types.TCon (n, []) =>
                   let val is = fn m => Unify.sameName (n, m) in
                   if is Types.stringName then value
                   else (if is Types.charName then call (p, spelled ("SubsetString", "fromChar", (["String"], "str")), value)
                   else (if is Types.intName then call (p, spelled ("SubsetInt32", "toString", (["Int"], "toString")), value)
                   else (if is Types.int64Name then call (p, (["Int64"], "toString"), value)
                   else (if is Types.realName then call (p, spelled ("SubsetReal64", "toString", (["Real"], "toString")), value)
                   else (if is Types.boolName
                     then EIf (value, EScon (p, SString "true"), EScon (p, SString "false"))
                   else shown ())))))
                   end
                   | _ => shown ()
                 end)
        | _ => e
    in
      mapProgram (rewrite, prog)
    end

  (* A Workman integer literal whose context made it real or a word is printed as an SML real or
     word constant: `1` as `1.0`, `0x1F` as `0wx1F`. *)
  val realLiterals = fn (st, prog) =>
    let
      val Unify.State (_, _, _, _, sites) = st
      val isWord = fn n => SmlList.exists (fn m => Unify.sameName (n, m)) Types.wordNames
      val isReal = fn n => Unify.sameName (n, Types.realName) orelse Unify.sameName (n, Types.real32Name)
      val kinds = SmlList.mapPartial (fn site => case site of
          Unify.Literal (p, t) => (case Unify.prune (st, t) of
             Types.TCon (n, []) => if isReal n then SOME (p, true) else (if isWord n then SOME (p, false) else NONE)
           | _ => NONE)
        | _ => NONE) (case sites of SOME xs => xs | NONE => [])
      val hex = fn text => SubsetList.exists (CompilerText.characters text, fn c => c = #"x")
      val constant = fn (p, c) =>
        case (c, SmlList.find (fn (q, _) => (p = q)) kinds) of
          (SInt text, SOME (_, true)) => if hex text then c else SReal (text ^ ".0")
        | (SInt text, SOME (_, false)) =>
            if CompilerText.size text > 0 andalso CompilerText.slice (text, 0, 1) = "~" then c
            else (if hex text then SWord ("0wx" ^ CompilerText.drop (text, 2)) else SWord ("0w" ^ text))
        | _ => c
      val rewrite = fn e => case e of EScon (p, c) => EScon (p, constant (p, c)) | _ => e
      val pattern = fn pat => case pat of PScon (p, c) => PScon (p, constant (p, c)) | _ => pat
    in
      mapProgramWith (rewrite, pattern, prog)
    end

  (* WM can generalize a pure function-field alias; SML selector applications cannot.
     Probe in the declaration's actual environment, then wrap only a known function.
     The probe state is discarded: the emitted expression is elaborated normally, so
     captured monomorphic variables keep their levels and ordinary partial applications
     retain their source restriction. This first pass handles module-level bindings. *)
  val portableValues = fn (env, prog, st) =>
    let
      val used = concatMap (fn TopDecs sds => concatMap (fn SDec d => decNames d
        | SStructure (_, bs) => concatMap (fn (_, _, ds) => concatMap (decNames, ds), bs), sds)
        | TopExp (p, e) => expNames (p, e), prog)
      val fresh = fn n => BackendNames.avoid (SmlList.map (fn (_, x) => x) used, n)
      val rec options = fn xs =>
        case xs of [] => SOME [] | NONE :: _ => NONE
        | SOME x :: rest => (case options rest of SOME xs => SOME (x :: xs) | NONE => NONE)
      (* Find a visible nominal constructor, including imported datatypes. Only identity
         aliases qualify: an alias with permuted/fixed arguments is not a spelling for it. *)
      val typeName = fn (env, nominal) =>
        let
          val rec identity = fn (i, args) => case args of [] => true
            | Types.TGen j :: rest => (i = j) andalso identity (i + 1, rest)
            | _ => false
          val rec find = fn (Env.Env (structures, types, _), path) =>
            let
              val rec localType = fn (types, seen) => case types of [] => NONE
                | (n, Env.TyStr (arity, body, _)) :: rest =>
                    if SmlList.exists (fn x => x = n) seen then localType (rest, seen)
                    else (case body of Types.TCon (name, args) =>
                      if Unify.sameName (name, nominal) andalso (arity = Types.arityOf nominal)
                        andalso identity (0, args) then SOME (path, n)
                      else localType (rest, n :: seen)
                    | _ => localType (rest, n :: seen))
              val rec imported = fn (structures, seen) => case structures of [] => NONE
                | (n, (body, _)) :: rest =>
                    if SmlList.exists (fn x => x = n) seen then imported (rest, seen)
                    else (case find (body, SubsetList.append (path, [n])) of SOME id => SOME id
                      | NONE => imported (rest, n :: seen))
            in case localType (types, []) of SOME id => SOME id | NONE => imported (structures, []) end
        in if Types.stampOf nominal < Types.firstStamp then SOME ([], Types.nameOf nominal)
           else find (env, []) end
      val copy = fn (env, p, source, target, layout, st) =>
        case layout of TyCon (parameters, id) =>
          let val variables = concatMap (fn TyVar v => [v] | _ => [], parameters) in
            Unify.bind (Elab.exp ((env, 1, []), source, st)) (fn sourceType => fn probe =>
              Unify.bind (Elab.mapRes (fn (v, probe) =>
                let val (t, probe) = Unify.fresh (probe, Types.KPlain, 1)
                in Unify.Ok ((v, t), probe) end, variables, probe)) (fn arguments => fn probe =>
                Unify.bind (Elab.elabTy (env, fn v => Env.assoc (v, arguments), p, layout, probe))
                  (fn layoutType => fn probe =>
                    Unify.bind (Elab.unifyAt (probe, p, "copied layout", layoutType, sourceType)) (fn _ => fn probe =>
                      Unify.bind (Elab.closeDeclaration (0, probe)) (fn _ => fn probe =>
                        let
                          val rec syntaxType = fn t => case Unify.prune (probe, t) of
                              Types.TVar v => (case Unify.lookup (probe, v) of
                                Unify.Free (kind, level) => if level <= 0 then NONE
                                  else (case kind of Types.KClass _ => NONE | _ =>
                                    SOME (TyVar ((case kind of Types.KEq => "''" | _ => "'") ^
                                      fresh ("subsetmlCopy" ^ CompilerText.natural p ^ "Variable" ^ CompilerText.natural v))))
                              | _ => NONE)
                            | Types.TRigid _ => NONE
                            | Types.TGen _ => NONE
                            | Types.TArrow (a, b) => (case (syntaxType a, syntaxType b) of
                                (SOME a, SOME b) => SOME (TyArrow (a, b)) | _ => NONE)
                            | Types.TCon (n, args) => (case (typeName (env, n), options (SmlList.map syntaxType args)) of
                                (SOME id, SOME args) => SOME (TyCon (args, id)) | _ => NONE)
                            | Types.TRecord [] => SOME (TyCon ([], ([], "unit")))
                            | Types.TRecord fields => (case Types.tupleComponents fields of
                                SOME types => (case options (SmlList.map syntaxType types) of
                                  SOME types => SOME (TyTuple types) | NONE => NONE)
                              | NONE => NONE)
                          val inferred = options (SmlList.map (fn (_, t) => syntaxType t) arguments)
                          val expanded = case target of ERecord (q, fields) =>
                              ERecord (q, SmlList.map (fn (label, value) =>
                                let val argument = fresh ("subsetmlCopy" ^ CompilerText.natural p ^ "_" ^ label)
                                in (label, EFn [(PId (p, ([], argument)), EApp (value, EId (p, ([], argument))))]) end) fields)
                            | _ => target
                        in Unify.Ok ((case inferred of SOME args => ETyped (expanded, TyCon (args, id))
                          | NONE => source), st) end)))))
          end
        | _ => Unify.Ok (source, st)
      val expression = fn (env, p, e, st) =>
        case e of
          ECopy (p, source, target, layout) => copy (env, p, source, target, layout, st)
        |
          EApp (ESelect (_, _), EId (_, _)) =>
            Unify.bind (Elab.exp ((env, 1, []), e, st)) (fn t => fn probe =>
              Unify.bind (Elab.closeDeclaration (0, probe)) (fn _ => fn probe =>
                case Unify.prune (probe, t) of
                  Types.TArrow (_, _) =>
                    let val arg = fresh ("subsetmlAlias" ^ CompilerText.natural p)
                    in Unify.Ok (EFn [(PId (p, ([], arg)), EApp (e, EId (p, ([], arg))))], st) end
                | _ => Unify.Ok (e, st)))
        | _ => Unify.Ok (e, st)
      val rec declaration = fn (env, d, st) =>
        case d of
          DVal (p, vs, [(pattern, e)], []) =>
            (case pattern of
               PId (_, ([], _)) => Unify.bind (expression (env, p, e, st)) (fn e => fn st =>
                 Unify.Ok (DVal (p, vs, [(pattern, e)], []), st))
             | _ => Unify.Ok (d, st))
        (* Workman's `private`: rewrite both parts, each in its scope. The probe state is
           discarded; the caller elaborates the rewritten `local` itself. *)
        | DLocal (p, hidden, body) =>
            Unify.bind (declarations (env, hidden, st)) (fn (private, hidden') => fn probe =>
              Unify.bind (declarations (Env.plus (env, private), body, probe)) (fn (_, body') => fn _ =>
                Unify.Ok (DLocal (p, hidden', body'), st)))
        | _ => Unify.Ok (d, st)
      and declarations = fn (env, ds, st) =>
        case ds of [] => Unify.Ok ((Env.empty, []), st)
        | d :: rest => Unify.bind (declaration (env, d, st)) (fn d => fn st =>
            Unify.bind (Elab.dec ((env, 0, []), d, st)) (fn delta => fn st =>
              Unify.bind (declarations (Env.plus (env, delta), rest, st)) (fn (more, rest) => fn st =>
                Unify.Ok ((Env.plus (delta, more), d :: rest), st))))
      val structureDec = fn (env, sd, st) =>
        case sd of SDec d => Unify.bind (declaration (env, d, st)) (fn d => fn st =>
          Unify.bind (Elab.dec ((env, 0, []), d, st)) (fn delta => fn st => Unify.Ok ((delta, SDec d), st)))
        | SStructure (p, bs) =>
            Unify.bind (Elab.foldRes (fn ((delta, output), (n, aliases, ds), st) =>
              Unify.bind (Elab.structureAliases (env, aliases, st)) (fn nested => fn st =>
                Unify.bind (declarations (Env.plus (env, nested), ds, st)) (fn (body, ds) => fn st =>
                  Unify.Ok ((Env.plus (delta, Env.withStructure (n, Env.plus (nested, body), false)), SubsetList.append (output, [(n, aliases, ds)])), st))),
              (Env.empty, []), bs, st)) (fn (delta, bs) => fn st =>
                Unify.Ok ((delta, SStructure (p, bs)), st))
      val rec structures = fn (env, sds, st) =>
        case sds of [] => Unify.Ok ((Env.empty, []), st)
        | sd :: rest => Unify.bind (structureDec (env, sd, st)) (fn (delta, sd) => fn st =>
              Unify.bind (structures (Env.plus (env, delta), rest, st)) (fn (more, rest) => fn st =>
                Unify.Ok ((Env.plus (delta, more), sd :: rest), st)))
      val rec phrases = fn (env, prog, st) =>
        case prog of [] => Unify.Ok ((env, []), st)
        | td :: rest =>
            Unify.bind (case td of TopDecs sds =>
              Unify.bind (structures (env, sds, st)) (fn (delta, sds) => fn st =>
                Unify.Ok ((delta, TopDecs sds), st))
              | _ => Unify.bind (Elab.topdec (env, td, st)) (fn delta => fn st =>
                Unify.Ok ((delta, td), st))) (fn (delta, td) => fn st =>
                Unify.bind (phrases (Env.plus (env, delta), rest, st)) (fn (env, rest) => fn st =>
                  Unify.Ok ((env, td :: rest), st)))
    in phrases (env, prog, st) end

  (* Check dependencies before a module, regardless of the command-line order. Every
     recovery starts with its dependency closure, so unrelated input files remain independent. *)
  val recover = fn (modules, target) =>
    let
      (* A round trip reproduces the SML it started from, so the reader keeps SML's spellings. *)
      val smlSpelling = Env.Env ([], [], [])
      val nameOfModule = fn (_, _, prog, _) =>
        case structureOf prog of n :: _ => n | [] => ""
      val rec decDeps = fn d =>
        case d of
          DOpen (_, ids) => concatMap (head, ids)
        | _ => decQuals d
      val deps = fn (_, _, prog, _) =>
        distinct (concatMap (fn
            TopDecs sds => concatMap (fn SDec d => decDeps d
              | SStructure (_, bs) => concatMap (fn (_, aliases, ds) =>
                  SubsetList.append (SmlList.map (fn (_, _, target) => target) aliases, concatMap (decDeps, ds)), bs), sds)
          | TopExp (_, e) => expQuals e, prog))
      val rec order = fn (item, visiting, done, acc) =>
        let val name = nameOfModule item in
          if SmlList.exists (fn n => n = name) done then Unify.Ok ((done, acc), Unify.initial)
          else (if SmlList.exists (fn n => n = name) visiting then
            Unify.Err ("cyclic module dependency involving " ^ name, 0)
          else
            let
              val needed = SmlList.filter (fn m => nameOfModule m <> name andalso
                SmlList.exists (fn n => n = nameOfModule m) (deps item)) modules
              val rec walk = fn
                  ([], done, acc) => Unify.Ok ((name :: done, SubsetList.append (acc, [item])), Unify.initial)
                | (m :: rest, done, acc) =>
                    Unify.bind (order (m, name :: visiting, done, acc)) (fn (done, acc) => fn _ =>
                      walk (rest, done, acc))
            in walk (needed, done, acc) end)
        end
      val rec elaborate = fn
          (_, [], st, acc) => Unify.Ok (acc, st)
        | (env, (path, src, prog, comments) :: rest, st, acc) =>
            let val Unify.State (vars, next, sels, recs, _) = st in
              Unify.bind (portableValues (env, prog, Unify.State (vars, next, sels, recs, SOME [])))
                (fn (env, prog) => fn st => Unify.bind (wmNumbers st) (fn _ => fn st =>
                  elaborate (env, rest, st, SubsetList.append (acc, [(path, src, recordUpdates (st, printing (smlSpelling, st, remainders (smlSpelling, st, templateText (smlSpelling, st, realLiterals (st, realEquality (smlSpelling, st, fieldRecords (st, patternRecords (st, prog)))))))), comments)]))))
            end
      val rec strict = fn
          (_, [], st) => Unify.Ok ((), st)
        | (env, (_, _, prog, _) :: rest, st) =>
            Unify.bind (Elab.program (env, prog, st)) (fn env => fn st => strict (env, rest, st))
    in
      Unify.bind (order (target, [], [], [])) (fn (_, ordered) => fn _ =>
        let
          val prefix = BackendNames.prefix (SmlList.map (fn (path, src, _, _) => (path, src)) ordered)
          val (planned, names) = BackendNames.project (prefix,
            SmlList.map (fn m => (nameOfModule m, deps m, m)) ordered)
          val ordered = SmlList.map (fn (_, _, m) => m) planned
        in case BackendNames.failure names of
          SOME (_, p, message) => Unify.Err (message, p)
        | NONE => Unify.bind Basis.initial (fn basis => fn _ =>
          Unify.bind (elaborate (basis, ordered, Unify.lenient, [])) (fn rewritten => fn _ =>
            Unify.bind (strict (basis, rewritten, Unify.initial)) (fn _ => fn st =>
              case SmlList.find (fn m => nameOfModule m = nameOfModule target) rewritten of
                SOME m => Unify.Ok (m, st)
              | NONE => Unify.Err ("missing translated module", 0)))) end)
    end

  (* Modules arrive in resolved dependency order. Each checker sees only direct imports;
     cache owned structure environments, never an importer's ambient environment. *)
  (* A project error names its module ahead of the message, so the caller can report it at the
     module's own source position; `unlocated` splits the two again. *)
  val located = fn (path, message) => path ^ "\n" ^ message
  val unlocated = fn message =>
    case CompilerText.fields (message, fn c => c = #"\n") of
      path :: first :: rest => SOME (path, SubsetString.concatWith (first :: rest, "\n"))
    | _ => NONE

  val recoverProjectWithRuntime = fn (runtime, modules) =>
    let
      val working = fn (basis, cache, dependencies) =>
        SmlList.foldl (fn (name, result) => Unify.bind result (fn env => fn st =>
          case SmlList.find (fn (key, _) => key = name) cache of
            NONE => Unify.Err ("missing resolved dependency " ^ name, 0)
          | SOME (_, body) => Unify.Ok (Env.plus (env, Env.withStructure (name, body, false)), st)))
          (Unify.Ok (basis, Unify.initial)) dependencies
      val own = fn (env, name) =>
        case Env.structureAt (env, [name]) of
          NONE => Unify.Err ("missing translated structure " ^ name, 0)
        | SOME (body, _) =>
            let val selected = case runtime of SOME key => key = name | NONE => false
                val valid = case Env.value (body, ([], "panic")) of
                  SOME (([Types.KPlain], Types.TArrow (Types.TCon (tn, []), Types.TGen index)), Env.SValue) =>
                    (Types.stampOf tn = Types.stampOf Types.stringName) andalso (index = 0)
                | _ => false
            in if selected andalso SubsetBool.not valid then
                 Unify.Err ("panic runtime must export panic : string -> 'a", 0)
               else Unify.Ok (body, Unify.initial) end
      val rec rewrite = fn (basis, remaining, cache, st, acc) =>
        case remaining of
          [] => Unify.Ok (SmlList.rev acc, st)
        | (name, dependencies, (path, src, prog, cs)) :: rest =>
            Unify.bind (working (basis, cache, dependencies)) (fn env => fn _ =>
              let val Unify.State (vars, next, sels, recs, _) = st in
                case Unify.bind (portableValues (env, prog, Unify.State (vars, next, sels, recs, SOME [])))
                  (fn (exports, rewritten) => fn next => Unify.bind (wmNumbers next) (fn _ => fn next =>
                    Unify.bind (own (exports, name)) (fn body => fn _ =>
                      Unify.Ok ((body, rewritten), next)))) of
                  Unify.Err (message, pos) => Unify.Err (located (path, message), pos)
                | Unify.Ok ((body, rewritten), next) =>
                    rewrite (basis, rest, (name, body) :: cache, next,
                      (name, dependencies, (path, src, recordUpdates (next, printing (Env.plus (env, body), next, remainders (env, next, templateText (Env.plus (env, body), next, realLiterals (next, realEquality (env, next, fieldRecords (next, patternRecords (next, rewritten)))))))), cs)) :: acc)
              end)
      val rec strict = fn (basis, remaining, cache, st) =>
        case remaining of
          [] => Unify.Ok ((), st)
        | (name, dependencies, (path, _, prog, _)) :: rest =>
            Unify.bind (working (basis, cache, dependencies)) (fn env => fn _ =>
              case Unify.bind (Elab.programExports (env, prog, st)) (fn exports => fn next =>
                Unify.bind (own (exports, name)) (fn body => fn _ => Unify.Ok (body, next))) of
                Unify.Err (message, pos) => Unify.Err (located (path, message), pos)
              | Unify.Ok (body, next) => strict (basis, rest, (name, body) :: cache, next))
    in
      Unify.bind Basis.initial (fn basis => fn _ =>
        Unify.bind (rewrite (basis, modules, [], Unify.lenient, [])) (fn rewritten => fn _ =>
          Unify.bind (strict (basis, rewritten, [], Unify.initial)) (fn _ => fn st =>
            Unify.Ok (SmlList.map (fn (_, _, m) => m) rewritten, st))))
    end

  val recoverProject = fn modules => recoverProjectWithRuntime (NONE, modules)

  (* A Workman module as SubsetML: its declarations become the structure named by the file. *)
  val fromWmNamed = fn (name, aliases, src, decs, exps, comments) =>
    let
      (* Imports disappear from the AST. Anchor the structure before them, so comments
         between an import and the first declaration stay inside the structure. *)
      val first =
        case WmLexer.lex src of
          WmLexer.Tokens ((WmLexer.WKey "from", p) :: _, _) => SOME p
        | WmLexer.Tokens ((WmLexer.WName ["export"], p) :: (WmLexer.WKey "from", _) :: _, _) => SOME p
        | _ => (case decs of d :: _ => SOME (decPos d) | [] => NONE)
      val structureLine =
        case first of
          SOME p => Doc.atom (p, "structure " ^ name ^ " = struct")
        | NONE => Doc.text ("structure " ^ name ^ " = struct")
      val structureDoc =
        Doc.stack [structureLine,
                   Doc.indent (2, Doc.stack (SubsetList.append (
                     SmlList.map (fn (p, alias, target) => Doc.atom (p, "structure " ^ alias ^ " = " ^ target)) aliases,
                     SmlList.map SmlPrint.dec decs))),
                   Doc.text "end"]
      val expDocs = SmlList.map (fn e => Doc.cat (SmlPrint.exp e, Doc.text ";")) exps
      val doc =
        case expDocs of
          [] => structureDoc
        | _ => Doc.stack (Doc.cat (structureDoc, Doc.text ";") :: expDocs)
    in
      Doc.render (src, comments, SmlPrint.commentStyle, doc)
    end

  val fromWm = fn (path, src, decs, exps, comments) =>
    fromWmNamed (WmParse.structureName path, WmParse.structureAliases src, src, decs, exps, comments)

  (* Reprints a parsed file as SubsetML. *)
  val toSml = fn (src, prog, comments) =>
    let
      (* A declaration phrase needs its `;` when an expression phrase follows (Definition §8). *)
      val rec phrases = fn
          [] => []
        | TopDecs sds :: (TopExp (pos, e) :: rest) =>
            Doc.cat (SmlPrint.topdec (TopDecs sds), Doc.text ";") :: phrases (TopExp (pos, e) :: rest)
        | td :: rest => SmlPrint.topdec td :: phrases rest
    in
      Doc.render (src, comments, SmlPrint.commentStyle, Doc.stack (phrases prog))
    end

end
