#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
usage() {
  cat <<'HELP'
Usage: scripts/quick-start.sh compose|helm|k8s init|check|up|status|stop|render
Compose: N8N_METER_ENV_FILE (default .local/compose.env)
Helm/K8s: N8N_METER_VALUES (default .local/values.yaml), N8N_METER_NAMESPACE
          (default n8n), N8N_METER_RELEASE (default n8nmeter), N8N_METER_CONTEXT
init writes examples only; check/render never deploy; up explicitly deploys.
K8s render produces .local/n8nmeter.yaml using Helm, without contacting a cluster.
stop stops Compose or scales the Kubernetes collector/gateway to zero; data is kept.
HELP
}
need() { command -v "$1" >/dev/null || { echo "Required command: $1" >&2; exit 1; }; }
fail() { echo "$*" >&2; exit 1; }
mode=${1:-help}; action=${2:-help}
case "$mode" in compose|helm|k8s) ;; *) usage; exit 0;; esac
mkdir -p .local
if [[ "$mode" == compose ]]; then
  config=${N8N_METER_ENV_FILE:-.local/compose.env}
  if [[ "$action" == init ]]; then
    [[ ! -e "$config" ]] || fail "Already exists: $config (not overwritten)"
    cp .env.example "$config"
    echo "Edit $config: existing network, n8n upstream, DB reader settings, and local secret file paths."
    exit 0
  fi
  [[ -f "$config" ]] || fail "Run $0 compose init first."
  need docker
  compose=(docker compose --project-directory "$ROOT" --env-file "$config" -f compose.yaml)
  case "$action" in
    check) "${compose[@]}" config --quiet; echo 'Compose configuration valid; DB/network access not checked.';;
    up) "${compose[@]}" config --quiet; "${compose[@]}" up -d --build --wait --wait-timeout 120;;
    status) "${compose[@]}" ps;;
    stop) "${compose[@]}" stop;;
    *) usage; exit 1;;
  esac
else
  config=${N8N_METER_VALUES:-.local/values.yaml}
  namespace=${N8N_METER_NAMESPACE:-n8n}
  release=${N8N_METER_RELEASE:-n8nmeter}
  if [[ "$action" == init ]]; then
    [[ ! -e "$config" ]] || fail "Already exists: $config (not overwritten)"
    cp examples/values.existing-n8n.yaml "$config"
    echo "Edit $config. Secret names refer to existing Secrets in namespace $namespace."
    exit 0
  fi
  [[ -f "$config" ]] || fail "Run $0 $mode init first."
  need helm
  render() {
    helm lint helm -f "$config"
    helm template "$release" helm -n "$namespace" -f "$config" > .local/n8nmeter.yaml.tmp
    mv .local/n8nmeter.yaml.tmp .local/n8nmeter.yaml
    echo 'Rendered .local/n8nmeter.yaml (no cluster mutation).'
  }
  case "$action" in
    check|render) render; exit 0;;
    up|status|stop) ;;
    *) usage; exit 1;;
  esac
  need kubectl
  kube=(kubectl)
  helm_context=()
  if [[ -n "${N8N_METER_CONTEXT:-}" ]]; then
    kube+=(--context "$N8N_METER_CONTEXT")
    helm_context+=(--kube-context "$N8N_METER_CONTEXT")
  fi
  echo "Target context: ${N8N_METER_CONTEXT:-$(kubectl config current-context)} namespace: $namespace release: $release"
  case "$action" in
    up)
      render
      "${kube[@]}" get namespace "$namespace" >/dev/null
      if [[ "$mode" == helm ]]; then
        helm upgrade --install "$release" ./helm "${helm_context[@]}" -n "$namespace" -f "$config" --wait --timeout 3m
      else
        "${kube[@]}" -n "$namespace" apply --dry-run=server -f .local/n8nmeter.yaml >/dev/null
        "${kube[@]}" -n "$namespace" apply -f .local/n8nmeter.yaml
      fi
      "${kube[@]}" -n "$namespace" rollout status "deployment/$release" --timeout=180s
      ;;
    status) "${kube[@]}" -n "$namespace" get deployment,service,pvc -l "app.kubernetes.io/instance=$release";;
    stop) "${kube[@]}" -n "$namespace" scale "deployment/$release" --replicas=0;;
  esac
fi
