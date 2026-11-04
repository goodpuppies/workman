export class Tagged<T = string> {
  constructor(readonly value: T) {}
}
export class Pair<A, B = string> {
  constructor(readonly first: A, readonly second: B) {}
}
export const numberTagged = () => new Tagged<number>(1);
export const stringTagged = () => new Tagged<string>("s");
export const numberPair = () => new Pair<number, number>(1, 2);
export const describe = (tagged: Tagged<unknown>) => String(tagged.value);
