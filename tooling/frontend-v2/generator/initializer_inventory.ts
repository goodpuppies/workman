import ts from "typescript-api";
import type { WorkmanGrammarIr } from "../../../scripts/frontend_v2_grammar_ir.ts";

export type InitializerState = Readonly<{
  jsName: string;
  wmName: string;
  initialValue: number;
}>;

export type InitializerHelper = Readonly<{
  jsName: string;
  wmFunction: string;
  parameters: readonly string[];
  code: string;
}>;

export type InitializerInventory = Readonly<{
  state: readonly InitializerState[];
  helpers: readonly InitializerHelper[];
}>;

const stateBindings: Readonly<Record<string, string>> = Object.freeze({
  nextNodeId: "nextNodeId",
  nextLiftId: "nextLiftId",
});

export function inventoryInitializer(grammar: WorkmanGrammarIr): InitializerInventory {
  if (!grammar.initializer) throw new Error("Workman grammar must have an initializer");
  const file = ts.createSourceFile(
    "workman-grammar-initializer.ts",
    grammar.initializer.code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const state: InitializerState[] = [];
  const helpers: InitializerHelper[] = [];

  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error("initializer state must use identifier bindings");
        }
        const jsName = declaration.name.text;
        const wmName = stateBindings[jsName];
        if (!wmName) throw new Error(`initializer state ${jsName} has no Workman binding`);
        if (!declaration.initializer || !ts.isNumericLiteral(declaration.initializer)) {
          throw new Error(`initializer state ${jsName} must have a numeric initial value`);
        }
        state.push(Object.freeze({
          jsName,
          wmName,
          initialValue: Number(declaration.initializer.text),
        }));
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement)) {
      if (!statement.name || !statement.body) {
        throw new Error("initializer functions must be named and have bodies");
      }
      const jsName = statement.name.text;
      const parameters = statement.parameters.map((parameter) => {
        if (!ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken) {
          throw new Error(`initializer helper ${jsName} has a non-portable parameter`);
        }
        return parameter.name.text;
      });
      helpers.push(Object.freeze({
        jsName,
        wmFunction: jsName,
        parameters: Object.freeze(parameters),
        code: statement.getText(file),
      }));
      continue;
    }
    throw new Error(
      `unsupported initializer statement ${ts.SyntaxKind[statement.kind]}`,
    );
  }

  assertUnique(state.map((entry) => entry.jsName), "initializer state");
  assertUnique(helpers.map((entry) => entry.jsName), "initializer helper");
  return Object.freeze({
    state: Object.freeze(state),
    helpers: Object.freeze(helpers),
  });
}

function assertUnique(names: readonly string[], label: string): void {
  if (new Set(names).size !== names.length) throw new Error(`${label} names must be unique`);
}
