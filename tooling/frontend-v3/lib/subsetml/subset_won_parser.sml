(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./subset_string.sml" import * as SubsetString;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_won_value.sml" import * as SubsetWonValue;
from "./subset_won_syntax.sml" import * as SubsetWonSyntax;
*)

(* Strict WON grammar and cursor mechanics. *)

structure SubsetWonParser = struct

  type cursor = {input : char list, offset : int}
  val makeCursor = fn (input, offset) => {input = input, offset = offset} : cursor

  val via = SubsetResult.via

  val fail = fn (cursor : cursor, message) =>
    SubsetResult.Err (SubsetWonValue.makeError (#offset cursor, message))

  val advance = fn cursor : cursor =>
    (case #input cursor of
        [] => cursor
      | _ :: rest => makeCursor (rest, #offset cursor + 1))

  val peek = fn (cursor : cursor, c) =>
    (case #input cursor of
        first :: _ => first = c
      | [] => false)

  (* Commas are whitespace: they separate entries but carry no meaning. *)
  val space = fn c =>
    (case (
      case (
        case (
          case (c = #" ", c = #"\t") of
              (false, false) => false
            | _ => true,
          c = #"\r"
        ) of
            (false, false) => false
          | _ => true,
        c = #"\n"
      ) of
          (false, false) => false
        | _ => true,
      c = #","
    ) of
        (false, false) => false
      | _ => true)

  val rec take = fn (cursor : cursor, predicate, acc) =>
    (case #input cursor of
        c :: _ =>
          if predicate c then
            take (advance cursor, predicate, c :: acc)
          else
            (SubsetList.reverse acc, cursor)
      | [] => (SubsetList.reverse acc, cursor))

  val rec block = fn (cursor : cursor, depth) =>
    (case #input cursor of
        [] => fail (cursor, "unterminated block comment")
      | #"/" :: #"*" :: rest =>
          block (makeCursor (rest, #offset cursor + 2), depth + 1)
      | #"*" :: #"/" :: rest =>
          let
            val next = makeCursor (rest, #offset cursor + 2)
          in
            if depth <= 1 then SubsetResult.Ok next else block (next, depth - 1)
          end
      | _ => block (advance cursor, depth))

  val rec skip = fn cursor : cursor =>
    (case #input cursor of
        #"/" :: #"/" :: _ =>
          let
            val (_, next) = take (
              cursor,
              fn c =>
                (case (c <> #"\n", c <> #"\r") of
                    (true, true) => true
                  | _ => false),
              []
            )
          in
            skip next
          end
      | #"/" :: #"*" :: rest =>
          (case block (makeCursor (rest, #offset cursor + 2), 1) of
              SubsetResult.Err e => SubsetResult.Err e
            | SubsetResult.Ok next => skip next)
      | c :: _ => if space c then skip (advance cursor) else SubsetResult.Ok cursor
      | [] => SubsetResult.Ok cursor)

  val expect = fn (cursor, c) =>
    let
      val consume = via (fn next =>
        if peek (next, c) then
          SubsetResult.Ok (advance next)
        else
          fail (next, "expected " ^ SubsetWonSyntax.native [c]))
    in
      consume (skip cursor)
    end

  (* Text validates strict UTF-8 and accepts only the canonical escape spellings. *)
  val text = fn cursor =>
    let
      val rec go = fn (cur : cursor, acc) =>
        (case #input cur of
            [] => fail (cur, "unterminated quoted value")
          | #"\"" :: _ =>
              let
                val xs = SubsetList.reverse acc
              in
                if SubsetWonSyntax.textValid xs then
                  SubsetResult.Ok (SubsetWonSyntax.native xs, advance cur)
                else
                  fail (cursor, "text is not valid UTF-8")
              end
          | #"\\" :: #"x" :: a :: b :: rest =>
              (case SubsetWonSyntax.hexPair (a, b) of
                  SOME c =>
                    if case (
                      case (
                        case (SubsetChar.isCntrl c, c <> #"\n") of
                            (true, true) => true
                          | _ => false,
                        c <> #"\r"
                      ) of
                          (true, true) => true
                        | _ => false,
                      c <> #"\t"
                    ) of
                        (true, true) => true
                      | _ => false then
                      go (makeCursor (rest, #offset cur + 4), c :: acc)
                    else
                      fail (cur, "use literal UTF-8 or the named text escape")
                | NONE => fail (cur, "expected two hex digits after \\x"))
          | #"\\" :: c :: rest =>
              let
                val decoded = case c of
                    #"n" => SOME #"\n"
                  | #"r" => SOME #"\r"
                  | #"t" => SOME #"\t"
                  | #"\"" => SOME #"\""
                  | #"\\" => SOME #"\\"
                  | _ => NONE
              in
                case decoded of
                    SOME value => go (makeCursor (rest, #offset cur + 2), value :: acc)
                  | NONE => fail (cur, "unknown escape")
              end
          | c :: _ =>
              if SubsetChar.isCntrl c then
                fail (cur, "control byte must be escaped")
              else
                go (advance cur, c :: acc))
    in
      if peek (cursor, #"\"") then
        go (advance cursor, [])
      else
        fail (cursor, "expected quote")
    end

  val name = fn cursor : cursor =>
    (case #input cursor of
        c :: _ =>
          if SubsetWonSyntax.firstName c then
            let
              val (xs, next) = take (cursor, SubsetWonSyntax.nameChar, [])
            in
              SubsetResult.Ok (SubsetWonSyntax.native xs, next)
            end
          else
            fail (cursor, "expected ASCII name")
      | [] => fail (cursor, "expected name"))

  (* JSON number grammar; preserve the spelling without host conversion or bounds. *)
  val number = fn cursor =>
    let
      val start = if peek (cursor, #"-") then advance cursor else cursor
      val (whole, afterWhole) = take (start, SubsetWonSyntax.digit, [])
      val requiredDigits = fn cur =>
        let
          val (xs, next) = take (cur, SubsetWonSyntax.digit, [])
        in
          case xs of
              [] => fail (cur, "expected digit")
            | _ => SubsetResult.Ok next
        end
      val fraction = fn cur =>
        if peek (cur, #".") then requiredDigits (advance cur) else SubsetResult.Ok cur
      val exponent = fn cur =>
        if case (peek (cur, #"e"), peek (cur, #"E")) of
            (false, false) => false
          | _ => true then
          let
            val afterE = advance cur
            val signed = if case (peek (afterE, #"-"), peek (afterE, #"+")) of
                (false, false) => false
              | _ => true then
              advance afterE
            else
              afterE
          in
            requiredDigits signed
          end
        else
          SubsetResult.Ok cur
      val validWhole = case whole of
          [] => false
        | #"0" :: _ :: _ => false
        | _ => true
      val readExponent = via exponent
      val preserveSpelling = fn next : cursor =>
        let
          val rec prefix = fn (cur : cursor, acc) =>
            (if #offset cur >= #offset next then
              SubsetWonSyntax.native (SubsetList.reverse acc)
            else
              case #input cur of
                  c :: _ => prefix (advance cur, c :: acc)
                | [] => SubsetWonSyntax.native (SubsetList.reverse acc))
        in
          (SubsetWonValue.Number (prefix (cursor, [])), next)
        end
    in
      if validWhole then
        SubsetResult.map (readExponent (fraction afterWhole), preserveSpelling)
      else
        fail (cursor, "invalid number")
    end

  val key = fn cursor =>
    let
      val requireQuotedKey = via (fn (name, stop) =>
        if SubsetWonSyntax.identifier name then
          fail (cursor, "identifier keys must be bare")
        else
          SubsetResult.Ok (name, stop))
    in
      if peek (cursor, #"\"") then requireQuotedKey (text cursor) else name cursor
    end

  val blob = fn cursor =>
    let
      val rec go = fn (input : cursor, acc) =>
        (case #input input of
            #"\"" :: _ =>
              SubsetResult.Ok (SubsetWonValue.Blob (SubsetList.reverse acc), advance input)
          | a :: b :: tail =>
              (case SubsetWonSyntax.hexPair (a, b) of
                  SOME c => go (makeCursor (tail, #offset input + 2), c :: acc)
                | NONE => fail (input, "hex blob requires pairs of hex digits"))
          | _ => fail (input, "unterminated hex blob"))
    in
      go (advance (advance cursor), [])
    end

  (* Read entries with Result procedures. *)
  val collect = fn (input, close, item) =>
    let
      val step = fn (cursor, previous) =>
        let
          val skipTrivia = via (fn (entry, stop) =>
            SubsetResult.map (
              skip stop,
              fn after => (entry, stop, after)
            ))
          val requireGap = via (fn (entry, stop : cursor, after : cursor) =>
            if case (peek (after, close), #offset after > #offset stop) of
                (false, false) => false
              | _ => true then
              SubsetResult.Ok (entry, after)
            else
              fail (after, "expected whitespace between values or fields"))
        in
          requireGap (skipTrivia (item (cursor, previous)))
        end

      val rec go = fn (cursor, acc) =>
        let
          val read = via (fn next =>
            if peek (next, close) then
              SubsetResult.Ok (SubsetList.reverse acc, advance next)
            else
              let
                val append = via (fn (entry, after) => go (after, entry :: acc))
              in
                append (step (next, acc))
              end)
        in
          read (skip cursor)
        end
    in
      go (input, [])
    end

  (* Bound nesting independently of the number of container entries. *)
  val rec value = fn (cursor, depth) =>
    let
      val parse = via (fn cur : cursor =>
        let
          val sequence = fn input =>
            SubsetResult.map (
              collect (input, #"]", fn (next, _) => value (next, depth + 1)),
              fn (items, stop) =>
                (SubsetWonValue.List items, stop)
            )
          val fields = fn (input, close) =>
            let
              val readField = fn (next, previous) =>
                let
                  val readValue = via (fn (name, afterKey) =>
                    let
                      val parseValue = via (fn afterEquals => value (afterEquals, depth + 1))
                    in
                      if SubsetWonSyntax.duplicate (previous, name) then
                        fail (next, "duplicate field: " ^ name)
                      else
                        SubsetResult.map (
                          parseValue (expect (afterKey, #"=")),
                          fn (v, stop) =>
                            ((name, v), stop)
                        )
                    end)
                in
                  readValue (key next)
                end
            in
              collect (input, close, readField)
            end
          val payload = fn input : cursor =>
            let
              val closeScalar = via (fn (v, stop) =>
                (case v of
                    SubsetWonValue.Null => fail (input, "omit null tag payload")
                  | SubsetWonValue.List _ => fail (input, "list tag payload must use []")
                  | SubsetWonValue.Record _ => fail (input, "record tag payload must use {}")
                  | _ =>
                      SubsetResult.map (expect (stop, #")"), fn after => (v, after))))
            in
              case #input input of
                  #"(" :: _ => closeScalar (value (advance input, depth + 1))
                | #"[" :: _ => sequence (advance input)
                | #"{" :: _ =>
                    SubsetResult.map (
                      fields (advance input, #"}"),
                      fn (items, stop) =>
                        (SubsetWonValue.Record items, stop)
                    )
                | _ => SubsetResult.Ok (SubsetWonValue.Null, input)
            end
          val tag = fn (name, afterName) =>
            let
              val requireAttributes = via (fn (attrs, stop) =>
                (case attrs of
                    [] => fail (afterName, "omit empty tag attributes")
                  | _ => SubsetResult.Ok (attrs, stop)))
              val attachPayload = via (fn (attrs, afterAttrs) =>
                SubsetResult.map (
                  payload afterAttrs,
                  fn (body, stop) =>
                    (SubsetWonValue.Tag (name, attrs, body), stop)
                ))
              val attributes = if peek (afterName, #"<") then
                requireAttributes (fields (advance afterName, #">"))
              else
                SubsetResult.Ok ([], afterName)
            in
              attachPayload attributes
            end
        in
          if depth > 128 then
            fail (cur, "maximum nesting depth exceeded")
          else
            case #input cur of
                [] => fail (cur, "expected value")
              | #"\"" :: _ =>
                  SubsetResult.map (
                    text cur,
                    fn (s, stop) =>
                      (SubsetWonValue.Text s, stop)
                  )
              | #"x" :: #"\"" :: _ => blob cur
              | #"[" :: _ => sequence (advance cur)
              | #"{" :: _ =>
                  SubsetResult.map (
                    fields (advance cur, #"}"),
                    fn (items, stop) =>
                      (SubsetWonValue.Record items, stop)
                  )
              | c :: _ =>
                  let
                    val interpretName = via (fn (name, stop) =>
                      (case name of
                          "null" => SubsetResult.Ok (SubsetWonValue.Null, stop)
                        | "true" => SubsetResult.Ok (SubsetWonValue.Boolean true, stop)
                        | "false" => SubsetResult.Ok (SubsetWonValue.Boolean false, stop)
                        | _ => tag (name, stop)))
                  in
                    if case (SubsetWonSyntax.digit c, c = #"-") of
                        (false, false) => false
                      | _ => true then
                      number cur
                    else
                      interpretName (name cur)
                  end
        end)
    in
      parse (skip cursor)
    end

  val decode = fn source =>
    let
      val parse = via (fn input => value (makeCursor (input, 0), 0))
      val requireEnd = via (fn (parsed, stop) =>
        let
          val finish = via (fn next : cursor =>
            (case #input next of
                [] => SubsetResult.Ok parsed
              | _ => fail (next, "unexpected trailing input")))
        in
          finish (skip stop)
        end)
    in
      requireEnd (parse (SubsetResult.mapError (
        SubsetString.fromNative source,
        fn _ => SubsetWonValue.makeError (0, "expected a byte string")
      )))
    end
end
