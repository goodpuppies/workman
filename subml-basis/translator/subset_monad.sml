(* Custom Basis carriers. A carrier is an ordinary record of the operations one wrapping type
   supports; `Monad` functions are field accesses on it, so a carrier passed as a value works
   like any other record. Each operation has its own type parameters, so one record value can
   be used at several types where it is let-bound. A carrier passed as a parameter has one
   instantiation per call. *)
structure SubsetMonad = struct
  type ('viaArg, 'viaResult, 'viaErrArg, 'viaErrResult, 'succeedArg, 'succeedResult,
        'mapCarrier, 'mapTransform, 'mapResult,
        'map2Left, 'map2Right, 'map2Combine, 'map2Result,
        'andThenCarrier, 'andThenTransform, 'andThenResult,
        'mapErrCarrier, 'mapErrTransform, 'mapErrResult) carrier = {
    via : 'viaArg -> 'viaResult,
    viaErr : 'viaErrArg -> 'viaErrResult,
    succeed : 'succeedArg -> 'succeedResult,
    map : 'mapCarrier * 'mapTransform -> 'mapResult,
    map2 : 'map2Left * 'map2Right * 'map2Combine -> 'map2Result,
    andThen : 'andThenCarrier * 'andThenTransform -> 'andThenResult,
    mapErr : 'mapErrCarrier * 'mapErrTransform -> 'mapErrResult
  }

  (* The subset a lifted operator needs: inject a pure operand, and combine two carriers
     componentwise. A type with no lawful andThen, a fixed-size vector say, can supply this
     without pretending to be a monad. *)
  type ('succeedArg, 'succeedResult, 'mapCarrier, 'mapTransform, 'mapResult,
        'map2Left, 'map2Right, 'map2Combine, 'map2Result) applicative = {
    succeed : 'succeedArg -> 'succeedResult,
    map : 'mapCarrier * 'mapTransform -> 'mapResult,
    map2 : 'map2Left * 'map2Right * 'map2Combine -> 'map2Result
  }

  (* Explicit type variables are rigid, so each annotation spells out how the operations it uses
     relate; the others stay independent. `via` and `viaErr` stay curried: they build a stage
     rather than being one. *)
  val via = fn (domain : ('a, 'b, 'c, 'd, 'e, 'f, 'g, 'h, 'i, 'j, 'k, 'l, 'm, 'n, 'o, 'p, 'q, 'r, 's) carrier) =>
    fn f => #via domain f

  val viaErr = fn (domain : ('a, 'b, 'c, 'd -> 'e, 'f, 'g, 'h, 'i, 'j, 'k, 'l, 'm, 'n, 'o, 'p, 'q, 'r, 's, 't) carrier) =>
    fn inject => fn f => #viaErr domain inject f

  (* The stage functions take the carrier value first, so a pipeline supplies it:
     `value :> Monad.map(Result, f)`. *)
  val map = fn (wrapped, domain : ('a, 'b, 'c, 'd, 'e, 'f, 'g, 'h, 'i, 'j, 'k, 'l, 'm, 'n, 'o, 'p, 'q, 'r, 's) carrier, transform) =>
    #map domain (wrapped, transform)

  val mapErr = fn (wrapped, domain : ('a, 'b, 'c, 'd, 'e, 'f, 'g, 'h, 'i, 'j, 'k, 'l, 'm, 'n, 'o, 'p, 'q, 'r, 's) carrier, transform) =>
    #mapErr domain (wrapped, transform)

  val andThen = fn (wrapped, domain : ('a, 'b, 'c, 'd, 'e, 'f, 'g, 'h, 'i, 'j, 'k, 'l, 'm, 'n, 'o, 'p, 'q, 'r, 's) carrier, transform) =>
    #andThen domain (wrapped, transform)

  (* Applies a carrier-returning function to each item in order and collects the results in one
     carrier. Each item runs only after the previous one succeeded, so the first failure stops
     the traversal. The loop is a self tail call that chains through andThen, so long lists do
     not grow the stack. *)
  val traverse = fn (items : 'item list,
                     domain : ('a, 'b, 'c, 'd, 'value list, 'carried, 'mapped, 'value -> 'value list, 'carried,
                               'e, 'f, 'g, 'h, 'carried, 'value list -> 'carried, 'carried, 'i, 'j, 'k) carrier,
                     f : 'item -> 'mapped) =>
    let
      val rec go = fn (rest, acc) =>
        case rest of
          [] => acc
        | item :: tail =>
            go (tail, #andThen domain (acc, fn values => #map domain (f item, fn value => value :: values)))
      val rec reverse = fn (rest, acc) =>
        case rest of
          [] => acc
        | value :: tail => reverse (tail, value :: acc)
    in
      #andThen domain (go (items, #succeed domain []), fn values => #succeed domain (reverse (values, [])))
    end

end
