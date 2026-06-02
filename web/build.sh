#!/bin/sh
set -eu

rm -rf dist
mkdir -p dist/assets

API_BASE_URL="${API_URL:-/api}"

# Escape backslashes and quotes for a JS string literal.
ESCAPED_API_BASE_URL=$(printf '%s' "$API_BASE_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')
cat > dist/config.js <<EOF2
window.APP_CONFIG = {
  apiBaseUrl: "$ESCAPED_API_BASE_URL",
};
EOF2

cp index.html style.css app.js dist/
cp -R assets/* dist/assets/