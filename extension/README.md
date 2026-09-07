# Optional Chrome extension prototype

The default installation is the [server gateway](../README.md); no Chrome extension is required. These scripts also remain loadable as an experimental unpacked Manifest V3 extension for development.

The extension prototype uses local n8n origins on ports 7811/15679 and a collector on 7810. It is not a general-purpose authenticated remote connector. Use the server installation for normal deployments.

The workflow usage button is always visible next to the existing action menu. The bridge reads WorkflowCard IDs from the Vue component tree; missing IDs or statistics remain unknown. See [compatibility requirements](../COMPATIBILITY.md).

The optional browser fixture requires a separately prepared local n8n 2.26.9 at 127.0.0.1:7811, a local snapshot collector at 7810 and an installed Playwright module. Run `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/verify-workflow-rows.mjs` from the repository root. It is a fixture test, not an authenticated end-to-end test.
