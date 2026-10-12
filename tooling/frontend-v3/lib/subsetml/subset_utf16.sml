(* @subsetml
from "./subset_unicode.sml" import * as SubsetUnicode;
from "./subset_list.sml" import * as SubsetList;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_char.sml" import * as SubsetChar;
*)

(* Strict UTF-16 byte codecs. Endianness is explicit; BOMs are ordinary scalars. *)
structure SubsetUtf16 = struct
  datatype endian = LittleEndian | BigEndian

  val unitCodes = fn (unitCode, order) =>
    let val (high, low) = SubsetUnicode.split (unitCode, 256.0) in
      case order of LittleEndian => [low, high] | BigEndian => [high, low]
    end
  val encodeOne = fn (code, order, index) =>
    if SubsetUnicode.isScalar code then
      let
        val codes = if code < 65536.0 then unitCodes (code, order)
          else let val (high, low) = SubsetUnicode.split (code - 65536.0, 1024.0) in
            SubsetList.append (unitCodes (55296.0 + high, order), unitCodes (56320.0 + low, order))
          end
      in SubsetUnicode.encodeCodes (codes, index) end
    else SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.scalarError code, index))

  val encode = fn (scalars, order) =>
    let
      val rec go = fn
          ([], index, acc) => SubsetResult.Ok (SubsetList.reverse acc)
        | (code :: rest, index, acc) =>
            case encodeOne (code, order, index) of
              SubsetResult.Err error => SubsetResult.Err error
            | SubsetResult.Ok bytes => go (rest, index + 1.0, SubsetList.reverseAppend (bytes, acc))
    in go (scalars, 0.0, []) end

  val readUnit = fn (bytes, order, offset) =>
    case bytes of
      [] => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.Truncated, offset))
    | [c] => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.OddLength, offset))
    | a :: b :: rest =>
        case SubsetChar.toCode a of
          SubsetResult.Err error => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.InvalidByte, offset))
        | SubsetResult.Ok first =>
            case SubsetChar.toCode b of
              SubsetResult.Err error => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.InvalidByte, offset + 1.0))
            | SubsetResult.Ok second =>
                SubsetResult.Ok ((case order of LittleEndian => first + second * 256.0
                  | BigEndian => first * 256.0 + second), rest)

  val decodeOne = fn (bytes, order, offset) =>
    SubsetResult.andThen (readUnit (bytes, order, offset), fn (first, rest) =>
      if first >= 55296.0 andalso first <= 56319.0 then
        SubsetResult.andThen (readUnit (rest, order, offset + 2.0), fn (second, tail) =>
          if second >= 56320.0 andalso second <= 57343.0 then
            SubsetResult.Ok (65536.0 + (first - 55296.0) * 1024.0 + second - 56320.0, tail, 4.0)
          else SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.UnpairedSurrogate, offset + 2.0)))
      else (if first >= 56320.0 andalso first <= 57343.0 then
        SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.UnpairedSurrogate, offset))
      else SubsetResult.Ok (first, rest, 2.0)))

  val decode = fn (bytes, order) =>
    let
      val rec go = fn
          ([], offset, acc) => SubsetResult.Ok (SubsetList.reverse acc)
        | (input, offset, acc) =>
            case decodeOne (input, order, offset) of
              SubsetResult.Err error => SubsetResult.Err error
            | SubsetResult.Ok decoded =>
                let val (code, rest, consumed) = decoded in
                  go (rest, offset + consumed, code :: acc)
                end
    in go (bytes, 0.0, []) end
end
