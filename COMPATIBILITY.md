# n8n compatibility contract

n8n Meter depends on internal n8n UI and database structures. An n8n upgrade can break it even when n8n itself starts normally. Pin both n8n and n8n Meter versions; test before upgrading the operator endpoint.

## Adapter inventory

- Source semantics inspected: n8n 2.26.9 / PostgreSQL.
- UI: WorkflowCard Vue component, its `props.data.id`, Vue mount VNode tree, `.card`, `workflow-card-actions` and `workflow-card-name` markers.
- n8n Meter uses its own `data-n8nmeter-card` marker because the parent list can override n8n's card test attribute.
- Missing IDs/rows are unknown, not zero. Names must never substitute for IDs.
- DB: `workflow_statistics` count/rootCount and Insights raw/period tables. An unchanged schema alone does not prove unchanged billing semantics.

## Before releasing or upgrading

1. Record actual n8n image tag/digest, PostgreSQL version and n8n Meter commit/images. Never infer installed version from configured N8N_VERSION alone.
2. Verify installed n8n license-metrics and statistics implementations; record execution modes and statuses, especially Error Workflow and subworkflow behavior.
3. Run core/HTTP tests and the production Vue regression fixture. These are not an authenticated end-to-end test.
4. Open the actual authenticated workflow list through the gateway. Verify all visible rows have an always-visible usage button, with no hover needed. Capture a screenshot only with non-sensitive workflow names.
5. Verify pagination, filtering, folders/projects, SPA navigation, identical workflow names with different IDs, unknown statistics, keyboard access, mobile bounds, and row-menu behavior.
6. Compare one known workflow against read-only source statistics. Validate stale/error states. Do not execute customer workflows solely for tests without authorization.
7. Verify unauthenticated gateway and statistics requests return 401, authenticated page loads, WebSocket connection works, and original n8n/webhook paths still work directly.
8. Verify deployment rendering, readiness, previous-image rollback and SQLite preservation. Mark CI, local container runtime and actual cluster rollout separately.

For SSO, CSP, subpath installations or a different n8n version, record the unverified boundary. Do not disable n8n security headers or claim compatibility from a fixture alone. If an adapter fails, use the original n8n address and leave metrics unavailable rather than inventing counts.
