#!/usr/bin/env bash
set -euo pipefail

API_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
ANON_KEY="${SUPABASE_ANON_KEY:-}"
SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [[ -z "${ANON_KEY}" ]]; then
  ANON_KEY="$(cd "$(dirname "$0")/.." && supabase status -o env | awk -F= '/^ANON_KEY=/{gsub(/"/,"",$2); print $2}')"
fi

if [[ -z "${SERVICE_ROLE_KEY}" ]]; then
  SERVICE_ROLE_KEY="$(cd "$(dirname "$0")/.." && supabase status -o env | awk -F= '/^SERVICE_ROLE_KEY=/{gsub(/"/,"",$2); print $2}')"
fi

if [[ -z "${ANON_KEY}" || -z "${SERVICE_ROLE_KEY}" ]]; then
  echo "Missing ANON_KEY or SERVICE_ROLE_KEY."
  exit 1
fi

request_code() {
  curl -sS -o /tmp/api_smoke_resp.txt -w "%{http_code}" "$@"
}

assert_2xx() {
  local code="$1"
  local name="$2"
  if [[ ! "$code" =~ ^2[0-9][0-9]$ ]]; then
    echo "[FAIL] ${name} (HTTP ${code})"
    cat /tmp/api_smoke_resp.txt
    exit 1
  fi
  echo "[PASS] ${name}"
}

echo "Running local API smoke checks against ${API_URL}"

code="$(request_code -H "apikey: ${ANON_KEY}" "${API_URL}/auth/v1/health")"
assert_2xx "${code}" "Auth health"

code="$(request_code -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}" "${API_URL}/rest/v1/products?select=id&limit=1")"
assert_2xx "${code}" "REST products select"

code="$(request_code -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" "${API_URL}/storage/v1/bucket")"
assert_2xx "${code}" "Storage bucket list"

if ! grep -q '"id":"Menu"' /tmp/api_smoke_resp.txt; then
  code="$(request_code -X POST "${API_URL}/storage/v1/bucket" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"id":"Menu","name":"Menu","public":true}')"
  assert_2xx "${code}" "Create Menu bucket"
fi

if ! grep -q '"id":"Avatar"' /tmp/api_smoke_resp.txt; then
  code="$(request_code -X POST "${API_URL}/storage/v1/bucket" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"id":"Avatar","name":"Avatar","public":true}')"
  assert_2xx "${code}" "Create Avatar bucket"
fi

SMOKE_PATH="public/_smoke/$(date +%s).webp"
printf 'api-smoke-image' > /tmp/api_smoke_upload.webp
code="$(request_code -X POST "${API_URL}/storage/v1/object/Menu/${SMOKE_PATH}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "x-upsert: true" \
  -H "Content-Type: image/webp" \
  --data-binary "@/tmp/api_smoke_upload.webp")"
assert_2xx "${code}" "Storage upload (Menu bucket)"

echo "All API smoke checks passed."
