#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  printf 'Run this on the new cloud VM as root.\n' >&2
  exit 1
fi

. /etc/os-release
if [ "$ID" != ubuntu ] || [ "$VERSION_ID" != 24.04 ]; then
  printf 'This bootstrap supports Ubuntu 24.04 only.\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq docker.io docker-compose-v2 git ca-certificates curl
systemctl enable --now docker

# A small swap file handles brief dependency/build memory peaks without adding a disk.
if [ ! -e /swapfile ] && [ "$(swapon --noheadings | wc -l)" -eq 0 ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

if [ ! -e /opt/agentic-converter ]; then
  git clone --quiet https://github.com/muhammadhamad1104/Agentic-Website-Converter.git /opt/agentic-converter
fi

chown -R converter:converter /opt/agentic-converter
printf 'Docker host prepared. No application secrets were supplied or printed.\n'
