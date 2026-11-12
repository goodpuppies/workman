declare const optionBrand: unique symbol;

/**
 * A Workman `Option`. Opaque: construct it with `Some`/`None`/`fromNullable` and read it with
 * `isSome`, `getOr`, `match`, or `toNullable`. Nested Options and `Some(undefined)` stay distinct.
 */
export interface Option<out T> {
  readonly [optionBrand]: T;
}

/** A Workman `Result`, as a discriminated union. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** A Workman `Task`: eager, and an ordinary WM `Err` resolves rather than rejects. */
export type Task<T, E> = Promise<Result<T, E>>;

export const None: Option<never>;
export function Some<T>(value: T): Option<T>;
export function isSome<T>(option: Option<T>): boolean;
export function isNone<T>(option: Option<T>): boolean;
export function getOr<T>(option: Option<T>, fallback: T): T;
export function match<T, R>(
  option: Option<T>,
  cases: { readonly some: (value: T) => R; readonly none: () => R },
): R;
/** `null` and `undefined` become `None`; any other value, `Some(value)`. */
export function fromNullable<T>(value: T | null | undefined): Option<T>;
/** `None` becomes `undefined`. Loses the distinction for `Option<undefined>` and nested Options. */
export function toNullable<T>(option: Option<T>): T | undefined;
export function Ok<T>(value: T): Result<T, never>;
export function Err<E>(error: E): Result<never, E>;
