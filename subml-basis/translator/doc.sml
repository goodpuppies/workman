(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./sml_list.sml" import * as SmlList;
from "./sml_option.sml" import * as SmlOption;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_list.sml" import * as SubsetList;
from "./subset_bytes.sml" import * as SubsetBytes;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_source.sml" import * as SubsetSource;
from "./subset_string.sml" import * as SubsetString;
*)

(* Layout shared by the source printers.

   A document is a non-empty list of lines. Each line has an indentation relative to the
   document's first line, its text, and the source offset of the earliest node printed on it.
   The offsets let `render` put the source comments and blank lines back in place. *)
structure Doc = struct
  open SubsetOptionValue

  open Syntax

  type line = int * string * pos option

  type doc = line list

  (* Lines up to this width stay on one line where the printers have a choice. *)
  val width = 80

  val text = fn s => [(0, s, NONE)]

  val atom = fn (p, s) => [(0, s, SOME p)]

  val empty = text ""

  val minTag = fn
      (NONE, b) => b
    | (a, NONE) => a
    | (SOME a, SOME b) => SOME (if (a : int) <= b then a else b)

  (* Horizontal composition: b continues the last line of a, and b's later lines are indented
     relative to that line. *)
  val cat = fn (a : doc, b : doc) =>
    case (SmlList.rev a, b) of
      ((ia, ta, pa) :: restA, (_, tb, pb) :: restB) =>
        SmlList.revAppend (restA,
          (ia, ta ^ tb, minTag (pa, pb)) :: SmlList.map (fn (i, t, p) => (i + ia, t, p)) restB)
    | _ => SubsetList.append (a, b)

  val cats = fn ds => SmlList.foldl (fn (d, acc) => cat (acc, d)) empty ds

  val indent = fn (n : int, d : doc) => SmlList.map (fn (i, t, p) => (i + n, t, p)) d

  (* Vertical composition. *)
  val stack = fn ds => SmlList.concat ds

  (* The text of a one-line document. *)
  val flat = fn
      [(_, t, _)] => SOME t
    | _ => NONE

  val isFlat = fn d => SmlOption.isSome (flat d)

  val fits = fn d =>
    case flat d of
      SOME t => CompilerText.size t <= width
    | NONE => false

  (* `ds` joined by `sep` on one line. *)
  val join = fn (sep, ds) =>
    case ds of
      [] => empty
    | d :: rest => SmlList.foldl (fn (d, acc) => cats [acc, text sep, d]) d rest

  (* Items between delimiters, separated by `sep`: on one line when that fits, otherwise one
     item per line. *)
  val group = fn (openD, sep, closeD, ds) =>
    let val oneLine = cats [text openD, join (sep ^ " ", ds), text closeD] in
      if fits oneLine orelse SmlList.null ds then oneLine
      else
        let
          val count = SubsetList.length ds
          val rec items = fn
              (_, []) => []
            | (i, d :: rest) => (if i < count - 1 then cat (d, text sep) else d) :: items (i + 1, rest)
        in
          stack [text openD, indent (2, stack (items (0, ds))), text closeD]
        end
    end

  (* --------------------------------------------------------------------------------------- *)
  (* Rendering *)

  val trim = fn s =>
    CompilerText.stringOf (SubsetBytes.trim (CompilerText.characters s, SubsetChar.isSpace))

  val spaces = fn n =>
    let val SubsetResult.Ok bytes = SubsetList.repeat (#" ", n) in CompilerText.stringOf bytes end

  val isBlankText = fn s => SmlList.all SubsetChar.isSpace (CompilerText.characters s)

  (* Offset of the start of the line containing offset i. *)
  val lineStart = fn (src, i) =>
    let
      val rec back = fn k =>
        if k <= 0 then 0 else (if CompilerText.sub (src, k - 1) = #"\n" then k else back (k - 1))
    in
      back (if i <= SubsetSource.length src then i else SubsetSource.length src)
    end

  (* Whether the source line before the one containing offset i is blank. *)
  val blankLineBefore = fn (src, i) =>
    let val start = lineStart (src, i) in
      start > 0
      andalso (let
                 val prev = lineStart (src, start - 1)
                 val SubsetResult.Ok bytes = SubsetSource.slice (src, prev, start - 1 - prev)
               in SubsetList.all (bytes, SubsetChar.isSpace) end)
    end

  (* Lines of a comment, re-indented. `style` turns the comment's lines into output lines. *)
  val commentLines = fn (src, (p, body, _), style) =>
    let
      val column = p - lineStart (src, p)
      val strip = fn bytes =>
        let
          val rec drop = fn
              ([], remaining) => []
            | (c :: rest, remaining) =>
                if remaining > 0 andalso c = #" " then drop (rest, remaining - 1)
                else c :: rest
        in CompilerText.stringOf (drop (bytes, column)) end
      val lines = SubsetBytes.fields (CompilerText.characters body, fn c => c = #"\n")
    in
      case lines of
        [] => style []
      | first :: rest => style (CompilerText.stringOf first :: SmlList.map strip rest)
    end

  (* Renders lines, inserting each comment before the first line tagged after it. A trailing
     comment joins the last tagged line instead. `style` formats a comment's lines. *)
  val render = fn (src, comments, style, lines) =>
    let
      val src = CompilerText.source src
      (* acc holds the output lines in reverse, each with whether it carries a tag. *)
      val appendTrailing = fn (acc, s) =>
        let
          val rec go = fn
              ([], _) => NONE
            | ((t, true) :: rest, seen) => SOME (SmlList.revAppend (seen, (t ^ " " ^ s, true) :: rest))
            | (l :: rest, seen) => go (rest, l :: seen)
        in
          go (acc, [])
        end

      val blankIfNeeded = fn (acc, lastTag, p) =>
        case acc of
          (t, _) :: _ =>
            if blankLineBefore (src, p) andalso lastTag < lineStart (src, p) andalso SubsetBool.not (isBlankText t)
            then ("", false) :: acc
            else acc
        | [] => acc

      val emitComment = fn (acc, lastTag, ind, c) =>
        let val (p, _, isTrailing) = c in
          case (isTrailing, appendTrailing (acc, SubsetString.concatWith (commentLines (src, c, style), " "))) of
            (true, SOME acc') => acc'
          | _ =>
              SmlList.foldl (fn (l, acc) => (spaces ind ^ l, false) :: acc)
                (blankIfNeeded (acc, lastTag, p)) (commentLines (src, c, style))
        end

      val rec flush = fn (acc, lastTag, ind, limit, cs) =>
        case cs of
          (c :: rest) =>
            let val (p, _, _) = c in
              if p < limit then flush (emitComment (acc, lastTag, ind, c), p, ind, limit, rest)
              else (acc, lastTag, cs)
            end
        | [] => (acc, lastTag, cs)

      (* A file's leading comment is always followed by one blank line, whatever the source
         had, so that translating back and forth keeps the same layout. *)
      val afterHeader = fn acc =>
        case acc of
          (t, _) :: _ => if isBlankText t then acc else ("", false) :: acc
        | [] => acc

      val rec go = fn (ls, acc, lastTag, cs, seenCode) =>
        case ls of
          [] =>
            let val (acc', _, _) = flush (acc, lastTag, 0, SubsetSource.length src + 1, cs) in acc' end
        | (ind, t, NONE) :: rest => go (rest, (spaces ind ^ t, false) :: acc, lastTag, cs, seenCode)
        | (ind, t, SOME p) :: rest =>
            let
              val (acc1, lastTag1, cs1) = flush (acc, lastTag, ind, p, cs)
              val acc2 = if seenCode then blankIfNeeded (acc1, lastTag1, p) else afterHeader acc1
            in
              go (rest, (spaces ind ^ t, true) :: acc2, (if p >= lastTag1 then p else lastTag1), cs1, true)
            end
    in
      SubsetString.concat (SmlList.map (fn (t, _) => t ^ "\n") (SmlList.rev (go (lines, [], ~1, comments, false))))
    end

end
