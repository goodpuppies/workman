(* @subsetml
from "./subset_list.sml" import * as SubsetList;
from "./subset_result.sml" import * as SubsetResult;
from "./subset_bytes.sml" import * as SubsetBytes;
from "./subset_string.sml" import * as SubsetString;
*)

(* Immutable source-built byte index. Native input is converted exactly once. *)
structure SubsetSource = struct
  datatype source = Empty | Byte of char | Branch of int * source * source
  val length = fn Empty => 0 | Byte c => 1 | Branch (size, left, right) => size
  val join = fn (left, right) => Branch (length left + length right, left, right)
  val build = fn bytes =>
    let
      val rec push = fn (tree, stack) =>
        case stack of [] => [tree] | previous :: rest =>
          if length previous <= length tree then push (join (previous, tree), rest)
          else tree :: stack
      val forest = SubsetList.foldLeft (bytes, [], fn (c, stack) => push (Byte c, stack))
    in SubsetList.foldLeft (forest, Empty, fn (tree, acc) => join (tree, acc)) end
  val fromBytes = fn bytes => SubsetResult.map (SubsetBytes.validate bytes, build)
  val fromNative = fn value => SubsetResult.map (SubsetString.fromNative value, build)

  val at = fn (tree, index : int) =>
    if index >= 0 andalso index < length tree then
      let
        val rec go = fn
            (Empty, offset) => SubsetResult.Err SubsetBytes.OutOfBounds
          | (Byte c, offset) =>
              if offset <= 0 andalso offset >= 0 then SubsetResult.Ok c
              else SubsetResult.Err SubsetBytes.InvalidIndex
          | (Branch (size, left, right), offset) =>
              if offset < length left then go (left, offset)
              else go (right, offset - length left)
      in go (tree, index) end
    else SubsetResult.Err SubsetBytes.InvalidIndex

  val boundary = fn (tree, index) =>
    if index >= 0 andalso index <= length tree then
      if index >= length tree then true else SubsetResult.isOk (at (tree, index))
    else false
  val slice = fn (tree, start, count) =>
    if count >= 0 andalso boundary (tree, start) andalso count <= length tree - start then
      let
        val finish = start + count
        val rec collect = fn (node, base, acc) =>
          if base >= finish orelse base + length node <= start then acc
          else case node of
              Empty => acc
            | Byte c => c :: acc
            | Branch (size, left, right) =>
                collect (left, base, collect (right, base + length left, acc))
      in SubsetResult.Ok (collect (tree, 0, [])) end
    else SubsetResult.Err SubsetBytes.InvalidIndex
end
