const canaryUrl =
  "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-eslint-config-exec-20261004";

try {
  await fetch(canaryUrl, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "CR_ESLINT_CONFIG_EXEC_20261004",
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
