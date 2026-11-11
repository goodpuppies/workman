import { assertEquals, assertThrows } from "@std/assert";
import {
  ConsumerDiagnostics,
  pushOnlyInitialize,
  WorkmanDocumentSync,
} from "../src/content_mapper/typescript_lsp.ts";
import {
  type FreshSyncEditor,
  installWorkmanTypeScriptSync,
} from "../editors/fresh-typescript-sync/sync.ts";

Deno.test("TypeScript adapter exposes push diagnostics without advertising a second pull cache", () => {
  const message = {
    jsonrpc: "2.0" as const,
    id: 1,
    result: {
      capabilities: {
        hoverProvider: true,
        diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
      },
      serverInfo: { name: "TypeScript" },
    },
  };
  assertEquals(pushOnlyInitialize(message), {
    jsonrpc: "2.0",
    id: 1,
    result: {
      capabilities: { hoverProvider: true },
      serverInfo: { name: "TypeScript" },
    },
  });
  assertEquals(message.result.capabilities.diagnosticProvider.interFileDependencies, true);
});

Deno.test("consumer diagnostics publishes errors and clears them after dependent WM changes", () => {
  const bridge = new ConsumerDiagnostics();
  const uri = "file:///test/consumer.ts";
  bridge.track({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, version: 1 } },
  });
  bridge.invalidate();
  const [request] = bridge.requests();
  assertEquals(request.method, "textDocument/diagnostic");
  const error = { code: 2345, message: "Wrong argument type" };
  assertEquals(
    bridge.response({ jsonrpc: "2.0", id: request.id, result: { kind: "full", items: [error] } }),
    [{
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, version: 1, diagnostics: [error] },
    }],
  );
  bridge.invalidate();
  const [next] = bridge.requests();
  assertEquals(
    bridge.response({ jsonrpc: "2.0", id: next.id, result: { kind: "full", items: [] } }),
    [{
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, version: 1, diagnostics: [] },
    }],
  );
});

Deno.test("push-only adapter requests initial TS diagnostics before any wm buffer is synchronized", () => {
  const bridge = new ConsumerDiagnostics();
  const uri = "file:///test/plain.ts";
  bridge.track({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, version: 1 } },
  });
  const requests = bridge.requests();
  assertEquals(requests.length, 1);
  assertEquals(requests[0].params, { textDocument: { uri } });
});

Deno.test("consumer diagnostics drops stale reports, coalesces edits, and honors close/shutdown", () => {
  const bridge = new ConsumerDiagnostics();
  const uri = "file:///test/consumer.ts";
  bridge.track({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, version: 1 } },
  });
  bridge.invalidate();
  const [old] = bridge.requests();
  bridge.invalidate();
  bridge.track({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: { textDocument: { uri, version: 2 } },
  });
  assertEquals(bridge.requests(), []);
  assertEquals(
    bridge.response({
      jsonrpc: "2.0",
      id: old.id,
      result: { kind: "full", items: [{ message: "stale" }] },
    }),
    [],
  );
  const [latest] = bridge.requests();
  const result = bridge.response({
    jsonrpc: "2.0",
    id: latest.id,
    result: { kind: "full", items: [] },
  });
  assertEquals(result?.[0].params, { uri, version: 2, diagnostics: [] });
  bridge.invalidate();
  const [closing] = bridge.requests();
  bridge.track({
    jsonrpc: "2.0",
    method: "textDocument/didClose",
    params: { textDocument: { uri } },
  });
  assertEquals(
    bridge.response({ jsonrpc: "2.0", id: closing.id, result: { kind: "full", items: [] } }),
    [],
  );
  assertEquals(bridge.response({ jsonrpc: "2.0", id: "native-request", result: null }), undefined);
  bridge.track({ jsonrpc: "2.0", method: "shutdown" });
  bridge.invalidate();
  assertEquals(bridge.requests(), []);
});

Deno.test("WM document synchronization sends open/change/close with deduplication and versions", () => {
  const sync = new WorkmanDocumentSync();
  const uri = "file:///test/math.wm";
  const document = { uri, text: "let value = 1;" };
  const first = sync.update({ documents: [document] });
  assertEquals(first, [{
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { ...document, languageId: "wm", version: 1 } },
  }]);
  assertEquals(sync.update({ documents: [document] }), []);
  assertEquals(
    sync.update({ documents: [{ uri, text: 'let value = "unsaved";' }] }),
    [{
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'let value = "unsaved";' }],
      },
    }],
  );
  assertThrows(() =>
    sync.update({
      documents: [document, { uri: "file:///not-wm.ts", text: "" }],
    })
  );
  // A rejected snapshot must not alter the existing overlay.
  assertEquals(sync.update({ documents: [] }), [{
    jsonrpc: "2.0",
    method: "textDocument/didClose",
    params: { textDocument: { uri } },
  }]);
  assertThrows(() => sync.update({ documents: [document, document] }));
  assertThrows(() =>
    sync.update({
      documents: [{ uri: "https://example.com/file.wm", text: "" }],
    })
  );
});

function freshFixture() {
  let buffers = [
    { id: 1, path: "/test/math #1.wm" },
    { id: 2, path: "/test/consumer.ts" },
  ];
  let text = "let value = 1;";
  let readHook: (() => void) | undefined;
  const events = new Map<string, (event: { buffer_id?: number }) => void>();
  const calls: {
    language: string;
    method: string;
    params: Record<string, unknown>;
  }[] = [];
  let tick!: () => Promise<void>;
  const editor: FreshSyncEditor & { getConfig(): never } = {
    listBuffers: () => buffers,
    getBufferText: () => {
      readHook?.();
      return Promise.resolve(text);
    },
    getConfig: () => {
      throw new Error(
        "Terminal-mode config snapshots cannot select the live LSP",
      );
    },
    sendLspRequest: (language, method, params) => {
      calls.push({ language, method, params });
      return Promise.resolve(null);
    },
    on: (event, handler) => {
      events.set(event, handler);
    },
    setInterval: () => 1,
  };
  installWorkmanTypeScriptSync(editor, (_name, handler) => {
    tick = handler;
  });
  return {
    calls,
    tick: () => tick(),
    event: (event: string, buffer_id?: number) => events.get(event)!({ buffer_id }),
    setText: (value: string) => {
      text = value;
    },
    setBuffers: (value: typeof buffers) => {
      buffers = value;
    },
    onRead: (hook: (() => void) | undefined) => {
      readHook = hook;
    },
  };
}

Deno.test("Fresh sync forwards unsaved WM edits and removes closed overlays without sending TS source", async () => {
  const fixture = freshFixture();
  await fixture.tick();
  assertEquals(fixture.calls, [{
    language: "typescript",
    method: "workman/syncDocuments",
    params: {
      documents: [{
        uri: "file:///test/math%20%231.wm",
        text: "let value = 1;",
      }],
    },
  }]);
  await fixture.tick();
  assertEquals(fixture.calls.length, 1);
  fixture.setText('let value = "unsaved";');
  // No buffer hook is required: this also covers restore, reload, save and undo paths.
  await fixture.tick();
  assertEquals(fixture.calls[1].params, {
    documents: [{
      uri: "file:///test/math%20%231.wm",
      text: 'let value = "unsaved";',
    }],
  });
  fixture.setBuffers([{ id: 2, path: "/test/consumer.ts" }]);
  await fixture.tick();
  assertEquals(fixture.calls[2].params, { documents: [] });
});

Deno.test("Fresh sync resamples content even when an edit happens during an asynchronous read", async () => {
  const fixture = freshFixture();
  fixture.onRead(() => fixture.setText("let newest = true;"));
  await fixture.tick();
  assertEquals(fixture.calls[0].params, {
    documents: [{
      uri: "file:///test/math%20%231.wm",
      text: "let newest = true;",
    }],
  });
  fixture.onRead(undefined);
  fixture.setText('let newest = "changed again without a hook";');
  await fixture.tick();
  assertEquals(fixture.calls[1].params, {
    documents: [{
      uri: "file:///test/math%20%231.wm",
      text: 'let newest = "changed again without a hook";',
    }],
  });
});

Deno.test("Fresh sync waits for a consumer but never uses stale plugin config to select its LSP", async () => {
  const fixture = freshFixture();
  fixture.setBuffers([{ id: 1, path: "/test/math #1.wm" }]);
  await fixture.tick();
  assertEquals(fixture.calls, []);
  fixture.setBuffers([{ id: 1, path: "/test/math #1.wm" }, {
    id: 2,
    path: "/test/consumer.ts",
  }]);
  fixture.event("config_changed");
  await fixture.tick();
  assertEquals(fixture.calls.length, 1);
});
