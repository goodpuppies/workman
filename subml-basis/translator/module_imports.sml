(* @subsetml
from "./subset_bool.sml" import * as SubsetBool;
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./compiler_text.sml" import * as CompilerText;
from "./subset_list.sml" import * as SubsetList;
from "./subset_char.sml" import * as SubsetChar;
from "./wm_lexer.sml" import * as WmLexer;
*)

(* Comment metadata, using Workman's namespace import spelling. *)
structure ModuleImports = struct
  open SubsetOptionValue

  datatype dependency = Import of string * string * Syntax.pos
  datatype result = Imports of dependency list | Error of string * Syntax.pos

  val marker = "@subsetml"
  val prefix = fn (text, beginning) =>
    let
      val rec go = fn
          (_, []) => true
        | ([], _) => false
        | (x :: xs, y :: ys) => x = y andalso go (xs, ys)
    in go (CompilerText.characters text, CompilerText.characters beginning) end

  val marked = fn body =>
    let val trimmed = CompilerText.stringOf (SubsetList.dropWhile (CompilerText.characters body, SubsetChar.isSpace)) in
      if prefix (trimmed, marker) then
        let val rest = CompilerText.drop (trimmed, CompilerText.size marker) in
          if rest = "" orelse CompilerText.firstIs (rest, SubsetChar.isSpace) then
            SOME (CompilerText.size body - CompilerText.size rest, rest)
          else NONE
        end
      else NONE
    end

  val isGeneratedHeader = fn body =>
    prefix (CompilerText.stringOf (SubsetList.dropWhile (CompilerText.characters body, SubsetChar.isSpace)),
            WmLexer.generatedMarker)

  (* Supported specifiers are explicit POSIX relative paths in the common local profile.
     URL escaping/query syntax and non-ASCII specifiers are rejected, not approximated. *)
  val validPath = fn path =>
    (prefix (path, "./") orelse prefix (path, "../"))
    andalso CompilerText.isSuffix (path, ".sml")
    andalso SubsetList.all (CompilerText.characters path, fn c =>
      SubsetChar.isPrint c andalso SubsetBool.not (SubsetChar.contains ([#"\\", #"%", #"?", #"#"], c)))

  val declarations = fn (body, base) =>
    case WmLexer.lex body of
      WmLexer.LexError (message, offset) => Error (message, base + offset)
    | WmLexer.Tokens (tokens, _) =>
        let
          val rec loop = fn (tokens, acc) =>
            case tokens of
              [(WmLexer.WEOF, _)] => Imports (SubsetList.reverse acc)
            | (WmLexer.WKey "from", pos) ::
              (WmLexer.WScon (Syntax.SString path), _) ::
              (WmLexer.WKey "import", _) :: (WmLexer.WKey "*", _) ::
              (WmLexer.WKey "as", _) :: (WmLexer.WName [name], _) ::
              (WmLexer.WKey ";", _) :: rest =>
                if validPath path then loop (rest, Import (path, name, base + pos) :: acc)
                else Error ("imports require explicit relative .sml paths; URL escapes and non-ASCII specifiers are not supported yet", base + pos)
            | (_, pos) :: _ => Error ("expected `from \"./file.sml\" import * as Structure;`", base + pos)
            | [] => Error ("incomplete import metadata", base)
        in loop (tokens, []) end

  val parse = fn (first, comments) =>
    let
      val rec loop = fn (comments, seen, imports) =>
        case comments of
          [] => Imports imports
        | (pos, body, _) :: rest =>
            case marked body of
              NONE => loop (rest, seen, imports)
            | SOME payload =>
                let val (skip, text) = payload in
                  if seen then Error ("only one @subsetml metadata block is allowed", pos)
                  else (if pos >= first then Error ("import metadata must precede ordinary declarations", pos)
                  else (case declarations (text, pos + 2 + skip) of
                    Error (message, offset) => Error (message, offset)
                  | Imports entries => loop (rest, true, entries)))
                end
    in loop (comments, false, []) end
end
