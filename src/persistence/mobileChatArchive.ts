import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DATABASE_SCHEMA_VERSION, type LocalDataSnapshot } from "../domain";
import { normalizeSnapshot } from "./mobileChatDb";

const ARCHIVE_FORMAT = "mobilechat";
const ARCHIVE_VERSION = 1;

type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT;
  archiveVersion: typeof ARCHIVE_VERSION;
  schemaVersion: typeof DATABASE_SCHEMA_VERSION;
  appVersion: string;
  exportedAt: string;
  options: {
    includeCredentials: boolean;
    includeBlobs: boolean;
  };
};

type ArchiveChecksums = {
  algorithm: "sha-256";
  entries: Record<string, string>;
};

export type ArchiveOptions = {
  includeCredentials: boolean;
  includeBlobs?: boolean;
};

const parseJson = <T>(bytes: Uint8Array, entryName: string): T => {
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch {
    throw new Error(`${entryName} is not valid JSON.`);
  }
};

const toSortedJsonBytes = (value: unknown): Uint8Array =>
  strToU8(JSON.stringify(value, null, 2));

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  if (globalThis.crypto?.subtle) {
    const copy = new Uint8Array(bytes);
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      copy.buffer,
    );
    return toHex(new Uint8Array(digest));
  }

  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash.toString(16).padStart(8, "0");
};

const buildChecksums = async (
  entries: Record<string, Uint8Array>,
): Promise<ArchiveChecksums> => {
  const checksums: ArchiveChecksums = {
    algorithm: "sha-256",
    entries: {},
  };

  for (const [entryName, bytes] of Object.entries(entries)) {
    checksums.entries[entryName] = await sha256(bytes);
  }

  return checksums;
};

const assertSafeEntries = (entries: Record<string, Uint8Array>) => {
  for (const entryName of Object.keys(entries)) {
    if (
      entryName.startsWith("/") ||
      entryName.includes("..") ||
      entryName.includes("\\")
    ) {
      throw new Error(`Unsafe archive entry path: ${entryName}`);
    }
  }
};

const sanitizeSnapshot = (
  snapshot: LocalDataSnapshot,
  options: ArchiveOptions,
): LocalDataSnapshot => {
  const normalized = normalizeSnapshot(snapshot);

  return {
    ...normalized,
    blobs: options.includeBlobs ? normalized.blobs : [],
    apiProfiles: normalized.apiProfiles.map((profile) => ({
      ...profile,
      apiKey: options.includeCredentials ? profile.apiKey : "",
      models: profile.models.map((model) => ({ ...model })),
    })),
  };
};

export const createMobileChatArchive = async (
  snapshot: LocalDataSnapshot,
  options: ArchiveOptions,
): Promise<Blob> => {
  const exportedAt = new Date().toISOString();
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    archiveVersion: ARCHIVE_VERSION,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    appVersion: "0.0.0",
    exportedAt,
    options: {
      includeCredentials: options.includeCredentials,
      includeBlobs: Boolean(options.includeBlobs),
    },
  };
  const records = sanitizeSnapshot(snapshot, options);
  const entries: Record<string, Uint8Array> = {
    "manifest.json": toSortedJsonBytes(manifest),
    "records.json": toSortedJsonBytes(records),
  };
  entries["checksums.json"] = toSortedJsonBytes(await buildChecksums(entries));

  return new Blob([zipSync(entries)], {
    type: "application/vnd.mobilechat+zip",
  });
};

export const readMobileChatArchive = async (
  file: Blob,
): Promise<LocalDataSnapshot> => {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  assertSafeEntries(entries);

  const manifestEntry = entries["manifest.json"];
  const recordsEntry = entries["records.json"];
  const checksumsEntry = entries["checksums.json"];

  if (!manifestEntry || !recordsEntry || !checksumsEntry) {
    throw new Error("Archive is missing required entries.");
  }

  const manifest = parseJson<ArchiveManifest>(manifestEntry, "manifest.json");
  if (
    manifest.format !== ARCHIVE_FORMAT ||
    manifest.archiveVersion !== ARCHIVE_VERSION ||
    manifest.schemaVersion > DATABASE_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported .mobilechat archive version.");
  }

  const expected = parseJson<ArchiveChecksums>(
    checksumsEntry,
    "checksums.json",
  );
  for (const [entryName, expectedChecksum] of Object.entries(
    expected.entries,
  )) {
    const entry = entries[entryName];
    if (!entry) {
      throw new Error(
        `Archive checksum references missing entry: ${entryName}`,
      );
    }
    const actualChecksum = await sha256(entry);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`Archive checksum mismatch: ${entryName}`);
    }
  }

  const records = parseJson<LocalDataSnapshot>(recordsEntry, "records.json");
  return sanitizeSnapshot(records, {
    includeCredentials: manifest.options.includeCredentials,
    includeBlobs: manifest.options.includeBlobs,
  });
};

export const estimateArchiveSizeText = async (
  snapshot: LocalDataSnapshot,
): Promise<string> => {
  const previewBlob = await createMobileChatArchive(snapshot, {
    includeCredentials: false,
  });

  if (previewBlob.size < 1024) {
    return `${previewBlob.size} B`;
  }
  if (previewBlob.size < 1024 * 1024) {
    return `${(previewBlob.size / 1024).toFixed(1)} KB`;
  }
  return `${(previewBlob.size / 1024 / 1024).toFixed(1)} MB`;
};

export const createArchiveDownloadName = () => {
  const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
  return `mobilechat-${stamp}.mobilechat`;
};
