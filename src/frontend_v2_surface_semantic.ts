import {
  type Binding,
  type CtorDecl,
  type Decl,
  type Directive,
  type Expr,
  type ImportClause,
  type ImportSpec,
  type JsImportClause,
  type JsImportSpec,
  type JsTarget,
  longIdSpelling,
  type Module,
  type Param,
  type Pattern,
  type RecordExprItem,
  type TypeExpr,
} from "./ast.ts";
import {
  fields,
  type FrontendV2SurfaceProgram,
  list,
  option,
  record,
  variant,
  type WmVariant,
} from "./frontend_v2_surface_loader.ts";
import { type AstNode, offsetToLineCol, type SourceSpan } from "./source.ts";

export type FrontendV2SemanticAdapterDiagnostic = {
  code: "frontend-v2.unsupported-decl" | "frontend-v2.recovered-decl";
  structuralId: number;
  message: string;
};

export type FrontendV2SurfaceModuleProjection = Readonly<{
  module: Module;
  diagnostics: readonly FrontendV2SemanticAdapterDiagnostic[];
}>;

type Context = {
  source: string;
  nextNodeId: number;
  nextLiftId: number;
  nextTypeGroupId: number;
};

/**
 * Project the generated grammar-complete Surface AST directly to the compiler AST.
 *
 * Unsupported constructors are reported at their top-level phrase. The projector
 * never reparses source text; token text is consulted only for literal values and
 * authored identifiers.
 */
export function surfaceProgramToModule(
  program: FrontendV2SurfaceProgram,
  source: string,
): FrontendV2SurfaceModuleProjection {
  const context: Context = { source, nextNodeId: 0, nextLiftId: 0, nextTypeGroupId: 0 };
  const diagnostics: FrontendV2SemanticAdapterDiagnostic[] = [];
  const decls: Decl[] = [];
  const [phrasesValue, programSpan] = fields(program.root, "ProgramNode");
  const phrases = list(phrasesValue);

  phrases.forEach((phraseValue, index) => {
    try {
      const [item] = fields(phraseValue, "TopPhraseNode");
      const itemVariant = variant(item);
      if (itemVariant.name === "TypeDeclarationGroupNode") {
        decls.push(...projectTypeDeclGroup(itemVariant, context));
      } else if (isDeclNode(itemVariant.name)) {
        decls.push(projectDecl(itemVariant, context));
      } else {
        const expression = projectExpr(itemVariant, context);
        const span = spanOf(itemVariant);
        const pattern: Pattern = {
          kind: "PVar",
          name: "it",
          node: nodeFor(context, span),
        };
        const binding: Binding = {
          pattern,
          value: expression,
          node: nodeFor(context, span),
        };
        decls.push({
          kind: "LetDecl",
          exported: true,
          recursive: false,
          bindings: [binding],
          node: nodeFor(context, span),
        });
      }
    } catch (error) {
      diagnostics.push({
        code: "frontend-v2.unsupported-decl",
        structuralId: index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    module: {
      kind: "Module",
      decls,
      ...(hasNoPreludeDirective(source) ? { prelude: "none" as const } : {}),
      node: nodeFor(context, sourceSpan(programSpan)),
    },
    diagnostics,
  };
}

function projectDecl(node: WmVariant, context: Context): Decl {
  switch (node.name) {
    case "ImportDeclarationNode":
      return projectImport(node, context);
    case "LetDeclarationNode":
      return projectLet(node, context);
    case "RecordDeclarationNode":
      return projectRecordDecl(node, context);
    case "TypeDeclarationNode":
      return projectTypeDecl(node, context);
    case "JavaScriptImportDeclarationNode":
      return projectJavaScriptImport(node, context);
    default:
      throw unsupported("declaration", node);
  }
}

function projectJavaScriptImport(node: WmVariant, context: Context): Decl {
  const [, targetNode, , typeOnlyValue, clauseNode] = fields(
    node,
    "JavaScriptImportDeclarationNode",
  );
  return {
    kind: "JsImportDecl",
    target: projectJavaScriptTarget(variant(targetNode), context),
    clause: projectJavaScriptClause(variant(clauseNode), context),
    typeOnly: option(typeOnlyValue) !== undefined,
    node: nodeFor(context, spanOf(node)),
  };
}

function projectJavaScriptTarget(node: WmVariant, context: Context): JsTarget {
  const located = { node: nodeFor(context, spanOf(node)) };
  switch (node.name) {
    case "JavaScriptGlobalRootTargetNode":
      return { kind: "JsGlobalRoot", ...located };
    case "JavaScriptMetaTargetNode":
      return { kind: "JsMeta", ...located };
    case "JavaScriptGlobalTargetNode": {
      const [, , pathToken] = fields(node);
      return { kind: "JsGlobal", path: jsonString(pathToken), ...located };
    }
    case "JavaScriptModuleTargetNode": {
      const [, , specifierToken] = fields(node);
      return { kind: "JsModule", specifier: jsonString(specifierToken), ...located };
    }
    case "JavaScriptWorkerTargetNode": {
      const [, , specifierToken] = fields(node);
      return { kind: "JsWorker", specifier: jsonString(specifierToken), ...located };
    }
    default:
      throw unsupported("JavaScript target", node);
  }
}

function projectJavaScriptClause(node: WmVariant, context: Context): JsImportClause {
  const [unsafeValue, bodyNode] = fields(node, "JavaScriptImportClauseNode");
  const unsafe = option(unsafeValue) !== undefined;
  const body = variant(bodyNode);
  if (body.name === "ImportNamespaceClauseNode") {
    const [, , aliasToken] = fields(body);
    return {
      kind: "Namespace",
      alias: tokenText(aliasToken),
      unsafe,
      node: nodeFor(context, spanOf(node)),
    };
  }
  if (body.name === "JavaScriptNamedClauseNode") {
    const [, specsValue, , aliasValue] = fields(body);
    const aliasNode = option(aliasValue);
    return {
      kind: "Named",
      specs: list(specsValue).map((spec) => projectJavaScriptSpec(variant(spec), context)),
      ...(aliasNode ? { alias: tokenText(fields(aliasNode, "ImportAliasNode")[1]) } : {}),
      unsafe,
      node: nodeFor(context, spanOf(node)),
    };
  }
  throw unsupported("JavaScript import clause", body);
}

function projectJavaScriptSpec(node: WmVariant, context: Context): JsImportSpec {
  const [nameToken, aliasValue, annotationValue] = fields(
    node,
    "JavaScriptImportSpecificationNode",
  );
  const aliasNode = option(aliasValue);
  const annotationNode = option(annotationValue);
  return {
    name: tokenText(nameToken),
    ...(aliasNode ? { alias: tokenText(fields(aliasNode, "ImportAliasNode")[1]) } : {}),
    ...(annotationNode ? { type: projectType(variant(annotationNode), context) } : {}),
    node: nodeFor(context, spanOf(node)),
  };
}

function projectRecordDecl(node: WmVariant, context: Context): Decl {
  const [, nameToken, parametersValue, , , fieldsValue] = fields(
    node,
    "RecordDeclarationNode",
  );
  const parametersNode = option(parametersValue);
  return {
    kind: "RecordDecl",
    exported: true,
    name: tokenText(nameToken),
    params: parametersNode ? projectTypeParameters(variant(parametersNode)) : [],
    fields: list(fieldsValue).map((fieldValue) => {
      const field = variant(fieldValue, "RecordFieldDeclarationNode");
      const [fieldName, , fieldType] = fields(field);
      return {
        name: tokenText(fieldName),
        type: projectType(variant(fieldType), context),
        node: nodeFor(context, spanOf(field)),
      };
    }),
    node: nodeFor(context, spanOf(node)),
  };
}

function projectTypeDecl(node: WmVariant, context: Context): Decl {
  const [, nameToken, parametersValue, , bodyNode] = fields(node, "TypeDeclarationNode");
  return projectTypeBindingParts(node, nameToken, parametersValue, bodyNode, context);
}

function projectTypeDeclGroup(node: WmVariant, context: Context): Decl[] {
  const [bindingsValue] = fields(node, "TypeDeclarationGroupNode");
  const bindings = list(bindingsValue);
  const mutualGroup = context.nextTypeGroupId++;
  return bindings.map((value) => {
    const binding = variant(value, "TypeBindingNode");
    const [nameToken, parametersValue, , bodyNode] = fields(binding);
    const declaration = projectTypeBindingParts(
      bindings.length === 1 ? node : binding,
      nameToken,
      parametersValue,
      bodyNode,
      context,
    );
    return bindings.length === 1 ? declaration : { ...declaration, mutualGroup };
  });
}

function projectTypeBindingParts(
  node: WmVariant,
  nameToken: unknown,
  parametersValue: unknown,
  bodyNode: unknown,
  context: Context,
): Extract<Decl, { kind: "TypeDecl" }> {
  const parametersNode = option(parametersValue);
  const [leadingPipeValue, membersValue] = fields(variant(bodyNode), "TypeDeclarationBodyNode");
  const hasLeadingPipe = option(leadingPipeValue) !== undefined;
  const members = list(membersValue).map((member) => projectType(variant(member), context));
  const isAlias = !hasLeadingPipe && members.length === 1;
  return {
    kind: "TypeDecl",
    exported: true,
    name: tokenText(nameToken),
    params: parametersNode ? projectTypeParameters(variant(parametersNode)) : [],
    ctors: isAlias ? [] : members.map((member) => projectCtor(member, context)),
    ...(isAlias ? { alias: members[0] } : {}),
    hasLeadingPipe,
    node: nodeFor(context, spanOf(node)),
  };
}

function projectTypeParameters(node: WmVariant): string[] {
  const [, parametersValue] = fields(node, "TypeParametersNode");
  return list(parametersValue).map(tokenText);
}

function projectCtor(type: TypeExpr, _context: Context): CtorDecl {
  if (type.kind !== "TName" || type.path?.qualifiers.length) {
    throw new Error("frontend-v2 variant members must be unqualified constructor names");
  }
  return {
    name: type.name,
    args: type.args,
    ...(type.node ? { node: type.node } : {}),
  };
}

function projectImport(node: WmVariant, context: Context): Decl {
  const [, pathNode, , clauseNode] = fields(node, "ImportDeclarationNode");
  const [pathToken] = fields(pathNode, "LiteralExpressionNode");
  const pathText = tokenText(pathToken);
  let path: string;
  try {
    path = JSON.parse(pathText) as string;
  } catch {
    throw new Error(`frontend-v2 cannot decode import path ${JSON.stringify(pathText)}`);
  }
  const pathSpan = tokenSpan(pathToken);
  return {
    kind: "ImportDecl",
    path,
    pathNode: nodeFor(context, pathSpan),
    clause: projectImportClause(variant(clauseNode), context),
    node: nodeFor(context, spanOf(node)),
  };
}

function projectImportClause(node: WmVariant, context: Context): ImportClause {
  if (node.name === "ImportAllClauseNode") {
    return { kind: "All", node: nodeFor(context, spanOf(node)) };
  }
  if (node.name === "ImportNamespaceClauseNode") {
    const [, , aliasToken] = fields(node);
    return {
      kind: "Namespace",
      alias: tokenText(aliasToken),
      node: nodeFor(context, spanOf(node)),
    };
  }
  if (node.name === "ImportNamedClauseNode") {
    const [, specsValue] = fields(node);
    return {
      kind: "Named",
      specs: list(specsValue).map((spec) => projectImportSpec(variant(spec), context)),
      node: nodeFor(context, spanOf(node)),
    };
  }
  throw unsupported("import clause", node);
}

function projectImportSpec(node: WmVariant, context: Context): ImportSpec {
  const [nameToken, aliasValue] = fields(node, "ImportSpecificationNode");
  const aliasNode = option(aliasValue);
  const alias = aliasNode ? tokenText(fields(aliasNode, "ImportAliasNode")[1]) : undefined;
  return {
    name: tokenText(nameToken),
    ...(alias ? { alias } : {}),
    node: nodeFor(context, spanOf(node)),
  };
}

function projectLet(node: WmVariant, context: Context): Decl {
  const [, recursiveValue, bindingsValue] = fields(node, "LetDeclarationNode");
  const bindings = list(bindingsValue).map((binding) =>
    projectBinding(variant(binding, "LetBindingNode"), context)
  );
  return {
    kind: "LetDecl",
    exported: true,
    recursive: option(recursiveValue) !== undefined,
    bindings,
    node: nodeFor(context, spanOf(node)),
  };
}

function projectBinding(node: WmVariant, context: Context): Binding {
  const [patternNode, annotationValue, , expressionNode] = fields(node, "LetBindingNode");
  const annotationNode = option(annotationValue);
  return {
    pattern: projectPattern(variant(patternNode), context, "let"),
    ...(annotationNode
      ? { annotation: projectTypeAnnotation(variant(annotationNode), context) }
      : {}),
    value: projectExpr(variant(expressionNode), context),
    node: nodeFor(context, spanOf(node)),
  };
}

type PatternFlavor = "general" | "let" | "param";

function projectPattern(
  node: WmVariant,
  context: Context,
  flavor: PatternFlavor = "general",
): Pattern {
  const located = { node: nodeFor(context, spanOf(node)) };
  switch (node.name) {
    case "VariablePatternNode": {
      const [name] = fields(node);
      return { kind: "PVar", name: tokenText(name), ...located };
    }
    case "ExplicitVariablePatternNode": {
      const [, , name] = fields(node);
      return { kind: "PVar", name: tokenText(name), ...located };
    }
    case "NamePatternNode": {
      const [nameNode] = fields(node);
      const path = projectLongName(variant(nameNode, "LongNameNode"));
      return {
        kind: "PCtor",
        name: longIdSpelling(path),
        path,
        args: [],
        ...located,
      };
    }
    case "PinnedPatternNode": {
      const [nameNode] = fields(node);
      const path = projectLongName(variant(nameNode, "LongNameNode"));
      return { kind: "PPinned", name: longIdSpelling(path), path, ...located };
    }
    case "WildcardPatternNode":
      return { kind: "PWildcard", ...located };
    case "LiteralPatternNode": {
      const [literal] = fields(node);
      return projectLiteralPattern(tokenText(literal), located);
    }
    case "TuplePatternNode": {
      const [, itemsValue] = fields(node);
      const items = list(itemsValue).map((item) => projectPattern(variant(item), context, flavor));
      return items.length === 0
        ? { kind: "PVoid", ...located }
        : { kind: "PTuple", items, ...located };
    }
    case "GroupedPatternNode": {
      const [, inner] = fields(node);
      return projectPattern(variant(inner), context, flavor);
    }
    case "TypedPatternNode": {
      const [inner, , annotation] = fields(node);
      return {
        kind: "PAscribed",
        pattern: projectPattern(variant(inner), context, flavor),
        annotation: projectType(variant(annotation), context),
        ...located,
      };
    }
    case "ConstructorPatternNode": {
      const [nameNode, argumentsValue] = fields(node);
      const path = projectLongName(variant(nameNode, "LongNameNode"));
      const argumentsNode = option(argumentsValue);
      const args = argumentsNode ? projectPatternArguments(variant(argumentsNode), context) : [];
      return { kind: "PCtor", name: longIdSpelling(path), path, args, ...located };
    }
    case "ListPatternNode": {
      const [, itemsValue, tailValue] = fields(node);
      const items = list(itemsValue).map((item) =>
        projectListPatternElement(variant(item), context, flavor)
      );
      const tailNode = option(tailValue);
      return projectListPattern(
        items,
        tailNode ? projectListPatternElement(variant(tailNode), context, flavor) : undefined,
        context,
        spanOf(node),
      );
    }
    case "RecordPatternNode": {
      const [, , fieldsValue] = fields(node);
      return {
        kind: "PRecord",
        fields: list(fieldsValue).map((fieldValue) => {
          const field = variant(fieldValue, "RecordPatternFieldNode");
          const [nameToken, patternValue] = fields(field);
          const name = tokenText(nameToken);
          const patternNode = option(patternValue);
          return {
            name,
            pattern: patternNode ? projectPattern(variant(patternNode), context, flavor) : {
              kind: "PVar",
              name,
              node: nodeFor(context, tokenSpan(nameToken)),
            },
            node: nodeFor(context, spanOf(field)),
          };
        }),
        ...located,
      };
    }
    default:
      throw unsupported("pattern", node);
  }
}

function projectListPatternElement(
  node: WmVariant,
  context: Context,
  flavor: PatternFlavor,
): Pattern {
  if (flavor === "general" && node.name === "WildcardPatternNode") {
    return {
      kind: "PVar",
      name: "_",
      node: nodeFor(context, spanOf(node)),
    };
  }
  return projectPattern(node, context, flavor);
}

function projectPatternArguments(node: WmVariant, context: Context): Pattern[] {
  if (node.name === "TuplePatternNode") {
    const [, itemsValue] = fields(node);
    return list(itemsValue).map((item) => projectDirectCtorPattern(variant(item), context));
  }
  if (node.name === "GroupedPatternNode") {
    return [projectDirectCtorPattern(variant(fields(node)[1]), context)];
  }
  return [projectDirectCtorPattern(node, context)];
}

function projectDirectCtorPattern(node: WmVariant, context: Context): Pattern {
  if (node.name === "WildcardPatternNode") {
    return {
      kind: "PVar",
      name: "_",
      node: nodeFor(context, spanOf(node)),
    };
  }
  return projectPattern(node, context);
}

function projectLiteralPattern(
  text: string,
  located: { node: AstNode },
): Pattern {
  if (text === "true" || text === "false") {
    return { kind: "PBool", value: text === "true", ...located };
  }
  if (text === "void") return { kind: "PVoid", ...located };
  if (text.startsWith('"') || text.startsWith("`")) {
    return { kind: "PString", value: decodeStringLiteral(text), ...located };
  }
  return { kind: "PInt", value: Number(text), ...located };
}

function projectTypeAnnotation(node: WmVariant, context: Context): TypeExpr {
  const [, typeNode] = fields(node, "TypeAnnotationNode");
  return projectType(variant(typeNode), context);
}

function projectType(node: WmVariant, context: Context): TypeExpr {
  const located = { node: nodeFor(context, spanOf(node)) };
  switch (node.name) {
    case "NamedTypeNode": {
      const [nameNode, argumentsValue] = fields(node);
      const path = projectLongName(variant(nameNode, "LongNameNode"));
      const argumentsNode = option(argumentsValue);
      return {
        kind: "TName",
        name: longIdSpelling(path),
        path,
        args: argumentsNode ? projectTypeArguments(variant(argumentsNode), context) : [],
        ...located,
      };
    }
    case "TypeVariableNode": {
      const [name] = fields(node);
      return { kind: "TVar", name: tokenText(name), ...located };
    }
    case "TupleTypeNode": {
      const [, itemsValue] = fields(node);
      return {
        kind: "TTuple",
        items: list(itemsValue).map((item) => projectType(variant(item), context)),
        ...located,
      };
    }
    case "GroupedTypeNode": {
      const [, inner] = fields(node);
      return projectType(variant(inner), context);
    }
    case "FunctionTypeNode": {
      const [domainNode, , resultNode] = fields(node);
      const [, paramsValue] = fields(domainNode, "FunctionTypeDomainNode");
      return {
        kind: "TFn",
        params: list(paramsValue).map((item) => projectType(variant(item), context)),
        result: projectType(variant(resultNode), context),
        ...located,
      };
    }
    default:
      throw unsupported("type", node);
  }
}

function projectTypeArguments(node: WmVariant, context: Context): TypeExpr[] {
  const [, itemsValue] = fields(node, "TypeArgumentsNode");
  return list(itemsValue).map((item) => projectType(variant(item), context));
}

function projectExpr(node: WmVariant, context: Context): Expr {
  const located = { node: nodeFor(context, spanOf(node)) };
  switch (node.name) {
    case "LiteralExpressionNode": {
      const [literal] = fields(node);
      return projectLiteralExpr(tokenText(literal), located);
    }
    case "NameExpressionNode": {
      const [nameNode] = fields(node);
      const path = projectLongName(variant(nameNode, "LongNameNode"));
      return { kind: "Var", name: longIdSpelling(path), path, ...located };
    }
    case "TupleExpressionNode": {
      const [, itemsValue] = fields(node);
      const items = list(itemsValue).map((item) => projectExpr(variant(item), context));
      return items.length === 0
        ? { kind: "Void", ...located }
        : { kind: "Tuple", items, ...located };
    }
    case "GroupedExpressionNode": {
      const [, inner] = fields(node);
      return projectExpr(variant(inner), context);
    }
    case "ApplyExpressionNode": {
      const [calleeNode, argumentNode] = fields(node);
      const callee = projectExpr(variant(calleeNode), context);
      const argument = variant(argumentNode);
      if (argument.name === "ExplicitCallNode") {
        const [, argsValue] = fields(argument);
        return {
          kind: "Call",
          callee,
          args: list(argsValue).map((arg) => projectExpr(variant(arg), context)),
          ...located,
        };
      }
      if (argument.name === "SpaceCallNode") {
        return {
          kind: "Call",
          callee,
          args: [projectExpr(variant(fields(argument)[0]), context)],
          ...located,
        };
      }
      throw unsupported("application suffix", argument);
    }
    case "BinaryExpressionNode": {
      const [left, operator, right] = fields(node);
      return {
        kind: "Binary",
        op: tokenText(operator),
        left: projectExpr(variant(left), context),
        right: projectExpr(variant(right), context),
        ...located,
      };
    }
    case "UnaryExpressionNode": {
      const [operator, value] = fields(node);
      return {
        kind: "Unary",
        op: tokenText(operator),
        value: projectExpr(variant(value), context),
        ...located,
      };
    }
    case "AscribedExpressionNode": {
      const [value, , annotation] = fields(node);
      return {
        kind: "Ascribed",
        value: projectExpr(variant(value), context),
        annotation: projectType(variant(annotation), context),
        ...located,
      };
    }
    case "PipeExpressionNode": {
      const [leftNode, , rightNode] = fields(node);
      const left = projectExpr(variant(leftNode), context);
      const right = variant(rightNode);
      const rightSpan = spanOf(right);
      const pipeNode = nodeFor(context, {
        line: 1,
        col: 0,
        start: left.node?.span.start ?? spanOf(node).start,
        end: rightSpan.end,
      });
      if (right.name === "PipeMemberNode") {
        const [, pathValue, callValue] = fields(right);
        const path = list(pathValue).map(tokenText);
        const callNode = option(callValue);
        return callNode
          ? {
            kind: "FfiCall",
            receiver: left,
            path,
            args: projectExplicitArguments(variant(callNode), context),
            node: pipeNode,
          }
          : { kind: "FfiGet", receiver: left, path, node: pipeNode };
      }
      return {
        kind: "Pipe",
        left,
        right: projectExpr(right, context),
        node: pipeNode,
      };
    }
    case "RecordExpressionNode": {
      const [, , itemsValue] = fields(node);
      return {
        kind: "Record",
        fields: list(itemsValue).map((item) => projectRecordItem(variant(item), context)),
        ...located,
      };
    }
    case "NamedRecordExpressionNode": {
      const [targetNode, , itemsValue] = fields(node);
      const path = projectLongName(variant(targetNode, "LongNameNode"));
      return {
        kind: "Record",
        target: {
          kind: "TName",
          name: longIdSpelling(path),
          path,
          args: [],
          node: nodeFor(context, spanOf(variant(targetNode))),
        },
        fields: list(itemsValue).map((item) => projectRecordItem(variant(item), context)),
        ...located,
      };
    }
    case "JsonArrayExpressionNode": {
      const [, , itemsValue] = fields(node);
      return {
        kind: "JsonArray",
        items: list(itemsValue).map((item) => projectExpr(variant(item), context)),
        ...located,
      };
    }
    case "JsonObjectExpressionNode": {
      const [, , itemsValue] = fields(node);
      return {
        kind: "JsonObject",
        fields: list(itemsValue).map((item) => {
          const field = variant(item, "JsonObjectFieldNode");
          const [keyToken, , valueNode] = fields(field);
          const authoredKey = tokenText(keyToken);
          return {
            key: authoredKey.startsWith('"') ? JSON.parse(authoredKey) as string : authoredKey,
            value: projectExpr(variant(valueNode), context),
            node: nodeFor(context, spanOf(field)),
          };
        }),
        ...located,
      };
    }
    case "ListExpressionNode": {
      const [, itemsValue, tailValue] = fields(node);
      const items = list(itemsValue).map((item) => projectExpr(variant(item), context));
      const tailNode = option(tailValue);
      return projectListExpr(
        items,
        tailNode ? projectExpr(variant(tailNode), context) : undefined,
        context,
        spanOf(node),
      );
    }
    case "LiftTupleExpressionNode": {
      const [, itemsValue] = fields(node);
      const items = list(itemsValue).map((item) => projectExpr(variant(item), context));
      return projectTupleLift(
        { qualifiers: ["Task"], id: "Task" },
        items,
        context,
        spanOf(node),
        true,
      );
    }
    case "CarrierLiftExpressionNode": {
      const [carrierNode, , itemsValue] = fields(node);
      const carrier = projectLongName(variant(carrierNode, "LongNameNode"));
      const items = list(itemsValue).map((item) => projectExpr(variant(item), context));
      return projectTupleLift(carrier, items, context, spanOf(node), false);
    }
    case "LambdaExpressionNode":
      return projectLambda(node, context);
    case "BlockExpressionNode":
    case "ParenthesizedSequenceNode":
      return projectBlock(node, context);
    case "IfExpressionNode": {
      const [, , condition, , thenExpr, , elseExpr] = fields(node);
      return {
        kind: "If",
        cond: projectExpr(variant(condition), context),
        thenExpr: projectExpr(variant(thenExpr), context),
        elseExpr: projectExpr(variant(elseExpr), context),
        ...located,
      };
    }
    case "MatchExpressionNode": {
      const [, , valuesValue, , , armsValue] = fields(node);
      // Keep the tracked stage-0 artifact able to compile the new self-hosted
      // sources: the previous surface ABI stored one matched node here.
      const values = (Array.isArray(valuesValue) ? list(valuesValue) : [valuesValue])
        .map((value) => projectExpr(variant(value), context));
      return {
        kind: "Match",
        value: values.length === 1
          ? values[0]
          : { kind: "Tuple", items: values, node: nodeFor(context, spanOf(node)) },
        arms: projectMatchArms(armsValue, context),
        ...located,
      };
    }
    case "InterpolatedStringExpressionNode":
      return projectInterpolatedString(node, context);
    case "MatchFunctionNode": {
      const [, , namesValue, , , , armsValue] = fields(node);
      const names = list(namesValue).map(tokenText);
      const params: Param[] = names.map((name) => ({
        pattern: {
          kind: "PVar",
          name,
          node: nodeFor(context, spanOf(node)),
        },
        node: nodeFor(context, spanOf(node)),
      }));
      const values: Expr[] = names.map((name) => ({
        kind: "Var",
        name,
        node: nodeFor(context, spanOf(node)),
      }));
      const value: Expr = values.length === 1
        ? values[0]
        : { kind: "Tuple", items: values, node: nodeFor(context, spanOf(node)) };
      return {
        kind: "Lambda",
        params,
        directives: [],
        body: {
          kind: "Match",
          value,
          arms: projectMatchArms(armsValue, context),
          node: nodeFor(context, spanOf(node)),
        },
        ...located,
      };
    }
    case "PanicExpressionNode": {
      const [, , message] = fields(node);
      return { kind: "Panic", message: projectExpr(variant(message), context), ...located };
    }
    default:
      throw unsupported("expression", node);
  }
}

function projectTupleLift(
  carrier: { qualifiers: string[]; id: string },
  items: Expr[],
  context: Context,
  span: SourceSpan,
  taskShorthand: boolean,
): Expr {
  if (items.length === 0) {
    throw new Error("frontend-v2 lifted tuple requires at least one argument");
  }
  if (items.length === 1) return items[0];
  const names = items.map(() => `__wm_lift_${context.nextLiftId++}`);
  const build = (index: number, values: Expr[]): Expr => {
    const name = names[index];
    const value: Expr = {
      kind: "Var",
      name,
      node: nodeFor(context, span),
    };
    const nextValues = [...values, value];
    const last = index === items.length - 1;
    const body: Expr = last
      ? { kind: "Tuple", items: nextValues, node: nodeFor(context, span) }
      : build(index + 1, nextValues);
    const member = taskShorthand ? { qualifiers: ["Task"], id: last ? "map" : "andThen" } : {
      qualifiers: [...carrier.qualifiers, carrier.id],
      id: last ? "map" : "andThen",
    };
    const callee: Expr = {
      kind: "Var",
      name: longIdSpelling(member),
      path: member,
      node: nodeFor(context, span),
    };
    const lambda: Expr = {
      kind: "Lambda",
      params: [{
        pattern: {
          kind: "PVar",
          name,
          node: nodeFor(context, span),
        },
        node: nodeFor(context, span),
      }],
      directives: [],
      body,
      node: nodeFor(context, span),
    };
    return {
      kind: "Call",
      callee,
      args: [items[index], lambda],
      node: nodeFor(
        context,
        taskShorthand ? span : items[index].node?.span ?? span,
      ),
    };
  };
  return build(0, []);
}

function projectMatchArms(value: unknown, context: Context) {
  return list(value).map((armValue) => {
    const arm = variant(armValue, "MatchArmNode");
    const [patternNode, , bodyNode] = fields(arm);
    return {
      pattern: projectPattern(variant(patternNode), context),
      body: projectExpr(variant(bodyNode), context),
      node: nodeFor(context, spanOf(arm)),
    };
  });
}

function projectListPattern(
  items: Pattern[],
  tail: Pattern | undefined,
  context: Context,
  span: SourceSpan,
): Pattern {
  let result: Pattern = tail ?? {
    kind: "PCtor",
    name: "Nil",
    args: [],
    node: nodeFor(context, span),
  };
  for (let index = items.length - 1; index >= 0; index -= 1) {
    result = {
      kind: "PCtor",
      name: "Cons",
      args: [items[index], result],
      node: nodeFor(context, span),
    };
  }
  return result;
}

function projectExplicitArguments(node: WmVariant, context: Context): Expr[] {
  if (node.name !== "ExplicitCallNode") throw unsupported("explicit arguments", node);
  return list(fields(node)[1]).map((item) => projectExpr(variant(item), context));
}

function projectRecordItem(node: WmVariant, context: Context): RecordExprItem {
  if (node.name === "RecordSpreadNode") {
    const [, valueNode] = fields(node);
    return {
      kind: "Spread",
      value: projectExpr(variant(valueNode), context),
      node: nodeFor(context, spanOf(node)),
    };
  }
  if (node.name === "RecordFieldNode") {
    const [nameToken, , valueOption] = fields(node);
    const name = tokenText(nameToken);
    const valueNode = option(valueOption);
    return {
      kind: "Field",
      name,
      value: valueNode ? projectExpr(variant(valueNode), context) : {
        kind: "Var",
        name,
        node: nodeFor(context, tokenSpan(nameToken)),
      },
      node: nodeFor(context, spanOf(node)),
    };
  }
  throw unsupported("record item", node);
}

function projectListExpr(
  items: Expr[],
  tail: Expr | undefined,
  context: Context,
  span: SourceSpan,
): Expr {
  let result: Expr = tail ?? {
    kind: "Var",
    name: "Nil",
    node: nodeFor(context, span),
  };
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const callee: Expr = {
      kind: "Var",
      name: "Cons",
      node: nodeFor(context, span),
    };
    result = {
      kind: "Call",
      callee,
      args: [items[index], result],
      node: nodeFor(context, span),
    };
  }
  return result;
}

function projectLambda(node: WmVariant, context: Context): Expr {
  const [parametersValue, returnValue, , bodyNode, trailingValue] = fields(
    node,
    "LambdaExpressionNode",
  );
  const parametersNode = option(parametersValue);
  const returnNode = option(returnValue);
  const trailingNode = option(trailingValue);
  const bodyVariant = variant(bodyNode);
  const projectedBody = bodyVariant.name === "BlockExpressionNode"
    ? projectBlockParts(bodyVariant, context)
    : { body: projectExpr(bodyVariant, context), directives: [] };
  return {
    kind: "Lambda",
    params: parametersNode ? projectParameters(variant(parametersNode), context) : [],
    directives: projectedBody.directives,
    body: projectedBody.body,
    ...(returnNode
      ? { returnAnnotation: projectLambdaAnnotation(variant(returnNode), context) }
      : {}),
    ...(trailingNode
      ? { trailingReturnAnnotation: projectLambdaAnnotation(variant(trailingNode), context) }
      : {}),
    node: nodeFor(context, spanOf(node)),
  };
}

function projectLambdaAnnotation(node: WmVariant, context: Context): TypeExpr {
  return node.name === "TypeAnnotationNode"
    ? projectTypeAnnotation(node, context)
    : projectType(node, context);
}

function projectParameters(node: WmVariant, context: Context): Param[] {
  const [, parametersValue] = fields(node, "ParametersNode");
  return list(parametersValue).map((parameterValue) => {
    const parameter = variant(parameterValue, "ParameterNode");
    const [patternNode, annotationValue] = fields(parameter);
    const annotationNode = option(annotationValue);
    return {
      pattern: projectPattern(variant(patternNode), context, "param"),
      ...(annotationNode
        ? { annotation: projectTypeAnnotation(variant(annotationNode), context) }
        : {}),
      node: nodeFor(context, spanOf(parameter)),
    };
  });
}

function projectBlock(node: WmVariant, context: Context): Expr {
  return projectBlockParts(node, context).body;
}

function projectBlockParts(
  node: WmVariant,
  context: Context,
): { body: Expr; directives: Directive[] } {
  const [, itemsValue, resultValue, closeValue] = fields(node);
  const directives: Directive[] = [];
  const items: (Decl | Expr)[] = [];
  let finalTerminator: SourceSpan | undefined;
  let firstItemSpan: SourceSpan | undefined;
  let lastItemSpan: SourceSpan | undefined;
  for (const itemValue of list(itemsValue)) {
    const item = variant(itemValue);
    if (item.name === "DirectiveNode") {
      const [, nameToken] = fields(item);
      directives.push({
        name: tokenText(nameToken),
        node: nodeFor(context, spanOf(item)),
      });
      continue;
    }
    variant(item, "BlockItemNode");
    const [value, terminator] = fields(item);
    firstItemSpan ??= spanOf(item);
    lastItemSpan = spanOf(item);
    const valueNode = variant(value);
    if (valueNode.name === "TypeDeclarationGroupNode") {
      items.push(...projectTypeDeclGroup(valueNode, context));
    } else {
      items.push(
        isDeclNode(valueNode.name)
          ? projectDecl(valueNode, context)
          : projectExpr(valueNode, context),
      );
    }
    finalTerminator = surfaceTokenSpan(terminator, context);
  }
  const resultNode = option(resultValue);
  const implicitStatement = !resultNode && items.length > 0 && !isSemanticDecl(items.at(-1)!)
    ? items.at(-1) as Expr
    : undefined;
  const closeSpan = surfaceTokenSpan(closeValue, context);
  const implicitSpan = firstItemSpan && lastItemSpan
    ? {
      line: 1,
      col: 0,
      start: firstItemSpan.start,
      end: lastItemSpan.end,
    }
    : {
      line: 1,
      col: 0,
      start: closeSpan.start,
      end: closeSpan.start,
    };
  return {
    directives,
    body: {
      kind: "Block",
      items,
      result: resultNode ? projectExpr(variant(resultNode), context) : {
        kind: "Void",
        ...(implicitStatement ? { implicitStatement } : {}),
        ...(implicitStatement && finalTerminator
          ? { implicitTerminatorSpan: finalTerminator }
          : {}),
        node: nodeFor(context, implicitSpan),
      },
      node: nodeFor(context, spanOf(node)),
    },
  };
}

function projectLiteralExpr(text: string, located: { node: AstNode }): Expr {
  if (text === "?") {
    return {
      kind: "Panic",
      hole: true,
      message: { kind: "String", value: "typed hole" },
      ...located,
    };
  }
  if (text === "true" || text === "false") {
    return { kind: "Bool", value: text === "true", ...located };
  }
  if (text === "void" || text === "()") return { kind: "Void", ...located };
  if (text.startsWith('"') || text.startsWith("`")) {
    return { kind: "String", value: decodeStringLiteral(text), ...located };
  }
  return text.includes(".")
    ? { kind: "Float", value: Number(text), ...located }
    : { kind: "Int", value: Number(text), ...located };
}

function projectInterpolatedString(node: WmVariant, context: Context): Expr {
  const [, partsValue] = fields(node);
  const outerNode = nodeFor(context, spanOf(node));
  const parts: Expr[] = [{ kind: "String", value: "", node: outerNode }];
  for (const partValue of list(partsValue)) {
    const part = variant(partValue);
    if (part.name === "InterpolatedStringTextNode") {
      const [textValue] = fields(part);
      parts.push({
        kind: "String",
        value: decodeMultilineText(tokenText(textValue)),
        node: nodeFor(context, spanOf(part)),
      });
      continue;
    }
    if (part.name === "StringInterpolationNode") {
      const [, expressionValue] = fields(part);
      const partNode = nodeFor(context, spanOf(part));
      parts.push({
        kind: "Call",
        callee: {
          kind: "Var",
          name: "Text.of",
          node: partNode,
        },
        args: [projectExpr(variant(expressionValue), context)],
        node: partNode,
      });
      continue;
    }
    throw unsupported("interpolated string part", part);
  }
  parts.push({ kind: "String", value: "", node: outerNode });
  return parts.slice(1).reduce<Expr>((left, right) => ({
    kind: "Binary",
    op: "++",
    left,
    right,
    node: outerNode,
  }), parts[0]);
}

function decodeStringLiteral(text: string): string {
  if (text.startsWith('"')) return JSON.parse(text) as string;
  if (!text.startsWith("`") || !text.endsWith("`")) {
    throw new Error(`frontend-v2 cannot decode string literal ${JSON.stringify(text)}`);
  }
  return decodeMultilineText(text.slice(1, -1));
}

function decodeMultilineText(body: string): string {
  let output = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "\\") {
      output += body[index];
      continue;
    }
    index += 1;
    const escaped = body[index];
    if (escaped === "n") output += "\n";
    else if (escaped === "t") output += "\t";
    else if (escaped === "`") output += "`";
    else if (escaped === "$") output += "$";
    else if (escaped === "\\") output += "\\";
    else throw new Error(`frontend-v2 cannot decode multiline escape \\${escaped ?? ""}`);
  }
  return output;
}

function projectLongName(node: WmVariant): { qualifiers: string[]; id: string } {
  const [partsValue] = fields(node, "LongNameNode");
  const parts = list(partsValue).map(tokenText);
  if (parts.length === 0) throw new Error("frontend-v2 LongNameNode has no parts");
  return { qualifiers: parts.slice(0, -1), id: parts.at(-1)! };
}

function tokenText(value: unknown): string {
  const token = record(value, "SurfaceToken");
  if (typeof token.text !== "string") throw new Error("frontend-v2 token has no text");
  return token.text;
}

function jsonString(value: unknown): string {
  const text = tokenText(value);
  try {
    return JSON.parse(text) as string;
  } catch {
    throw new Error(`frontend-v2 cannot decode string token ${JSON.stringify(text)}`);
  }
}

function tokenSpan(value: unknown): SourceSpan {
  return sourceSpan(record(value, "SurfaceToken").span);
}

function surfaceTokenSpan(value: unknown, context: Context): SourceSpan {
  const carrier = variant(value);
  const token = carrier.name === "AuthoredValue"
    ? carrier.args[0]
    : carrier.name === "MarkedValue" && Array.isArray(carrier.args[0])
    ? carrier.args[0][1]
    : undefined;
  if (!token) throw new Error(`frontend-v2 expected SurfaceValue token, got ${carrier.name}`);
  const span = tokenSpan(token);
  const position = offsetToLineCol(context.source, span.start);
  return { ...position, start: span.start, end: span.end };
}

function spanOf(node: WmVariant): SourceSpan {
  const nodeFields = fields(node);
  return sourceSpan(nodeFields.at(-1));
}

function sourceSpan(value: unknown): SourceSpan {
  const span = record(value, "Span");
  if (typeof span.start !== "number" || typeof span.end !== "number") {
    throw new Error("frontend-v2 span has an invalid shape");
  }
  return { line: 1, col: 0, start: span.start, end: span.end };
}

function nodeFor(context: Context, span: SourceSpan): AstNode {
  const position = offsetToLineCol(context.source, span.start);
  return {
    id: context.nextNodeId++,
    span: { ...position, start: span.start, end: span.end },
  };
}

function isDeclNode(name: string): boolean {
  return name === "ImportDeclarationNode" ||
    name === "LetDeclarationNode" ||
    name === "RecordDeclarationNode" ||
    name === "TypeDeclarationNode" ||
    name === "TypeDeclarationGroupNode" ||
    name === "JavaScriptImportDeclarationNode";
}

function isSemanticDecl(value: Decl | Expr): value is Decl {
  return value.kind.endsWith("Decl");
}

function hasNoPreludeDirective(source: string): boolean {
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    return trimmed === "-- @no-prelude" || trimmed === "// @no-prelude";
  }
  return false;
}

function unsupported(category: string, node: WmVariant): Error {
  return new Error(`frontend-v2 Surface projector does not yet support ${category} ${node.name}`);
}
