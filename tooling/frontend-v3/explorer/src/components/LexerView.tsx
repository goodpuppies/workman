import type { Item } from "../../model";
import { label, spanOf } from "../../model";

// Adapted from wmplayground's LexerView. V3 already records reciprocal mate indices.
export function LexerView({ items, source, selected, onSelect }: {
  items: Item[];
  source: string;
  selected: Item | null;
  onSelect: (item: Item) => void;
}) {
  return <div id="items" role="group" aria-label="Lexer items">
    {items.map((item, index) => {
      const bounds = spanOf(item);
      const damaged = "problem" in item || item.marks.length > 0;
      return <button key={index} className={`item${selected === item ? " selected" : ""}${damaged ? " damaged" : ""}`}
        aria-pressed={selected === item} onClick={() => onSelect(item)}>
        <strong>{index} · {label("problem" in item ? item.problem : item.kind)}</strong>
        <small>{bounds.join("–")}  {JSON.stringify(source.slice(...bounds))}</small>
      </button>;
    })}
  </div>;
}
