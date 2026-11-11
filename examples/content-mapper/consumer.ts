import { curried, double, identity, sum } from "./math.wm";

const answer = double(21);
const greeting: string = identity("hello from wm");
// The JS boundary passes the WM parameter tuple as positional arguments.
const total: number = sum(20, 22);
const curriedTotal: number = curried(20)(22);

// These directives also verify that TypeScript rejects the invalid calls.
// Remove one to see the corresponding diagnostic.
// @ts-expect-error WM in'ferred a numeric argument.
double("wrong");
// @ts-expect-error The JS boundary expects positional arguments.
sum([20, 22]);
// @ts-expect-error The polymorphic identity preserves its argument's type.
const wrong: number = identity("a string");

export { answer, curriedTotal, greeting, total };
