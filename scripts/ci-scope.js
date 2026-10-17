// Which Lean jobs a pull request or merge-queue diff needs, and whether
// the jobs that then ran are exactly those.
//
//   node scripts/ci-scope.js select <workflow> [--all] < changed-paths
//   node scripts/ci-scope.js gate <workflow> < needs-json
//   node scripts/ci-scope.js patterns
//
// A pattern ending in "/" matches every path under that directory; any
// other pattern is one file. A job runs when a changed path matches a
// pattern of any group it belongs to.

import { readFileSync } from "node:fs";

// What every Lean job reads: the workspace's dependency and test
// configuration, and this table itself.
const SHARED = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.tests.json",
  "vitest.config.ts",
  "scripts/ci-scope.js",
];

const WORKFLOWS = {
  lean: {
    groups: {
      // The prover builds on the semantics and imports core and lemma; its
      // suites and the repository-wide checks live under tests/.
      prover: [
        "thales/",
        "core/",
        "lemma/",
        "tests/",
        ".github/workflows/lean.yml",
        ".github/actions/lean-setup/",
        ...SHARED,
      ],
      // The semantics, the evaluator, and the test262 runner. The runner
      // parses with lemma's bridge, so a change to the bridge, the schema
      // it emits to, or the compiler it is built on moves the slice's table.
      semantics: [
        "thales/Js/",
        "thales/Js.lean",
        "thales/Tarski/",
        "thales/Tarski.lean",
        "thales/Test/Js/",
        "thales/Test/Tarski/",
        "thales/Test/fixtures/",
        "thales/tests/tarski/",
        "thales/test262/",
        "thales/scripts/check-boundary.sh",
        "thales/scripts/check-imports.sh",
        "thales/scripts/lean-strip.awk",
        "thales/scripts/test262-full.sh",
        "thales/scripts/boundary-fixture/",
        "thales/scripts/import-fixture/",
        "thales/lakefile.lean",
        "thales/lake-manifest.json",
        "thales/lean-toolchain",
        "lemma/src/",
        "lemma/schemas/",
        "lemma/package.json",
        "lemma/tsconfig.json",
        ".github/workflows/lean.yml",
        ".github/actions/lean-setup/",
        ...SHARED,
      ],
      // What `tarski <file.ts>`'s suites run besides tarski itself: the
      // lemma checkout it gates through, and every fixture the comparison
      // runs against Node.
      exe: [
        "lemma/",
        "thales/tests/fixtures/",
        "thales/tests/conformance/",
        "pabst/tests/fixtures/",
      ],
      // The parity suite runs refute beside prove.
      parity: ["pabst/"],
    },
    jobs: {
      "lean-tests": ["prover", "semantics"],
      "verdict-channel": ["prover"],
      envelopes: ["prover"],
      "prove-e2e": ["prover", "parity"],
      "verdict-corpus": ["prover"],
      "test262-slice": ["semantics"],
      "runner-e2e": ["semantics", "exe"],
    },
  },
};

const matches = (path, pattern) =>
  pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern;

function select(workflow, paths, all) {
  const out = {};
  for (const [group, patterns] of Object.entries(WORKFLOWS[workflow].groups)) {
    out[group] =
      all || paths.some((p) => patterns.some((pat) => matches(p, pat)));
  }
  return out;
}

// null when the run matches the selection; otherwise one line per problem.
function gate(workflow, needs) {
  const { groups, jobs } = WORKFLOWS[workflow];
  const changes = needs.changes;
  if (!changes || changes.result !== "success") {
    return `the changes job did not succeed: ${changes?.result ?? "missing"}`;
  }
  const selected = {};
  for (const group of Object.keys(groups)) {
    const answer = changes.outputs?.[group];
    if (answer !== "true" && answer !== "false") {
      return `the changes job gave no answer for ${group}`;
    }
    selected[group] = answer === "true";
  }
  const problems = [];
  for (const [job, jobGroups] of Object.entries(jobs)) {
    const expected = jobGroups.some((g) => selected[g]) ? "success" : "skipped";
    const result = needs[job]?.result ?? "missing";
    if (result !== expected) {
      problems.push(`${job}: ${result}, expected ${expected}`);
    }
  }
  for (const job of Object.keys(needs)) {
    if (job !== "changes" && !(job in jobs)) {
      problems.push(`${job}: not a job this gate knows`);
    }
  }
  return problems.length ? problems.join("\n") : null;
}

function usage() {
  process.stderr.write(
    "usage: ci-scope.js select lean [--all] | gate lean | patterns\n",
  );
  process.exit(2);
}

const [mode, workflow, flag] = process.argv.slice(2);

if (mode === "patterns") {
  const all = new Set();
  for (const { groups } of Object.values(WORKFLOWS)) {
    for (const patterns of Object.values(groups)) {
      for (const p of patterns) all.add(p);
    }
  }
  process.stdout.write([...all].join("\n") + "\n");
} else if (mode === "select" && workflow in WORKFLOWS) {
  // NUL-separated from `git diff -z`, so a non-ASCII path arrives as
  // itself rather than C-quoted; newline-separated by hand.
  const paths = readFileSync(0, "utf8")
    .split(/[\0\n]/)
    .filter(Boolean);
  const chosen = select(workflow, paths, flag === "--all");
  for (const [group, on] of Object.entries(chosen)) {
    process.stdout.write(`${group}=${on}\n`);
  }
} else if (mode === "gate" && workflow in WORKFLOWS) {
  const problem = gate(workflow, JSON.parse(readFileSync(0, "utf8")));
  if (problem !== null) {
    process.stderr.write(problem + "\n");
    process.exit(1);
  }
  process.stdout.write(
    `every selected ${workflow} job succeeded and no other ran\n`,
  );
} else {
  usage();
}
