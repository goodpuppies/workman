(* @subsetml
from "./subset_option_value.sml" import * as SubsetOptionValue;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_text_host.sml" import * as SubsetTextHost;
from "./subset_bytes.sml" import * as SubsetBytes;
*)

(* Native byte-string boundary. Extraction and reconstruction are SubsetTextHost primitives. *)
structure SubsetString = struct
  datatype error = NonByte of int
  datatype slice_error = InvalidIndex | StringError of error
  val fromNative = fn value =>
    let
      val rec go = fn
          ([], offset, bytes) => SubsetResult.Ok (SubsetList.reverse bytes)
        | (code :: rest, offset, bytes) =>
            case SubsetChar.fromCode code of
              SubsetResult.Err error => SubsetResult.Err (NonByte offset)
            | SubsetResult.Ok c => go (rest, offset + 1, c :: bytes)
    in go (SubsetTextHost.codes value, 0, []) end

  val compare = fn (left, right) =>
    SubsetResult.andThen (fromNative left, fn xs =>
      SubsetResult.andThen (fromNative right, fn ys =>
        SubsetBytes.compareWith (xs, ys, fn offset => NonByte offset)))

  val rec concat = fn pieces =>
    case pieces of [] => "" | [value] => value | first :: second :: rest =>
      let
        val rec pairs = fn
            ([], acc) => SubsetList.reverse acc
          | ([value], acc) => SubsetList.reverse (value :: acc)
          | (left :: right :: tail, acc) => pairs (tail, (left ^ right) :: acc)
      in concat (pairs (pieces, [])) end

  val concatWith = fn (pieces, separator) =>
    case pieces of [] => "" | first :: rest =>
      let
        val rec go = fn
            ([], acc) => concat (SubsetList.reverse acc)
          | (piece :: tail, acc) => go (tail, piece :: separator :: acc)
      in go (rest, [first]) end

  val toNative = fn bytes =>
    let
      val rec go = fn
          ([], offset, codes) => SubsetResult.Ok (SubsetTextHost.fromCodes (SubsetList.reverse codes))
        | (c :: rest, offset, codes) =>
            case SubsetChar.toCode c of
              SubsetResult.Err error => SubsetResult.Err (NonByte offset)
            | SubsetResult.Ok code => go (rest, offset + 1, code :: codes)
    in go (bytes, 0, []) end

  (* Checked byte-string helpers share the extraction/reconstruction boundaries. *)
  val size32 = fn value => SubsetResult.map (fromNative value, SubsetList.length32)
  val str = fn c => toNative [c]
  (* A one-character native string. Total: a character is always a host text unit. *)
  val fromChar = fn c => SubsetTextHost.fromCodes [SubsetTextHost.charCode c]

  (* SML STRING counterparts, with data-first arguments and typed boundary errors.
     Validate complete operands even when a match could be decided early. *)
  val isPrefix = fn (value, prefix) =>
    SubsetResult.andThen (fromNative value, fn bytes =>
      SubsetResult.map (fromNative prefix, fn wanted => SubsetBytes.isPrefix (bytes, wanted)))
  val isSuffix = fn (value, suffix) =>
    SubsetResult.andThen (fromNative value, fn bytes =>
      SubsetResult.map (fromNative suffix, fn wanted => SubsetBytes.isSuffix (bytes, wanted)))
  val isSubstring = fn (value, needle) =>
    SubsetResult.andThen (fromNative value, fn bytes =>
      SubsetResult.map (fromNative needle, fn wanted => SubsetBytes.isSubstring (bytes, wanted)))

  val fields = fn (value, delimiter) =>
    SubsetResult.andThen (fromNative value, fn bytes =>
      SubsetList.traverse (SubsetBytes.fields (bytes, delimiter), toNative))
  val tokens = fn (value, delimiter) =>
    SubsetResult.map (fields (value, delimiter), fn pieces =>
      SubsetList.filter (pieces, fn piece => piece <> ""))

  (* Range errors are separate from the existing byte-conversion error type.
     Successive checked drops/takes avoid overflowing start + count. *)
  val extract32 = fn (value, start, count) =>
    SubsetResult.andThen (SubsetResult.mapErr (fromNative value, StringError), fn bytes =>
      SubsetResult.andThen (SubsetResult.mapErr (SubsetList.drop32 (bytes, start), fn error => InvalidIndex), fn rest =>
        let
          val selected = case count of
              SubsetOptionValue.NONE => SubsetResult.Ok rest
            | SubsetOptionValue.SOME size32 =>
                SubsetResult.mapErr (SubsetList.take32 (rest, size32), fn error => InvalidIndex)
        in SubsetResult.andThen (selected, fn chosen =>
          SubsetResult.mapErr (toNative chosen, StringError)) end))
  val substring32 = fn (value, start, count) => extract32 (value, start, SubsetOptionValue.SOME count)

  val map = fn (value, transform) =>
    SubsetResult.andThen (fromNative value, fn bytes =>
      toNative (SubsetList.map (bytes, transform)))
  val translate = fn (value, transform) =>
    SubsetResult.andThen (fromNative value, fn bytes =>
      SubsetResult.andThen (SubsetList.traverse (bytes, fn c => fromNative (transform c)), fn pieces =>
        toNative (SubsetList.concat pieces)))
end
