# Frontend explorer

Run in `tooling/frontend-v3/explorer`:

```sh
npm ci
npm run server
# In a second terminal:
npm run dev
```

Open http://127.0.0.1:5173. The React/Vite client proxies `/api/lex` to the local
Deno server on port 5174. Server startup compiles and loads the current handwritten
WM lexer; restart it after changing lexer code. Generated JavaScript stays on the
server, is loaded from a temporary file, and is deleted after loading.

On this machine, the explorer is also served within the tailnet at
https://homepc.tail7771a7.ts.net:8447. With both dev servers running, enable the
proxy with `tailscale serve --bg --https=8447 http://127.0.0.1:5173`; disable it
with `tailscale serve --https=8447 off`. Vite allows this specific hostname.

The existing WM compiler and its import map are a bootstrap dependency, isolated
in `bootstrap.ts`. Runtime lexing uses frontend-v3 alone, with no existing parser,
LSP, compiler endpoint, or wmplayground service. All explorer sources and its
package manifest live here. Browser execution can replace the server later.

The first stage exposes actual tokens, exact trivia, and localized marks. Select
source or an item to inspect its span and fields; paired tokens offer mate navigation.
The inspector preserves record fields and constructor identity metadata. The
transport adapter flattens WM lists to arrays so large buffers serialize without
recursing through linked lists. Source changes clear stale results; requests for
older revisions are aborted and their replies ignored.
Typed holes and internal failures are shown explicitly; they do not become empty
successful documents or source-error marks.

The reference is `research/workmangr/submodules/wmplayground` at
`fe2b69ea917347a6050f30e39843345221ecb0c7`, particularly `LexerView`, `ASTTreeView`,
and `NodeInspector`. Its source/tree/inspector relationships guide this explorer.

As v3 gains a parser, add its actual structural data as another stage. Inspect
authored slots, missing slots, marks, and unassembled fragments directly; keep
stage identity and source spans explicit. Structural edits and parser execution
are still pending. There is no substitute parser or fabricated AST in this UI.

`npm run build` checks the React client and builds it. Check the Deno side with
`deno check --config ../../../deno.json server.ts`. Source errors remain successful
lexical documents with marks; typed holes return an `unfinished` response and
internal failures return an `internal` response. Neither fabricates lexical data.

Run the transport regression test from the repository root:

```sh
deno test --config deno.json --allow-read --allow-write --allow-env --allow-run tooling/frontend-v3/explorer/server_test.ts
```
