export type ValidationTicket = Readonly<{
  generation: number;
  isCurrent: () => boolean;
}>;

type ValidationOperation = (ticket: ValidationTicket) => void | Promise<void>;

type ScheduledValidation = Readonly<{
  generation: number;
  operation: ValidationOperation;
}>;

type ValidationState = {
  generation: number;
  pending?: ScheduledValidation;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
};

/** Per-key debounce with one active and at most one latest pending validation. */
export class ValidationScheduler {
  #states = new Map<string, ValidationState>();

  constructor(readonly debounceMs = 50) {}

  schedule(key: string, operation: ValidationOperation): number {
    const state = this.#states.get(key) ?? { generation: 0 };
    this.#states.set(key, state);
    const generation = ++state.generation;
    state.pending = { generation, operation };
    if (state.running) return generation;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      this.#start(key, state);
    }, this.debounceMs);
    return generation;
  }

  cancel(key: string): void {
    const state = this.#states.get(key);
    if (!state) return;
    state.generation++;
    state.pending = undefined;
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    if (!state.running) this.#states.delete(key);
  }

  async drain(): Promise<void> {
    while (true) {
      for (const [key, state] of this.#states) {
        if (state.timer !== undefined) {
          clearTimeout(state.timer);
          state.timer = undefined;
        }
        if (!state.running && state.pending) this.#start(key, state);
      }
      const running = [...this.#states.values()].flatMap((state) =>
        state.running ? [state.running] : []
      );
      if (running.length === 0) return;
      await Promise.allSettled(running);
    }
  }

  #start(key: string, state: ValidationState): void {
    if (state.running || !state.pending) return;
    const scheduled = state.pending;
    state.pending = undefined;
    const ticket = Object.freeze({
      generation: scheduled.generation,
      isCurrent: () => state.generation === scheduled.generation,
    });
    const running = Promise.resolve().then(() => scheduled.operation(ticket));
    state.running = running.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      state.running = undefined;
      if (state.pending) this.#start(key, state);
      else if (state.timer === undefined) this.#states.delete(key);
    });
  }
}
