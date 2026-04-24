import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  mint(context: __compactRuntime.CircuitContext<PS>,
       recipient_0: Uint8Array,
       amount_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           sender_0: Uint8Array,
           recipient_0: Uint8Array,
           amount_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  getTotalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  getOwner(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getTokenColor(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getCurrentNonce(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type ProvableCircuits<PS> = {
  mint(context: __compactRuntime.CircuitContext<PS>,
       recipient_0: Uint8Array,
       amount_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           sender_0: Uint8Array,
           recipient_0: Uint8Array,
           amount_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  getTotalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  getOwner(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getTokenColor(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getCurrentNonce(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  mint(context: __compactRuntime.CircuitContext<PS>,
       recipient_0: Uint8Array,
       amount_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  transfer(context: __compactRuntime.CircuitContext<PS>,
           sender_0: Uint8Array,
           recipient_0: Uint8Array,
           amount_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  getTotalSupply(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  getOwner(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getTokenColor(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getCurrentNonce(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
  readonly totalSupply: bigint;
  readonly owner: Uint8Array;
  readonly tokenColor: Uint8Array;
  readonly currentNonce: Uint8Array;
  readonly nonceIndex: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
