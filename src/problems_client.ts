/**
 * The channel between the problems backend and the Workman TUI.
 *
 * Both halves run in one process — `problemsCommand` starts the TUI in-process —
 * so a shared module is the entire transport. The TUI is compiled Workman whose
 * only inbound FFI is this module, imported as `#problems-client`.
 *
 * The interface is one function. `nextSnapshot(revision)` resolves with the first
 * snapshot newer than `revision`, immediately if one already exists and otherwise
 * when the backend next publishes. That makes the TUI event-driven: it asks for
 * what comes after what it is showing, and is woken when there is an answer.
 */

export type Problem = {
  path: string;
  line: number;
  column: number;
  severity: number;
  code: string;
  message: string;
};

export type Head = {
  kind: string;
  path: string;
  moduleCount: number;
  recovered: boolean;
};

export type Snapshot = {
  revision: number;
  problems: Problem[];
  head: Head;
};

const initial: Snapshot = {
  revision: 0,
  problems: [],
  head: { kind: "", path: "", moduleCount: 0, recovered: false },
};

let latest: Snapshot = initial;
let waiting: ((snapshot: Snapshot) => void)[] = [];

/** The snapshot the TUI would render right now. */
export function current(): Snapshot {
  return latest;
}

/** Publish a new snapshot and wake everyone waiting on one. */
export function publish(problems: Problem[], head: Head): Snapshot {
  latest = { revision: latest.revision + 1, problems, head };
  const woken = waiting;
  waiting = [];
  for (const resolve of woken) resolve(latest);
  return latest;
}

/** The first snapshot newer than `revision`. */
export function nextSnapshot(revision: number): Promise<Snapshot> {
  if (latest.revision > revision) return Promise.resolve(latest);
  return new Promise((resolve) => waiting.push(resolve));
}

/** Drop published state and waiters. Tests share this module; a run does not. */
export function reset(): void {
  latest = initial;
  for (const resolve of waiting) resolve(initial);
  waiting = [];
}
