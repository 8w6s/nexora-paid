/**
 * admin-db guards smoke tests.
 *
 * These cover the three pure helpers — they're the foot-gun safety
 * net for the SQL console and CRUD endpoints. Full route tests would
 * need session bootstrapping; the guards are the load-bearing bit.
 */
import { describe, expect, it } from "bun:test";
import { guardStatement, isMutation, validateTableName } from "./admin-db.ts";

describe("validateTableName", () => {
  it("accepts plain identifiers", () => {
    expect(validateTableName("users")).toBe("users");
    expect(validateTableName("order_items")).toBe("order_items");
    expect(validateTableName("_t1")).toBe("_t1");
  });

  it("rejects sqlite_* internal tables", () => {
    expect(validateTableName("sqlite_master")).toBe(null);
    expect(validateTableName("sqlite_sequence")).toBe(null);
  });

  it("rejects audit_log and _migrations", () => {
    expect(validateTableName("audit_log")).toBe(null);
    expect(validateTableName("_migrations")).toBe(null);
  });

  it("rejects names with spaces, quotes, or sql injection", () => {
    expect(validateTableName("users; DROP TABLE users")).toBe(null);
    expect(validateTableName('"users"')).toBe(null);
    expect(validateTableName("user-data")).toBe(null);
    expect(validateTableName("user data")).toBe(null);
    expect(validateTableName("")).toBe(null);
    expect(validateTableName("1users")).toBe(null);
  });

  it("rejects non-strings", () => {
    expect(validateTableName(undefined)).toBe(null);
    expect(validateTableName(null)).toBe(null);
    expect(validateTableName(42)).toBe(null);
    expect(validateTableName({})).toBe(null);
  });
});

describe("isMutation", () => {
  it("detects writes", () => {
    expect(isMutation("INSERT INTO foo VALUES (1)")).toBe(true);
    expect(isMutation("update foo set x=1")).toBe(true);
    expect(isMutation("  DELETE FROM foo")).toBe(true);
    expect(isMutation("DROP TABLE foo")).toBe(true);
    expect(isMutation("ALTER TABLE foo ADD x INT")).toBe(true);
    expect(isMutation("REPLACE INTO foo VALUES (1)")).toBe(true);
  });

  it("detects reads as non-mutations", () => {
    expect(isMutation("SELECT * FROM foo")).toBe(false);
    expect(isMutation("  select 1")).toBe(false);
    expect(isMutation("EXPLAIN SELECT 1")).toBe(false);
    expect(isMutation("PRAGMA table_info(foo)")).toBe(false);
  });
});

describe("guardStatement", () => {
  it("accepts ordinary statements", () => {
    expect(() => guardStatement("SELECT 1")).not.toThrow();
    expect(() => guardStatement("UPDATE foo SET x=1 WHERE id=2")).not.toThrow();
    expect(() => guardStatement("PRAGMA table_info(users)")).not.toThrow();
  });

  it("rejects empty / non-string input", () => {
    expect(() => guardStatement("")).toThrow(/empty/);
    expect(() => guardStatement("   ")).toThrow(/empty/);
    expect(() => guardStatement(123 as unknown as string)).toThrow(/string/);
  });

  it("rejects ATTACH / DETACH / load_extension", () => {
    expect(() => guardStatement("ATTACH DATABASE 'x' AS y")).toThrow(/ATTACH/);
    expect(() => guardStatement("detach  database y")).toThrow(/DETACH/);
    expect(() => guardStatement("SELECT load_extension('evil.so')")).toThrow(/load_extension/);
  });

  it("rejects writable PRAGMAs", () => {
    expect(() => guardStatement("PRAGMA journal_mode = DELETE")).toThrow(/PRAGMA/);
    expect(() => guardStatement("PRAGMA foreign_keys = OFF")).toThrow(/PRAGMA/);
    expect(() => guardStatement("PRAGMA key = 'hunter2'")).toThrow(/PRAGMA/);
  });

  it("rejects writes against audit_log", () => {
    expect(() => guardStatement("DELETE FROM audit_log")).toThrow(/audit_log/);
    expect(() => guardStatement("UPDATE audit_log SET success = 1")).toThrow(/audit_log/);
    expect(() => guardStatement("DROP TABLE audit_log")).toThrow(/audit_log/);
    // Reads from audit_log are fine — admin needs to inspect their own history.
    expect(() => guardStatement("SELECT * FROM audit_log")).not.toThrow();
  });

  it("rejects oversize statements", () => {
    const big = `SELECT ${"a".repeat(70_000)}`;
    expect(() => guardStatement(big)).toThrow(/too long/);
  });
});
