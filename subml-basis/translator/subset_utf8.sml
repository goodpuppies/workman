(* @subsetml
from "./subset_unicode.sml" import * as SubsetUnicode;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./subset_char.sml" import * as SubsetChar;
*)

(* Strict UTF-8 over byte characters and numeric Unicode scalars. *)
structure SubsetUtf8 = struct
  val encodeOne = fn (code, index) =>
    if SubsetUnicode.isScalar code then
      let
        val (a, b) = SubsetUnicode.split (code, 64)
        val (c, d) = SubsetUnicode.split (a, 64)
        val (e, f) = SubsetUnicode.split (c, 64)
        val codes = if code < 128 then [code]
          else (if code < 2048 then [192 + a, 128 + b]
          else (if code < 65536 then [224 + c, 128 + d, 128 + b]
          else [240 + e, 128 + f, 128 + d, 128 + b]))
      in SubsetUnicode.encodeCodes (codes, index) end
    else SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.scalarError code, index))

  val encode = fn scalars =>
    let
      val rec go = fn
          ([], index, acc) => SubsetResult.Ok (SubsetList.reverse acc)
        | (code :: rest, index, acc) =>
            case encodeOne (code, index) of
              SubsetResult.Err error => SubsetResult.Err error
            | SubsetResult.Ok bytes => go (rest, index + 1, SubsetList.reverseAppend (bytes, acc))
    in go (scalars, 0, []) end

  val decodeOne = fn (bytes, offset) =>
    case bytes of
      [] => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.Truncated, offset))
    | lead :: rest =>
        case SubsetChar.toCode lead of
          SubsetResult.Err error => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.InvalidByte, offset))
        | SubsetResult.Ok first =>
            let
              val continuation = fn (count, initial, minimum) =>
                let
                  val rec go = fn (remaining, input, code, consumed) =>
                    if remaining <= 0 then
                      (if code < minimum then SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.Overlong, offset))
                       else (if SubsetUnicode.isScalar code then SubsetResult.Ok (code, input, consumed)
                       else SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.scalarError code, offset))))
                    else case input of
                        [] => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.Truncated, offset + consumed))
                      | c :: tail =>
                          case SubsetChar.toCode c of
                            SubsetResult.Err error => SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.InvalidByte, offset + consumed))
                          | SubsetResult.Ok value =>
                              if value >= 128 andalso value <= 191 then
                                go (remaining - 1, tail, code * 64 + value - 128, consumed + 1)
                              else SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.InvalidContinuation, offset + consumed))
                in go (count, rest, initial, 1) end
            in
              if first < 128 then SubsetResult.Ok (first, rest, 1)
              else (if first >= 194 andalso first <= 223 then continuation (1, first - 192, 128)
              else (if first >= 224 andalso first <= 239 then continuation (2, first - 224, 2048)
              else (if first >= 240 andalso first <= 244 then continuation (3, first - 240, 65536)
              else SubsetResult.Err (SubsetUnicode.Error (SubsetUnicode.InvalidLeadingByte, offset)))))
            end

  val decode = fn bytes =>
    let
      val rec go = fn
          ([], offset, acc) => SubsetResult.Ok (SubsetList.reverse acc)
        | (input, offset, acc) =>
            case decodeOne (input, offset) of
              SubsetResult.Err error => SubsetResult.Err error
            | SubsetResult.Ok decoded =>
                let val (code, rest, consumed) = decoded in
                  go (rest, offset + consumed, code :: acc)
                end
    in go (bytes, 0, []) end
end
