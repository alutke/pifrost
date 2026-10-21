/** AST-based import boundary guard. The handwritten architecture invariants
 * remain separately verified by the executable regression suite. */
import ts from "typescript";
import { posix } from "node:path";

export function importedSpecifiers(source, fileName = "module.ts") {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const out = [];
  const stringArg = value => value && ts.isStringLiteralLike(value) ? value.text : undefined;
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const value = stringArg(node.moduleSpecifier);
      if (value) out.push(value);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const value = stringArg(node.moduleReference.expression);
      if (value) out.push(value);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const value = stringArg(node.argument.literal);
      if (value) out.push(value);
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require");
      if (dynamic) {
        const value = stringArg(node.arguments[0]);
        if (value) out.push(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return out;
}

export function checkImportBoundaries(sources, controlOnly) {
  const errors = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const specifier of importedSpecifiers(source, file)) {
      if (specifier.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(file), specifier));
        if (controlOnly.has(target)) errors.push(`${file} must not depend on control-plane module ${target}`);
      }
      if (file !== "native.ts" && (
        specifier === "@oh-my-pi/pi-catalog" ||
        specifier.startsWith("@oh-my-pi/pi-catalog/") ||
        specifier === "@oh-my-pi/pi-natives" ||
        specifier.startsWith("@oh-my-pi/pi-natives/")
      )) errors.push(`${file} must not import ${specifier}; OMP snapshot/native imports belong at native.ts boundary`);
    }
  }
  return errors;
}
