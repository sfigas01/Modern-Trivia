---
name: Dependency upgrade constraints
description: Compatibility constraints encountered when updating security-sensitive transitive dependencies.
---

Keep a patched `qs` override until every parent permits the fixed minor release.

**Why:** Updating Express within its current major still left body-parser and Superagent resolving an older vulnerable `qs` minor. Updating the top-level dependency alone did not remove every vulnerable copy.

**How to apply:** Check the full installed dependency tree and all lockfiles after upgrades, not just direct package versions. Remove the override only when every parent resolves a safe version without it.

The workspace's npm 10 resolver failed on the `$esbuild` override reference during peer dependency resolution.

**Why:** The direct development dependency existed, but installation still failed with “Unable to resolve reference $esbuild.” An explicit matching version range resolved the failure.

**How to apply:** Keep the explicit override compatible with the direct esbuild range; reconsider the workaround when upgrading npm.