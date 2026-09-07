#!/usr/bin/env bash
set -euo pipefail
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
TMP=$(cd "$TMP" && pwd -P)

trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_LOG"
if [[ $1 == inspect ]]; then
  case "$3" in
    *Config.Image*) printf '%s\n' "${TEST_IMAGE:-n8nio/n8n:2.26.9}";;
    *project.config_files*) printf '%s\n' "$TEST_BASE";;
    *com.docker.compose.project*) echo fixture;;
    *NetworkSettings.Networks*) echo fixture_default;;
    *'len .HostConfig.PortBindings'*) echo 1;;
    *HostConfig.PortBindings*) echo '127.0.0.1|15678';;
    *DB_TYPE*) echo DB_TYPE=postgresdb;;
    *DB_POSTGRESDB_HOST*) echo DB_POSTGRESDB_HOST=postgres;;
    *) :;;
  esac
elif [[ "$*" == 'compose version --short' ]]; then echo 2.30.0
elif [[ "$*" == *'ps -q'* ]]; then echo fixture-container
elif [[ "$*" == *'config --services'* ]]; then printf 'n8n\npostgres\n'
elif [[ "$*" == *'preflight.mjs'* && ${TEST_FAILURE:-} == preflight ]]; then exit 1
elif [[ "$*" == *'--wait-timeout'* && ${TEST_FAILURE:-} == start ]]; then exit 1
fi
DOCKER
chmod +x "$TMP/bin/docker"
# Any accidental new host-runtime dependency fails the test.
for tool in python python3 node jq yq; do
  printf '#!/bin/sh\necho forbidden-%s >> "$TEST_LOG"\nexit 98\n' "$tool" > "$TMP/bin/$tool"
  chmod +x "$TMP/bin/$tool"
done
export PATH="$TMP/bin:$PATH"
new_case() {
  DIR="$TMP/$1"; mkdir -p "$DIR/examples"
  cp "$SOURCE/install.sh" "$DIR/"
  cp "$SOURCE/examples/compose.attach.yaml" "$DIR/examples/"
  TEST_BASE="$DIR/compose.yaml"; printf 'fixture\n' > "$TEST_BASE"
  TEST_LOG="$DIR/commands"; : > "$TEST_LOG"
  SECRET="$DIR/reader password"; printf 'SENSITIVE_TEST_VALUE' > "$SECRET"
  export TEST_BASE TEST_LOG TEST_FAILURE= TEST_IMAGE=n8nio/n8n:2.26.9
}
new_case plan
"$DIR/install.sh" "$TEST_BASE" --reader-secret "$SECRET" --check > "$DIR/output"
[[ -f "$DIR/.local/compose.meter.yaml" ]]
! grep -Eq 'SENSITIVE_TEST_VALUE|forbidden-' "$DIR/output" "$DIR/.local/attach.env" "$DIR/.local/compose.meter.yaml" "$TEST_LOG"
! grep -Eq ' build | up | rm |preflight.mjs' "$TEST_LOG"
grep -Fq 'METER_BINDING=127.0.0.1:15678:8080' "$DIR/.local/attach.env"
"$DIR/install.sh" "$TEST_BASE" --status >/dev/null
printf 'changed\n' >> "$TEST_BASE"
if "$DIR/install.sh" "$TEST_BASE" --remove --yes >/dev/null 2>&1; then exit 1; fi
! grep -q ' rm ' "$TEST_LOG"
printf 'PASS: plan/status, no host runtimes, secret not copied, drift blocks removal\n'
new_case unsupported
export TEST_IMAGE=n8nio/n8n:latest
if "$DIR/install.sh" "$TEST_BASE" --reader-secret "$SECRET" --yes >/dev/null 2>&1; then exit 1; fi
! grep -Eq ' build | up | rm ' "$TEST_LOG"
printf 'PASS: unsupported version stops before mutation\n'
new_case preflight
export TEST_FAILURE=preflight
if "$DIR/install.sh" "$TEST_BASE" --reader-secret "$SECRET" --yes >/dev/null 2>&1; then exit 1; fi
! grep -q ' up ' "$TEST_LOG"
printf 'PASS: preflight failure does not restart n8n\n'
new_case recovery
export TEST_FAILURE=start
if "$DIR/install.sh" "$TEST_BASE" --reader-secret "$SECRET" --yes >/dev/null 2>&1; then exit 1; fi
grep -q 'rm -s -f n8nmeter-gateway n8nmeter' "$TEST_LOG"
last=$(tail -1 "$TEST_LOG")
[[ $last == *'up -d --no-deps n8n' && $last != *compose.meter.yaml* ]]
printf 'PASS: failed startup restores original n8n command\n'
new_case success
"$DIR/install.sh" "$TEST_BASE" --reader-secret "$SECRET" --yes > "$DIR/output"
grep -Fq '[5/5]' "$DIR/output"
"$DIR/install.sh" "$TEST_BASE" --remove --yes >/dev/null
! grep -Eq 'forbidden-| down | rm .* -v' "$TEST_LOG"
printf 'PASS: install/remove keep data volumes\n'
