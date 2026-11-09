export class ReceiverBox {
  constructor(public value = 3) {}
  read(): number {
    return this.value;
  }
  add(amount: number): ReceiverBox {
    this.value += amount;
    return this;
  }
  get child(): ReceiverBox {
    return new ReceiverBox(this.value + 1);
  }
  get broken(): number {
    throw new Error("getter exploded");
  }
  fail(): number {
    throw new Error("method exploded");
  }
  async readLater(): Promise<number> {
    return this.value;
  }
  get pendingValue(): Promise<number> {
    return Promise.resolve(this.value);
  }
}
export function box(): ReceiverBox {
  return new ReceiverBox();
}
export function withBox(callback: (box: ReceiverBox) => number): number {
  return callback(box());
}
export function boxes(): [ReceiverBox, ReceiverBox] {
  return [box(), box()];
}
export function identity<T>(value: T): T {
  return value;
}
export async function boxLater(): Promise<ReceiverBox> {
  return box();
}
export function rejectLater(): Promise<number> {
  return Promise.reject(new Error("promise exploded"));
}
export function throwBeforePromise(): Promise<number> {
  throw new Error("before promise");
}
export async function pairLater(a: number, b: number): Promise<[number, string | null]> {
  return [a + b, null];
}
// Trusted manual Task primitive: the promise already resolves to WM's Result representation.
export function taskPrimitive(): Promise<unknown> {
  return Promise.resolve({ ctor: -3, name: "Ok", a0: 17 });
}
export function maybeBox(): ReceiverBox | null {
  return box();
}
export function boxList(): ReceiverBox[] {
  return [box()];
}
export class ViewNode {
  readonly label = "view";
}
export class ViewRoot {
  render(_view: unknown): void {}
}
export function createRoot(_mount: ReceiverBox): ViewRoot {
  return new ViewRoot();
}
export function createElement(_component: (props: unknown) => ViewNode, _props: unknown): ViewNode {
  return new ViewNode();
}
export function view(): ViewNode {
  return new ViewNode();
}
