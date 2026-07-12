export type TupleHandle = [bigint];

export enum TupleStatus {
  Ok,
  Error,
}

export interface TupleForeign {
  create(): [TupleStatus, TupleHandle];
  unsupportedObject(): { value: string };
}

export declare function foreignValue(): TupleForeign;

export declare function makePair(): [number, string];
