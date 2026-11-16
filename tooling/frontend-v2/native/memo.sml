(* Native implementation of host/memo.wm, for MLton. Full SML, not SubsetML: the packrat memo
   is a mutable hash table keyed by rule slot. Slots are non-negative integral reals that can
   exceed the default int range, so they are hashed with Real.rem. native/memo.wm is the
   checker interface. *)
structure FrontendMemo = struct
  type 'v memo = { buckets : (real * 'v) list array ref, count : int ref }

  val empty = fn () => { buckets = ref (Array.array (1024, [])), count = ref 0 } : 'v memo

  fun index (buckets, slot) =
    Real.trunc (Real.rem (slot, Real.fromInt (Array.length buckets)))

  fun lookup (entries, slot) =
    case entries of
      [] => NONE
    | (key, value) :: rest => if Real.== (key, slot) then SOME value else lookup (rest, slot)

  val get = fn ({ buckets, ... } : 'v memo, slot) =>
    lookup (Array.sub (!buckets, index (!buckets, slot)), slot)

  fun grow (buckets : (real * 'v) list array ref) =
    let
      val old = !buckets
      val next = Array.array (2 * Array.length old, [])
      fun insert (slot, value) =
        let val i = index (next, slot) in Array.update (next, i, (slot, value) :: Array.sub (next, i)) end
    in
      Array.app (List.app insert) old;
      buckets := next
    end

  (* Each slot is written once per parse, after its lookup missed. *)
  val set = fn ({ buckets, count } : 'v memo, slot, value) =>
    let val i = index (!buckets, slot) in
      Array.update (!buckets, i, (slot, value) :: Array.sub (!buckets, i));
      count := !count + 1;
      if !count > 2 * Array.length (!buckets) then grow buckets else ()
    end
end
