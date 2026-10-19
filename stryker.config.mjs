/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command: "./node_modules/.bin/vitest run --bail 1",
  },
  mutate: ["pabst/src/**/*.ts", "!**/*.d.ts"],
  ignorePatterns: [".lakatos", "coverage", "reports", "thales"],
  concurrency: 8,
  timeoutFactor: 3,
  timeoutMS: 60000,
  disableTypeChecks: "pabst/src/**/*.ts",
  reporters: ["clear-text", "html", "progress"],
};
