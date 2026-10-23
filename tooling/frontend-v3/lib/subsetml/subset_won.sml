(* @subsetml
from "./subset_won_value.sml" import * as SubsetWonValue;
from "./subset_won_parser.sml" import * as SubsetWonParser;
from "./subset_won_syntax.sml" import * as SubsetWonSyntax;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./subset_string.sml" import * as SubsetString;
from "./subset_natural.sml" import * as SubsetNatural;
*)

(* Public portable WON encoding and decoding API. *)

structure SubsetWon = struct

  type value = SubsetWonValue.value
  type error = SubsetWonValue.error
  type node = SubsetWonValue.node
  type problem = SubsetWonValue.problem

  val decode = SubsetWonParser.decode

  (* Preserve field order and number spelling; each shape has one wire spelling. *)
  val rec render = fn value =>
    let
      val fieldsText = fn fields =>
        SubsetString.concatWith (
          SubsetList.map (fields, fn (key, item) => SubsetWonSyntax.keyText key ^ " = " ^ render item),
          " "
        )
    in

      case value of
          SubsetWonValue.Null => "null"
        | SubsetWonValue.Boolean true => "true"
        | SubsetWonValue.Boolean false => "false"
        | SubsetWonValue.Number spelling => spelling
        | SubsetWonValue.Text content => SubsetWonSyntax.quote content
        | SubsetWonValue.Blob items =>
            let
              val content = SubsetString.concat (SubsetList.map (items, SubsetWonSyntax.hexByte))
            in
              "x\"" ^ content ^ "\""
            end
        | SubsetWonValue.List items =>
            let
              val content = SubsetString.concatWith (SubsetList.map (items, render), " ")
            in
              "[" ^ content ^ "]"
            end
        | SubsetWonValue.Record fields => "{" ^ fieldsText fields ^ "}"
        | SubsetWonValue.Tag (name, attrs, body) =>
            let
              val attributes = case attrs of
                  [] => ""
                | _ => "<" ^ fieldsText attrs ^ ">"
              val payload = case body of
                  SubsetWonValue.Null => ""
                | SubsetWonValue.List _ => render body
                | SubsetWonValue.Record _ => render body
                | _ => "(" ^ render body ^ ")"
            in
              name ^ attributes ^ payload
            end
    end

  (* Reuse the parser's validation instead of maintaining a second grammar. *)
  val encode = fn value =>
    let
      val source = render value
      val checkRoundTrip = SubsetResult.via (fn parsed =>
        if parsed = value then
          SubsetResult.Ok source
        else
          SubsetResult.Err "value cannot be represented as WON")
    in

      checkRoundTrip (SubsetResult.mapError (decode source, fn error : error => #message error))
    end

  (* Access steps take and return a Result, so a chain is checked once at its end: *)
  (* SubsetWon.read(source) :> SubsetWon.get("server") :> SubsetWon.get("port") :> SubsetWon.number *)
  val pathText = fn path =>
    (case path of
        [] => "document"
      | _ => SubsetString.concat (SubsetList.reverse path))

  val keyStep = fn (path, key) =>
    (case path of
        [] => [SubsetWonSyntax.keyText key]
      | _ => "." ^ SubsetWonSyntax.keyText key :: path)

  val mismatch = fn (node : node, kind) =>
    SubsetResult.Err (SubsetWonValue.Mismatch (pathText (#path node), kind))

  val lookup = fn (fields, key, path) =>
    (case SubsetList.find (
      fields,
      fn entry =>
        let
          val (name, _) = entry
        in
          name = key
        end
    ) of
        SOME entry =>
          let
            val (_, item) = entry
          in
            SubsetResult.Ok (SubsetWonValue.makeNode (path, item))
          end
      | NONE => SubsetResult.Err (SubsetWonValue.Missing (pathText path)))

  val root = fn value => SubsetResult.Ok (SubsetWonValue.makeNode ([], value))

  val read = fn source =>
    SubsetResult.map (
      SubsetResult.mapError (decode source, SubsetWonValue.Malformed),
      fn value => SubsetWonValue.makeNode ([], value)
    )

  val get = fn (found, key) =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Record fields => lookup (fields, key, keyStep (#path node, key))
          | _ => mismatch (node, "record"))
    )

  val attribute = fn (found, key) =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Tag (_, attrs, _) =>
              lookup (attrs, key, "<" ^ SubsetWonSyntax.keyText key ^ ">" :: #path node)
          | _ => mismatch (node, "tag"))
    )

  val indexStep = fn (path, position) =>
    "[" ^ SubsetResult.getOr (SubsetNatural.toString position, "?") ^ "]" :: path

  val index = fn (found, position) =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.List items =>
              let
                val path = indexStep (#path node, position)
              in
                case SubsetList.at (items, position) of
                    SubsetResult.Ok item => SubsetResult.Ok (SubsetWonValue.makeNode (path, item))
                  | SubsetResult.Err _ => SubsetResult.Err (SubsetWonValue.Missing (pathText path))
              end
          | _ => mismatch (node, "list"))
    )

  (* A tag's payload keeps the tag's path: `view[0]` is the first child of `view`. *)
  val payload = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Tag (_, _, body) => SubsetResult.Ok (SubsetWonValue.makeNode (#path node, body))
          | _ => mismatch (node, "tag"))
    )

  val tagName = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Tag (name, _, _) => SubsetResult.Ok name
          | _ => mismatch (node, "tag"))
    )

  val items = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.List values =>
              let
                val rec go = fn (rest, position, acc) =>
                  (case rest of
                      [] => SubsetList.reverse acc
                    | item :: tail =>
                        go (
                          tail,
                          position + 1,
                          SubsetWonValue.makeNode (indexStep (#path node, position), item) :: acc
                        ))
              in
                SubsetResult.Ok (go (values, 0, []))
              end
          | _ => mismatch (node, "list"))
    )

  val entries = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Record fields =>
              SubsetResult.Ok (SubsetList.map (fields, fn (key, item) => (key, SubsetWonValue.makeNode (keyStep (#path node, key), item))))
          | _ => mismatch (node, "record"))
    )

  val text = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Text content => SubsetResult.Ok content
          | _ => mismatch (node, "text"))
    )

  (* The exact spelling; numeric conversion is the caller's choice. *)
  val number = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Number spelling => SubsetResult.Ok spelling
          | _ => mismatch (node, "number"))
    )

  val boolean = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Boolean flag => SubsetResult.Ok flag
          | _ => mismatch (node, "boolean"))
    )

  val blob = fn found =>
    SubsetResult.andThen (
      found,
      fn node : node =>
        (case #value node of
            SubsetWonValue.Blob bytes => SubsetResult.Ok bytes
          | _ => mismatch (node, "blob"))
    )

  val value = fn found => SubsetResult.map (found, fn node : node => #value node)

  (* Ends a chain: anything missing along it becomes None. Present null stays a value. *)
  val optional = fn found =>
    (case found of
        SubsetResult.Ok result => SubsetResult.Ok (SOME result)
      | SubsetResult.Err (SubsetWonValue.Missing _) => SubsetResult.Ok NONE
      | SubsetResult.Err problem => SubsetResult.Err problem)

  val problemText = fn problem =>
    (case problem of
        SubsetWonValue.Malformed error =>
          "byte " ^ SubsetResult.getOr (SubsetNatural.toString (#offset error), "?") ^ ": " ^ #message error
      | SubsetWonValue.Missing path => path ^ ": missing"
      | SubsetWonValue.Mismatch (path, kind) => path ^ ": expected " ^ kind)
end
