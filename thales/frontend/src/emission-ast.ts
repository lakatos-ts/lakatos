// The declaration's own AST: the ESTree of its dependency closure, as
// tarski's parser bridge produced it.
//
// The emitter never writes a node. Each module's stripped text goes
// through the bridge once, and a declaration's closure is a *selection*
// of those documents' top-level statements — the constants it reads, the
// functions it calls, the classes it names, and itself — in module order.
// That is why the closure is computed from the bridge's identifiers
// rather than from the emission IR: the IR erases `const safeMathAbs =
// Math.abs` into a `builtin` node, so an IR walk would assemble a script
// that `ReferenceError`s where the source does not.
//
// A closure that cannot be closed has no AST at all. Authoring a
// `const local = imported;` node to bridge a renamed import is exactly
// what #480 forbids, so a renamed import, a name two of the closure's
// modules both declare, a name one module uses free that another declares,
// and a module the bridge could not parse each answer `undefined` instead.

import {
  parseScript,
  type Program,
  type Statement,
  stripTypes,
} from "@lakatos/tarski";
import { type ModelRef } from "./module-graph.js";

/** One walked module: the qualifier its models carry (empty for the
 * entry), the bridge's document for its stripped text, and the name map
 * the walk built — a local spelling to the model it names. `cycles` holds
 * the imports that close a cycle: degraded in `names`, yet bound at run
 * time to the module still being walked. */
export interface ModuleScript {
  qualifier: string;
  program: Program;
  names: ReadonlyMap<string, ModelRef>;
  cycles: ReadonlyMap<string, ModelRef>;
}

/**
 * One module's stripped text through the bridge, or `undefined` for a
 * module there is no script for.
 *
 * Two things land here. A declaration file has no output at all —
 * `transpileModule` on a `.d.ts` fails rather than answering empty text —
 * and text tsc's printer emitted that tsc's own parser then refuses would
 * be an internal disagreement. Neither is a user error and neither should
 * end a run: containment is the emitter's rule, so both degrade this one
 * field and the declarations model as before.
 */
export function bridgeModule(text: string, file: string): Program | undefined {
  try {
    return parseScript(stripTypes(text, file), file);
  } catch {
    return undefined;
  }
}

/** The top-level names a bridged statement binds. An `Unsupported`
 * statement binds nothing the frontend can see — the bridge kept no name
 * — which is right: it can be *selected*, never *resolved to*. A
 * declarator whose `id` is a *binding pattern* binds nothing here for the
 * same reason: what a closure resolves to is a function, a class, or a
 * constant with a single name, and a pattern declares none of the
 * three. */
export function declaredNames(stmt: Statement): string[] {
  switch (stmt.type) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return [stmt.id.name];
    case "VariableDeclaration":
      return stmt.declarations.flatMap((d) =>
        d.id.type === "Identifier" ? [d.id.name] : [],
      );
    default:
      return [];
  }
}

/** Whether a node's child under `key` is a name in its own right rather
 * than a reference: the property of a non-computed member access, and the
 * key of a non-computed property, method, or field. */
function isNameSlot(node: Record<string, unknown>, key: string): boolean {
  if (node["computed"] !== false) return false;
  if (node["type"] === "MemberExpression") return key === "property";
  return (
    key === "key" &&
    (node["type"] === "Property" ||
      node["type"] === "MethodDefinition" ||
      node["type"] === "PropertyDefinition")
  );
}

/**
 * Every identifier a subtree references.
 *
 * The walk is generic over objects and arrays, so a node kind added to
 * the bridge is covered the day it arrives. It over-approximates —
 * locals, parameters, and labels are collected too — and that is
 * deliberate: only module-level names are ever looked up, so the excess
 * resolves to nothing and costs nothing.
 */
export function referencedNames(node: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (obj["type"] === "Identifier" && typeof obj["name"] === "string") {
      found.add(obj["name"]);
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      if (isNameSlot(obj, key)) continue;
      walk(child);
    }
  };
  walk(node);
  return found;
}

/** Every name a statement binds in the script, binding patterns included:
 * a pattern is never resolved to, but what it binds can still capture. A
 * pattern's defaults count too, which can only over-refuse. */
function boundNames(stmt: Statement): string[] {
  if (stmt.type !== "VariableDeclaration") return declaredNames(stmt);
  return stmt.declarations.flatMap((d) => [...referencedNames(d.id)]);
}

/** A statement selected into a closure, with the module it came from. */
interface Selection {
  module: number;
  index: number;
}

/**
 * The script a declaration's replay would run: the bridge's document for
 * the declaration's own module, its body replaced by the strict directive
 * and the closure's statements — dependencies first, the declaration's own
 * module last, source order within each.
 *
 * `undefined` when no closed script exists: two of the selected statements
 * declare one name, a module the closure reaches was not bridged, a name
 * it reaches was bound under a different spelling on import, or the script
 * would bind a name one module uses free to another module's declaration.
 *
 * Two kinds of name are skipped instead, and both are genuinely free in
 * the script the module itself becomes. One resolves to nothing at all — a
 * global like `Math` or `RangeError`, or an import the walk degraded. The
 * other resolves to a model whose module declares it with no runtime
 * statement: `declare function exotic`, an `interface`, a `type`, an
 * ambient module. Type erasure leaves those out of the module's own script
 * too, so leaving them out of the closure is what keeps the two the same.
 */
export function closureProgram(
  decl: ModelRef,
  modules: readonly ModuleScript[],
): Program | undefined {
  const homeIndex = modules.findIndex((m) => m.qualifier === decl.module);
  if (homeIndex === -1) return undefined;
  const home = modules[homeIndex]!;
  const directive = home.program.body[0];
  /* v8 ignore next 2 -- `stripTypes` puts `"use strict";` on top, so the
     bridge's first statement is always the directive. */
  if (directive === undefined || !("directive" in directive)) return undefined;

  const selected: Selection[] = [];
  const seen = new Set<string>();
  const queue: ModelRef[] = [decl];

  while (queue.length > 0) {
    const ref = queue.shift()!;
    const key = `${ref.module}\0${ref.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = modules.findIndex((m) => m.qualifier === ref.module);
    if (at === -1) return undefined;
    const module = modules[at]!;
    const index = module.program.body.findIndex((s) =>
      declaredNames(s).includes(ref.name),
    );
    // A name its own module's script does not declare either: erased with
    // the types, and free in both.
    if (index === -1) continue;
    if (!selected.some((s) => s.module === at && s.index === index))
      selected.push({ module: at, index });
    for (const name of referencedNames(module.program.body[index])) {
      const to = module.names.get(name);
      if (to === undefined) continue;
      // An aliased import binds a local spelling to another name, and a
      // selected statement keeps the exporter's spelling: the closure
      // would reference a binding the script does not have.
      if (to.name !== name) return undefined;
      queue.push(to);
    }
  }

  // Which module's selected statement declares each name in the script.
  // Two modules declaring one name make no script: nothing renames them.
  const owner = new Map<string, number>();
  for (const s of selected) {
    for (const name of boundNames(modules[s.module]!.program.body[s.index]!)) {
      const prev = owner.get(name);
      if (prev !== undefined && prev !== s.module) return undefined;
      owner.set(name, s.module);
    }
  }
  // The script must bind every name as the statement's own module does: to
  // that module's selected declaration, or to nothing when the name is free
  // there (a global, a degraded import, an erased type, a local).
  for (const s of selected) {
    const module = modules[s.module]!;
    for (const name of referencedNames(module.program.body[s.index])) {
      const bound = owner.get(name);
      if (bound === undefined) continue;
      const to = module.names.get(name) ?? module.cycles.get(name);
      const expected =
        to === undefined || to.name !== name
          ? undefined
          : modules.findIndex((m) => m.qualifier === to.module);
      if (bound !== expected) return undefined;
    }
  }

  selected.sort((a, b) => a.module - b.module || a.index - b.index);
  return {
    ...home.program,
    body: [
      directive,
      ...selected.map((s) => modules[s.module]!.program.body[s.index]!),
    ],
  };
}

/** The emitter's `EmitDecl` narrowed to what attaching an AST needs. A
 * class's members share the class's closure — a member's replay runs the
 * class's own program — so a class carries one and they carry none. */
export type AstBearing =
  | {
      kind: "function" | "class" | "constant";
      name: string;
      module?: string;
      ast?: Program;
    }
  | { kind: "residual" };

/**
 * Attach each function, class, and constant its closure, in place. A
 * declaration whose closure does not close keeps no field at all, which
 * is what the schema's optional `ast` means.
 */
export function attachAsts(
  declarations: readonly AstBearing[],
  scripts: readonly ModuleScript[],
): void {
  for (const d of declarations) {
    if (d.kind === "residual") continue;
    const program = closureProgram(
      { module: d.module ?? "", name: d.name },
      scripts,
    );
    if (program !== undefined) d.ast = program;
  }
}
