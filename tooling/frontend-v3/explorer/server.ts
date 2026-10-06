import { loadLexer } from "./bootstrap.ts";
import { type RuntimeDocument, toDocument } from "./bridge.ts";
import type { LexResponse } from "./model.ts";

export function handler(lex: (source: string) => RuntimeDocument) {
  const respond = (body: LexResponse, status = 200) => Response.json(body, { status });
  return async (request: Request) => {
    if (new URL(request.url).pathname !== "/api/lex") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    let body;
    try {
      body = await request.json();
    } catch {
      // Invalid JSON is a request fault, not a frontend fault.
      return respond({ success: false, error: { kind: "request", message: "Expected JSON with a string source." } }, 400);
    }
    if (body === null || typeof body !== "object" || typeof body.source !== "string") {
      return respond({ success: false, error: { kind: "request", message: "Expected JSON with a string source." } }, 400);
    }
    const start = performance.now();
    try {
      const document = toDocument(lex(body.source));
      return respond({ success: true, document, elapsed: performance.now() - start });
    } catch (error) {
      const unfinished = error instanceof Error && error.name === "TypedHole";
      return respond({
        success: false,
        error: {
          kind: unfinished ? "unfinished" : "internal",
          message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
      }, unfinished ? 422 : 500);
    }
  };
}

if (import.meta.main) {
  const lex = await loadLexer();
  Deno.serve({ hostname: "127.0.0.1", port: 5174 }, handler(lex));
}
