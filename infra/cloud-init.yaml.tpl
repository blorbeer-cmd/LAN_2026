#cloud-config
# Rendered by .github/workflows/provision.yml (envsubst over this template)
# and passed to `hcloud server create --user-data-from-file`. Runs once, on
# first boot of the box. Re-running provision.yml re-renders and re-applies
# this to the *existing* server only if you delete/recreate it — day-to-day
# code deploys go through deploy.yml instead (see README "Deployment").
#
# Placeholders substituted by the workflow (its envsubst whitelist), never
# committed with real values: SSH_PUBLIC_KEY, CF_TUNNEL_TOKEN,
# APP_ACCESS_TOKEN, APP_ADMIN_PIN, INITIAL_IMAGE — that last one exists only
# to seed .env's IMAGE= line once at boot. The app service's own "image:"
# line below is deliberately NOT one of those names (it stays the literal
# 4-character string image-colon-dollar-brace-I-M-A-G-E, unresolved by this
# render step) so `docker compose` re-reads it from .env fresh on every
# future deploy/rollback instead of it being frozen at first boot. Do not
# add that name to the workflow's envsubst whitelist, and do not wrap any of
# the other names above in "$$" hoping it means literal-dollar — envsubst
# has no such escape; a whitelisted name inside $${...} still gets rewritten
# to a literal "$" followed by its value, not left as "${...}".

package_update: true
package_upgrade: true

# No root SSH login. All access goes through the "deploy" user (sudo, no
# password auth — key only).
disable_root: true
ssh_pwauth: false

users:
  - name: deploy
    groups: [sudo]
    shell: /bin/bash
    sudo: ['ALL=(ALL) NOPASSWD:ALL']
    lock_passwd: true
    ssh_authorized_keys:
      - $SSH_PUBLIC_KEY

write_files:
  # Keep in sync with docker-compose.yml at the repo root — this is a copy
  # because the box has no working copy of the repo, only the built image.
  - path: /opt/lan2026/docker-compose.yml
    permissions: '0600'
    content: |
      services:
        app:
          image: ${IMAGE}
          restart: unless-stopped
          env_file: .env
          environment:
            - NODE_ENV=production
          expose:
            - '3000'
          volumes:
            - ./data:/app/data

        cloudflared:
          image: cloudflare/cloudflared:latest
          restart: unless-stopped
          command: tunnel run
          environment:
            - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
          depends_on:
            - app

  - path: /opt/lan2026/.env
    permissions: '0600'
    content: |
      ACCESS_TOKEN=$APP_ACCESS_TOKEN
      ADMIN_PIN=$APP_ADMIN_PIN
      CF_TUNNEL_TOKEN=$CF_TUNNEL_TOKEN
      IMAGE=$INITIAL_IMAGE

  - path: /opt/lan2026/rollback.sh
    permissions: '0755'
    content: |
      #!/usr/bin/env bash
      # One-command revert to a previously built image, e.g. after a bad
      # deploy: ./rollback.sh <git-sha>  (sha must exist as a ghcr.io tag).
      set -euo pipefail
      if [ -z "${1:-}" ]; then
        echo "usage: rollback.sh <git-sha>"
        exit 1
      fi
      cd /opt/lan2026
      sed -i "s#^IMAGE=.*#IMAGE=ghcr.io/blorbeer-cmd/lan_2026:${1}#" .env
      docker compose pull app
      docker compose up -d app

runcmd:
  - apt-get update
  - apt-get install -y --no-install-recommends ufw fail2ban unattended-upgrades
  - curl -fsSL https://get.docker.com | sh
  - usermod -aG docker deploy
  - mkdir -p /opt/lan2026/data
  - chown -R deploy:deploy /opt/lan2026
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow OpenSSH
  - ufw --force enable
  - systemctl enable --now fail2ban
  - bash -c 'cd /opt/lan2026 && docker compose pull && docker compose up -d'
