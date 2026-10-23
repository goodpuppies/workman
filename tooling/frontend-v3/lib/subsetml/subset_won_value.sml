(* Public WON values and byte-offset decoding errors. *)

structure SubsetWonValue = struct
  datatype value =
      Null
      | Boolean of bool
      | Number of string
      | Text of string
      | Blob of char list
      | List of value list
      | Record of (string * value) list
      | Tag of string * (string * value) list * value

  type error = {offset : int, message : string}
  val makeError = fn (offset, message) => {offset = offset, message = message} : error

  (* A value reached by access, with its reversed path for reporting problems. *)
  type node = {path : string list, value : value}
  val makeNode = fn (path, value) => {path = path, value = value} : node
  datatype problem = Malformed of error | Missing of string | Mismatch of string * string
end
