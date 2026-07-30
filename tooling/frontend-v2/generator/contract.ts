import type { WorkmanGrammarIr } from "../../../scripts/frontend_v2_grammar_ir.ts";
import type { ClassifiedAction } from "./action_ir.ts";
import type { InitializerInventory } from "./initializer_inventory.ts";

export const FRONTEND_V2_GENERATOR_CONTRACT_VERSION = 1;
export const FRONTEND_V2_GENERATOR_EXCEPTION_LIMIT = 8;

export type GeneratorException = Readonly<{
  peggyRule: string;
  alternative?: number;
  kind: "grammar" | "lexical";
  wmFunction: string;
  reason: string;
  fixture: string;
}>;

export type RequiredTokenRecovery = Readonly<{
  rule: string;
  after: string;
  token: ";" | "{" | "}";
  synchronizeAt: readonly string[];
}>;

export type ActionBinding = ClassifiedAction;

export type GeneratorContract = Readonly<{
  version: number;
  grammar: WorkmanGrammarIr;
  initializer: InitializerInventory;
  actions: readonly ActionBinding[];
  exceptions: readonly GeneratorException[];
  recoveries: readonly RequiredTokenRecovery[];
}>;

export function validateGeneratorContract(contract: GeneratorContract): void {
  if (contract.version !== FRONTEND_V2_GENERATOR_CONTRACT_VERSION) {
    throw new Error(`unsupported generator contract version ${contract.version}`);
  }
  if (contract.exceptions.length > FRONTEND_V2_GENERATOR_EXCEPTION_LIMIT) {
    throw new Error(
      `generator exception cap exceeded: ${contract.exceptions.length}/` +
        FRONTEND_V2_GENERATOR_EXCEPTION_LIMIT,
    );
  }
  if (contract.initializer.state.length === 0 || contract.initializer.helpers.length === 0) {
    throw new Error("generator initializer inventory must include state and helpers");
  }

  const rules = new Set(contract.grammar.rules.map((rule) => rule.name));
  const actionIds = new Set(contract.grammar.actions.map((action) => action.id));
  const boundActions = new Set<string>();
  for (const binding of contract.actions) {
    if (!actionIds.has(binding.actionId)) {
      throw new Error(`action binding references unknown action ${binding.actionId}`);
    }
    if (boundActions.has(binding.actionId)) {
      throw new Error(`action ${binding.actionId} is classified more than once`);
    }
    boundActions.add(binding.actionId);
  }
  const missingActions = [...actionIds].filter((actionId) => !boundActions.has(actionId));
  if (missingActions.length > 0) {
    throw new Error(
      `generator contract leaves ${missingActions.length} action(s) unclassified: ` +
        missingActions.slice(0, 3).join(", "),
    );
  }
  for (const exception of contract.exceptions) {
    if (!rules.has(exception.peggyRule)) {
      throw new Error(`generator exception references unknown rule ${exception.peggyRule}`);
    }
    if (!exception.wmFunction || !exception.reason || !exception.fixture) {
      throw new Error(`generator exception for ${exception.peggyRule} is incomplete`);
    }
  }
  for (const recovery of contract.recoveries) {
    if (!rules.has(recovery.rule)) {
      throw new Error(`recovery annotation references unknown rule ${recovery.rule}`);
    }
  }
}
