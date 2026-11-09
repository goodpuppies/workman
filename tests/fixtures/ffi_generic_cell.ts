// React-shaped generic result without React's value-or-updater setter union.
export function makeCell<T>(initial: T | (() => T)): [T, (next: T) => void] {
  let value = typeof initial === "function" ? (initial as () => T)() : initial;
  return [value, (next) => {
    value = next;
  }];
}
