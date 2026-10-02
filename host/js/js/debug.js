// Primitive of `host/js/debug.wm`. `show` is `Text.of`, passed in so this file doesn't depend on how
// the compiler prints values. A `Js.Error` is recognized by its constructor name.

export const describe = (error, show) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return String(error.message);
  if (error === null) return "null";
  if (typeof error === "object" && "ctor" in error) {
    if (error.name === "Js.Error") return String(error.args[0]);
    if (error.name === "Js.Unknown") return "unknown JavaScript error";
  }
  return show(error);
};
