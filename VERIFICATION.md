# Verification evidence

Initial source publication, 2026-09-07.

- n8n 2.26.9 PostgreSQL statistics source and deployed UI/Vue component structure inspected.
- 9 core/HTTP tests passed, including auth, BigInt counters, snapshot persistence and discontinuity behavior.
- Compose configuration and Bash syntax validated. Helm lint and template rendering passed for the Helm and plain Kubernetes quick-start paths.
- Gateway image built locally. Isolated synthetic-container smoke test passed: unauthorized/wrong-password 401, authenticated HTML injection, summary retrieval, static UI script delivery, internal auth endpoint protection, UID 1000/read-only sidecar execution.
- Production Vue fixture with Chrome extension passed always-visible button, ID binding, duplicate names, unknown counts, click isolation, keyboard behavior and mobile bounds.

Not verified: real continuous DB collection with a dedicated reader, authenticated n8n through the packaged gateway, TLS/SSO/WebSocket integration, actual Kubernetes rollout, public image distribution or final billing reconciliation. Synthetic fixtures and Helm rendering do not establish those outcomes. CI status must be read from the repository checks.

Run the upgrade checks in [COMPATIBILITY.md](COMPATIBILITY.md) before claiming support for an n8n version.

## Simplified installation work

- Added `install.sh`: five progress stages, elapsed-time messages, readable plan, unchanged source Compose, same-port override, preflight reader check before n8n recreation, status and removal, and recovery on connection failure. Automatic support is limited to a single Compose file, n8n 2.26.9, PostgreSQL, root HTTP and one published port.
- Gateway no longer requires an additional login. Collector verifies existing n8n `/rest/login` sessions for global owner/admin, including MFA completion. Source response semantics inspected in the deployed 2.26.9 auth controller and user service.
- README now has a compact quick-start and Mermaid architecture diagram; advanced database/Helm details moved out of the primary flow.
- Passed: 10 Node core/HTTP/session tests; Python installer plan/rejection/recovery tests; real Docker Compose merge validation with a synthetic configuration (same host port, no original n8n host binding, no copied password); Helm lint/render; isolated gateway/collector synthetic-session integration.
- Not executed: installer apply/remove against a real n8n deployment, real dedicated-reader collection, real administrator browser session through the new gateway, cluster rollout or TLS/SSO/WebSocket validation. The current 7811 snapshot PoC was not restarted by this change.

## Shell-only installer

- Removed the Python installer and its Python tests. The host entry point is now Bash with a fixed Compose attachment template and Docker's built-in metadata queries. No Python, Node, jq/yq or installer container is invoked by the installation script.
- Shell regression checks passed for plan/status, changed-source protection, unsupported-version rejection, preflight failure before restart, startup failure recovery and install/remove with volume preservation. Fake Python/Node/jq/yq commands fail the tests if invoked.
- Real Docker metadata lookup and Compose merge passed against an isolated sleep-container fixture using the existing n8n image. The test used a synthetic credential file and confirmed that its contents were not copied to generated configuration. The fixture was removed afterward.
- Existing n8n/DB and local 7811 preview were not modified. Real reader collection and live install/remove remain unverified.
