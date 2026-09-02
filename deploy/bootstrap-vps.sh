#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root on a fresh Debian/Ubuntu VPS." >&2
  exit 1
fi

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl ufw

id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

if [ ! -s /home/deploy/.ssh/authorized_keys ]; then
  if [ ! -s /root/.ssh/authorized_keys ]; then
    echo "No SSH public key found; refusing to disable password/root login." >&2
    exit 1
  fi
  install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
  install -m 0600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
fi

sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sshd -t
systemctl restart ssh

ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon --show=NAME | grep -qx /swapfile || swapon /swapfile
grep -q '^/swapfile none swap sw 0 0$' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-tline-swap.conf
sysctl --system

curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
install -d -m 0755 /etc/docker
printf '%s\n' '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' > /etc/docker/daemon.json
systemctl restart docker
docker network inspect web >/dev/null 2>&1 || docker network create web

echo "Baseline complete. Copy deploy/proxy to /home/deploy/proxy, configure Caddyfile, then re-login as deploy."
