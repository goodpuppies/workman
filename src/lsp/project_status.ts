import { normalize, resolve } from "node:path";
import type { ProjectSnapshot } from "../module_interface.ts";
import type { SemanticService } from "./semantic_service.ts";
import { fileUriToPath } from "./uri.ts";

/**
 * Project-context status for one document, derived entirely from compiler facts.
 *
 * A project is one `main` head plus its reachable graph (`D31`); a document uses the
 * context selected by the compiler registry (`D32`). This surface exists so an editor
 * can display which head currently owns a file — making head selection, stability
 * across edits, and headed-versus-detached behavior observable in real usage.
 */
export type ProjectHeadStatus = Readonly<{
  kind: ProjectSnapshot["kind"];
  /** Display path of the head module. A display fact, never an identity. */
  headPath: string;
  moduleCount: number;
  containsDocument: boolean;
}>;

export type ProjectStatusResult = Readonly<{
  selected:
    | Readonly<{
      kind: ProjectSnapshot["kind"];
      headPath: string;
      moduleCount: number;
      /** True when strict analysis failed and the snapshot is the recovered one. */
      recovered: boolean;
    }>
    | null;
  activeHeads: readonly ProjectHeadStatus[];
}>;

export async function projectStatusForUri(
  service: SemanticService,
  uri: string,
): Promise<ProjectStatusResult> {
  const documentPath = canonical(fileUriToPath(uri));
  const context = await service.documentContext(uri);
  const selected = context
    ? Object.freeze({
      kind: context.project.kind,
      headPath: headPath(context.project),
      moduleCount: context.project.interfaces.size,
      recovered: context.recovered,
    })
    : null;
  const activeHeads = service.openSnapshots().map((snapshot) =>
    Object.freeze({
      kind: snapshot.kind,
      headPath: headPath(snapshot),
      moduleCount: snapshot.interfaces.size,
      containsDocument: [...snapshot.interfaces.values()]
        .some((item) => canonical(item.path) === documentPath),
    })
  );
  return Object.freeze({ selected, activeHeads: Object.freeze(activeHeads) });
}

function headPath(snapshot: ProjectSnapshot): string {
  return snapshot.interfaces.get(snapshot.head)?.path ?? "";
}

function canonical(path: string): string {
  return normalize(resolve(path));
}
