// Deno may skip constructing Request for a callback whose declared arity is zero.
// Workman FFI adapters use rest parameters, so retain an explicit request here.
export const serve = (options, handler) => Deno.serve(options, (request) => handler(request));
