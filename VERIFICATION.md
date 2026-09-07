# Verification evidence

Initial source publication, 2026-09-07.

- n8n 2.26.9 PostgreSQL statistics source and deployed UI/Vue component structure inspected.
- 9 core/HTTP tests passed, including auth, BigInt counters, snapshot persistence and discontinuity behavior.
- Compose configuration and Bash syntax validated. Helm lint and template rendering passed for the Helm and plain Kubernetes quick-start paths.
- Gateway image built locally. Isolated synthetic-container smoke test passed: unauthorized/wrong-password 401, authenticated HTML injection, summary retrieval, static UI script delivery, internal auth endpoint protection, UID 1000/read-only sidecar execution.
- Production Vue fixture with Chrome extension passed always-visible button, ID binding, duplicate names, unknown counts, click isolation, keyboard behavior and mobile bounds.

Not verified: real continuous DB collection with a dedicated reader, authenticated n8n through the packaged gateway, TLS/SSO/WebSocket integration, actual Kubernetes rollout, public image distribution or final billing reconciliation. Synthetic fixtures and Helm rendering do not establish those outcomes. CI status must be read from the repository checks.

Run the upgrade checks in [COMPATIBILITY.md](COMPATIBILITY.md) before claiming support for an n8n version.
