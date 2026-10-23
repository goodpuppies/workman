(* @subsetml
from "./subset_unicode.sml" import * as SubsetUnicode;
from "./subset_list.sml" import * as SubsetList;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_text_host.sml" import * as SubsetTextHost;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_utf16.sml" import * as SubsetUtf16;
from "./subset_utf8.sml" import * as SubsetUtf8;
*)

(* Lossless UTF-16 units, including lone surrogates. Strict codecs remain separate.
   Tree/Source constructors are implementation representations; use the checked builders. *)
structure SubsetUtf16Source = struct
  datatype error = InvalidUnit of int | InvalidIndex | UnicodeError of SubsetUnicode.error
  datatype tree = Empty | Unit of int | Branch of int * tree * tree
  datatype source = Source of tree * int * int

  val treeLength = fn Empty => 0 | Unit code => 1 | Branch (size, left, right) => size
  val length = fn Source (tree, start, count) => count
  val isUnit = fn (code : int) =>
    code >= 0 andalso code <= 65535
    andalso (let val (whole, residue) = SubsetUnicode.split (code, 1) in residue <= 0 end)

  val fromUnits = fn units =>
    let
      val join = fn (left, right) => Branch (treeLength left + treeLength right, left, right)
      val rec push = fn (tree, stack) =>
        case stack of
          [] => [tree]
        | previous :: rest =>
            if treeLength previous <= treeLength tree then push (join (previous, tree), rest)
            else tree :: stack
      val rec build = fn
          ([], index, stack) =>
            let val tree = SubsetList.foldLeft (stack, Empty, fn (tree, acc) => join (tree, acc))
            in SubsetResult.Ok (Source (tree, 0, index)) end
        | (code :: rest, index, stack) =>
            if isUnit code then build (rest, index + 1, push (Unit code, stack))
            else SubsetResult.Err (InvalidUnit index)
    in build (units, 0, []) end

  (* Native means storage units, not implicit UTF-8 decoding. JS supplies UTF-16 units;
     the SML adapter supplies byte values. Decode native UTF-8 file bytes explicitly. *)
  val fromNativeUnits = fn text => fromUnits (SubsetTextHost.codes text)

  (* NONE means no unit at this index: outside the view. *)
  val peek = fn (Source (tree, start, count), index : int) =>
    if index >= 0 andalso index < count then
      let
        val rec go = fn
            (Empty, offset) => NONE
          | (Unit code, offset) =>
              if offset <= 0 andalso offset >= 0 then SOME code else NONE
          | (Branch (size, left, right), offset) =>
              if offset < treeLength left then go (left, offset)
              else go (right, offset - treeLength left)
      in go (tree, start + index) end
    else NONE

  val at = fn (source, index) =>
    case peek (source, index) of
      SOME code => SubsetResult.Ok code
    | NONE => SubsetResult.Err InvalidIndex

  (* Views retain the original tree; slicing does not copy or decode source spelling. *)
  val slice = fn (source, offset : int, count : int) =>
    let
      val boundary = fn index =>
        index >= 0 andalso index <= length source
        andalso (if index >= length source then true else SubsetResult.isOk (at (source, index)))
      val Source (tree, start, size) = source
    in
      if count >= 0 andalso boundary offset andalso count <= size - offset then
        SubsetResult.Ok (Source (tree, start + offset, count))
      else SubsetResult.Err InvalidIndex
    end

  val toUnits = fn Source (tree, start, count) =>
    let
      val finish = start + count
      val rec collect = fn (node, base, acc) =>
        if base >= finish orelse base + treeLength node <= start then acc
        else case node of
            Empty => acc
          | Unit code => code :: acc
          | Branch (size, left, right) =>
              collect (left, base, collect (right, base + treeLength left, acc))
    in collect (tree, 0, []) end

  (* Raw UTF-16 bytes validate byte values and pairing, but not surrogate pairing.
     Errors retain byte offsets, including the final byte of an odd-length input. *)
  val fromUtf16Bytes = fn (bytes, order) =>
    let
      val invalid = fn (reason, offset) =>
        SubsetResult.Err (UnicodeError (SubsetUnicode.Error (reason, offset)))
      val rec read = fn
          ([], offset, acc) => fromUnits (SubsetList.reverse acc)
        | ([last], offset, acc) => invalid (SubsetUnicode.OddLength, offset)
        | (first :: second :: rest, offset, acc) =>
            case SubsetChar.toCode first of
              SubsetResult.Err error => invalid (SubsetUnicode.InvalidByte, offset)
            | SubsetResult.Ok a =>
                case SubsetChar.toCode second of
                  SubsetResult.Err error => invalid (SubsetUnicode.InvalidByte, offset + 1)
                | SubsetResult.Ok b =>
                    let val code = case order of
                        SubsetUtf16.LittleEndian => a + b * 256
                      | SubsetUtf16.BigEndian => a * 256 + b
                    in read (rest, offset + 2, code :: acc) end
    in read (bytes, 0, []) end

  val toUtf16Bytes = fn (source, order) =>
    let
      val rec encode = fn
          ([], offset, acc) => SubsetResult.Ok (SubsetList.reverse acc)
        | (code :: rest, offset, acc) =>
            case SubsetUnicode.encodeCodes (SubsetUtf16.unitCodes (code, order), offset) of
              SubsetResult.Err error => SubsetResult.Err (UnicodeError error)
            | SubsetResult.Ok bytes => encode (rest, offset + 2, SubsetList.reverseAppend (bytes, acc))
    in encode (toUnits source, 0, []) end

  val fromScalars = fn scalars =>
    SubsetResult.andThen (
      SubsetResult.mapError (SubsetUtf16.encode (scalars, SubsetUtf16.LittleEndian), UnicodeError),
      fn bytes => fromUtf16Bytes (bytes, SubsetUtf16.LittleEndian))
  val toScalars = fn source =>
    SubsetResult.andThen (toUtf16Bytes (source, SubsetUtf16.LittleEndian), fn bytes =>
      SubsetResult.mapError (SubsetUtf16.decode (bytes, SubsetUtf16.LittleEndian), UnicodeError))
  val fromUtf8 = fn bytes =>
    SubsetResult.andThen (SubsetResult.mapError (SubsetUtf8.decode bytes, UnicodeError), fromScalars)
  val toUtf8 = fn source =>
    SubsetResult.andThen (toScalars source, fn scalars =>
      SubsetResult.mapError (SubsetUtf8.encode scalars, UnicodeError))
end
