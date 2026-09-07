# Instructions for AI agents

## Repository purpose

This repository is a read-only metadata mirror and catalog builder for static music clients. It must never contain downloaded audio, authentication material, or a runtime proxy. The Church hosts the media; this repository records public metadata and HTTPS URLs.

## Working rules

- Read `README.md` and inspect `git status` before editing.
- Preserve unrelated user changes. Do not rewrite or discard generated snapshots unless the task requires a refresh or catalog rebuild.
- Treat `fetchProcess.js` as the source of truth. Files under `sacredmusic/` are generated outputs and should not be edited by hand.
- Keep the project dependency-free unless a requested change cannot reasonably be implemented with Node.js built-ins.
- Preserve the public `/sacredmusic/main.json` and `/sacredmusic/api/<slug>.json` paths for existing consumers.
- Keep app-facing data under `/sacredmusic/catalog/` and bump `schemaVersion` for breaking field or identity changes.
- Maintain stable song IDs (`<collection-slug>:<song-slug>`). If upstream identifiers change, add an explicit migration strategy before changing stored IDs.
- Never select a recording by array position. Recording type and listener preference determine playback defaults.
- Do not copy audio or artwork into the repository. Do not claim that availability implies permission to redistribute or reuse an asset.

## Verification

Use Node.js 22 or newer.

```sh
npm run validate
npm run build
git diff --check
```

After `npm run build`, run `npm run validate` again and inspect the generated diff. For importer changes, use `npm run refresh` only when network access and an upstream refresh are part of the task. A refresh must be all-or-nothing: failures must leave the last valid `sacredmusic/` snapshot in place.

Workflow changes must retain this order: refresh when appropriate, rebuild, validate, verify generated output on pushes, commit the exact scheduled snapshot, prepare the Pages artifact, then deploy. Scheduled refresh commits made with `GITHUB_TOKEN` do not trigger a second push workflow, so the originating run must perform deployment itself.

## Change notes

In handoff summaries, state whether the work changed importer behavior, raw mirrored data, compact catalog schema, or public URLs. Report validation results and any checks that could not run.
