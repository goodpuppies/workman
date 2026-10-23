(* @subsetml
from "./subset_result.sml" import * as SubsetResult;
from "./subset_list.sml" import * as SubsetList;
from "./subset_string.sml" import * as SubsetString;
from "./subset_char.sml" import * as SubsetChar;
from "./subset_utf8.sml" import * as SubsetUtf8;
*)

(* Shared byte-string and canonical-token helpers; not the public WON API. *)

structure SubsetWonSyntax = struct

  val native = fn xs => SubsetResult.getOr (SubsetString.toNative xs, "")

  val bytes = fn source => SubsetResult.getOr (SubsetString.fromNative source, [])

  val digit = fn c => SubsetChar.isDigit c

  val firstName = fn c =>
    (case (SubsetChar.isAlpha c, c = #"_") of
        (false, false) => false
      | _ => true)

  val nameChar = fn c =>
    (case (firstName c, digit c) of
        (false, false) => false
      | _ => true)

  val identifier = fn source =>
    (case SubsetString.fromNative source of
        SubsetResult.Ok xs =>
          (case xs of
              [] => false
            | c :: rest =>
                case (firstName c, SubsetList.all (rest, nameChar)) of
                    (true, true) => true
                  | _ => false)
      | SubsetResult.Err _ => false)

  val hexDigits = [
    #"0",
    #"1",
    #"2",
    #"3",
    #"4",
    #"5",
    #"6",
    #"7",
    #"8",
    #"9",
    #"a",
    #"b",
    #"c",
    #"d",
    #"e",
    #"f"
  ]

  val hex = fn c =>
    let
      val rec go = fn (xs, n) =>
        (case xs of
            [] => NONE
          | x :: rest => if c = x then SOME n else go (rest, n + 1))
    in
      go (hexDigits, 0)
    end

  val hexPair = fn (a, b) =>
    (case (hex a, hex b) of
        (SOME hi, SOME lo) =>
          SubsetResult.toOption (SubsetChar.fromCode (hi * 16 + lo))
      | _ => NONE)

  val hexByte = fn c =>
    let
      val code = SubsetResult.getOr (SubsetChar.toCode c, 0)
      val rec split = fn (n, hi) => if n < 16 then (hi, n) else split (n - 16, hi + 1)
      val (hi, lo) = split (code, 0)
    in
      native [
        SubsetResult.getOr (SubsetList.at (hexDigits, hi), #"0"),
        SubsetResult.getOr (SubsetList.at (hexDigits, lo), #"0")
      ]
    end

  val quote = fn s =>
    let
      val escape = fn c =>
        (case c of
            #"\"" => "\\\""
          | #"\\" => "\\\\"
          | #"\n" => "\\n"
          | #"\r" => "\\r"
          | #"\t" => "\\t"
          | _ => if SubsetChar.isCntrl c then "\\x" ^ hexByte c else native [c])
      val escaped = SubsetString.concat (SubsetList.map (bytes s, escape))
    in
      "\"" ^ escaped ^ "\""
    end

  val textValid = fn xs => SubsetResult.isOk (SubsetUtf8.decode xs)

  val keyText = fn key => if identifier key then key else quote key

  val duplicate = fn (fields, key) =>
    SubsetList.exists (
      fields,
      fn entry =>
        let
          val (k, _) = entry
        in
          k = key
        end
    )
end
