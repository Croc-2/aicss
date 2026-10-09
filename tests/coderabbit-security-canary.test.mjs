// node --experimental-vm-modules --test tests/coderabbit-security-canary.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, SourceTextModule } from "node:vm";

test("the canary module exports the boolean true without runtime dependencies", async () => {
  // This TypeScript fixture contains only JavaScript syntax. Evaluate its actual
  // source in isolation without importing the ESLint configuration or React.
  const source = readFileSync(new URL(
    "../packages/react/src/coderabbit-security-canary.ts", import.meta.url,
  ), "utf8");
  const module = new SourceTextModule(source, {
    context: createContext({}),
    importModuleDynamically() { throw new Error("Unexpected runtime dependency"); },
  });
  await module.link(() => { throw new Error("Unexpected runtime dependency"); });
  await module.evaluate({ timeout: 1_000 });
  assert.equal(module.namespace.coderabbitSecurityCanary, true);
});
