// Deliberately only rank-1 generics: no overloads, unions, or conditional types.
export interface Box<A> {
  readonly value: A;
}

export function succeed<A>(value: A): Box<A> {
  return { value };
}

export function map<A, B>(self: Box<A>, f: (value: A) => B): Box<B> {
  return { value: f(self.value) };
}

export function flatMap<A, B>(self: Box<A>, f: (value: A) => Box<B>): Box<B> {
  return f(self.value);
}

export function run<A>(self: Box<A>): A {
  return self.value;
}

// These calls are monomorphic, but their result types instantiate the same interface.
export function numberBox(): Box<number> {
  return { value: 42 };
}

export function stringBox(): Box<string> {
  return { value: "hello" };
}

export function textLength(box: Box<string>): number {
  return box.value.length;
}
