# musicapi

`musicapi` mirrors public metadata and media URLs exposed by the Church of Jesus Christ of Latter-day Saints music library. It also produces a smaller, stable catalog for static clients such as Living Music.

This is an independent project. It is not an official Church API and is not affiliated with or endorsed by The Church of Jesus Christ of Latter-day Saints.

## Published data

GitHub Pages preserves the existing `/sacredmusic/` URL structure.

| Path | Purpose |
| --- | --- |
| `sacredmusic/main.json` | Raw library hierarchy mirrored from the source page |
| `sacredmusic/api/<collection>.json` | Raw response for one collection |
| `sacredmusic/catalog/index.json` | Compact list of collections and counts for apps |
| `sacredmusic/catalog/collections/<collection>.json` | Normalized songs and recordings for one collection |

Apps should start with `catalog/index.json`, then load only the selected collection. The catalog schema has an integer `schemaVersion`; consumers must reject unsupported major versions rather than guessing.

Song IDs use `<collection-slug>:<song-slug>`. Store favorites by song ID. Recording IDs add the normalized recording type. Media remains hosted by the Church; this repository stores URLs and metadata, not audio files.

## Commands

Node.js 22 or newer is required. There are no package dependencies.

```sh
npm run validate
npm run build
npm run refresh
```

- `validate` checks that every advertised collection exists, totals match, song IDs are unique, audio URLs are HTTPS, and the compact catalog agrees with the raw mirror.
- `build` regenerates the compact catalog from the checked-in raw mirror without network access.
- `refresh` downloads a complete snapshot into a temporary directory, validates it, builds the compact catalog, and only then replaces `sacredmusic/`.

Run `npm run validate` after any data or importer change. Do not hand-edit generated files under `sacredmusic/`; fix the transformation and rebuild instead.

## Automation

The `Refresh and publish catalog` workflow runs daily and can be started manually. Scheduled and manual runs refresh, rebuild, validate, commit changed data, and deploy that exact snapshot. Pushes to `main` rebuild and validate without contacting the upstream service; deployment stops if the committed compact catalog is stale.

The workflow uploads only published data and keeps the historical `/sacredmusic/` prefix. In repository settings, GitHub Pages must use **GitHub Actions** as its source.

## Consumer guidance

- Treat this repository as a cache that can occasionally be unavailable or stale.
- Prefer `AUDIO_VOCAL`, `AUDIO_INSTRUMENTAL`, or audience-specific vocal recordings for everyday listening. Do not assume the first recording is the best default; accompaniment is frequently first in the source data.
- Show a recording selector when multiple versions exist.
- Keep an official source link in the interface and handle removed songs or changed media URLs.
- Test browser playback, seeking, and cross-origin behavior against representative live URLs before release.
- Do not infer reuse rights from public availability. Review applicable source terms and asset-specific rights before publishing an app that uses this data or artwork.

## Maintenance notes

The importer intentionally limits concurrency and retries transient request failures. Collection pagination continues until the reported total is reached. Any incomplete or malformed collection fails the run, leaving the previously published snapshot untouched.

The raw mirror is retained for debugging and provenance. The compact catalog is the supported application-facing shape. Breaking changes require a new `schemaVersion` and a migration note in this README.
