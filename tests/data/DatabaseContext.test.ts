/**
 * DatabaseContext.test.ts
 *
 * Integration tests for the DatabaseService (database context layer).
 * Each test creates a fresh in-memory sql.js database via beforeEach and
 * closes it in afterEach to ensure complete test isolation.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "sql.js";
import { initDatabase } from "../../src/data/DatabaseService";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Resolve the WASM binary bundled with sql.js. */
const WASM_PATH = resolve(
  __dirname,
  "../../node_modules/sql.js/dist/sql-wasm.wasm"
);

let wasmBinary: ArrayBuffer;
let db: Database;

beforeEach(async () => {
  if (!wasmBinary) {
    wasmBinary = readFileSync(WASM_PATH).buffer as ArrayBuffer;
  }
  db = await initDatabase(wasmBinary);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Helpers
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
  sql: string,
  params: unknown[] = []
): T[] {
  const stmt = database.prepare(sql);
  stmt.bind(params as Parameters<typeof stmt.bind>[0]);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

// ---------------------------------------------------------------------------
// Database initialisation
// ---------------------------------------------------------------------------

describe("initDatabase – basic sanity", () => {
  it("returns a usable Database instance", () => {
    expect(db).toBeDefined();
    expect(() => db.exec("SELECT 1")).not.toThrow();
  });

  it("is idempotent – calling initDatabase again returns a valid DB", async () => {
    const db2 = await initDatabase(wasmBinary);
    expect(() => db2.exec("SELECT 1")).not.toThrow();
    db2.close();
  });
});

// ---------------------------------------------------------------------------
// Table existence
// ---------------------------------------------------------------------------

describe("Table existence", () => {
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

  it("creates exactly three application tables", () => {
    const tables = queryAll<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = tables.map((r) => r.name);
    expect(names).toContain("Transactions");
    expect(names).toContain("Tags");
    expect(names).toContain("TransactionTags");
  });
});

// ---------------------------------------------------------------------------
// Schema – Transactions table
// ---------------------------------------------------------------------------

describe("Schema – Transactions table", () => {
  type ColumnInfo = {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  };

  let cols: Record<string, ColumnInfo>;

  beforeEach(() => {
    const rows = queryAll<ColumnInfo>(db, "PRAGMA table_info(Transactions)");
    cols = Object.fromEntries(rows.map((c) => [c.name, c]));
  });

  it("has Id as INTEGER primary key", () => {
    expect(cols["Id"].type).toBe("INTEGER");
    expect(cols["Id"].pk).toBe(1);
  });

  it("has RawContent as nullable TEXT", () => {
    expect(cols["RawContent"].type).toBe("TEXT");
    expect(cols["RawContent"].notnull).toBe(0);
  });

  it("has JsonContent as nullable TEXT", () => {
    expect(cols["JsonContent"].type).toBe("TEXT");
    expect(cols["JsonContent"].notnull).toBe(0);
  });

  it("has ReceivedAt as NOT NULL TEXT", () => {
    expect(cols["ReceivedAt"].type).toBe("TEXT");
    expect(cols["ReceivedAt"].notnull).toBe(1);
  });

  it("has NotificationTitle as nullable TEXT", () => {
    expect(cols["NotificationTitle"].type).toBe("TEXT");
    expect(cols["NotificationTitle"].notnull).toBe(0);
  });

  it("has NotificationBody as nullable TEXT", () => {
    expect(cols["NotificationBody"].type).toBe("TEXT");
    expect(cols["NotificationBody"].notnull).toBe(0);
  });

  it("has PackageName as nullable TEXT", () => {
    expect(cols["PackageName"].type).toBe("TEXT");
    expect(cols["PackageName"].notnull).toBe(0);
  });

  it("has IsDeleted as NOT NULL INTEGER with default 0", () => {
    expect(cols["IsDeleted"].type).toBe("INTEGER");
    expect(cols["IsDeleted"].notnull).toBe(1);
    expect(cols["IsDeleted"].dflt_value).toBe("0");
  });

  it("has IsCash as NOT NULL INTEGER with default 0", () => {
    expect(cols["IsCash"].type).toBe("INTEGER");
    expect(cols["IsCash"].notnull).toBe(1);
    expect(cols["IsCash"].dflt_value).toBe("0");
  });

  it("has Amount as nullable REAL", () => {
    expect(cols["Amount"].type).toBe("REAL");
    expect(cols["Amount"].notnull).toBe(0);
  });

  it("has Currency as nullable TEXT", () => {
    expect(cols["Currency"].type).toBe("TEXT");
    expect(cols["Currency"].notnull).toBe(0);
  });

  it("has IsIncome as NOT NULL INTEGER with default 0", () => {
    expect(cols["IsIncome"].type).toBe("INTEGER");
    expect(cols["IsIncome"].notnull).toBe(1);
    expect(cols["IsIncome"].dflt_value).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// Schema – Tags table
// ---------------------------------------------------------------------------

describe("Schema – Tags table", () => {
  type ColumnInfo = { name: string; type: string; notnull: number; pk: number };

  let cols: Record<string, ColumnInfo>;

  beforeEach(() => {
    const rows = queryAll<ColumnInfo>(db, "PRAGMA table_info(Tags)");
    cols = Object.fromEntries(rows.map((c) => [c.name, c]));
  });

  it("has Id as INTEGER primary key", () => {
    expect(cols["Id"].pk).toBe(1);
    expect(cols["Id"].type).toBe("INTEGER");
  });

  it("has Name as NOT NULL TEXT", () => {
    expect(cols["Name"].type).toBe("TEXT");
    expect(cols["Name"].notnull).toBe(1);
  });

  it("has LastUsedAt as NOT NULL TEXT", () => {
    expect(cols["LastUsedAt"].type).toBe("TEXT");
    expect(cols["LastUsedAt"].notnull).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Schema – TransactionTags table
// ---------------------------------------------------------------------------

describe("Schema – TransactionTags table", () => {
  type ColumnInfo = { name: string; type: string; notnull: number; pk: number };

  let cols: Record<string, ColumnInfo>;

  beforeEach(() => {
    const rows = queryAll<ColumnInfo>(db, "PRAGMA table_info(TransactionTags)");
    cols = Object.fromEntries(rows.map((c) => [c.name, c]));
  });

  it("has Id as INTEGER primary key", () => {
    expect(cols["Id"].pk).toBe(1);
    expect(cols["Id"].type).toBe("INTEGER");
  });

  it("has TransactionId as NOT NULL INTEGER", () => {
    expect(cols["TransactionId"].type).toBe("INTEGER");
    expect(cols["TransactionId"].notnull).toBe(1);
  });

  it("has TagId as NOT NULL INTEGER", () => {
    expect(cols["TagId"].type).toBe("INTEGER");
    expect(cols["TagId"].notnull).toBe(1);
  });

  it("has CreatedAt as NOT NULL TEXT", () => {
    expect(cols["CreatedAt"].type).toBe("TEXT");
    expect(cols["CreatedAt"].notnull).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

describe("Column defaults", () => {
  it("IsDeleted, IsCash, and IsIncome default to 0 on INSERT", () => {
    db.run("INSERT INTO Transactions (ReceivedAt) VALUES (?)", [
      "2024-01-01T00:00:00.000Z",
    ]);
    const row = queryOne<{ IsDeleted: number; IsCash: number; IsIncome: number }>(
      db,
      "SELECT IsDeleted, IsCash, IsIncome FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    expect(row?.IsDeleted).toBe(0);
    expect(row?.IsCash).toBe(0);
    expect(row?.IsIncome).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

describe("Indexes", () => {
  it("unique index idx_tags_name exists on Tags(Name)", () => {
    const row = queryOne<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tags_name'"
    );
    expect(row?.name).toBe("idx_tags_name");
  });

  it("Tags.Name rejects duplicate values", () => {
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
      "unique-tag",
      "2024-01-01T00:00:00.000Z",
    ]);
    expect(() =>
      db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
        "unique-tag",
        "2024-01-02T00:00:00.000Z",
      ])
    ).toThrow();
  });

  it("unique composite index idx_transaction_tags_unique exists on TransactionTags(TransactionId, TagId)", () => {
    const row = queryOne<{ name: string }>(
      db,
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_transaction_tags_unique'"
    );
    expect(row?.name).toBe("idx_transaction_tags_unique");
  });

  it("TransactionTags rejects duplicate (TransactionId, TagId) pairs", () => {
    db.run("PRAGMA foreign_keys = ON");
    db.run("INSERT INTO Transactions (ReceivedAt) VALUES (?)", [
      "2024-01-01T00:00:00.000Z",
    ]);
    const txRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
      "dup-tag",
      "2024-01-01T00:00:00.000Z",
    ]);
    const tagRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Tags ORDER BY Id DESC LIMIT 1"
    );
    const txId = txRow!.Id;
    const tagId = tagRow!.Id;

    db.run(
      "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
      [txId, tagId, "2024-01-01T00:00:00.000Z"]
    );
    expect(() =>
      db.run(
        "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
        [txId, tagId, "2024-01-02T00:00:00.000Z"]
      )
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Foreign keys with ON DELETE CASCADE
// ---------------------------------------------------------------------------

describe("Foreign keys – ON DELETE CASCADE", () => {
  it("cascade-deletes TransactionTags when parent Transaction is deleted", () => {
    db.run("PRAGMA foreign_keys = ON");
    db.run("INSERT INTO Transactions (ReceivedAt) VALUES (?)", [
      "2024-06-01T00:00:00.000Z",
    ]);
    const txRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
      "cascade-tag",
      "2024-06-01T00:00:00.000Z",
    ]);
    const tagRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Tags ORDER BY Id DESC LIMIT 1"
    );
    const txId = txRow!.Id;
    const tagId = tagRow!.Id;

    db.run(
      "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
      [txId, tagId, "2024-06-01T00:00:00.000Z"]
    );

    // Verify the link exists before deleting.
    const before = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tagId]
    );
    expect(before).toBeDefined();

    db.run("DELETE FROM Transactions WHERE Id = ?", [txId]);

    const after = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tagId]
    );
    expect(after).toBeUndefined();
  });

  it("cascade-deletes TransactionTags when parent Tag is deleted", () => {
    db.run("PRAGMA foreign_keys = ON");
    db.run("INSERT INTO Transactions (ReceivedAt) VALUES (?)", [
      "2024-07-01T00:00:00.000Z",
    ]);
    const txRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Transactions ORDER BY Id DESC LIMIT 1"
    );
    db.run("INSERT INTO Tags (Name, LastUsedAt) VALUES (?, ?)", [
      "cascade-tag-2",
      "2024-07-01T00:00:00.000Z",
    ]);
    const tagRow = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM Tags ORDER BY Id DESC LIMIT 1"
    );
    const txId = txRow!.Id;
    const tagId = tagRow!.Id;

    db.run(
      "INSERT INTO TransactionTags (TransactionId, TagId, CreatedAt) VALUES (?, ?, ?)",
      [txId, tagId, "2024-07-01T00:00:00.000Z"]
    );

    db.run("DELETE FROM Tags WHERE Id = ?", [tagId]);

    const after = queryOne<{ Id: number }>(
      db,
      "SELECT Id FROM TransactionTags WHERE TransactionId = ? AND TagId = ?",
      [txId, tagId]
    );
    expect(after).toBeUndefined();
  });
});
