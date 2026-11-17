(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./syntax.sml" import * as Syntax;
from "./sml_list.sml" import * as SmlList;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_source.sml" import * as SubsetSource;
from "./subset_string.sml" import * as SubsetString;
from "./compiler_text.sml" import * as CompilerText;
*)

(* Lexical analysis (docs/spec.md §2, Definition §2). *)
structure Lexer = struct
  open SubsetOptionValue

  open Syntax

  datatype token =
      TKey of string               (* reserved word or reserved punctuation *)
    | TId of string                (* unqualified identifier *)
    | TLong of string list * string
    | TTyVar of string
    | TScon of scon
    | TEOF

  datatype 'a step =
      Ok of 'a * int               (* value and the offset after it *)
    | Err of string * pos

  datatype result =
      Tokens of (token * pos) list * comment list
    | LexError of string * pos

  val reservedWords =
    ["abstype", "and", "andalso", "as", "case", "datatype", "do", "else", "end",
     "exception", "fn", "fun", "handle", "if", "in", "infix", "infixr", "let", "local",
     "nonfix", "of", "op", "open", "orelse", "raise", "rec", "then", "type", "val", "with",
     "withtype", "while",
     "eqtype", "functor", "include", "sharing", "sig", "signature", "struct", "structure",
     "where"]

  val reservedSymbols = ["|", "=", "=>", "->", "#", ":", ":>"]

  (* The symbolic identifiers of the initial basis (spec §2.4). *)
  val basisSymbols = ["+", "-", "*", "/", "^", "::", "=", "<", ">", "<=", ">=", "<>", "@", "~"]

  val member = fn (x, xs) => SmlList.exists (fn y => y = x) xs

  val isSymbolic = fn c => SubsetChar.contains ([#"!", #"%", #"&", #"$", #"#", #"+", #"-", #"/", #":", #"<", #"=", #">", #"?", #"@", #"\\", #"~", #"`", #"^", #"|", #"*"], c)

  val isAlnum = fn c => SubsetChar.isAlphaNum c orelse c = #"'" orelse c = #"_"

  (* Formatting characters that may separate tokens and appear in string gaps. *)
  val isFormatting = fn c =>
    c = #" " orelse c = #"\t" orelse c = #"\n" orelse c = #"\v" orelse c = #"\f"
    orelse c = #"\r"

  val isPrintable = SubsetChar.isPrint

  (* Compiler-internal assertion: language characters are bytes. The public converter
     returns Result; a foreign non-byte character violates the supplied text contract. *)
  val byteCode = fn c => let val SubsetResult.Ok code = SubsetChar.toCode c in code end

  val digitValue = fn c =>
    if SubsetChar.isDigit c then byteCode c - byteCode #"0"
    else byteCode (SubsetChar.toLower c) - byteCode #"a" + 10

  val lex = fn src =>
    case SubsetSource.fromNative src of
      SubsetResult.Err (SubsetString.NonByte offset) => LexError ("source contains a non-byte character", offset)
    | SubsetResult.Ok source =>
    let
      val n = SubsetSource.length source

      val at = fn i => CompilerText.sub (source, i)

      val has = fn (i, c) => i < n andalso at i = c

      val digitAt = fn i => i < n andalso SubsetChar.isDigit (at i)

      val rec skipWhile = fn (p, i) =>
        if i < n andalso p (at i) then skipWhile (p, i + 1) else i

      (* Value of the `count` digits starting at i, in the given radix. *)
      val rec digitsValue = fn (i, count, radix, acc) =>
        if (count = 0) then acc
        else digitsValue (i + 1, count - 1, radix, acc * radix + digitValue (at i))

      val rec allDigits = fn (p, i, count) =>
        (count = 0) orelse (i < n andalso p (at i) andalso allDigits (p, i + 1, count - 1))

      val rec skipComment = fn (start, i, depth) =>
        case ((depth = 0), i + 1 >= n) of
          (true, _) => Ok ((), i)
        | (false, true) => Err ("unterminated comment", start)
        | (false, false) =>
            case (at i, at (i + 1)) of
              (#"(", #"*") => skipComment (start, i + 2, depth + 1)
            | (#"*", #")") => skipComment (start, i + 2, depth - 1)
            | _ => skipComment (start, i + 1, depth)

      val charFromCode = fn (code, pos, next) =>
        case SubsetChar.fromCode code of
          SubsetResult.Ok c => Ok (SOME c, next)
        | SubsetResult.Err error => Err ("character code exceeds 255 in escape sequence", pos)

      (* An escape sequence; i is just after the backslash. NONE is a \f...f\ gap. *)
      val escape = fn i =>
        if i >= n then Err ("unterminated escape sequence", i - 1)
        else
          case at i of
            #"a" => Ok (SOME (#"\007"), i + 1)
          | #"b" => Ok (SOME (#"\008"), i + 1)
          | #"t" => Ok (SOME #"\t", i + 1)
          | #"n" => Ok (SOME #"\n", i + 1)
          | #"v" => Ok (SOME #"\v", i + 1)
          | #"f" => Ok (SOME #"\f", i + 1)
          | #"r" => Ok (SOME #"\r", i + 1)
          | #"\"" => Ok (SOME #"\"", i + 1)
          | #"\\" => Ok (SOME #"\\", i + 1)
          | #"^" =>
              if i + 1 < n andalso byteCode (at (i + 1)) >= 64 andalso byteCode (at (i + 1)) <= 95
              then charFromCode (byteCode (at (i + 1)) - 64, i - 1, i + 2)
              else Err ("illegal control escape sequence", i - 1)
          | #"u" =>
              if allDigits (SubsetChar.isHexDigit, i + 1, 4)
              then charFromCode (digitsValue (i + 1, 4, 16, 0), i - 1, i + 5)
              else Err ("\\u must be followed by four hexadecimal digits", i - 1)
          | c =>
              case (SubsetChar.isDigit c, isFormatting c) of
                (true, _) =>
                  if allDigits (SubsetChar.isDigit, i, 3)
                  then charFromCode (digitsValue (i, 3, 10, 0), i - 1, i + 3)
                  else Err ("decimal escape needs exactly three digits", i - 1)
              | (false, true) =>
                  let val j = skipWhile (isFormatting, i) in
                    if has (j, #"\\") then Ok (NONE, j + 1)
                    else Err ("unterminated string gap", i - 1)
                  end
              | (false, false) => Err ("illegal escape sequence", i - 1)

      (* A string body; i is just after the opening quote. *)
      val rec lexString = fn (start, i, acc) =>
        if i >= n then Err ("unterminated string constant", start)
        else
          case at i of
            #"\"" => Ok (CompilerText.implode (SmlList.rev acc), i + 1)
          | #"\\" =>
              (case escape (i + 1) of
                 Ok (NONE, j) => lexString (start, j, acc)
               | Ok (SOME e, j) => lexString (start, j, e :: acc)
               | Err (message, offset) => Err (message, offset))
          | c =>
              if isPrintable c then lexString (start, i + 1, c :: acc)
              else Err ("character not allowed in a string constant; use an escape sequence", i)

      (* An exponent starting at j, or j itself if there is none. *)
      val exponent = fn j =>
        let val digits = if has (j + 1, #"~") then j + 2 else j + 1 in
          if (has (j, #"e") orelse has (j, #"E")) andalso digitAt digits
          then skipWhile (SubsetChar.isDigit, digits)
          else j
        end

      (* A numeric constant starting at a digit or at `~` followed by a digit. *)
      val lexNumber = fn start =>
        let
          val i = if at start = #"~" then start + 1 else start
          val text = fn j => CompilerText.substring (source, start, j - start)
          val hexAt = fn j => j < n andalso SubsetChar.isHexDigit (at j)
          val isWord =
            at i = #"0" andalso has (i + 1, #"w")
            andalso (digitAt (i + 2) orelse (has (i + 2, #"x") andalso hexAt (i + 3)))
          val isHex = at i = #"0" andalso has (i + 1, #"x") andalso hexAt (i + 2)
        in
          case (isWord, isHex) of
            (true, _) =>
              if start <> i then Err ("a word constant cannot be negative", start)
              else
                let val j = if has (i + 2, #"x") then skipWhile (SubsetChar.isHexDigit, i + 3)
                            else skipWhile (SubsetChar.isDigit, i + 2)
                in Ok (TScon (SWord (text j)), j) end
          | (false, true) =>
              let val j = skipWhile (SubsetChar.isHexDigit, i + 2) in Ok (TScon (SInt (text j)), j) end
          | (false, false) =>
              let val j = skipWhile (SubsetChar.isDigit, i) in
                if has (j, #".") andalso digitAt (j + 1) then
                  let val k = exponent (skipWhile (SubsetChar.isDigit, j + 1)) in
                    Ok (TScon (SReal (text k)), k)
                  end
                else
                  let val k = exponent j in
                    if (k = j) then Ok (TScon (SInt (text j)), j) else Ok (TScon (SReal (text k)), k)
                  end
              end
        end

      (* An alphanumeric identifier, keyword or long identifier starting at a letter. *)
      val lexAlnum = fn start =>
        let
          val j = skipWhile (isAlnum, start)
          val word = CompilerText.substring (source, start, j - start)
          val rec qualified = fn (quals, last, j) =>
            let val dotThen = fn p => has (j, #".") andalso j + 1 < n andalso p (at (j + 1)) in
              case (dotThen SubsetChar.isAlpha, dotThen isSymbolic, quals) of
                (true, _, _) =>
                  let
                    val k = skipWhile (isAlnum, j + 1)
                    val next = CompilerText.substring (source, j + 1, k - j - 1)
                  in
                    if member (next, reservedWords)
                    then Err ("reserved word `" ^ next ^ "` in a long identifier", j + 1)
                    else qualified (last :: quals, next, k)
                  end
              | (_, true, _) =>
                  (* Only Real.== and Real.!= : real equality, since real is not an equality type. *)
                  let
                    val k = skipWhile (isSymbolic, j + 1)
                    val sym = CompilerText.substring (source, j + 1, k - j - 1)
                  in
                    if (sym = "==" orelse sym = "!=") andalso SmlList.null quals andalso last = "Real"
                    then Ok (TLong (["Real"], sym), k)
                    else Err ("qualified symbolic identifiers are not part of SubsetML (except Real.== and Real.!=)", start)
                  end
              | (_, _, []) => Ok (TId last, j)
              | _ => Ok (TLong (SmlList.rev quals, last), j)
            end
        in
          if member (word, reservedWords) then Ok (TKey word, j)
          else qualified ([], word, j)
        end

      val lexSymbolic = fn start =>
        let
          val j = skipWhile (isSymbolic, start)
          val s = CompilerText.substring (source, start, j - start)
        in
          case (member (s, reservedSymbols), member (s, basisSymbols), s = "!" orelse s = ":=") of
            (true, _, _) => Ok (TKey s, j)
          | (_, true, _) => Ok (TId s, j)
          | (_, _, true) => Err ("`" ^ s ^ "` is not part of SubsetML (references are omitted)", start)
          | _ => Err ("symbolic identifier `" ^ s ^ "` is not part of SubsetML", start)
        end

      val lexTyVar = fn start =>
        case (has (start + 1, #"'"), start + 1 < n andalso isAlnum (at (start + 1))) of
          (true, _) => Err ("equality type variables are not part of SubsetML", start)
        | (false, true) =>
            let val j = skipWhile (isAlnum, start + 1) in
              Ok (TTyVar (CompilerText.substring (source, start, j - start)), j)
            end
        | (false, false) => Err ("malformed type variable", start)

      val punctuation = fn c => SubsetChar.contains ([#"(", #")", #"[", #"]", #"{", #"}", #",", #";"], c)

      (* Whether code precedes offset i on its line. *)
      val trailing = fn i =>
        let
          val rec back = fn k =>
            if k < 0 then false
            else
              case at k of
                #"\n" => false
              | c => if isFormatting c then back (k - 1) else true
        in
          back (i - 1)
        end

      val charConstant = fn i =>
        case lexString (i, i + 2, []) of
          Ok (s, j) =>
            if (CompilerText.size s = 1) then
              Ok (TScon (SChar ((let val SubsetResult.Ok decoded = SubsetSource.fromNative s in CompilerText.sub (decoded, 0) end))), j)
            else Err ("a character constant must contain exactly one character", i)
        | Err (message, offset) => Err (message, offset)

      (* Token helpers return the next token; only this loop advances the scan. *)
      val rec loop = fn (i, acc, cs) =>
        if i >= n then Tokens (SmlList.rev ((TEOF, n) :: acc), SmlList.rev cs)
        else
          case at i of
            #"(" =>
              if has (i + 1, #"*") then
                case skipComment (i, i + 2, 1) of
                  Ok (_, j) =>
                    loop (j, acc, (i, CompilerText.substring (source, i + 2, j - i - 4), trailing i) :: cs)
                | Err (message, offset) => LexError (message, offset)
              else loop (i + 1, (TKey "(", i) :: acc, cs)
          | #"." =>
              if has (i + 1, #".") andalso has (i + 2, #".") then loop (i + 3, (TKey "...", i) :: acc, cs)
              else LexError ("unexpected `.`", i)
          | #"\"" =>
              (case lexString (i, i + 1, []) of
                 Ok (s, j) => loop (j, (TScon (SString s), i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset))
          | #"#" =>
              if has (i + 1, #"\"") then (case charConstant i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset)) else (case lexSymbolic i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset))
          | #"~" =>
              if digitAt (i + 1) then (case lexNumber i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset)) else (case lexSymbolic i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset))
          | #"'" => (case lexTyVar i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset))
          | #"_" => loop (i + 1, (TKey "_", i) :: acc, cs)
          | c =>
              case (isFormatting c, punctuation c, SubsetChar.isDigit c, SubsetChar.isAlpha c, isSymbolic c) of
                (true, _, _, _, _) => loop (i + 1, acc, cs)
              | (_, true, _, _, _) => loop (i + 1, (TKey (CompilerText.str c), i) :: acc, cs)
              | (_, _, true, _, _) => (case lexNumber i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset))
              | (_, _, _, true, _) => (case lexAlnum i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset))
              | (_, _, _, _, true) => (case lexSymbolic i of
                 Ok (tok, j) => loop (j, (tok, i) :: acc, cs)
               | Err (message, offset) => LexError (message, offset))
              | _ => LexError ("unexpected character", i)

    in
      loop (0, [], [])
    end

end
