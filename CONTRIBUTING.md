# Contributing to n8n Meter

n8n Meter is an independent server-side n8n add-on. Keep the collector and gateway independently deployable. Source: https://github.com/alsrl8/n8n-meter. Public container images are not published yet.

- Keep gateway, collector and environment configuration separate. No n8n image patches or Docker socket mounts.
- Keep DB collection read-only. Do not relax role checks to make an installation pass. Never commit passwords, snapshots, browser session data or workflow captures.
- Use exact workflow IDs; missing data must remain unknown. Do not label source statistics as final billed executions.
- For UI/adapter changes follow [COMPATIBILITY.md](COMPATIBILITY.md). Report the actual tested n8n version and whether verification used a fixture or an authenticated page.
- Run `npm test`, `bash -n scripts/quick-start.sh`, Compose validation, Helm lint/render and the relevant gateway/browser checks. Do not apply to shared clusters as part of a test.
- Keep installation examples, quick-start and rollback instructions aligned with the final files. Changes should work with a separate existing n8n installation.

An issue report should include versions, install mode, symptom, sanitized error code and reproduction steps. Omit DB secrets, execution payloads and unredacted workflow names. Record supported versions and evidence when creating a release; publish images only after release checks and maintainer review.
