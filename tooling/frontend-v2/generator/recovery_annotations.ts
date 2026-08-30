import type { RequiredTokenRecovery } from "./contract.ts";

const braceDelimitedRules = [
  "ImportClause",
  "JsImportClauseBody",
  "RecordDecl",
  "MatchExpr",
  "MatchFn",
  "AnonymousMatchFn",
  "LambdaBlock",
  "JsonExpr",
  "RecordExpr",
  "Block",
  "RecordPattern",
  "RecordLetPattern",
  "RecordParamPattern",
] as const;

const braceRecoveries = braceDelimitedRules.flatMap((rule): RequiredTokenRecovery[] => [
  {
    rule,
    after: "authored construct discriminator",
    token: "{",
    synchronizeAt: ["}"],
  },
  {
    rule,
    after: "authored opening brace or construct body",
    token: "}",
    synchronizeAt: [";", ",", "}"],
  },
]);

export const frontendV2RecoveryAnnotations: readonly RequiredTokenRecovery[] = Object.freeze([
  {
    rule: "TopPhrase",
    after: "complete top-level declaration or expression",
    token: ";",
    synchronizeAt: ["end of input", "next top-level phrase"],
  },
  {
    rule: "SemiToken",
    after: "committed directive or block item",
    token: ";",
    synchronizeAt: ["}", "next block item"],
  },
  ...braceRecoveries,
]);
