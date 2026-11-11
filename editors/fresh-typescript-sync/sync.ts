// Small structural API subset so this module is testable outside Fresh's QuickJS runtime.
export interface FreshSyncEditor {
  listBuffers(): { id: number; path: string | null }[];
  getBufferText(id: number): Promise<string>;
  sendLspRequest(
    language: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;
  on(event: string, handler: (event: { buffer_id?: number }) => void): void;
  setInterval(milliseconds: number, handler: string): number;
}

export function installWorkmanTypeScriptSync(
  editor: FreshSyncEditor,
  register: (name: string, handler: () => Promise<void>) => void,
): void {
  const synchronized = new Map<string, string>();
  let busy = false;
  let retryAt = 0;
  let lastError: string | undefined;
  // Activation also covers a restarted TS session. Buffer content is sampled independently of
  // editor hook delivery, so restored buffers, saves, undo and reload cannot leave us "clean".
  for (
    const event of ["buffer_activated", "config_changed", "lsp_server_error"]
  ) {
    editor.on(event, () => synchronized.clear());
  }
  register("workman_typescript_sync_buffers", async () => {
    if (busy || Date.now() < retryAt) return;
    busy = true;
    try {
      const buffers = editor.listBuffers();
      const targets = ["typescript", "javascript"].filter((language) => {
        const suffix = language === "typescript" ? /\.[cm]?tsx?$/ : /\.[cm]?jsx?$/;
        // The terminal-mode plugin config snapshot can disagree with the live LSP manager.
        // Resolve the running server through sendLspRequest instead. Its acknowledgement of
        // workman/syncDocuments verifies the adapter, without trusting cached config metadata.
        return buffers.some((buffer) => buffer.path && suffix.test(buffer.path));
      });
      if (!targets.length) {
        synchronized.clear();
        return;
      }
      const documents = [];
      for (const buffer of buffers) {
        if (!buffer.path?.endsWith(".wm")) continue;
        const normalized = buffer.path.replaceAll("\\", "/");
        const uri = "file://" + (normalized.startsWith("/") ? "" : "/") +
          encodeURI(normalized).replaceAll("#", "%23").replaceAll("?", "%3F");
        documents.push({ uri, text: await editor.getBufferText(buffer.id) });
      }
      documents.sort((a, b) => a.uri.localeCompare(b.uri));
      if (!documents.length && !synchronized.size) return;
      const signature = JSON.stringify(documents);
      for (const language of targets) {
        if (synchronized.get(language) === signature) continue;
        await editor.sendLspRequest(language, "workman/syncDocuments", {
          documents,
        });
        synchronized.set(language, signature);
        console.log(
          `Workman TypeScript sync acknowledged: ${language}, ${documents.length} wm buffer(s)`,
        );
      }
      lastError = undefined;
    } catch (error) {
      // A server may still be starting or restarting. Retry without marking it synchronized.
      retryAt = Date.now() + 1000;
      const message = String(error);
      if (message !== lastError) {
        console.error("Workman TypeScript buffer sync failed:", message);
      }
      lastError = message;
    } finally {
      busy = false;
    }
  });
  // Fresh owns this timer and cancels it when the plugin unloads. Requests and TS transforms are
  // deduplicated by content; reads are serialized so an older read cannot overwrite a newer one.
  editor.setInterval(250, "workman_typescript_sync_buffers");
}

declare const editor: FreshSyncEditor;
declare function registerHandler(
  name: string,
  handler: () => Promise<void>,
): void;
if (typeof editor !== "undefined") {
  installWorkmanTypeScriptSync(editor, registerHandler);
}
