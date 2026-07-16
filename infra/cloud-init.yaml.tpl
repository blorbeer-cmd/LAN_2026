#cloud-config
# Rendered by .github/workflows/provision.yml (envsubst over this template)
# and passed to `hcloud server create --user-data-from-file`. Runs once, on
# first boot of the box. Re-running provision.yml re-renders and re-applies
# this to the *existing* server only if you delete/recreate it — day-to-day
# code deploys go through deploy.yml instead (see README "Deployment").
#
# Placeholders substituted by the workflow (its envsubst whitelist), never
# committed with real values: SSH_PUBLIC_KEY, CF_TUNNEL_TOKEN,
# APP_ACCESS_TOKEN, APP_ADMIN_RECOVERY_CODE, APP_KIOSK_TOKEN, GHCR_PULL_TOKEN, GHCR_PULL_USERNAME,
# INITIAL_IMAGE — GHCR_PULL_USERNAME isn't secret (it's just github.actor,
# whoever ran the provision workflow — not a repo owner or a new secret),
# and INITIAL_IMAGE exists only
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
          logging:
            driver: local
            options:
              max-size: 10m
              max-file: '5'

        cloudflared:
          image: cloudflare/cloudflared:latest
          restart: unless-stopped
          command: tunnel run
          environment:
            - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
          logging:
            driver: local
            options:
              max-size: 10m
              max-file: '5'
          # No depends_on: cloudflared must come up even before the app
          # image has ever been pushed (see runcmd below) — it retries the
          # connection to app:3000 on its own once that exists.

  - path: /opt/lan2026/.env
    permissions: '0600'
    content: |
      AUTH_MODE=required
      ADMIN_RECOVERY_CODE=$APP_ADMIN_RECOVERY_CODE
      KIOSK_TOKEN=$APP_KIOSK_TOKEN
      # Kept for rollback compatibility with images from before personal auth.
      ACCESS_TOKEN=$APP_ACCESS_TOKEN
      CF_TUNNEL_TOKEN=$CF_TUNNEL_TOKEN
      GHCR_PULL_TOKEN=$GHCR_PULL_TOKEN
      GHCR_PULL_USERNAME=$GHCR_PULL_USERNAME
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
      if ! docker compose up -d --wait --wait-timeout 90 app; then
        docker compose ps app || true
        docker compose logs --tail=100 app || true
        exit 1
      fi

  - path: /opt/lan2026/docker-login.sh
    permissions: '0700'
    content: |
      #!/usr/bin/env bash
      # GHCR package stays private (not everyone with repo read access
      # should be able to pull it) — this box authenticates instead, via a
      # PAT with read:packages scope. Reads the token from .env rather than
      # taking it as an argument so it never appears in shell history or a
      # process list. Re-run manually if GHCR_PULL_TOKEN is ever rotated.
      set -euo pipefail
      cd /opt/lan2026
      # shellcheck disable=SC1091
      source .env
      echo "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "$GHCR_PULL_USERNAME" --password-stdin

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
  # Everything docker-related runs as "deploy" (not root) from here on, so
  # the login this seeds is the same one deploy.yml's SSH deploys reuse —
  # `su - deploy` starts a fresh session that already sees the docker group
  # added above via usermod.
  - su - deploy -c '/opt/lan2026/docker-login.sh'
  # cloudflared always comes up (public image, no auth needed). The app
  # image does NOT exist in GHCR yet on a brand-new repo — nothing has ever
  # been pushed to main — so this pull is expected to fail on a virgin box;
  # `|| true` keeps that from blocking the rest of boot. deploy.yml's first
  # real run (see README step 6) pulls and starts it for real.
  - su - deploy -c 'cd /opt/lan2026 && docker compose up -d cloudflared'
  - su - deploy -c 'cd /opt/lan2026 && (docker compose pull app && docker compose up -d app || true)'
