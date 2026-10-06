import type { Item } from "../../model";
import { spanOf } from "../../model";

// Adapted from wmplayground's NodeInspector: inspect fields and their authored source.
// Keep the full data rather than guessing a generic children array for structural nodes.
export function NodeInspector({ item, source, onMate }: {
  item: Item | null;
  source: string;
  onMate: (index: number) => void;
}) {
  function tree(key: string, value: unknown): React.ReactNode {
    if (value !== null && typeof value === "object") {
      return <details key={key} open={key === "item"}>
        <summary>{key}{"name" in value ? ` · ${value.name}` : ""}</summary>
        {Object.entries(value).map(([field, child]) => tree(field, child))}
      </details>;
    }
    return <div className="leaf" key={key}>{key}: {JSON.stringify(value)}</div>;
  }
  const bounds = item && spanOf(item);
  return <section className="inspector-pane">
    <h2>Inspector{item && "mateIdx" in item && item.mateIdx.name === "Mate" &&
      <button onClick={() => onMate(item.mateIdx.args[0])}>Go to mate</button>}</h2>
    <pre id="spelling">{bounds && JSON.stringify(source.slice(...bounds))}</pre>
    <div id="inspector">{item ? tree("item", item) : "Select an item to inspect its fields."}</div>
  </section>;
}
