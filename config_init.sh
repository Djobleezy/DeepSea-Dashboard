#!/bin/sh
set -eu

config_path="${CONFIG_PATH:-/config/config.json}"
config_seed_path="${CONFIG_SEED_PATH:-/app/config.json.default}"
config_dir="$(dirname "$config_path")"

umask 077
mkdir -p "$config_dir"

# A privileged one-shot initializer can import a private, read-only host seed.
# Preserve settings already saved in the volume on later starts and upgrades.
if [ ! -e "$config_path" ]; then
  cp "$config_seed_path" "$config_path"
fi

chown app:app "$config_dir" "$config_path"
chmod 600 "$config_path"
