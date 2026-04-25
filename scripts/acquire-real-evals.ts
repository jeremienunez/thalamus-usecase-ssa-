#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

type Profile = "smoke" | "full";

interface EvalAsset {
  id: string;
  profiles: Profile[];
  url: string;
  path: string;
  type: string;
  expectedMd5?: string;
  expectedBytes?: number;
}

interface EvalDataset {
  id: string;
  domain: string;
  kind: string;
  purpose: string;
  sourceName: string;
  sourceUrl: string;
  license: string;
  assets: EvalAsset[];
}

interface EvalManifest {
  version: number;
  storageRoot: string;
  datasets: EvalDataset[];
}

interface LockEntry {
  datasetId: string;
  assetId: string;
  url: string;
  path: string;
  bytes: number;
  sha256: string;
  md5: string;
  etag: string | null;
  lastModified: string | null;
  downloadedAt: string;
}

interface Args {
  list: boolean;
  download: boolean;
  force: boolean;
  profile: Profile;
  outDir: string | null;
  datasetIds: Set<string> | null;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifestPath = resolve(repoRoot, "docs/evals/real-eval-manifest.json");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as EvalManifest;
  const selected = selectAssets(manifest, args);

  if (args.list || !args.download) {
    printSelection(manifest, selected, args.profile);
  }

  if (!args.download) {
    if (!args.list) {
      console.log("\nPass --download to fetch files.");
    }
    return;
  }

  const root = resolve(repoRoot, args.outDir ?? manifest.storageRoot);
  await mkdir(root, { recursive: true });

  const lockEntries: LockEntry[] = [];
  for (const item of selected) {
    const dest = resolve(root, item.asset.path);
    console.log(`asset ${item.dataset.id}/${item.asset.id}`);
    console.log(`  ${item.asset.url}`);
    const entry = await downloadAsset(item.dataset, item.asset, dest, args.force);
    lockEntries.push(entry);
    console.log(
      `  -> ${relativePath(repoRoot, dest)} ${formatBytes(entry.bytes)} sha256=${entry.sha256.slice(0, 12)}...`,
    );
  }

  const lockPath = resolve(root, "_manifest-lock.json");
  await writeFile(
    lockPath,
    `${JSON.stringify(
      {
        manifestVersion: manifest.version,
        profile: args.profile,
        generatedAt: new Date().toISOString(),
        entries: lockEntries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`lock ${relativePath(repoRoot, lockPath)}`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    list: false,
    download: false,
    force: false,
    profile: "smoke",
    outDir: null,
    datasetIds: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") args.list = true;
    else if (arg === "--download") args.download = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--profile") {
      const value = argv[++i];
      if (value !== "smoke" && value !== "full") {
        throw new Error(`Invalid --profile: ${value}`);
      }
      args.profile = value;
    } else if (arg === "--out") {
      args.outDir = argv[++i] ?? null;
    } else if (arg === "--dataset") {
      const value = argv[++i] ?? "";
      args.datasetIds = new Set(
        value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      );
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function selectAssets(
  manifest: EvalManifest,
  args: Args,
): Array<{ dataset: EvalDataset; asset: EvalAsset }> {
  const selected: Array<{ dataset: EvalDataset; asset: EvalAsset }> = [];
  const knownIds = new Set(manifest.datasets.map((d) => d.id));

  if (args.datasetIds) {
    for (const id of args.datasetIds) {
      if (!knownIds.has(id)) throw new Error(`Unknown dataset id: ${id}`);
    }
  }

  for (const dataset of manifest.datasets) {
    if (args.datasetIds && !args.datasetIds.has(dataset.id)) continue;
    for (const asset of dataset.assets) {
      if (asset.profiles.includes(args.profile)) {
        selected.push({ dataset, asset });
      }
    }
  }

  return selected;
}

function printSelection(
  manifest: EvalManifest,
  selected: Array<{ dataset: EvalDataset; asset: EvalAsset }>,
  profile: Profile,
): void {
  console.log(`real eval manifest v${manifest.version}`);
  console.log(`profile: ${profile}`);
  console.log(`assets: ${selected.length}`);
  for (const dataset of manifest.datasets) {
    const assets = selected.filter((item) => item.dataset.id === dataset.id);
    if (assets.length === 0) continue;
    console.log(`\n${dataset.id} [${dataset.domain}/${dataset.kind}]`);
    console.log(`  source: ${dataset.sourceName}`);
    console.log(`  purpose: ${dataset.purpose}`);
    for (const { asset } of assets) {
      const size = asset.expectedBytes ? ` ~${formatBytes(asset.expectedBytes)}` : "";
      console.log(`  - ${asset.id}${size}: ${asset.url}`);
    }
  }
}

async function downloadAsset(
  dataset: EvalDataset,
  asset: EvalAsset,
  dest: string,
  force: boolean,
): Promise<LockEntry> {
  await mkdir(dirname(dest), { recursive: true });

  if (!force) {
    try {
      const existing = await hashExistingFile(dest);
      return {
        datasetId: dataset.id,
        assetId: asset.id,
        url: asset.url,
        path: relativePath(repoRoot, dest),
        bytes: existing.bytes,
        sha256: existing.sha256,
        md5: existing.md5,
        etag: null,
        lastModified: null,
        downloadedAt: "existing-file",
      };
    } catch {
      // Download below.
    }
  }

  const response = await fetch(asset.url, {
    headers: {
      "user-agent": "interview-thalamus-sweep-eval-acquirer/1.0",
    },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to fetch ${asset.url}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const tmp = `${dest}.part`;
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      sha256.update(chunk);
      md5.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>),
      meter,
      createWriteStream(tmp),
    );
    const md5Hex = md5.digest("hex");
    if (asset.expectedMd5 && asset.expectedMd5 !== md5Hex) {
      throw new Error(
        `MD5 mismatch for ${asset.id}: expected ${asset.expectedMd5}, got ${md5Hex}`,
      );
    }
    await rename(tmp, dest);
    return {
      datasetId: dataset.id,
      assetId: asset.id,
      url: asset.url,
      path: relativePath(repoRoot, dest),
      bytes,
      sha256: sha256.digest("hex"),
      md5: md5Hex,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      downloadedAt: new Date().toISOString(),
    };
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function hashExistingFile(
  path: string,
): Promise<{ bytes: number; sha256: string; md5: string }> {
  const info = await stat(path);
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  await pipeline(
    createReadStream(path),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sha256.update(chunk);
        md5.update(chunk);
        callback(null, chunk);
      },
    }),
    new Writable({
      write(_chunk: Buffer, _encoding, callback) {
        callback();
      },
    }),
  );
  return {
    bytes: info.size,
    sha256: sha256.digest("hex"),
    md5: md5.digest("hex"),
  };
}

function printHelp(): void {
  console.log(`Usage:
  node --import tsx scripts/acquire-real-evals.ts --list
  node --import tsx scripts/acquire-real-evals.ts --download [--profile smoke|full]
  node --import tsx scripts/acquire-real-evals.ts --download --dataset arc-agi-2

Options:
  --list              Print selected assets.
  --download          Fetch selected assets.
  --profile <name>    smoke or full. Default: smoke.
  --dataset <ids>     Comma-separated dataset ids.
  --out <dir>         Output directory. Default: manifest storageRoot.
  --force             Re-download existing files.
`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function relativePath(root: string, target: string): string {
  return target.startsWith(root) ? target.slice(root.length + 1) : target;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
