export type TupleHandle = [bigint];

export enum TupleStatus {
  Ok,
  Error,
}

export interface TupleForeign {
  create(): [TupleStatus, TupleHandle];
  unsupportedObject(): { value: string };
  add(...values: number[]): void;
  fixed(value: number): void;
}

export declare function foreignValue(): TupleForeign;

export declare function makePair(): [number, string];

export declare function acceptHandle(handle: TupleHandle): void;
