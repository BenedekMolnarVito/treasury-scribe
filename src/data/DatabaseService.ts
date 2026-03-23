/**
 * DatabaseService.ts
 *
 * Initialises sql.js (SQLite compiled to WebAssembly) and creates all
 * required application tables with their constraints, defaults, and indexes.
 * All CREATE TABLE statements use IF NOT EXISTS so that calling `initDatabase`
 * more than once is safe (idempotent).
 */

import initSqlJs, { type Database } from "sql.js";

export const DATABASE_STORAGE_KEY = "treasury-scribe.sqlite";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** SQL DDL executed on every call to {@link initDatabase}. */
const CREATE_TABLES_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Transactions (
  Id                INTEGER PRIMARY KEY AUTOINCREMENT,
  RawContent        TEXT,
  JsonContent       TEXT,
  ReceivedAt        TEXT    NOT NULL,
  NotificationTitle TEXT,
  NotificationBody  TEXT,
  PackageName       TEXT,
  IsDeleted         INTEGER NOT NULL DEFAULT 0,
  IsCash            INTEGER NOT NULL DEFAULT 0,
  Amount            REAL,
  Currency          TEXT,
  IsIncome          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Tags (
  Id         INTEGER PRIMARY KEY AUTOINCREMENT,
  Name       TEXT NOT NULL,
  LastUsedAt TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name
  ON Tags (Name);

CREATE TABLE IF NOT EXISTS TransactionTags (
  Id            INTEGER PRIMARY KEY AUTOINCREMENT,
  TransactionId INTEGER NOT NULL
    REFERENCES Transactions (Id) ON DELETE CASCADE,
  TagId         INTEGER NOT NULL
    REFERENCES Tags (Id) ON DELETE CASCADE,
  CreatedAt     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_tags_unique
  ON TransactionTags (TransactionId, TagId);
`;

function getSqlJsConfig(
  wasmBinaryOrPath?: string | ArrayBuffer
): Parameters<typeof initSqlJs>[0] {
  const config: Parameters<typeof initSqlJs>[0] = {};

  if (typeof wasmBinaryOrPath === "string") {
    config.locateFile = () => wasmBinaryOrPath;
  } else if (wasmBinaryOrPath instanceof ArrayBuffer) {
    config.wasmBinary = wasmBinaryOrPath;
  }

  return config;
}

function getDefaultStorage(): StorageLike | null {
  return typeof window !== "undefined" && window.localStorage
    ? window.localStorage
    : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function createDatabase(
  wasmBinaryOrPath?: string | ArrayBuffer,
  persistedBytes?: Uint8Array
): Promise<Database> {
  const SQL = await initSqlJs(getSqlJsConfig(wasmBinaryOrPath));
  const db = persistedBytes
    ? new SQL.Database(persistedBytes)
    : new SQL.Database();
  db.run(CREATE_TABLES_SQL);
  return db;
}

/**
 * Initialises sql.js and creates (or verifies) the application schema.
 *
 * @param wasmBinaryOrPath - Optional path or ArrayBuffer for the sql-wasm.wasm
 *   binary.  When omitted, sql.js resolves the WASM from its default location
 *   (suitable for browser / Capacitor WebView environments).
 * @returns A fully-initialised sql.js {@link Database} instance.
 */
export async function initDatabase(
  wasmBinaryOrPath?: string | ArrayBuffer
): Promise<Database> {
  return createDatabase(wasmBinaryOrPath);
}

export async function loadPersistedDatabase(
  wasmBinaryOrPath?: string | ArrayBuffer,
  storage: StorageLike | null = getDefaultStorage()
): Promise<Database> {
  const persisted = storage?.getItem(DATABASE_STORAGE_KEY);
  if (!persisted) {
    return createDatabase(wasmBinaryOrPath);
  }

  try {
    return await createDatabase(wasmBinaryOrPath, base64ToBytes(persisted));
  } catch {
    storage?.removeItem(DATABASE_STORAGE_KEY);
    return createDatabase(wasmBinaryOrPath);
  }
}

export function persistDatabase(
  db: Database,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  storage.setItem(DATABASE_STORAGE_KEY, bytesToBase64(db.export()));
}

export function clearPersistedDatabase(
  storage: StorageLike | null = getDefaultStorage()
): void {
  storage?.removeItem(DATABASE_STORAGE_KEY);
}
