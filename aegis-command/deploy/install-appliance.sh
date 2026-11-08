#!/bin/sh
set -eu
# Run at the physical console of a NEW dedicated Debian/Ubuntu appliance only.
# Does not start services or modify the running firewall.
[ "$(id -u)" = 0 ] || { echo 'Run as root on the dedicated appliance.' >&2; exit 1; }
[ "${1:-}" = '--dedicated-appliance' ] || { echo 'Usage: sh deploy/install-appliance.sh --dedicated-appliance' >&2; exit 1; }
command -v nft >/dev/null
[ -x /usr/bin/node ] || { echo 'Install the verified offline Node runtime at /usr/bin/node first.' >&2; exit 1; }
/usr/bin/node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
[ ! -e /opt/aegis/server.mjs ] || { echo 'Existing installation found. Follow the update runbook.' >&2; exit 1; }
if ! id aegis >/dev/null 2>&1; then useradd --system --home-dir /var/lib/aegis --shell /usr/sbin/nologin aegis; fi
install -d -m 0755 /opt/aegis
for entry in server.mjs lib web scripts deploy node_modules package.json package-lock.json README.md WORKFLOWS.md DEMO.md VALIDATION.md; do cp -R "$entry" /opt/aegis/; done
chown -R root:root /opt/aegis
chmod -R go-w /opt/aegis
install -d -m 0750 -o root -g aegis /etc/aegis /etc/aegis/secrets
install -d -m 0700 -o aegis -g aegis /var/lib/aegis
install -m 0640 -o root -g aegis deploy/aegis.env.example /etc/aegis/aegis.env
install -m 0600 deploy/enclave.nft /etc/aegis/enclave.nft
install -m 0644 deploy/aegis.service /etc/systemd/system/aegis.service
install -m 0644 deploy/aegis-firewall.service /etc/systemd/system/aegis-firewall.service
systemctl daemon-reload
echo 'Files installed. Configure keys, certificates, network and custodians using deploy/README.md before starting aegis.service.'
