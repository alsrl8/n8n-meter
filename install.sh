#!/usr/bin/env bash
# Host requirements: Bash, standard Unix utilities, Docker Compose. No JSON/YAML parser.
set -euo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
STATE="$ROOT/.local/attach.env"
OVERLAY="$ROOT/.local/compose.meter.yaml"
mode=install; yes=false; service=n8n; reader=n8nmeter_reader; secret=
fail() { printf '중단: %s\n' "$*" >&2; exit 1; }
step() { printf '[%s/5] %s\n' "$1" "$2"; }
usage() {
  cat <<'HELP'
./install.sh COMPOSE [--service n8n] [--reader-secret FILE] [--reader-user USER]
                    [--check | --status | --remove] [--yes]
기존 주소·기존 로그인 유지. --check는 변경 계획만 확인합니다.
--remove는 원래 연결을 복구하며 통계 데이터는 보존합니다.
호스트에 Python, Node.js, jq 또는 설치용 컨테이너가 필요하지 않습니다.
HELP
}
[[ ${1:-} != --help && $# -gt 0 ]] || { usage; exit 0; }
input=$1; shift
while (($#)); do
  case "$1" in
    --service|--reader-secret|--reader-user)
      (($# >= 2)) || fail "$1 값이 필요합니다."
      case "$1" in --service) service=$2;; --reader-secret) secret=$2;; --reader-user) reader=$2;; esac; shift 2;;
    --check|--status|--remove) [[ $mode == install ]] || fail '작업 옵션은 하나만 지정하세요.'; mode=${1#--}; shift;;
    --yes) yes=true; shift;;
    *) fail "알 수 없는 옵션: $1";;
  esac
done
[[ -f "$input" ]] || fail '기존 Compose 파일을 지정하세요.'
BASE=$(cd -- "$(dirname -- "$input")" && printf '%s/%s' "$(pwd -P)" "$(basename -- "$input")")
SUM=$(cksum < "$BASE")
command -v docker >/dev/null || fail 'Docker Compose가 필요합니다.'
base=(docker compose --project-directory "${BASE%/*}" -f "$BASE")
keys='METER_ROOT METER_BASE METER_SUM METER_PROJECT METER_SERVICE METER_NETWORK METER_N8N_PORT METER_BINDING METER_DB_HOST METER_DB_PORT METER_DB_NAME METER_DB_SCHEMA METER_DB_PREFIX METER_READER_USER METER_READER_SECRET'
load_state() {
  [[ -f "$STATE" ]] || fail '이 체크아웃에 설치 기록이 없습니다.'
  # Data only: never source/eval a saved configuration.
  while IFS='=' read -r key value; do
    case " $keys " in *" $key "*) export "$key=$value";; *) fail '설치 기록 형식을 확인하세요.';; esac
  done < "$STATE"
  [[ ${METER_BASE:-} == "$BASE" && ${METER_SUM:-} == "$SUM" ]] || fail 'Compose 경로/내용이 바뀌었습니다. 저장된 구성을 먼저 확인하세요.'
  [[ ${METER_ROOT:-} == "$ROOT" ]] || fail '설치 디렉터리가 이동했습니다. 저장된 경로를 먼저 확인하세요.'
  [[ -n ${METER_PROJECT:-} && -n ${METER_SERVICE:-} ]] || fail '설치 기록이 불완전합니다.'
}
confirm() { $yes && return 0; [[ -t 0 ]] || fail '비대화형 실행은 --yes를 지정하세요.'; read -r -p '이 구성으로 진행할까요? [y/N] ' answer; [[ $answer == y || $answer == Y ]]; }
run() {
  local label=$1 pid tick=0 status=0; shift
  printf '  %s\n' "$label"
  "$@" > "$ROOT/.local/command.log" 2>&1 & pid=$!
  trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; return 130' INT TERM
  while kill -0 "$pid" 2>/dev/null; do
    sleep 1; tick=$((tick+1))
    if ((tick % 8 == 0)); then printf '  %s 진행 중 · %s초\n' "$label" "$tick"; fi
  done
  wait "$pid" || status=$?
  trap - INT TERM
  # Compose/build logs may contain environment-dependent text; do not echo them.
  rm -f "$ROOT/.local/command.log"
  if ((status)); then printf '  실패: %s (exit %s)\n' "$label" "$status" >&2; return "$status"; fi
}
rollback() {
  run '추가 서비스 정리' "${combined[@]}" rm -s -f n8nmeter-gateway n8nmeter &&
  run '원래 n8n 포트 복구' "${base[@]}" -p "$METER_PROJECT" up -d --no-deps "$METER_SERVICE"
}
if [[ $mode == status || $mode == remove ]]; then
  load_state
  combined=("${base[@]}" -p "$METER_PROJECT" -f "$OVERLAY")
  if [[ $mode == status ]]; then "${combined[@]}" ps "$METER_SERVICE" n8nmeter n8nmeter-gateway; exit; fi
  printf '추가 기능만 제거합니다. n8n은 잠시 재시작되며 통계 데이터는 보존합니다.\n'
  confirm || exit 0
  rollback || fail '자동 복구 실패. 기존 Compose로 n8n 서비스를 복구하세요.'
  printf '복구 완료. 기존 n8n 주소를 사용하세요.\n'; exit 0
fi
step 1 'Docker Compose와 실행 중인 n8n 확인'
version=$(docker compose version --short)
IFS=. read -r major minor patch <<< "${version#v}"
[[ $major =~ ^[0-9]+$ && $minor =~ ^[0-9]+$ && ${patch:-} =~ ^[0-9]+$ ]] || fail 'Compose 버전을 확인하지 못했습니다.'
((major>2 || (major==2 && (minor>24 || (minor==24 && patch>=4))))) || fail 'Docker Compose 2.24.4 이상이 필요합니다.'
[[ $service =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || fail '서비스 이름을 확인하세요.'
[[ $reader =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail '읽기 계정 이름을 확인하세요.'
if [[ -f "$STATE" ]]; then load_state; service=$METER_SERVICE; fi
container=$("${base[@]}" ps -q "$service")
[[ -n $container && $container != *$'\n'* ]] || fail '실행 중인 단일 n8n이 필요합니다. 서비스명이 다르면 --service로 지정하세요.'
inspect() { docker inspect --format "$1" "$container"; }
env_value() {
  local line
  line=$(inspect "{{range .Config.Env}}{{if eq (index (split . \"=\") 0) \"$1\"}}{{println .}}{{end}}{{end}}")
  printf '%s' "${line#*=}"
}
image=$(inspect '{{.Config.Image}}')
[[ $image == */n8n:2.26.9 || $image == n8n:2.26.9 ]] || fail '간편 설치 검증 대상은 n8n 2.26.9입니다.'
[[ $(env_value DB_TYPE) == postgresdb ]] || fail 'PostgreSQL n8n만 지원합니다.'
[[ $(env_value EXECUTIONS_MODE) != queue && $(env_value DB_POSTGRESDB_SSL_ENABLED) != true ]] || fail 'queue/DB TLS 구성은 고급 설치를 사용하세요.'
value=$(env_value N8N_PATH); [[ -z $value || $value == / ]] || fail '서브경로는 고급 설치를 사용하세요.'
value=$(env_value N8N_PROTOCOL); [[ -z $value || $value == http ]] || fail 'HTTP n8n만 간편 설치를 지원합니다.'
files=$(inspect '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
[[ $files == "$BASE" || $files == "$BASE,$OVERLAY" ]] || fail '여러 Compose 파일을 사용하는 환경은 자동 변경하지 않습니다.'
METER_PROJECT=$(inspect '{{index .Config.Labels "com.docker.compose.project"}}')
[[ $METER_PROJECT =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'Compose 프로젝트를 확인하지 못했습니다.'
services=$("${base[@]}" config --services)
while IFS= read -r name; do [[ $name != n8nmeter && $name != n8nmeter-gateway ]] || fail '추가 서비스 이름이 기존 설정과 충돌합니다.'; done <<< "$services"
METER_NETWORK=$(inspect '{{range $name, $settings := .NetworkSettings.Networks}}{{println $name}}{{end}}')
[[ -n $METER_NETWORK && $METER_NETWORK != *$'\n'* && $METER_NETWORK != host && $METER_NETWORK != none ]] || fail '하나의 Docker 네트워크에 연결된 n8n만 지원합니다.'
METER_N8N_PORT=$(env_value N8N_PORT); METER_N8N_PORT=${METER_N8N_PORT:-5678}
if [[ ! -f "$STATE" ]]; then
  [[ $(inspect '{{len .HostConfig.PortBindings}}') == 1 ]] || fail '고정 공개 포트 하나가 필요합니다.'
  binding=$(inspect "{{range index .HostConfig.PortBindings \"$METER_N8N_PORT/tcp\"}}{{printf \"%s|%s\\n\" .HostIp .HostPort}}{{end}}")
  [[ -n $binding && $binding != *$'\n'* ]] || fail '공개 포트를 확인하지 못했습니다.'
  IFS='|' read -r ip port <<< "$binding"
  [[ $port =~ ^[0-9]+$ ]] && ((port>0 && port<=65535)) || fail '고정 공개 포트가 필요합니다.'
  if [[ -z $ip ]]; then METER_BINDING="$port:8080"; elif [[ $ip == *:* ]]; then METER_BINDING="[$ip]:$port:8080"; else METER_BINDING="$ip:$port:8080"; fi
fi
METER_ROOT=$ROOT; METER_BASE=$BASE; METER_SUM=$SUM; METER_SERVICE=$service
METER_DB_HOST=$(env_value DB_POSTGRESDB_HOST)
[[ -n $METER_DB_HOST ]] || fail 'DB 주소를 확인하지 못했습니다.'
METER_DB_PORT=$(env_value DB_POSTGRESDB_PORT); METER_DB_PORT=${METER_DB_PORT:-5432}
METER_DB_NAME=$(env_value DB_POSTGRESDB_DATABASE); METER_DB_NAME=${METER_DB_NAME:-n8n}
METER_DB_SCHEMA=$(env_value DB_POSTGRESDB_SCHEMA); METER_DB_SCHEMA=${METER_DB_SCHEMA:-public}
METER_DB_PREFIX=$(env_value DB_TABLE_PREFIX)
METER_READER_USER=$reader
step 2 '연결 구성 확인'
printf '  n8n: %s · 기존 포트 연결: %s\n  DB: %s / %s · 읽기 계정: %s\n' "$service" "${METER_BINDING%:8080}" "$METER_DB_HOST" "$METER_DB_NAME" "$reader"
secret=${secret:-${METER_READER_SECRET:-}}
if [[ -z $secret && -t 0 ]]; then read -r -p '  읽기 계정 비밀번호 파일 경로: ' secret; fi
[[ -f $secret && -s $secret ]] || fail '--reader-secret에 기존 읽기 계정 비밀번호 파일을 지정하세요.'
METER_READER_SECRET=$(cd -- "$(dirname -- "$secret")" && printf '%s/%s' "$(pwd -P)" "$(basename -- "$secret")")
mkdir -p "$ROOT/.local"
: > "$STATE.tmp"
for key in $keys; do
  value=${!key}; [[ $value != *$'\n'* && $value != *$'\r'* ]] || fail '설정값에 줄바꿈을 사용할 수 없습니다.'
  export "$key=$value"; printf '%s=%s\n' "$key" "$value" >> "$STATE.tmp"
done
sed "s/^  N8N_SERVICE:/  $service:/" "$ROOT/examples/compose.attach.yaml" > "$OVERLAY"
combined=("${base[@]}" -p "$METER_PROJECT" -f "$OVERLAY")
"${combined[@]}" config --quiet
mv "$STATE.tmp" "$STATE"
printf '  추가: 수집기 + 화면 연결기 · 기존 주소/로그인 유지\n  원본 Compose 수정 없음 · 포트 전환 시 잠시 재시작\n  구성 파일: %s\n' "$OVERLAY"
[[ $mode != check ]] || { printf '계획 확인 완료. 실행 중인 서비스는 변경하지 않았습니다.\n'; exit 0; }
confirm || exit 0
step 3 '이미지 준비와 읽기 전용 DB 검사'
run '이미지 준비' "${combined[@]}" build n8nmeter n8nmeter-gateway || fail '이미지 준비 실패. n8n은 변경하지 않았습니다.'
run '읽기 계정 검사' "${combined[@]}" run --rm --no-deps n8nmeter node preflight.mjs || fail 'DB 주소·읽기 계정·파일 권한을 확인하세요. n8n은 변경하지 않았습니다.'
step 4 '기존 주소에 연결'
if ! run 'n8n 포트 전환' "${combined[@]}" up -d --no-deps "$service" ||
   ! run '추가 기능 시작' "${combined[@]}" up -d --no-deps --wait --wait-timeout 120 n8nmeter n8nmeter-gateway; then
  printf '연결 실패. 원래 포트로 복구합니다.\n'
  rollback || fail '자동 복구 실패. 원본 Compose로 n8n을 복구하세요.'
  fail '설치는 완료되지 않았으며 원래 n8n 포트를 복구했습니다.'
fi
step 5 '완료 · 기존 n8n 화면을 새로고침하세요'
printf '상태: ./install.sh %q --status\n복구: ./install.sh %q --remove\n' "$BASE" "$BASE"
