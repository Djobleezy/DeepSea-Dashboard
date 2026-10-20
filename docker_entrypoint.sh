#!/bin/sh
set -eu

config_path="${CONFIG_PATH:-/config/config.json}"
config_seed_path="${CONFIG_SEED_PATH:-/app/config.json.default}"

# Seed a writable config only once; subsequent starts retain saved settings.
if [ ! -e "$config_path" ]; then
  umask 077
  mkdir -p "$(dirname "$config_path")"
  cp "$config_seed_path" "$config_path"
fi

exec "$@"
