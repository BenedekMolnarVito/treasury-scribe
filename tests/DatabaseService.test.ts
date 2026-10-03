/**
 * DatabaseService.test.ts
 *
 * Verifies that DatabaseService correctly initialises sql.js and produces
 * a database with the expected schema (tables, columns, defaults, foreign
 * keys, and unique indexes).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll } from "vitest";
import type { Database } from "sql.js";
import {
  initDatabase,
  loadPersistedDatabase,
  persistDatabase,
} from "../src/data/DatabaseService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the path to the sql-wasm.wasm binary bundled with sql.js. */
const WASM_PATH = resolve(
  __dirname,
  "../node_modules/sql.js/dist/sql-wasm.wasm"
);

/** Load the WASM binary once for all tests to keep the suite fast. */
let wasmBinary: ArrayBuffer;
let db: Database;

beforeAll(async () => {
  wasmBinary = readFileSync(WASM_PATH).buffer as ArrayBuffer;
  db = await initDatabase(wasmBinary);
});

// ---------------------------------------------------------------------------
// Utility: query helper
// ---------------------------------------------------------------------------

function queryOne<T extends Record<string, unknown>>(
  database: Database,
  sql: string,
  params: unknown[] = []
): T | undefined {
  const stmt = database.prepare(sql);
  stmt.bind(params as Parameters<typeof stmt.bind>[0]);
  const hasRow = stmt.step();
  if (!hasRow) {
    stmt.free();
    return undefined;
  }
  const row = stmt.getAsObject() as T;
  stmt.free();
  return row;
}

function queryAll<T extends Record<string, unknown>>(
  database: Database,
  sql: string
): T[] {
  const results = database.exec(sql);
  if (!results.length) return [];
  const { columns, values } = results[0];
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]])) as T
  );
}

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  dump(): Record<string, string>;
}

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    dump: () => Object.fromEntries(store.entries()),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatabaseService – initDatabase", () => {
  it("returns a usable Database instance", () => {
    expect(db).toBeDefined();
    // A usable db can execute SQL without throwing.
    expect(() => db.exec("SELECT 1")).not.toThrow();
  });

  it("is idempotent – calling init twice does not throw", async () => {
    await expect(initDatabase(wasmBinary)).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Table existence
  // -------------------------------------------------------------------------

  it("creates the Transactions table", () => {
    const row = queryOne<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='Transactions'"
    );
    expect(row?.name).toBe("Transactions");
  });

  it("creates the Tags table", () => {
    const row = queryOne<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='Tags'"
    );
    expect(row?.name).toBe("Tags");
  });

  it("creates the TransactionTags table", () => {
    const row = queryOne<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='TransactionTags'"
    );
    expect(row?.name).toBe("TransactionTags");
  });

  // -------------------------------------------------------------------------
  // Transactions columns
  // -------------------------------------------------------------------------

  it("Transactions table has correct columns", () => {
    const cols = queryAll<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(
      db,
      "PRAGMA table_info(Transactions)"
    );
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(byName["Id"].type).toBe("INTEGER");
    expect(byName["Id"].pk).toBe(1);

    expect(byName["RawContent"].type).toBe("TEXT");
    expect(byName["JsonContent"].type).toBe("TEXT");

    expect(byName["ReceivedAt"].type).toBe("TEXT");
    expect(byName["ReceivedAt"].notnull).toBe(1);

    expect(byName["NotificationTitle"].type).toBe("TEXT");
    expect(byName["NotificationBody"].type).toBe("TEXT");
    expect(byName["PackageName"].type).toBe("TEXT");

    expect(byName["IsDeleted"].type).toBe("INTEGER");
    expect(byName["IsDeleted"].notnull).toBe(1);
    expect(byName["IsDeleted"].dflt_value).toBe("0");

    expect(byName["IsCash"].type).toBe("INTEGER");
    expect(byName["IsCash"].notnull).toBe(1);
    expect(byName["IsCash"].dflt_value).toBe("0");

    expect(byName["Amount"].type).toBe("REAL");

    expect(byName["Currency"].type).toBe("TEXT");

    expect(byName["IsIncome"].type).toBe("INTEGER");
    expect(byName["IsIncome"].notnull).toBe(1);
    expect(byName["IsIncome"].dflt_value).toBe("0");
  });

  // -------------------------------------------------------------------------
  // Tags columns
  // -------------------------------------------------------------------------

  it("Tags table has correct columns", () => {
    const cols = queryAll<{ name: string; type: string; notnull: number; pk: number }>(
      db,
      "PRAGMA table_info(Tags)"
    );
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(byName["Id"].pk).toBe(1);
    expect(byName["Name"].type).toBe("TEXT");
    expect(byName["Name"].notnull).toBe(1);
    expect(byName["LastUsedAt"].type).toBe("TEXT");
    expect(byName["LastUsedAt"].notnull).toBe(1);
  });

  // -------------------------------------------------------------------------
  // TransactionTags columns
  // -------------------------------------------------------------------------

  it("TransactionTags table has correct columns", () => {
    const cols = queryAll<{ name: string; type: string; notnull: number; pk: number }>(
      db,
      "PRAGMA table_info(TransactionTags)"
    );
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(byName["Id"].pk).toBe(1);
    expect(byName["TransactionId"].type).toBe("INTEGER");
    expect(byName["TransactionId"].notnull).toBe(1);
    expect(byName["TagId"].type).toBe("INTEGER");
    expect(byName["TagId"].notnull).toBe(1);
    expect(byName["CreatedAt"].type).toBe("TEXT");
    expect(byName["CreatedAt"].notnull).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Default values (behaviour verification via INSERT)
  // -------------------------------------------------------------------------

  it("IsDeleted, IsCash, IsIncome default to 0", () => {
    db.run(
      "INSERT INTO Transactions (ReceivedAt) VALUES (?)",
      ["2024-01-01T00:00:00Z"]
    );
    const row = queryOne<{ IsDeleted: number; IsCash: number; IsIncome: number }>(
      db,
      "SELECT IsDeleted, IsCash, IsIncome FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    expect(row?.IsDeleted).toBe(0);
    expect(row?.IsCash).toBe(0);
    expect(row?.IsIncome).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Foreign keys with ON DELETE CASCADE
  // -------------------------------------------------------------------------

  it("TransactionTags rows are cascade-deleted when parent Transaction is deleted", () => {
    // PRAGMA foreign_keys must be ON in this connection.
    db.run("PRAGMA foreign_keys = ON");

    db.run(
      "INSERT INTO Transactions (ReceivedAt) VALUES (?)",
      ["2024-06-01T00:00:00Z"]
    );
    const txRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    const txId = txRow!.Id;

    db.run(
      "INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)",
      ["cascade-test-tag", "2024-06-01T00:00:00Z"]
    );
    const tagRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Tags ORDER BY Id DESC LIMIT 1"
    );
    const tagId = tagRow!.Id;

    db.run(
      "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
      [txId, tagId, "2024-06-01T00:00:00Z"]
    );

    // Verify link exists.
    const link = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tagId]
    );
    expect(link).toBeDefined();

    // Delete parent transaction → link must be cascade-deleted.
    db.run("DELETE FROM Transactions WHERE Id = ?", [txId]);

    const linkAfter = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tagId]
    );
    expect(linkAfter).toBeUndefined();
  });

  it("TransactionTags rows are cascade-deleted when parent Tag is deleted", () => {
    db.run("PRAGMA foreign_keys = ON");

    db.run(
      "INSERT INTO Transactions (ReceivedAt) VALUES (?)",
      ["2024-07-01T00:00:00Z"]
    );
    const txRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    const txId = txRow!.Id;

    db.run(
      "INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)",
      ["cascade-test-tag-2", "2024-07-01T00:00:00Z"]
    );
    const tagRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Tags ORDER BY Id DESC LIMIT 1"
    );
    const tagId = tagRow!.Id;

    db.run(
      "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
      [txId, tagId, "2024-07-01T00:00:00Z"]
    );

    db.run("DELETE FROM Tags WHERE Id = ?", [tagId]);

    const linkAfter = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tagId]
    );
    expect(linkAfter).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Unique index on Tags.Name
  // -------------------------------------------------------------------------

  it("Tags.Name has a unique index (rejects duplicate names)", () => {
    db.run(
      "INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)",
      ["unique-tag", "2024-01-01T00:00:00Z"]
    );
    expect(() =>
      db.run(
        "INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)",
        ["unique-tag", "2024-01-02T00:00:00Z"]
      )
    ).toThrow();
  });

  it("unique index idx_tags_name exists in sqlite_master", () => {
    const row = queryOne<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tags_name'"
    );
    expect(row?.name).toBe("idx_tags_name");
  });

  // -------------------------------------------------------------------------
  // Unique composite index on TransactionTags(TransactionId, TagId)
  // -------------------------------------------------------------------------

  it("TransactionTags has unique composite index on (TransactionId, TagId)", () => {
    const row = queryOne<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_transaction_tags_unique'"
    );
    expect(row?.name).toBe("idx_transaction_tags_unique");
  });

  it("TransactionTags rejects duplicate (TransactionId, TagId) pairs", () => {
    db.run("PRAGMA foreign_keys = ON");

    db.run(
      "INSERT INTO Transactions (ReceivedAt) VALUES (?)",
      ["2024-08-01T00:00:00Z"]
    );
    const txRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    const txId = txRow!.Id;

    db.run(
      "INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)",
      ["dup-composite-tag", "2024-08-01T00:00:00Z"]
    );
    const tagRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Tags ORDER BY Id DESC LIMIT 1"
    );
    const tagId = tagRow!.Id;

    db.run(
      "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
      [txId, tagId, "2024-08-01T00:00:00Z"]
    );

    expect(() =>
      db.run(
        "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
        [txId, tagId, "2024-08-02T00:00:00Z"]
      )
    ).toThrow();
  });

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  it("persists an exported database snapshot to storage", () => {
    const storage = createMemoryStorage();

    db.run(
      "INSERT INTO Transactions (ReceivedAt, NotificationTitle) VALUES (?, ?)",
      ["2024-09-01T00:00:00Z", "Persisted title"]
    );

    persistDatabase(db, storage);

    const values = Object.values(storage.dump());
    expect(values).toHaveLength(1);
    expect(values[0].length).toBeGreaterThan(0);
  });

  it("reloads a persisted database snapshot with existing rows intact", async () => {
    const storage = createMemoryStorage();

    db.run(
      "INSERT INTO Transactions (ReceivedAt, NotificationTitle) VALUES (?, ?)",
      ["2024-10-01T00:00:00Z", "Restored row"]
    );
    persistDatabase(db, storage);

    const restoredDb = await loadPersistedDatabase(wasmBinary, storage);
    const restored = queryOne<{ NotificationTitle: string }>(
      restoredDb,
      "SELECT NotificationTitle FROM Transactions WHERE NotificationTitle = ?",
      ["Restored row"]
    );

    expect(restored?.NotificationTitle).toBe("Restored row");
    restoredDb.close();
  });
});

// ---------------------------------------------------------------------------
// FR8: ExcludeFromAutoLearn migration
// ---------------------------------------------------------------------------

import initSqlJs from "sql.js";

describe("FR8 – ExcludeFromAutoLearn idempotent migration", () => {
  it("adds ExcludeFromAutoLearn column to an old-schema DB (no column)", async () => {
    // Build a DB from the OLD schema — without ExcludeFromAutoLearn.
    const SQL = await initSqlJs({ locateFile: () => WASM_PATH });
    const oldDb = new SQL.Database();
    oldDb.run(`
      CREATE TABLE IF NOT EXISTS Transactions (
        Id                INTEGER PRIMARY KEY AUTOINCREMENT,
        RawContent        TEXT,
        JsonContent       TEXT,
        ReceivedAt        TEXT NOT NULL,
        NotificationTitle TEXT,
        NotificationBody  TEXT,
        PackageName       TEXT,
        IsDeleted         INTEGER NOT NULL DEFAULT 0,
        IsCash            INTEGER NOT NULL DEFAULT 0,
        Amount            REAL,
        Currency          TEXT,
        IsIncome          INTEGER NOT NULL DEFAULT 0
      )
    `);
    // Verify column is absent before migration
    const before = oldDb
      .exec("PRAGMA table_info(Transactions)")
      .flatMap((r) => r.values.map((v) => v[1] as string));
    expect(before).not.toContain("ExcludeFromAutoLearn");

    // Insert a row to confirm default applies
    oldDb.run("INSERT INTO Transactions (ReceivedAt) VALUES (?)", ["2024-01-01T00:00:00Z"]);

    // Export old DB bytes, then run initDatabase with the persisted bytes —
    // this simulates opening an existing user DB (pre-migration).
    const bytes = oldDb.export();
    oldDb.close();

    const migratedDb = await loadPersistedDatabase(wasmBinary, {
      getItem: () => Buffer.from(bytes).toString("base64"),
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    // Column should now exist
    const after = migratedDb
      .exec("PRAGMA table_info(Transactions)")
      .flatMap((r) => r.values.map((v) => v[1] as string));
    expect(after).toContain("ExcludeFromAutoLearn");

    // The pre-existing row should default to 0
    const row = queryOne<{ ExcludeFromAutoLearn: number }>(
      migratedDb,
      "SELECT ExcludeFromAutoLearn FROM Transactions LIMIT 1"
    );
    expect(row?.ExcludeFromAutoLearn).toBe(0);

    migratedDb.close();
  });

  it("running initDatabase twice on the same DB never throws", async () => {
    // First call creates the DB
    const firstDb = await initDatabase(wasmBinary);
    // Export and reimport to simulate reopening the same DB
    const bytes = firstDb.export();
    firstDb.close();

    // Second call via loadPersistedDatabase should not throw
    await expect(
      loadPersistedDatabase(wasmBinary, {
        getItem: () => Buffer.from(bytes).toString("base64"),
        setItem: () => undefined,
        removeItem: () => undefined,
      })
    ).resolves.toBeDefined();
  });

  it("fresh DB created by initDatabase includes ExcludeFromAutoLearn column", async () => {
    const freshDb = await initDatabase(wasmBinary);
    const cols = freshDb
      .exec("PRAGMA table_info(Transactions)")
      .flatMap((r) => r.values.map((v) => v[1] as string));
    expect(cols).toContain("ExcludeFromAutoLearn");
    freshDb.close();
  });
});
