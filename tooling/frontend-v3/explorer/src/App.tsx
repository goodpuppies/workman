import { useEffect, useRef, useState } from "react";
import type { Item, LexResponse } from "../model";
import { spanOf } from "../model";
import { LexerView } from "./components/LexerView";
import { NodeInspector } from "./components/NodeInspector";

const initialSource = `let value = .{items = [1, 2]};
/* Comments /* can nest */ and stay visible. */
let unfinished = {
  text = "bad\\q";
`;
const views = ["tokens", "trivia", "marks"] as const;

export function App() {
  const [source, setSource] = useState(initialSource);
  const [result, setResult] = useState<{ source: string; response: LexResponse } | null>(null);
  const [failure, setFailure] = useState<{ source: string; message: string } | null>(null);
  const [view, setView] = useState<typeof views[number]>("tokens");
  const [selected, setSelected] = useState<Item | null>(null);
  const [offset, setOffset] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/lex", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
          signal: controller.signal,
        });
        const data = await response.json() as LexResponse;
        if (!controller.signal.aborted) setResult({ source, response: data });
      } catch (error) {
        // Aborted requests belong to an older editor revision and must not replace its result.
        if (!controller.signal.aborted) {
          setFailure({ source, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source]);

  const response = result?.source === source ? result.response : null;
  const document = response?.success ? response.document : null;
  const error = failure?.source === source ? failure.message
    : response && !response.success ? `${response.error.kind}: ${response.error.message}` : null;
  const items = document ? {
    tokens: document.tokens,
    trivia: document.tokens.flatMap((token) => token.leadingTrivia),
    marks: document.marks,
  }[view] : [];

  function select(item: Item, focusSource = true) {
    setSelected(item);
    if (focusSource) {
      const [start, end] = spanOf(item);
      editor.current!.focus();
      editor.current!.setSelectionRange(start, end);
      setOffset(start);
    }
  }
  function inspectCursor() {
    const offset = editor.current!.selectionStart;
    setOffset(offset);
    const item = items.find((item) => {
      const [start, end] = spanOf(item);
      return start <= offset && (offset < end || start === end && offset === start);
    });
    setSelected(item ?? null);
  }

  return <>
    <header>
      <div><strong>Workman</strong><span>Frontend v3 explorer · Lexer</span></div>
      <output className={error ? "error" : ""} aria-live="polite">{error ?? (document && response?.success
        ? `${document.tokens.length} tokens · ${document.marks.length} marks · ${response.elapsed.toFixed(1)} ms`
        : "Lexing…")}</output>
    </header>
    <main>
      <section className="source-pane">
        <h2>Source <span>UTF-16 offset {offset}</span></h2>
        <textarea ref={editor} aria-label="Workman source" spellCheck={false} autoCapitalize="off"
          value={source} onChange={(event) => {
            setSource(event.target.value);
            setSelected(null);
            setResult(null);
            setFailure(null);
          }} onClick={inspectCursor} onKeyUp={inspectCursor} />
        <p>Select source to inspect its item. Click a token, trivia, or mark to select its source span.</p>
      </section>
      <section className="data-pane">
        <nav aria-label="Lexer data">{views.map((tab) => <button key={tab} aria-pressed={view === tab}
          onClick={() => { setView(tab); setSelected(null); }}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav>
        <LexerView items={items} source={source} selected={selected} onSelect={select} />
      </section>
      <NodeInspector item={selected} source={source} onMate={(index) => select(document!.tokens[index])} />
    </main>
  </>;
}
