// Primitives of `std/task.wm`. A `Task<A, E>` is a promise that resolves to a `Result<A, E>`, never
// one that rejects. These functions only sequence promises; everything that inspects a `Result` is
// written in Workman, so this file doesn't depend on how the compiler represents constructors.

/** A settled task holding `value`, which is a `Result`. */
export const resolve = (value) => Promise.resolve(value);

/**
 * Run `next` on the task's `Result`. `next` returns a `Result` or a task; both are flattened.
 * Not named `then`: a module namespace with a `then` export is a thenable, so `await import()` of
 * this file would call it.
 */
export const onSettled = (task, next) => Promise.resolve(task).then(next);

/**
 * Wait for both tasks, then run the curried `next` on their `Result`s. Curried because a JavaScript
 * array handed to a Workman callback arrives as a `Js.Array`, not a tuple.
 */
export const both = (left, right, next) =>
  Promise.all([left, right]).then(([leftResult, rightResult]) => next(leftResult)(rightResult));

/** Wait for every task in a JavaScript array, giving the array of their `Result`s. */
export const settleAll = (tasks) => Promise.all(tasks);

export const race = (left, right) => Promise.race([left, right]);

/** A task settled by the `complete` callback that `register` receives. */
export const promise = (register) => new Promise((complete) => register(complete));
