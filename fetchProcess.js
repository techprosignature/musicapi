const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const DATA_DIRECTORY = path.join(ROOT, "sacredmusic");
const LIBRARY_URL = "https://www.churchofjesuschrist.org/media/music?lang=eng";
const LANGUAGE = "eng";
const PAGE_SIZE = 500;
const CONCURRENCY = 4;
const AUDIO_PREFIX = "AUDIO_";

function fail(message) {
  throw new Error(message);
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "musicapi catalog mirror" } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw new Error(`Request failed after ${attempts} attempts: ${url}\n${lastError}`);
}

function parseRenderData(html) {
  const marker = "window.renderData=";
  const start = html.indexOf(marker);
  if (start === -1) fail("The music library page did not contain window.renderData");
  const scriptEnd = html.indexOf("</script>", start);
  if (scriptEnd === -1) fail("Could not find the end of window.renderData");
  const source = html.slice(start + marker.length, scriptEnd).trim().replace(/;$/, "");
  return JSON.parse(source);
}

function collectCollections(entry, collections = new Map()) {
  if (!entry || typeof entry !== "object") return collections;
  if (entry.$model === "musicLibraryItem") {
    if (!entry.slug || !entry.title) fail("A library item is missing its slug or title");
    if (!collections.has(entry.slug)) collections.set(entry.slug, entry);
    return collections;
  }
  for (const child of entry.entries || []) collectCollections(child, collections);
  return collections;
}

function songsUrl(slug, offset) {
  const identifier = JSON.stringify({
    lang: LANGUAGE,
    limit: PAGE_SIZE,
    offset,
    orderByKey: ["bookSongPosition"],
    bookQueryList: [slug],
  });
  const url = new URL("https://www.churchofjesuschrist.org/media/music/api");
  url.searchParams.set("type", "songsFilteredList");
  url.searchParams.set("lang", LANGUAGE);
  url.searchParams.set("identifier", identifier);
  url.searchParams.set("batchSize", "20");
  return url;
}

async function fetchCollection(slug) {
  const songs = [];
  let total = Infinity;
  while (songs.length < total) {
    const response = await fetchWithRetry(songsUrl(slug, songs.length));
    const page = await response.json();
    if (!Array.isArray(page.data) || !Number.isInteger(page.total)) {
      fail(`Collection ${slug} returned an unexpected response`);
    }
    if (page.data.length === 0 && songs.length < page.total) {
      fail(`Collection ${slug} stopped at ${songs.length} of ${page.total} songs`);
    }
    total = page.total;
    songs.push(...page.data);
  }
  if (songs.length !== total) {
    fail(`Collection ${slug} returned ${songs.length} songs but reported ${total}`);
  }
  return { data: songs, limit: PAGE_SIZE, offset: 0, total };
}

async function mapConcurrent(values, limit, task) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function people(items) {
  return (items || []).map((item) => item.personName).filter(Boolean);
}

function imageUrl(asset) {
  const thumbnail = asset.thumbnail;
  if (!thumbnail) return null;
  const preferred = (thumbnail.renditions || []).find((item) => item.width === 500);
  return preferred?.distributionUrl || thumbnail.distributionUrl || null;
}

function recordingLabel(type) {
  const labels = {
    AUDIO_ACCOMPANIMENT: "Accompaniment",
    AUDIO_ACCOMPANIMENT_GUITAR: "Guitar accompaniment",
    AUDIO_INSTRUMENTAL: "Instrumental",
    AUDIO_VOCAL: "Vocal",
    AUDIO_VOCAL_CHILDREN: "Children's vocal",
    AUDIO_VOCAL_CONGREGATION: "Congregational vocal",
    AUDIO_VOCAL_FAMILY: "Family vocal",
    AUDIO_VOCAL_YOUTH: "Youth vocal",
  };
  return labels[type] || type.slice(AUDIO_PREFIX.length).toLowerCase().replaceAll("_", " ");
}

function normalizeSong(song, collectionSlug) {
  const songId = `${collectionSlug}:${song.slug}`;
  const typeCounts = new Map();
  const recordings = (song.assets || [])
    .filter((asset) => asset.assetType?.startsWith(AUDIO_PREFIX) && asset.distributionUrl)
    .map((asset) => {
      const count = (typeCounts.get(asset.assetType) || 0) + 1;
      typeCounts.set(asset.assetType, count);
      const suffix = count === 1 ? "" : `:${count}`;
      return {
        id: `${songId}:${asset.assetType.toLowerCase()}${suffix}`,
        type: asset.assetType,
        label: recordingLabel(asset.assetType),
        url: asset.distributionUrl,
        durationMs: asset.duration || null,
        language: asset.lang || LANGUAGE,
        artworkUrl: imageUrl(asset),
      };
    });
  return {
    id: songId,
    slug: song.slug,
    title: song.title,
    subtitle: song.subtitle || null,
    number: song.songNumber || null,
    section: song.bookSectionTitle || null,
    date: song.songDate || null,
    artists: people(song.artists),
    authors: people(song.authors),
    composers: people(song.composers),
    arrangers: people(song.arrangers),
    tags: song.tags || [],
    recordings,
  };
}

async function validateSnapshot(directory) {
  const main = JSON.parse(await fs.readFile(path.join(directory, "main.json"), "utf8"));
  const root = main?.data?.libraryData;
  if (!root) fail("main.json does not contain data.libraryData");
  const collections = [...collectCollections(root).values()];
  if (collections.length === 0) fail("main.json contains no music collections");

  const songIds = new Set();
  let songs = 0;
  let playableSongs = 0;
  let recordings = 0;
  for (const collection of collections) {
    const file = path.join(directory, "api", `${collection.slug}.json`);
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(payload.data) || payload.total !== payload.data.length) {
      fail(`${collection.slug}.json is incomplete or malformed`);
    }
    for (const song of payload.data) {
      if (!song.slug || !song.title) fail(`${collection.slug} contains a song without a slug or title`);
      const id = `${collection.slug}:${song.slug}`;
      if (songIds.has(id)) fail(`Duplicate song ID: ${id}`);
      songIds.add(id);
      songs += 1;
      const audio = (song.assets || []).filter((asset) => asset.assetType?.startsWith(AUDIO_PREFIX));
      if (song.recordingAvailable && audio.length === 0) fail(`${id} claims a recording but has no audio asset`);
      for (const asset of audio) {
        if (!asset.distributionUrl?.startsWith("https://")) fail(`${id} has an invalid audio URL`);
      }
      if (audio.length > 0) playableSongs += 1;
      recordings += audio.length;
    }
  }
  return { collections: collections.length, songs, playableSongs, recordings };
}

async function validateCatalog(directory, rawStats) {
  const catalogDirectory = path.join(directory, "catalog");
  const index = JSON.parse(await fs.readFile(path.join(catalogDirectory, "index.json"), "utf8"));
  if (index.schemaVersion !== 1 || !Array.isArray(index.collections)) {
    fail("catalog/index.json has an unsupported or malformed schema");
  }

  const collectionIds = new Set();
  const songIds = new Set();
  let songs = 0;
  let playableSongs = 0;
  let recordings = 0;
  for (const collection of index.collections) {
    if (collectionIds.has(collection.id)) fail(`Duplicate catalog collection ID: ${collection.id}`);
    collectionIds.add(collection.id);
    if (collection.href !== `collections/${collection.slug}.json`) {
      fail(`Unsafe or unexpected catalog path for ${collection.id}`);
    }
    const payload = JSON.parse(await fs.readFile(path.join(catalogDirectory, collection.href), "utf8"));
    if (payload.schemaVersion !== 1 || payload.collection?.id !== collection.id || !Array.isArray(payload.songs)) {
      fail(`Malformed compact collection: ${collection.id}`);
    }
    if (payload.songs.length !== collection.songCount) fail(`Catalog song count mismatch: ${collection.id}`);
    for (const song of payload.songs) {
      if (song.id !== `${collection.id}:${song.slug}` || songIds.has(song.id)) {
        fail(`Invalid or duplicate catalog song ID: ${song.id}`);
      }
      songIds.add(song.id);
      songs += 1;
      playableSongs += Number(song.recordings.length > 0);
      for (const recording of song.recordings) {
        if (!recording.id?.startsWith(`${song.id}:`) || !recording.url?.startsWith("https://")) {
          fail(`Invalid compact recording for ${song.id}`);
        }
      }
      recordings += song.recordings.length;
    }
  }

  const stats = { collections: collectionIds.size, songs, playableSongs, recordings };
  for (const key of Object.keys(stats)) {
    if (stats[key] !== rawStats[key]) fail(`Raw and compact ${key} counts do not match`);
  }
  if (
    index.stats?.collectionCount !== stats.collections
    || index.stats?.songCount !== stats.songs
    || index.stats?.playableSongCount !== stats.playableSongs
  ) {
    fail("catalog/index.json summary counts do not match its collections");
  }
  return stats;
}

async function buildCatalog(directory) {
  const main = JSON.parse(await fs.readFile(path.join(directory, "main.json"), "utf8"));
  const collections = [...collectCollections(main.data.libraryData).values()];
  const catalogDirectory = path.join(directory, "catalog");
  const staging = path.join(directory, `.catalog-build-${process.pid}`);
  const backup = path.join(directory, `.catalog-backup-${process.pid}`);
  const collectionDirectory = path.join(staging, "collections");
  await fs.rm(staging, { recursive: true, force: true });

  try {
    await fs.mkdir(collectionDirectory, { recursive: true });
    const index = { schemaVersion: 1, language: LANGUAGE, collections: [] };
    for (const collection of collections) {
      const raw = JSON.parse(await fs.readFile(path.join(directory, "api", `${collection.slug}.json`), "utf8"));
      const songs = raw.data.map((song) => normalizeSong(song, collection.slug));
      const playableSongCount = songs.filter((song) => song.recordings.length > 0).length;
      const coverUrl = collection.bookThumbnail?.renditions?.find((item) => item.distributionUrl)?.distributionUrl
        || collection.bookThumbnail?.distributionUrl
        || null;
      const item = {
        id: collection.slug,
        slug: collection.slug,
        title: collection.title,
        coverUrl,
        sourceUrl: `https://www.churchofjesuschrist.org/media/music/collections/${collection.slug}?lang=eng`,
        songCount: songs.length,
        playableSongCount,
        href: `collections/${collection.slug}.json`,
      };
      index.collections.push(item);
      await fs.writeFile(
        path.join(collectionDirectory, `${collection.slug}.json`),
        `${JSON.stringify({ schemaVersion: 1, collection: item, songs })}\n`,
      );
    }
    index.stats = {
      collectionCount: index.collections.length,
      songCount: index.collections.reduce((sum, item) => sum + item.songCount, 0),
      playableSongCount: index.collections.reduce((sum, item) => sum + item.playableSongCount, 0),
    };
    await fs.writeFile(path.join(staging, "index.json"), `${JSON.stringify(index)}\n`);

    await fs.rm(backup, { recursive: true, force: true });
    let hadCatalog = true;
    try {
      await fs.rename(catalogDirectory, backup);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hadCatalog = false;
    }
    try {
      await fs.rename(staging, catalogDirectory);
    } catch (error) {
      if (hadCatalog) await fs.rename(backup, catalogDirectory);
      throw error;
    }
    if (hadCatalog) await fs.rm(backup, { recursive: true, force: true });
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function refresh() {
  const staging = path.join(ROOT, `.sacredmusic-refresh-${process.pid}`);
  const backup = path.join(ROOT, `.sacredmusic-backup-${process.pid}`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(path.join(staging, "api"), { recursive: true });
  try {
    const html = await (await fetchWithRetry(LIBRARY_URL)).text();
    const main = parseRenderData(html);
    const collections = [...collectCollections(main?.data?.libraryData).values()];
    console.log(`Refreshing ${collections.length} collections...`);
    await fs.writeFile(path.join(staging, "main.json"), `${JSON.stringify(main)}\n`);
    await mapConcurrent(collections, CONCURRENCY, async (collection, index) => {
      const payload = await fetchCollection(collection.slug);
      await fs.writeFile(
        path.join(staging, "api", `${collection.slug}.json`),
        `${JSON.stringify(payload, null, 2)}\n`,
      );
      console.log(`[${index + 1}/${collections.length}] ${collection.slug}: ${payload.total}`);
    });
    const stats = await validateSnapshot(staging);
    await buildCatalog(staging);
    await validateCatalog(staging, stats);
    await fs.rm(backup, { recursive: true, force: true });
    await fs.rename(DATA_DIRECTORY, backup);
    try {
      await fs.rename(staging, DATA_DIRECTORY);
    } catch (error) {
      await fs.rename(backup, DATA_DIRECTORY);
      throw error;
    }
    await fs.rm(backup, { recursive: true, force: true });
    console.log(`Published ${stats.collections} collections, ${stats.songs} songs, and ${stats.recordings} recordings.`);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const command = process.argv[2] || "refresh";
  if (command === "refresh") {
    await refresh();
  } else if (command === "validate") {
    const rawStats = await validateSnapshot(DATA_DIRECTORY);
    const stats = await validateCatalog(DATA_DIRECTORY, rawStats);
    console.log(`Valid: ${stats.collections} collections, ${stats.songs} songs, ${stats.recordings} recordings.`);
  } else if (command === "build") {
    const rawStats = await validateSnapshot(DATA_DIRECTORY);
    await buildCatalog(DATA_DIRECTORY);
    await validateCatalog(DATA_DIRECTORY, rawStats);
    console.log("Rebuilt sacredmusic/catalog from the checked-in mirror.");
  } else {
    fail(`Unknown command: ${command}. Use refresh, validate, or build.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
