import { defineConfig } from "vitest/config";

// Its own config, outside the root's include: the scheduled `parity`
// workflow is the only runner, never a required check.
export default defineConfig({
  test: {
    include: ["parity/**/*.test.ts"],
    fileParallelism: false,
  },
});
