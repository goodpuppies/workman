import { hashGrammarIr, inventoryGrammar, parseWorkmanGrammar } from "./frontend_v2_grammar_ir.ts";
import { classifyGrammarActions } from "../tooling/frontend-v2/generator/action_ir.ts";
import { inventoryInitializer } from "../tooling/frontend-v2/generator/initializer_inventory.ts";
import {
  FRONTEND_V2_GENERATOR_CONTRACT_VERSION,
  validateGeneratorContract,
} from "../tooling/frontend-v2/generator/contract.ts";
import { frontendV2RecoveryAnnotations } from "../tooling/frontend-v2/generator/recovery_annotations.ts";

const grammarPath = Deno.args[0] ?? "src/grammar.peggy";
const source = await Deno.readTextFile(grammarPath);
const grammar = parseWorkmanGrammar(source, grammarPath);
const actions = classifyGrammarActions(grammar.actions);
const initializer = inventoryInitializer(grammar);
validateGeneratorContract({
  version: FRONTEND_V2_GENERATOR_CONTRACT_VERSION,
  grammar,
  initializer,
  actions,
  exceptions: [],
  recoveries: frontendV2RecoveryAnnotations,
});

const mechanical = actions.filter((action) => action.kind === "mechanical");
const named = actions.filter((action) => action.kind === "named");
console.log(JSON.stringify(
  {
    ...inventoryGrammar(grammar),
    grammarHash: await hashGrammarIr(grammar),
    actionClassifications: {
      mechanical: mechanical.length,
      named: named.length,
      unclassified: 0,
    },
    namedActions: named,
    initializer: {
      state: initializer.state,
      helpers: initializer.helpers.map(({ jsName, wmFunction, parameters }) => ({
        jsName,
        wmFunction,
        parameters,
      })),
    },
    recoveries: frontendV2RecoveryAnnotations,
  },
  null,
  2,
));
