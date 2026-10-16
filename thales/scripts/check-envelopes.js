#!/usr/bin/env node
// The envelope-expectation harness, successor to the two-arm parity
// harness: run the thales binary on each fixture of the manifest, project
// its envelope to per-annotation entries, and require them equal to the
// stored expectations. Regenerate with UPDATE_ENVELOPES=1 (which
// requires the full manifest, LAKATOS_PROVE_E2E=1, so the store never
// goes partial); without LAKATOS_PROVE_E2E=1 only the quick fixtures run,
// the same gate the prove e2e uses.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  canonical,
  checker,
  engineRoot,
  lemmaDir,
  repoRoot,
  thalesBinary,
} from "./harness.js";
import { shardOf } from "./shard.js";

const CONFORMANCE = "thales/tests/conformance";

/** Always checked: the tracer bullet and a frontend-classified refusal. */
const QUICK_FIXTURES = [
  "thales/tests/fixtures/tracer.ts",
  `${CONFORMANCE}/inappropriate/class-binder.ts`,
];

/** The expression slice of the conformance corpus (#147): single-return
 * bodies, int/nat binders, single-atom conclusions. Fixtures with imports
 * or unsupported ranges join the manifest with their own slices. */
const EXPRESSION_FIXTURES = [
  "thales/tests/fixtures/operators.ts",
  `${CONFORMANCE}/theorem/add-commutes.ts`,
  `${CONFORMANCE}/theorem/bounded-double.ts`,
  `${CONFORMANCE}/theorem/endpoints.ts`,
  `${CONFORMANCE}/theorem/halve-double.ts`,
  `${CONFORMANCE}/theorem/mul-associates.ts`,
  `${CONFORMANCE}/theorem/nat-double.ts`,
  `${CONFORMANCE}/theorem/nat-open-below.ts`,
  `${CONFORMANCE}/theorem/negate-involution.ts`,
  `${CONFORMANCE}/theorem/remainder.ts`,
  `${CONFORMANCE}/theorem/succ-monotone.ts`,
  `${CONFORMANCE}/theorem/twice-parity.ts`,
  `${CONFORMANCE}/theorem/unbounded-mul-commutes.ts`,
  `${CONFORMANCE}/countersatisfiable/commutes.ts`,
  `${CONFORMANCE}/countersatisfiable/off-by-one.ts`,
  `${CONFORMANCE}/countersatisfiable/zero-edge.ts`,
  `${CONFORMANCE}/countersatisfiable/float-assoc.ts`,
  `${CONFORMANCE}/gaveup/nonneg-int-range.ts`,
  `${CONFORMANCE}/gaveup/unbounded-double.ts`,
  `${CONFORMANCE}/gaveup/unbounded-false.ts`,
  `${CONFORMANCE}/gaveup/unbounded-nat.ts`,
  `${CONFORMANCE}/inappropriate/await-remote.ts`,
  `${CONFORMANCE}/inappropriate/class-method.ts`,
  `${CONFORMANCE}/inappropriate/exponentiation.ts`,
  `${CONFORMANCE}/inappropriate/unmodeled-operator.ts`,
  `${CONFORMANCE}/timeout/big-domain.ts`,
  `${CONFORMANCE}/theorem/finite-guard.ts`,
  `${CONFORMANCE}/countersatisfiable/abs-shrinks.ts`,
  `${CONFORMANCE}/countersatisfiable/last-element.ts`,
  `${CONFORMANCE}/theorem/fround-exact-wide.ts`,
];

/** The statement slice (#148): statement-bodied fixtures — const and
 * mutable locals, reassignment, branches whose arms return, throw, or
 * fall through — plus the statement-level degradations (loops, a
 * shadowing redeclaration, an uninitialized let). */
const STATEMENT_FIXTURES = [
  "thales/tests/fixtures/statements.ts",
  `${CONFORMANCE}/theorem/branch-joined-let.ts`,
  `${CONFORMANCE}/theorem/boolean-local.ts`,
  `${CONFORMANCE}/inappropriate/truthiness-local.ts`,
  `${CONFORMANCE}/theorem/const-chain.ts`,
  `${CONFORMANCE}/theorem/let-binding.ts`,
  `${CONFORMANCE}/countersatisfiable/branch-throw.ts`,
  `${CONFORMANCE}/inappropriate/branch-loop.ts`,
  `${CONFORMANCE}/inappropriate/for-loop.ts`,
  `${CONFORMANCE}/inappropriate/shadowed-const.ts`,
  `${CONFORMANCE}/inappropriate/uninitialized-let.ts`,
];

/** The binder/guard slice (#150): guard chains, guard-respecting
 * witnesses, and number binders — bounded, half-bounded, and rangeless.
 * With this slice the manifest covers every shape the emission pipeline
 * reaches. */
const BINDER_FIXTURES = [
  "thales/tests/fixtures/binders.ts",
  `${CONFORMANCE}/countersatisfiable/guarded-witness.ts`,
  `${CONFORMANCE}/countersatisfiable/reserved-binder.ts`,
  `${CONFORMANCE}/theorem/guarded-floor.ts`,
  `${CONFORMANCE}/theorem/branch-guarded-throw.ts`,
  `${CONFORMANCE}/theorem/number-binder.ts`,
  `${CONFORMANCE}/theorem/branch-clamp.ts`,
  `${CONFORMANCE}/theorem/finite-bounds.ts`,
  `${CONFORMANCE}/theorem/left-factor.ts`,
  `${CONFORMANCE}/theorem/literal-factor.ts`,
  `${CONFORMANCE}/theorem/guarded-monotone-conversion.ts`,
  `${CONFORMANCE}/gaveup/scale-identity.ts`,
  `${CONFORMANCE}/inappropriate/guarded-power.ts`,
  `${CONFORMANCE}/theorem/or-guard.ts`,
  `${CONFORMANCE}/countersatisfiable/or-guard-witness.ts`,
  `${CONFORMANCE}/theorem/connective-conclusions.ts`,
  `${CONFORMANCE}/countersatisfiable/boolean-witness.ts`,
];

/** The class slice (#129): structures, single-assignment constructors,
 * getters, and new in atoms — the theorem path and each degrade path —
 * plus a class-valued binder over a guarding constructor's image, one
 * whose class is itself built from classes, and fields at a union and at
 * an earlier class, read through the tagged sites and as receivers. */
const CLASS_FIXTURES = [
  "thales/tests/fixtures/classes.ts",
  `${CONFORMANCE}/theorem/class-box-roundtrip.ts`,
  `${CONFORMANCE}/theorem/class-getter-on-this.ts`,
  `${CONFORMANCE}/theorem/class-binder-distance.ts`,
  `${CONFORMANCE}/theorem/class-binder-equality-guards.ts`,
  `${CONFORMANCE}/theorem/class-binder-nested.ts`,
  `${CONFORMANCE}/theorem/class-binder-wide.ts`,
  `${CONFORMANCE}/inappropriate/ctor-assigns-twice.ts`,
  `${CONFORMANCE}/inappropriate/ctor-partial-assign.ts`,
  `${CONFORMANCE}/inappropriate/class-extends.ts`,
  `${CONFORMANCE}/theorem/ctor-default-omitted.ts`,
  `${CONFORMANCE}/theorem/ctor-default-undefined.ts`,
  `${CONFORMANCE}/theorem/class-binder-ctor-default.ts`,
  `${CONFORMANCE}/theorem/fn-default-instance.ts`,
  `${CONFORMANCE}/theorem/ctor-default-instance.ts`,
  `${CONFORMANCE}/theorem/method-default-instance.ts`,
  `${CONFORMANCE}/theorem/class-local.ts`,
  `${CONFORMANCE}/theorem/local-inferred.ts`,
  `${CONFORMANCE}/inappropriate/ctor-default-this.ts`,
  `${CONFORMANCE}/theorem/method-default-omitted.ts`,
  `${CONFORMANCE}/theorem/method-default-this.ts`,
  `${CONFORMANCE}/theorem/fn-default-omitted.ts`,
  `${CONFORMANCE}/theorem/fn-default-explicit-undefined.ts`,
  `${CONFORMANCE}/theorem/fn-default-leading.ts`,
  `${CONFORMANCE}/theorem/fn-default-calls.ts`,
  `${CONFORMANCE}/theorem/fn-default-outside-slice.ts`,
  `${CONFORMANCE}/theorem/field-union-undefined.ts`,
  `${CONFORMANCE}/theorem/field-class-nested.ts`,
  `${CONFORMANCE}/inappropriate/field-later-class.ts`,
];

/** The method slice (#130): instance methods, this-chains, method atoms,
 * and the whitelist non-collision. */
const METHOD_FIXTURES = [
  `${CONFORMANCE}/theorem/method-double.ts`,
  `${CONFORMANCE}/theorem/method-chain.ts`,
  `${CONFORMANCE}/theorem/method-guarded-throw.ts`,
  `${CONFORMANCE}/theorem/method-on-shadowing-class.ts`,
  `${CONFORMANCE}/theorem/method-sibling-degrades.ts`,
  `${CONFORMANCE}/inappropriate/method-power.ts`,
];

/** The class-typed-parameter slice: a parameter at its own class, one at
 * an earlier class through a constructor, a free function over a class,
 * the two ways a parameter's type can refuse, and booleans in classes. */
const PARAM_FIXTURES = [
  "thales/tests/fixtures/class-params.ts",
  `${CONFORMANCE}/theorem/class-param-gap.ts`,
  `${CONFORMANCE}/inappropriate/class-param-interface.ts`,
  `${CONFORMANCE}/theorem/boolean-param.ts`,
  `${CONFORMANCE}/theorem/boolean-classes.ts`,
];

/** The degradation slice (#151): unsupported ranges and the names
 * non-function declarations bind, mixed with healthy annotations in one
 * file. */
const DEGRADATION_FIXTURES = [
  "thales/tests/fixtures/degradations.ts",
  `${CONFORMANCE}/nottried/empty-after-clamp.ts`,
  `${CONFORMANCE}/nottried/half-bounded-int.ts`,
  `${CONFORMANCE}/nottried/huge-range.ts`,
  // A residual site off the property's path, and two on it: the reason a
  // site produces is the prover's, so the store pins it end to end.
  `${CONFORMANCE}/theorem/residual-untaken-branch.ts`,
  `${CONFORMANCE}/inappropriate/residual-dropped-value.ts`,
  `${CONFORMANCE}/inappropriate/residual-sites-distinct.ts`,
  // A throw of a class outside the seven error kinds is a site too: off the
  // property's path, and on it. The reason is the prover's, so the store
  // pins it end to end.
  `${CONFORMANCE}/theorem/custom-throw-unreached.ts`,
  `${CONFORMANCE}/inappropriate/custom-throw-reached.ts`,
];

/** The import slice: the closure fixtures the switchover carved out — a
 * followed closure, one through an aliased export, one through a barrel's
 * re-exports, and the two edges that stay opaque. */
const IMPORT_FIXTURES = [
  `${CONFORMANCE}/theorem/imported-scale/main.ts`,
  `${CONFORMANCE}/theorem/aliased-export/main.ts`,
  `${CONFORMANCE}/theorem/barrel-import/main.ts`,
  `${CONFORMANCE}/inappropriate/bare-import/main.ts`,
  `${CONFORMANCE}/inappropriate/import-cycle/main.ts`,
];

/** The module-constant slice: literal consts read from bodies and
 * formulas, a const derived from earlier ones, builtin aliases, a
 * cross-module constant, and the read of a module binding the model
 * still refuses. */
const CONST_FIXTURES = [
  "thales/tests/fixtures/module-consts.ts",
  `${CONFORMANCE}/theorem/module-const-scale.ts`,
  `${CONFORMANCE}/theorem/module-const-ladder.ts`,
  `${CONFORMANCE}/theorem/builtin-alias-magnitude.ts`,
  `${CONFORMANCE}/theorem/imported-constants/main.ts`,
  `${CONFORMANCE}/theorem/initializers.ts`,
  `${CONFORMANCE}/theorem/const-epsilon-read.ts`,
  `${CONFORMANCE}/inappropriate/module-let-read.ts`,
];

/** The union slice: typeof dispatch, JsVal equality, the falsity path,
 * union-typed locals (#117), the boolean position a union place projects
 * at, and the refusals unions must not loosen. */
const UNION_FIXTURES = [
  "thales/tests/fixtures/unions.ts",
  `${CONFORMANCE}/theorem/union-typeof-dispatch.ts`,
  `${CONFORMANCE}/theorem/union-null-flag.ts`,
  `${CONFORMANCE}/theorem/union-local.ts`,
  `${CONFORMANCE}/theorem/boolean-union-place.ts`,
  `${CONFORMANCE}/countersatisfiable/union-misread.ts`,
  `${CONFORMANCE}/inappropriate/union-return.ts`,
  `${CONFORMANCE}/inappropriate/union-string-argument.ts`,
  `${CONFORMANCE}/inappropriate/union-widened-argument.ts`,
];

/** The optional-parameter slice: a call filling the undefined tag by
 * arity, the same shape at full arity, the falsity path, and the
 * trailing-order refusal optionals must not loosen. */
const OPTIONAL_FIXTURES = [
  "thales/tests/fixtures/optionals.ts",
  `${CONFORMANCE}/theorem/optional-arity.ts`,
  `${CONFORMANCE}/countersatisfiable/optional-misread.ts`,
];

/** The SameValue-over-JsVal slice (#209): Object.is widened to the tags
 * the domain carries — boolean operands, the undefined atom — so a
 * statically cross-tag comparison answers false instead of refusing,
 * plus the string refusal Object.is must keep. */
const SAMEVALUE_FIXTURES = [
  "thales/tests/fixtures/object-is-tagged.ts",
  `${CONFORMANCE}/theorem/object-is-boolean-reflexive.ts`,
  `${CONFORMANCE}/theorem/object-is-mixed-branch.ts`,
  `${CONFORMANCE}/theorem/object-is-undefined-atom.ts`,
  `${CONFORMANCE}/countersatisfiable/object-is-mixed-tag.ts`,
  `${CONFORMANCE}/inappropriate/object-is-string.ts`,
];

/** The whitelisted `Math`/`Number` members: the integral roundings and
 * the sign unit over bounded int binders, the signed zero ceil keeps
 * below one, the tie direction round carries, the binary32 narrowing
 * where it is exact and where ties-to-even refutes it, the two variadic
 * members at a nested and a three-argument call site, the two integer
 * predicates where they agree and where the safe bound separates them,
 * and a member of the same objects the whitelist does not cover. */
const MEMBER_FIXTURES = [
  `${CONFORMANCE}/theorem/days-to-weeks.ts`,
  `${CONFORMANCE}/theorem/halve-integers.ts`,
  `${CONFORMANCE}/theorem/ceil-keeps-sign.ts`,
  `${CONFORMANCE}/theorem/round-half-up.ts`,
  `${CONFORMANCE}/theorem/sign-unit.ts`,
  `${CONFORMANCE}/theorem/fround-narrows.ts`,
  `${CONFORMANCE}/countersatisfiable/fround-ties-to-even.ts`,
  `${CONFORMANCE}/theorem/clamp-to-range.ts`,
  `${CONFORMANCE}/theorem/min-of-three.ts`,
  `${CONFORMANCE}/theorem/integral-scale.ts`,
  `${CONFORMANCE}/theorem/beyond-safe-integer.ts`,
  `${CONFORMANCE}/theorem/epsilon-scale.ts`,
  `${CONFORMANCE}/theorem/safe-integer-bound.ts`,
  `${CONFORMANCE}/theorem/infinity-spelled.ts`,
  `${CONFORMANCE}/theorem/unbounded-clamp.ts`,
  `${CONFORMANCE}/theorem/unbounded-rounding.ts`,
  `${CONFORMANCE}/theorem/unbounded-round-sign.ts`,
  `${CONFORMANCE}/theorem/unbounded-fround.ts`,
  `${CONFORMANCE}/theorem/clamp-identity.ts`,
  `${CONFORMANCE}/inappropriate/math-log.ts`,
  `${CONFORMANCE}/inappropriate/number-length.ts`,
  `${CONFORMANCE}/inappropriate/math-sqrt-local-alias.ts`,
];

const allFixtures =
  process.env.LAKATOS_PROVE_E2E === "1"
    ? [
        ...QUICK_FIXTURES,
        ...EXPRESSION_FIXTURES,
        ...STATEMENT_FIXTURES,
        ...BINDER_FIXTURES,
        ...CLASS_FIXTURES,
        ...METHOD_FIXTURES,
        ...PARAM_FIXTURES,
        ...DEGRADATION_FIXTURES,
        ...IMPORT_FIXTURES,
        ...CONST_FIXTURES,
        ...UNION_FIXTURES,
        ...OPTIONAL_FIXTURES,
        ...SAMEVALUE_FIXTURES,
        ...MEMBER_FIXTURES,
      ]
    : QUICK_FIXTURES;

const EXPECTED_FILE = path.join(
  engineRoot,
  "tests",
  "fixtures",
  "envelopes.expected.json",
);
const updating = process.env.UPDATE_ENVELOPES === "1";

const { check, failed, done } = checker("envelopes");
check(
  !updating || process.env.LAKATOS_PROVE_E2E === "1",
  "UPDATE_ENVELOPES=1 needs LAKATOS_PROVE_E2E=1: a quick-only regeneration would drop the corpus slices from the store",
);
// Regeneration needs the whole manifest — a partial store is an empty store
// — so the shard selector is inert when updating.
const fixtures = updating
  ? allFixtures
  : shardOf(allFixtures, process.env.LAKATOS_ENVELOPE_SHARD);
const expectedStore = updating
  ? {}
  : JSON.parse(fs.readFileSync(EXPECTED_FILE, "utf8"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thales-envelopes-"));
const bin = thalesBinary();
const tsconfig = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", types: [] },
  include: ["**/*.ts"],
  exclude: [".lakatos"],
});

/** The fixture in a scratch project: the file, or the whole directory of
 * a `main.ts` entry, beside a default tsconfig. Returns the entry's path
 * inside the project. */
function stage(fixture) {
  const dir = fs.mkdtempSync(path.join(tmp, "fixture-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), tsconfig);
  const source = path.join(repoRoot, fixture);
  if (path.basename(fixture) === "main.ts") {
    fs.cpSync(path.dirname(source), path.join(dir, "fixture"), {
      recursive: true,
    });
    return { dir, entry: "fixture/main.ts" };
  }
  fs.copyFileSync(source, path.join(dir, path.basename(fixture)));
  return { dir, entry: path.basename(fixture) };
}

/** One envelope entry, as the CLI ships it. `kind` rides only on the
 * refusals that carry one into the envelope, and `model` only on the
 * statuses the envelope's own rule gives it. */
function entry(fn, property, szs, reason, axioms, counterexample, kind, model) {
  return {
    function: fn,
    property,
    szs,
    reason,
    axioms,
    counterexample,
    kind,
    model,
  };
}

/** The envelope's annotation less its file, which is the staged path. */
function projectAnnotation(a) {
  return entry(
    a.function,
    a.property,
    a.szs,
    a.reason,
    a.axioms,
    a.counterexample,
    a.kind,
    a.model,
  );
}

for (const fixture of fixtures) {
  // Timeout fixtures are graded the way the corpus harness grades them:
  // under a reduced heartbeat budget, where Timeout is deterministic and
  // cheap.
  if (fixture.includes("/timeout/")) {
    process.env.LAKATOS_PROVE_HEARTBEATS = "1";
  } else {
    delete process.env.LAKATOS_PROVE_HEARTBEATS;
  }

  // The two quick fixtures run at the real correspondence budget, so the
  // store carries a validated model (the tracer's add, about half a
  // minute, deterministic in heartbeats). The corpus slices run at one
  // heartbeat: every obligation reports the budget reason in
  // milliseconds, and the manifest's 289 declarations stay minutes rather
  // than the two hours the real budget would cost. The script owns the
  // variable in both arms, so an exported value cannot skew the store.
  if (QUICK_FIXTURES.includes(fixture)) {
    delete process.env.LAKATOS_PROVE_VALIDATE_HEARTBEATS;
  } else {
    process.env.LAKATOS_PROVE_VALIDATE_HEARTBEATS = "1";
  }

  const { dir, entry: file } = stage(fixture);
  const r = spawnSync(bin, [file], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, LAKATOS_LEMMA: lemmaDir },
    timeout: 600_000 + 300_000 + 120_000 * 20,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ran = r.status === 0 || r.status === 1;
  check(ran, `${fixture}: thales exited ${r.status ?? r.error}\n${r.stderr}`);
  if (!ran) continue;
  const entries = JSON.parse(r.stdout).annotations.map(projectAnnotation);

  if (updating) {
    expectedStore[fixture] = entries;
    continue;
  }
  const want = expectedStore[fixture];
  check(
    want !== undefined,
    `${fixture}: no stored envelope — regenerate with UPDATE_ENVELOPES=1 LAKATOS_PROVE_E2E=1`,
  );
  check(
    canonical(entries) === canonical(want),
    `${fixture}: envelope entries diverge from stored\ngot:\n${JSON.stringify(entries, null, 2)}\nstored:\n${JSON.stringify(want, null, 2)}`,
  );
}

// Any recorded failure, the precondition's included, would leave the
// store partial: a failed fixture or a quick-only run drops entries.
if (updating && !failed()) {
  fs.writeFileSync(
    EXPECTED_FILE,
    JSON.stringify(expectedStore, null, 2) + "\n",
  );
}
fs.rmSync(tmp, { recursive: true, force: true });
done(
  updating
    ? `${fixtures.length} fixtures regenerated`
    : `${fixtures.length} fixtures against stored expectations`,
);
