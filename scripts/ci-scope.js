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
  thales: {
    groups: {
      // The prover builds tarski and imports core and lemma; its suites
      // and the repository-wide checks live under tests/.
      lean: [
        "thales/",
        "tarski/",
        "core/",
        "lemma/",
        "tests/",
        ".github/workflows/thales.yml",
        ".github/actions/thales-setup/",
        ...SHARED,
      ],
      // The parity suite runs refute beside prove.
      parity: ["pabst/"],
    },
    jobs: {
      "lean-tests": ["lean"],
      "verdict-channel": ["lean"],
      envelopes: ["lean"],
      "prove-e2e": ["lean", "parity"],
      "verdict-corpus": ["lean"],
    },
  },
  tarski: {
    groups: {
      lean: [
        "tarski/",
        ".github/workflows/tarski.yml",
        ".github/actions/tarski-setup/",
        ...SHARED,
      ],
      // thales-exe, its suites, and every fixture they run against Node.
      exe: [
        "thales/frontend/",
        "thales/tests/",
        "core/",
        "lemma/",
        "pabst/tests/fixtures/",
      ],
    },
    jobs: {
      "lean-tests": ["lean"],
      "test262-slice": ["lean"],
      "runner-e2e": ["lean", "exe"],
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

function usage() {
  process.stderr.write(
    "usage: ci-scope.js select <thales|tarski> [--all] | gate <thales|tarski> | patterns\n",
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
  const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const chosen = select(workflow, paths, flag === "--all");
  for (const [group, on] of Object.entries(chosen)) {
    process.stdout.write(`${group}=${on}\n`);
  }
} else {
  usage();
}
