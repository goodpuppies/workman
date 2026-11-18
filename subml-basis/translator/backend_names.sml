(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./subset_list.sml" import * as SubsetList;
from "./subset_string.sml" import * as SubsetString;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_char.sml" import * as SubsetChar;
from "./elab.sml" import * as Elab;
*)

(* Shared target spelling and lexical binding resolution. Module keys are supplied by the
   canonical project planner. A binding has its own allocation even when source names repeat. *)
structure BackendNames = struct
  open SubsetOptionValue

  datatype binding = Binding of string * string * bool
  datatype scope = Scope of binding list * binding list
  datatype symbol = Symbol of int * string * Syntax.pos * string * string * string
    | RuntimeUse of string * Syntax.pos
    | Invalid of string * Syntax.pos * string
  datatype supply = Supply of string * int * symbol list

  val keywords = ["abstype", "and", "andalso", "as", "case", "datatype", "do", "else", "end",
    "exception", "fn", "fun", "handle", "if", "in", "infix", "infixr", "let", "local", "nonfix",
    "of", "op", "open", "orelse", "raise", "rec", "then", "type", "val", "with", "withtype",
    "eqtype", "functor", "include", "sharing", "sig", "signature", "struct", "structure", "where", "while",
    (* Infix at top level in the SML Basis Library, so a native build can't use them as
       ordinary names; SubsetML itself leaves them unbound. `div` and `mod` are operators. *)
    "before", "o"]
  val member = fn (names, name) => SubsetList.exists (names, fn n => n = name)
  val prefix = fn sources =>
    let
      val rec starts = fn (text, needle) =>
        case needle of [] => true | n :: ns =>
          (case text of t :: ts => t = n andalso starts (ts, ns) | [] => false)
      val rec contains = fn (text, needle) =>
        starts (text, needle) orelse (case text of _ :: rest => contains (rest, needle) | [] => false)
      val rec choose = fn candidate =>
        if SubsetList.exists (sources, fn (_, src) => contains
          (CompilerText.characters src, CompilerText.characters candidate)) then choose (candidate ^ "_") else candidate
    in choose "subsetmlKeyword_" end

  (* Existing lowering passes can reserve deterministic hints through this shared allocator.
     They pass the visible/generated names they must avoid, rather than adding local policies. *)
  val rec avoid = fn (used, hint) =>
    if member (used, hint) then avoid (used, hint ^ "_") else hint

  (* Filesystem stems are hints, not SML identifiers. Normalize separators and prefix
     empty/digit-leading names; the project allocator still resolves spelling collisions. *)
  val moduleHint = fn stem =>
    let
      val pieces = CompilerText.fields (stem, fn c => SubsetBool.not (SubsetChar.isAlphaNum c))
      val capitalize = fn text => case CompilerText.characters text of
        [] => "" | first :: rest => CompilerText.implode (SubsetChar.toUpper first :: rest)
      val hint = CompilerText.implode (SubsetList.concat
        (SubsetList.map (pieces, fn text => CompilerText.characters (capitalize text))))
    in case CompilerText.characters hint of
      [] => "Module"
    | first :: _ => if SubsetChar.isAlpha first then hint else "Module" ^ hint
    end

  val empty = Scope ([], [])
  val plus = fn (Scope (av, at), Scope (bv, bt)) => Scope (SubsetList.append (bv, av), SubsetList.append (bt, at))
  val lookup = fn (bindings, name) => SubsetList.find (bindings, fn Binding (source, _, _) => source = name)
  val label = fn (prefix, name) => if member (keywords, name) then prefix ^ "Label_" ^ name else name
  val fresh = fn (Supply (prefix, next, symbols), owner, pos, space, name, constructor) =>
    let
      val unsafe = member (keywords, name) orelse
        (space = "value" andalso SubsetBool.not constructor andalso member (Elab.omittedConstructors, name))
      val target = if unsafe then prefix ^ space ^ CompilerText.natural next ^ "_" ^ name else name
      val symbol = Symbol (next, owner, pos, space, name, target)
    in (Binding (name, target, constructor), Supply (prefix, next + 1, symbol :: symbols)) end

  (* Every new lowering temporary uses the same collision-free project supply. *)
  val generated = fn (Supply (prefix, next, symbols), owner, pos, hint) =>
    let val target = prefix ^ "generated" ^ CompilerText.natural next ^ "_" ^ hint
    in (target, Supply (prefix, next + 1,
      Symbol (next, owner, pos, "generated", hint, target) :: symbols)) end

  val failure = fn Supply (_, _, symbols) =>
    case SubsetList.find (symbols, fn Invalid _ => true | _ => false) of
      SOME (Invalid (owner, pos, message)) => SOME (owner, pos, message)
    | _ => NONE

  val diagnostic = fn (Supply (_, _, symbols), message) =>
    let
      val rec begins = fn (text, prefix) => case prefix of [] => true
        | c :: rest => (case text of x :: xs => c = x andalso begins (xs, rest) | [] => false)
      val rec skip = fn (text, prefix) => case prefix of [] => text
        | _ :: rest => (case text of _ :: xs => skip (xs, rest) | [] => [])
      val rec replace = fn (text, prefix, replacement) =>
        if begins (text, prefix) then SubsetList.append (replacement, replace (skip (text, prefix), prefix, replacement))
        else case text of [] => [] | c :: rest => c :: replace (rest, prefix, replacement)
    in SubsetList.foldLeft (symbols, message, fn (symbol, message) => case symbol of
      Symbol (_, _, _, _, source, target) =>
        if source = target then message else CompilerText.stringOf
          (replace (CompilerText.characters message, CompilerText.characters target, CompilerText.characters source))
    | RuntimeUse _ => message
    | Invalid _ => message) end

  val validate = fn (supply, owner, pos, Scope (values, types)) =>
    let
      val duplicate = fn bindings => SubsetList.find (bindings, fn Binding (source, _, _) =>
        SubsetList.length32 (SubsetList.filter (bindings, fn Binding (other, _, _) => source = other)) > 1)
      val add = fn (supply, bindings) => case duplicate bindings of NONE => supply
        | SOME (Binding (source, _, _)) =>
            let val Supply (prefix, next, symbols) = supply
            in Supply (prefix, next, Invalid (owner, pos, "duplicate source binding " ^ source) :: symbols) end
    in add (add (supply, values), types) end

  (* The scopes a module's structure aliases and opens add to its imports, keyed by dotted path,
     so `Os.Process.x` finds its members the way `Process.x` does. *)
  val flatMap = fn (items, f) => SubsetList.concat (SubsetList.map (items, f))
  val pathUnder = fn (key, name) =>
    let val prefix = name ^ "." in
      if CompilerText.size key > CompilerText.size prefix andalso
        CompilerText.slice (key, 0, CompilerText.size prefix) = prefix
      then SOME (CompilerText.drop (key, CompilerText.size prefix))
      else NONE
    end
  val nestedScopes = fn (imports, target) =>
    flatMap (imports, fn (key, scope) => case pathUnder (key, target) of
      SOME path => [(path, scope)] | NONE => [])
  val structureScopes = fn (imports, prog) =>
    flatMap (prog, fn
        Syntax.TopDecs sds => flatMap (sds, fn
            Syntax.SStructure (_, binds) => flatMap (binds, fn (_, aliases, ds) =>
              SubsetList.append (
                flatMap (aliases, fn (_, name, target) =>
                  SubsetList.append (
                    SubsetList.map (SubsetList.filter (imports, fn (key, _) => key = target), fn (_, scope) => (name, scope)),
                    SubsetList.map (nestedScopes (imports, target), fn (path, scope) => (name ^ "." ^ path, scope)))),
                flatMap (ds, fn
                    Syntax.DOpen (_, paths) => flatMap (paths, fn
                        [target] => nestedScopes (imports, target)
                      | _ => [])
                  | _ => [])))
          | Syntax.SDec _ => [])
      | Syntax.TopExp (_, _) => [])

  val moduleWithRuntime = fn (runtime, owner, imports, prog, initial) =>
    let
      val Supply (prefix, _, _) = initial
      val imports = SubsetList.append (structureScopes (imports, prog), imports)
      val scopeAt = fn qualifiers =>
        SubsetList.find (imports, fn (key, _) => key = SubsetString.concatWith (qualifiers, "."))
      val resolve = fn (Scope (values, types), space, (qualifiers, name)) =>
        let
          val bindings = case qualifiers of [] => if space = "value" then values else types
            | _ => (case scopeAt qualifiers of
                NONE => [] | SOME (_, Scope (values, types)) => if space = "value" then values else types)
        in case lookup (bindings, name) of NONE => (qualifiers, name)
          | SOME (Binding (_, target, _)) => (qualifiers, target) end
      val isConstructor = fn (Scope (values, _), (qualifiers, name)) =>
        let val bindings = case qualifiers of [] => values
          | _ => (case scopeAt qualifiers of
              NONE => [] | SOME (_, Scope (values, _)) => values)
        in case lookup (bindings, name) of SOME (Binding (_, _, constructor)) => constructor
          | NONE => member (["true", "false", "nil", "::", "NONE", "SOME", "LESS", "EQUAL", "GREATER"], name) end
      val rec ty = fn (env, t) =>
        case t of Syntax.TyVar _ => t
        | Syntax.TyCon (args, id) => Syntax.TyCon (SubsetList.map (args, fn t => ty (env, t)), resolve (env, "type", id))
        | Syntax.TyTuple ts => Syntax.TyTuple (SubsetList.map (ts, fn t => ty (env, t)))
        | Syntax.TyArrow (a, b) => Syntax.TyArrow (ty (env, a), ty (env, b))
        | Syntax.TyRecord fs => Syntax.TyRecord (SubsetList.map (fs, fn (l, t) => (label (prefix, l), ty (env, t))))
      val rec pairFields = fn (fields, ps) => case (fields, ps) of
          ((l, _) :: fs, p :: ps) => (label (prefix, l), p) :: pairFields (fs, ps)
        | _ => []
      val rec pattern = fn (env, pat, supply) =>
        case pat of
          Syntax.PId (p, ("`constructor" :: _, name)) =>
            (* WM constructor aliases are ordinary native values. Their pattern uses have
               already been redirected to the defining datatype by WmScope. *)
            pattern (env, Syntax.PId (p, (["`bind"], name)), supply)
        | Syntax.PId (p, (["`bind"], name)) =>
            (* A generated named export binds a value even when its spelling would be an
               existing constructor pattern. Rename that collision before printing SML. *)
            if isConstructor (env, ([], name)) then
              let val (target, next) = generated (supply, owner, p, "export_" ^ name)
              in (Syntax.PId (p, ([], target)), Scope ([Binding (name, target, false)], []), next) end
            else let val (binding, next) = fresh (supply, owner, p, "value", name, false)
                     val Binding (_, target, _) = binding
                 in (Syntax.PId (p, ([], target)), Scope ([binding], []), next) end
        | Syntax.PId (p, ([], name)) =>
            if isConstructor (env, ([], name)) then (Syntax.PId (p, resolve (env, "value", ([], name))), empty, supply)
            else let val (binding, next) = fresh (supply, owner, p, "value", name, false)
                  val Binding (_, target, _) = binding
              in (Syntax.PId (p, ([], target)), Scope ([binding], []), next) end
        | Syntax.PPinned (p, id) =>
            (if isConstructor (env, id) then Syntax.PId (p, resolve (env, "value", id))
             else Syntax.PPinned (p, resolve (env, "value", id)), empty, supply)
        | Syntax.PId (p, id) => (Syntax.PId (p, resolve (env, "value", id)), empty, supply)
        | Syntax.PRecord (p, fs) =>
            let val (patterns, bindings, next) = patterns (env, SubsetList.map (fs, fn (_, p) => p), supply)
            in (Syntax.PRecord (p, pairFields (fs, patterns)), bindings, next) end
        | Syntax.PTuple ps => let val (ps, bindings, next) = patterns (env, ps, supply)
            in (Syntax.PTuple ps, bindings, next) end
        | Syntax.PList ps => let val (ps, bindings, next) = patterns (env, ps, supply)
            in (Syntax.PList ps, bindings, next) end
        | Syntax.PApp (p, id, arg) => let val (arg, bindings, next) = pattern (env, arg, supply)
            in (Syntax.PApp (p, resolve (env, "value", id), arg), bindings, next) end
        | Syntax.PTyped (pat, t) => let val (pat, bindings, next) = pattern (env, pat, supply)
            in (Syntax.PTyped (pat, ty (env, t)), bindings, next) end
        | _ => (pat, empty, supply)
      and patterns = fn (env, ps, supply) => case ps of
          [] => ([], empty, supply)
        | p :: rest => let val (p, bindings, next) = pattern (env, p, supply)
                          val (rest, more, next) = patterns (env, rest, next)
                      in (p :: rest, plus (bindings, more), validate (next, owner, 0, plus (bindings, more))) end

      val rec guarded = fn pat => case pat of
          Syntax.PScon (_, Syntax.SReal _) => true
        | Syntax.PPinned _ => true
        | Syntax.PComputed _ => true
        | Syntax.PRecord (_, fs) => SubsetList.exists (fs, fn (_, p) => guarded p)
        | Syntax.PTuple ps => SubsetList.exists (ps, guarded)
        | Syntax.PList ps => SubsetList.exists (ps, guarded)
        | Syntax.PApp (_, _, p) => guarded p
        | Syntax.PTyped (p, _) => guarded p
        | _ => false
      val id = fn (p, name) => Syntax.EId (p, ([], name))
      val variable = fn (p, name) => Syntax.PId (p, ([], name))
      val binding = fn (p, name, e) => Syntax.DVal (p, [], [(variable (p, name), e)], [])
      (* Pin aliases are evaluated outside the pattern's binders. The alias preserves the
         resolved outer value even when a same-spelled binder appears in this pattern. *)
      val rec checks = fn (pat, supply) =>
        let
          val compare = fn (p, rhs, operator, aliases, next) =>
            let val (name, next) = generated (next, owner, p, "pattern")
            in (variable (p, name), [Syntax.EApp (Syntax.EId (p, operator),
                 Syntax.ETuple [id (p, name), rhs])], aliases, next) end
        in case pat of
          Syntax.PScon (p, Syntax.SReal s) =>
            compare (p, Syntax.EScon (p, Syntax.SReal s), (["Real"], "=="), [], supply)
        | Syntax.PPinned (p, path) =>
            let val (name, next) = generated (supply, owner, p, "pin")
            in compare (p, id (p, name), ([], "="),
                 [binding (p, name, Syntax.EId (p, path))], next) end
        | Syntax.PRecord (p, fs) =>
            let val (ps, guards, aliases, next) = checkList (SubsetList.map (fs, fn (_, p) => p), supply)
            in (Syntax.PRecord (p, pairFields (fs, ps)), guards, aliases, next) end
        | Syntax.PTuple ps => let val (ps, guards, aliases, next) = checkList (ps, supply)
            in (Syntax.PTuple ps, guards, aliases, next) end
        | Syntax.PList ps => let val (ps, guards, aliases, next) = checkList (ps, supply)
            in (Syntax.PList ps, guards, aliases, next) end
        | Syntax.PApp (p, path, arg) => let val (arg, guards, aliases, next) = checks (arg, supply)
            in (Syntax.PApp (p, path, arg), guards, aliases, next) end
        | Syntax.PTyped (pat, t) => let val (pat, guards, aliases, next) = checks (pat, supply)
            in (Syntax.PTyped (pat, t), guards, aliases, next) end
        | _ => (pat, [], [], supply) end
      and checkList = fn (ps, supply) => case ps of
          [] => ([], [], [], supply)
        | p :: rest => let val (p, guards, aliases, next) = checks (p, supply)
                          val (rest, more, moreAliases, next) = checkList (rest, next)
                      in (p :: rest, SubsetList.append (guards, more), SubsetList.append (aliases, moreAliases), next) end
      val rec conditions = fn (guards, yes, no) => case guards of
          [] => yes | guard :: rest => Syntax.EIf (guard, conditions (rest, yes, no), no)
      val rec hasComputed = fn pat => case pat of
          Syntax.PComputed _ => true
        | Syntax.PRecord (_, fs) => SubsetList.exists (fs, fn (_, p) => hasComputed p)
        | Syntax.PTuple ps => SubsetList.exists (ps, hasComputed)
        | Syntax.PList ps => SubsetList.exists (ps, hasComputed)
        | Syntax.PApp (_, _, p) => hasComputed p
        | Syntax.PTyped (p, _) => hasComputed p
        | _ => false
      (* Place closures outside the arm's binders, but call them only when their guard is
         reached. Safe authored names intentionally retain their spelling in this backend. *)
      val rec computedAliases = fn (pat, supply) => case pat of
          Syntax.PComputed (p, value) =>
            let val (name, next) = generated (supply, owner, p, "computed")
            in (Syntax.PComputed (p, Syntax.EApp (id (p, name), Syntax.ETuple [])),
              [binding (p, name, Syntax.EFn [(Syntax.PTuple [], value)])], next) end
        | Syntax.PPinned (p, path) =>
            let val (name, next) = generated (supply, owner, p, "pin")
            in (Syntax.PPinned (p, ([], name)), [binding (p, name, Syntax.EId (p, path))], next) end
        | Syntax.PTuple ps => let val (ps, aliases, next) = computedAliasList (ps, supply)
            in (Syntax.PTuple ps, aliases, next) end
        | Syntax.PList ps => let val (ps, aliases, next) = computedAliasList (ps, supply)
            in (Syntax.PList ps, aliases, next) end
        | Syntax.PRecord (p, fs) =>
            let val rec fields = fn (fs, supply) => case fs of
                  [] => ([], [], supply)
                | (name, pat) :: rest => let val (pat, aliases, next) = computedAliases (pat, supply)
                                            val (rest, more, next) = fields (rest, next)
                  in ((name, pat) :: rest, SubsetList.append (aliases, more), next) end
                val (fs, aliases, next) = fields (fs, supply)
            in (Syntax.PRecord (p, fs), aliases, next) end
        | Syntax.PApp (p, constructor, inner) => let val (inner, aliases, next) = computedAliases (inner, supply)
            in (Syntax.PApp (p, constructor, inner), aliases, next) end
        | Syntax.PTyped (inner, t) => let val (inner, aliases, next) = computedAliases (inner, supply)
            in (Syntax.PTyped (inner, t), aliases, next) end
        | _ => (pat, [], supply)
      and computedAliasList = fn (ps, supply) => case ps of
          [] => ([], [], supply)
        | p :: rest => let val (p, aliases, next) = computedAliases (p, supply)
                           val (rest, more, next) = computedAliasList (rest, next)
                       in (p :: rest, SubsetList.append (aliases, more), next) end
      (* Computed guards can have effects. Match one structural layer at a time, then visit
         children in source order: a later shape mismatch must not skip an earlier expression.
         Outer expression closures are protected separately from same-spelled arm binders. *)
      val rec matchPattern = fn (subject, pat, yes, no, supply) =>
        let
          val compare = fn (p, value, operator) =>
            (Syntax.EIf (Syntax.EApp (Syntax.EId (p, operator), Syntax.ETuple [subject, value]), yes, no), supply)
          val rec subjects = fn (ps, supply) => case ps of
              [] => ([], supply)
            | _ :: rest => let val (name, next) = generated (supply, owner, 0, "component")
                                val (names, next) = subjects (rest, next)
                            in (name :: names, next) end
          val split = fn (ps, build) =>
            let val (names, next) = subjects (ps, supply)
                val (body, next) = matchChildren (names, ps, yes, no, next)
            in (Syntax.ECase (subject,
              [(build (SubsetList.map (names, fn name => variable (0, name))), body), (Syntax.PWild, no)]), next) end
        in case pat of
          Syntax.PWild => (yes, supply)
        | Syntax.PComputed (p, value) => compare (p, value, ([], "="))
        | Syntax.PPinned (p, path) => compare (p, Syntax.EId (p, path), ([], "="))
        | Syntax.PScon (p, Syntax.SReal value) => compare (p, Syntax.EScon (p, Syntax.SReal value), (["Real"], "=="))
        | Syntax.PTyped (inner, t) => matchPattern (Syntax.ETyped (subject, t), inner, yes, no, supply)
        | Syntax.PTuple ps => split (ps, Syntax.PTuple)
        | Syntax.PRecord (p, fs) =>
            let val rec fields = fn (fs, ps) => case (fs, ps) of
                  ((name, _) :: rest, item :: items) => (name, item) :: fields (rest, items)
                | _ => []
            in split (SubsetList.map (fs, fn (_, p) => p), fn ps => Syntax.PRecord (p, fields (fs, ps))) end
        | Syntax.PList [] => (Syntax.ECase (subject, [(pat, yes), (Syntax.PWild, no)]), supply)
        | Syntax.PList (p :: ps) => matchPattern (subject,
            Syntax.PApp (0, ([], "::"), Syntax.PTuple [p, Syntax.PList ps]), yes, no, supply)
        | Syntax.PApp (p, ([], "::"), Syntax.PTuple ps) =>
            split (ps, fn ps => Syntax.PApp (p, ([], "::"), Syntax.PTuple ps))
        | Syntax.PApp (p, constructor, inner) =>
            let val (name, next) = generated (supply, owner, p, "payload")
                val (body, next) = matchPattern (id (p, name), inner, yes, no, next)
            in (Syntax.ECase (subject,
              [(Syntax.PApp (p, constructor, variable (p, name)), body), (Syntax.PWild, no)]), next) end
        | _ => (Syntax.ECase (subject, [(pat, yes), (Syntax.PWild, no)]), supply)
        end
      and matchChildren = fn (names, ps, yes, no, supply) => case (names, ps) of
          (name :: names, p :: ps) =>
            let val (rest, next) = matchChildren (names, ps, yes, no, supply)
            in matchPattern (id (0, name), p, rest, no, next) end
        | _ => (yes, supply)
      (* Continuations live outside branch binders. Their bodies are not duplicated, and
         constructing a thunk does not execute later branches or evaluate their pins. *)
      val rec matchRules = fn (subject, rs, supply) =>
        if SubsetBool.not (SubsetList.exists (rs, fn (p, _) => guarded p)) then (Syntax.ECase (subject, rs), supply)
        else case rs of [] => (Syntax.ECase (subject, []), supply)
        | (pat, body) :: rest =>
            let
              val computed = hasComputed pat
              val (pat, guards, aliases, next) = if computed then
                let val (pat, aliases, next) = computedAliases (pat, supply)
                in (pat, [], aliases, next) end
                else checks (pat, supply)
              val (name, next) = generated (next, owner, 0, "next")
              val (fallback, next) = case rest of
                  [] => let val (result, next) = generated (next, owner, 0, "unmatched")
                        in (Syntax.ECase (Syntax.EList [],
                          [(Syntax.PList [variable (0, result)], id (0, result))]), next) end
                | _ => matchRules (subject, rest, next)
              val call = Syntax.EApp (id (0, name), Syntax.ETuple [])
              val (branch, next) = if computed then matchPattern (subject, pat, body, call, next)
                else (Syntax.ECase (subject,
                  [(pat, conditions (guards, body, call)), (Syntax.PWild, call)]), next)
            in (Syntax.ELet (binding (0, name, Syntax.EFn [(Syntax.PTuple [], fallback)]) :: aliases,
                 [branch]), next) end
      val matchCase = fn (subject, rs, supply) =>
        if SubsetList.exists (rs, fn (p, _) => guarded p) then
          let val (name, next) = generated (supply, owner, 0, "subject")
              val (body, next) = matchRules (id (0, name), rs, next)
          in (Syntax.ELet ([binding (0, name, subject)], [body]), next) end
        else (Syntax.ECase (subject, rs), supply)

      val rec expression = fn (env, e, supply) =>
        let
          val unary = fn (constructor, e) => let val (e, next) = expression (env, e, supply) in (constructor e, next) end
          val binary = fn (constructor, a, b) =>
            let val (a, next) = expression (env, a, supply)
                val (b, next) = expression (env, b, next) in (constructor (a, b), next) end
        in case e of
          Syntax.EId (p, ([], "Panic")) =>
            let val Scope (values, _) = env in
              case lookup (values, "Panic") of
                SOME _ => (Syntax.EId (p, resolve (env, "value", ([], "Panic"))), supply)
              | NONE => let val Supply (prefix, next, symbols) = supply in
                  case runtime of
                    SOME name => (Syntax.EId (p, ([name], "panic")),
                      Supply (prefix, next, RuntimeUse (owner, p) :: symbols))
                  | NONE => (e, Supply (prefix, next, Invalid (owner, p,
                      "built-in Panic requires --panic-runtime FILE.wm for reverse translation") :: symbols))
                end
            end
        | Syntax.EId (p, id) => (Syntax.EId (p, resolve (env, "value", id)), supply)
        | Syntax.ESelect (p, l) => (Syntax.ESelect (p, label (prefix, l)), supply)
        | Syntax.ERecord (p, fs) =>
            let val (es, next) = expressions (env, SubsetList.map (fs, fn (_, e) => e), supply)
            in (Syntax.ERecord (p, pairFields (fs, es)), next) end
        | Syntax.ETuple es => let val (es, next) = expressions (env, es, supply) in (Syntax.ETuple es, next) end
        | Syntax.EList es => let val (es, next) = expressions (env, es, supply) in (Syntax.EList es, next) end
        | Syntax.ESeq es => let val (es, next) = expressions (env, es, supply) in (Syntax.ESeq es, next) end
        | Syntax.ELet (ds, es) => let val (ds, localEnv, _, next) = declarations (env, ds, supply)
                                    val (es, next) = expressions (localEnv, es, next)
                                in (Syntax.ELet (ds, es), next) end
        | Syntax.EApp (a, b) => binary (Syntax.EApp, a, b)
        | Syntax.ETyped (e, t) => unary (fn e => Syntax.ETyped (e, ty (env, t)), e)
        | Syntax.EAndalso (a, b) => binary (Syntax.EAndalso, a, b)
        | Syntax.EOrelse (a, b) => binary (Syntax.EOrelse, a, b)
        | Syntax.EIf (c, a, b) => let val (c, next) = expression (env, c, supply)
                                    val (a, next) = expression (env, a, next)
                                    val (b, next) = expression (env, b, next)
                                in (Syntax.EIf (c, a, b), next) end
        | Syntax.ECase (e, rs) => let val (e, next) = expression (env, e, supply)
                                     val (rs, next) = rules (env, rs, next)
                                 in matchCase (e, rs, next) end
        | Syntax.EFn rs =>
            let val (rs, next) = rules (env, rs, supply)
            in if SubsetList.exists (rs, fn (p, _) => guarded p) then
              let val (name, next) = generated (next, owner, 0, "argument")
                  val (body, next) = matchRules (id (0, name), rs, next)
              in (Syntax.EFn [(variable (0, name), body)], next) end
            else (Syntax.EFn rs, next) end
        | Syntax.ECopy (p, a, b, t) => let val (a, next) = expression (env, a, supply)
                                         val (b, next) = expression (env, b, next)
                                     in (Syntax.ECopy (p, a, b, ty (env, t)), next) end
        | _ => (e, supply) end
      and expressions = fn (env, es, supply) => case es of
          [] => ([], supply)
        | e :: rest => let val (e, next) = expression (env, e, supply)
                          val (rest, next) = expressions (env, rest, next) in (e :: rest, next) end
      and rules = fn (env, rs, supply) => case rs of
          [] => ([], supply)
        | (pat, e) :: rest => let val (pat, next) = computedPattern (env, pat, supply)
                                 val (pat, bindings, next) = pattern (env, pat, next)
                                 val (e, next) = expression (plus (env, bindings), e, next)
                                 val (rest, next) = rules (env, rest, next)
                             in ((pat, e) :: rest, next) end
      and computedPattern = fn (env, pat, supply) => case pat of
          Syntax.PComputed (p, value) =>
            let val (value, next) = expression (env, value, supply) in (Syntax.PComputed (p, value), next) end
        | Syntax.PTuple ps => let val (ps, next) = computedPatterns (env, ps, supply) in (Syntax.PTuple ps, next) end
        | Syntax.PList ps => let val (ps, next) = computedPatterns (env, ps, supply) in (Syntax.PList ps, next) end
        | Syntax.PRecord (p, fs) =>
            let val rec fields = fn (fs, supply) => case fs of
                  [] => ([], supply)
                | (name, pat) :: rest => let val (pat, next) = computedPattern (env, pat, supply)
                                            val (rest, next) = fields (rest, next)
                                        in ((name, pat) :: rest, next) end
                val (fs, next) = fields (fs, supply)
            in (Syntax.PRecord (p, fs), next) end
        | Syntax.PApp (p, constructor, inner) =>
            let val (inner, next) = computedPattern (env, inner, supply) in (Syntax.PApp (p, constructor, inner), next) end
        | Syntax.PTyped (inner, t) =>
            let val (inner, next) = computedPattern (env, inner, supply) in (Syntax.PTyped (inner, t), next) end
        | _ => (pat, supply)
      and computedPatterns = fn (env, ps, supply) => case ps of
          [] => ([], supply)
        | pat :: rest => let val (pat, next) = computedPattern (env, pat, supply)
                            val (rest, next) = computedPatterns (env, rest, next)
                        in (pat :: rest, next) end
      and declaration = fn (env, d, supply) =>
        case d of
          Syntax.DVal (p, vs, plain, recs) =>
            let
              val (plainPs, plainDelta, next) = patterns (env, SubsetList.map (plain, fn (pat, _) => pat), supply)
              val (recPs, recDelta, next) = patterns (env, SubsetList.map (recs, fn (pat, _) => pat), next)
              val next = if SubsetList.exists (SubsetList.append (plainPs, recPs), guarded) then
                let val Supply (prefix, count, symbols) = next
                in Supply (prefix, count, Invalid (owner, p,
                  "numeric/pinned binding patterns are outside the reverse-WM profile; use match") :: symbols) end
                else next
              val (plainEs, next) = expressions (env, SubsetList.map (plain, fn (_, e) => e), next)
              val (recEs, next) = expressions (plus (env, recDelta), SubsetList.map (recs, fn (_, e) => e), next)
              val rec zip = fn (ps, es) => case (ps, es) of
                  (p :: ps, e :: es) => (p, e) :: zip (ps, es)
                (* Both lists originate from the same binding group. *)
                | _ => []
            in (Syntax.DVal (p, vs, zip (plainPs, plainEs), zip (recPs, recEs)),
                plus (plainDelta, recDelta), validate (next, owner, p, plus (plainDelta, recDelta))) end
        | Syntax.DType (p, bs) =>
            let val (names, delta, next) = typeBindings (p, bs, supply)
            in (Syntax.DType (p, typeAliases (env, bs, names)), delta, validate (next, owner, p, delta)) end
        | Syntax.DDatatype (p, bs) =>
            let
              val (names, types, next) = datatypeTypes (p, bs, supply)
              val (bs, values, next) = datatypes (plus (env, types), bs, names, next)
            in (Syntax.DDatatype (p, bs), plus (types, values), validate (next, owner, p, plus (types, values))) end
        | Syntax.DOpen (p, paths) =>
            let val delta = SubsetList.foldLeft (paths, empty, fn (path, acc) =>
              case path of [name] => (case SubsetList.find (imports, fn (key, _) => key = name) of
                SOME (_, body) => plus (acc, body) | NONE => acc) | _ => acc)
            in (d, delta, supply) end
        (* The body sees the hidden declarations; only the body's bindings are declared. *)
        | Syntax.DLocal (p, hidden, body) =>
            let
              val (hidden, _, hiddenDelta, next) = declarations (env, hidden, supply)
              val (body, _, bodyDelta, next) = declarations (plus (env, hiddenDelta), body, next)
            in (Syntax.DLocal (p, hidden, body), bodyDelta, next) end
      and typeBindings = fn (p, bs, supply) => case bs of
          [] => ([], empty, supply)
        | (_, name, _) :: rest => let val (binding, next) = fresh (supply, owner, p, "type", name, false)
                                     val Binding (_, target, _) = binding
                                     val (names, more, next) = typeBindings (p, rest, next)
                                 in (target :: names, plus (Scope ([], [binding]), more), next) end
      and datatypeTypes = fn (p, bs, supply) =>
        typeBindings (p, SubsetList.map (bs, fn (vs, name, _) => (vs, name, Syntax.TyVar "'unused")), supply)
      and typeAliases = fn (env, bs, names) => case (bs, names) of
          ((vs, _, t) :: bs, name :: names) => (vs, name, ty (env, t)) :: typeAliases (env, bs, names)
        | _ => []
      and datatypes = fn (env, bs, names, supply) => case (bs, names) of
          ((vs, _, cs) :: rest, name :: names) =>
            let val (cs, bindings, next) = constructors (env, cs, supply)
                val (rest, more, next) = datatypes (env, rest, names, next)
            in ((vs, name, cs) :: rest, plus (bindings, more), next) end
        | _ => ([], empty, supply)
      and constructors = fn (env, cs, supply) => case cs of
          [] => ([], empty, supply)
        | (p, name, arg) :: rest => let val (binding, next) = fresh (supply, owner, p, "value", name, true)
                                      val Binding (_, target, _) = binding
                                      val (rest, more, next) = constructors (env, rest, next)
                                  in ((p, target, case arg of NONE => NONE | SOME t => SOME (ty (env, t))) :: rest,
                                      plus (Scope ([binding], []), more), next) end
      and declarations = fn (env, ds, supply) => case ds of
          [] => ([], env, empty, supply)
        | d :: rest => let val (d, delta, next) = declaration (env, d, supply)
                          val (rest, final, more, next) = declarations (plus (env, delta), rest, next)
                      in (d :: rest, final, plus (delta, more), next) end

      val rec phrases = fn (prog, exports, supply) => case prog of
          [] => ([], exports, supply)
        | Syntax.TopDecs [Syntax.SStructure (p, [(name, aliases, ds)])] :: rest =>
            let val (ds, _, body, next) = declarations (empty, ds, supply)
                val (rest, exports, next) = phrases (rest, body, next)
            in (Syntax.TopDecs [Syntax.SStructure (p, [(name, aliases, ds)])] :: rest, exports, next) end
        | Syntax.TopExp (p, e) :: rest =>
            let val (e, next) = expression (exports, e, supply)
                val (rest, exports, next) = phrases (rest, exports, next)
            in (Syntax.TopExp (p, e) :: rest, exports, next) end
        | phrase :: rest => let val (rest, exports, next) = phrases (rest, exports, supply)
                            in (phrase :: rest, exports, next) end
    in phrases (prog, empty, initial) end

  val module = fn (owner, imports, prog, initial) =>
    moduleWithRuntime (NONE, owner, imports, prog, initial)

  val runtimeUsed = fn (Supply (_, _, symbols), owner) =>
    SubsetList.exists (symbols, fn RuntimeUse (name, _) => name = owner | _ => false)

  val projectWithRuntime = fn (runtime, prefix, modules) =>
    let
      val rec loop = fn (modules, cache, supply) => case modules of
          [] => ([], supply)
        | (name, dependencies, (path, src, prog, cs)) :: rest =>
            let val imports = SubsetList.filter (cache, fn (key, _) =>
                  SubsetList.exists (dependencies, fn dependency =>
                    key = dependency orelse (case pathUnder (key, dependency) of SOME _ => true | NONE => false)))
                val (prog, exports, next) = moduleWithRuntime (runtime, name, imports, prog, supply)
                val next = if runtimeUsed (next, name) then
                  (case runtime of SOME runtimeName =>
                    if SubsetList.exists (cache, fn (key, _) => key = runtimeName) then next
                    else let val Supply (prefix, count, symbols) = next in
                      Supply (prefix, count, Invalid (name, 0,
                        "panic runtime dependency cycle involving " ^ name ^ " and " ^ runtimeName) :: symbols) end
                  | NONE => next) else next
                val dependencies = if runtimeUsed (next, name) then
                  (case runtime of SOME runtimeName =>
                    if member (dependencies, runtimeName) then dependencies else SubsetList.append (dependencies, [runtimeName])
                  | NONE => dependencies) else dependencies
                val nested = SubsetList.map (structureScopes (imports, prog), fn (path, scope) =>
                  (name ^ "." ^ path, scope))
                val (rest, next) = loop (rest, SubsetList.append (nested, (name, exports) :: cache), next)
            in ((name, dependencies, (path, src, prog, cs)) :: rest, next) end
    in loop (modules, [], Supply (prefix, 0, [])) end

  val project = fn (prefix, modules) => projectWithRuntime (NONE, prefix, modules)
end
