/**
 * DatabaseService.ts
 *
 * Initialises sql.js (SQLite compiled to WebAssembly) and creates all
 * required application tables with their constraints, defaults, and indexes.
 * All CREATE TABLE statements use IF NOT EXISTS so that calling `initDatabase`
 * more than once is safe (idempotent).
 */

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

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
  const config: Parameters<SqlJsStatic>[0] = {};

  if (typeof wasmBinaryOrPath === "string") {
    config.locateFile = () => wasmBinaryOrPath;
  } else if (wasmBinaryOrPath instanceof ArrayBuffer) {
    config.wasmBinary = wasmBinaryOrPath;
  }

  const SQL = await initSqlJs(config);
  const db = new SQL.Database();

  // Enable foreign-key enforcement and create all tables / indexes.
  db.run(CREATE_TABLES_SQL);

  return db;
}
