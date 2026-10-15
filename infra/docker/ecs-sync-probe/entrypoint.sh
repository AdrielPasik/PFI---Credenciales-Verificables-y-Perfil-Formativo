#!/bin/sh
set -eu

case "${1:-}" in
  exit-zero)
    printf '%s\n' 'ecs-sync-probe: deterministic success'
    exit 0
    ;;
  exit-nonzero)
    printf '%s\n' 'ecs-sync-probe: deterministic controlled failure'
    exit 23
    ;;
  *)
    printf '%s\n' 'ecs-sync-probe: invalid mode'
    exit 64
    ;;
esac
