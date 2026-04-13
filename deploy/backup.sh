#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-/opt/minecraft}"
BACKUP_DIR="${2:-/opt/backups}"
TIMESTAMP="$(date +%F-%H%M)"

mkdir -p "$BACKUP_DIR"

tar -czf "$BACKUP_DIR/mc-$TIMESTAMP.tar.gz" -C "$(dirname "$SOURCE_DIR")" "$(basename "$SOURCE_DIR")"

# Borra respaldos con más de 7 días para evitar crecimiento ilimitado.
find "$BACKUP_DIR" -type f -name 'mc-*.tar.gz' -mtime +7 -delete
