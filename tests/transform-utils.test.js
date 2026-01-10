import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  removeKeys,
  renameKey,
  addDefaults,
  pick,
  omit,
} from "../src/migration/transform-utils.js";

describe("removeKeys", () => {
  it("removes a single key", () => {
    const obj = { a: 1, b: 2, c: 3 };
    removeKeys(obj, "b");
    assert.deepEqual(obj, { a: 1, c: 3 });
  });

  it("removes multiple keys", () => {
    const obj = { a: 1, b: 2, c: 3, d: 4 };
    removeKeys(obj, "b", "d");
    assert.deepEqual(obj, { a: 1, c: 3 });
  });

  it("ignores non-existent keys", () => {
    const obj = { a: 1 };
    removeKeys(obj, "b");
    assert.deepEqual(obj, { a: 1 });
  });
});

describe("renameKey", () => {
  it("renames an existing key", () => {
    const obj = { oldName: "value", other: 1 };
    renameKey(obj, "oldName", "newName");
    assert.deepEqual(obj, { newName: "value", other: 1 });
  });

  it("does nothing for non-existent key", () => {
    const obj = { a: 1 };
    renameKey(obj, "missing", "newName");
    assert.deepEqual(obj, { a: 1 });
  });

  it("overwrites existing key when renaming", () => {
    const obj = { a: 1, b: 2 };
    renameKey(obj, "a", "b");
    assert.deepEqual(obj, { b: 1 });
  });

  it("is a no-op when oldKey equals newKey", () => {
    const obj = { a: 1, b: 2 };
    renameKey(obj, "a", "a");
    assert.deepEqual(obj, { a: 1, b: 2 });
  });
});

describe("addDefaults", () => {
  it("adds missing defaults", () => {
    const obj = { a: 1 };
    addDefaults(obj, { b: 2, c: 3 });
    assert.deepEqual(obj, { a: 1, b: 2, c: 3 });
  });

  it("preserves existing values", () => {
    const obj = { a: 1, b: "existing" };
    addDefaults(obj, { b: "default", c: 3 });
    assert.deepEqual(obj, { a: 1, b: "existing", c: 3 });
  });

  it("preserves null values", () => {
    const obj = { a: null };
    addDefaults(obj, { a: "default" });
    assert.deepEqual(obj, { a: null });
  });
});

describe("pick", () => {
  it("picks existing keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = pick(obj, "a", "c");
    assert.deepEqual(result, { a: 1, c: 3 });
    // Original unchanged
    assert.deepEqual(obj, { a: 1, b: 2, c: 3 });
  });

  it("ignores non-existent keys", () => {
    const obj = { a: 1 };
    const result = pick(obj, "a", "missing");
    assert.deepEqual(result, { a: 1 });
  });
});

describe("omit", () => {
  it("omits existing keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    const result = omit(obj, "b");
    assert.deepEqual(result, { a: 1, c: 3 });
    // Original unchanged
    assert.deepEqual(obj, { a: 1, b: 2, c: 3 });
  });

  it("ignores non-existent keys", () => {
    const obj = { a: 1, b: 2 };
    const result = omit(obj, "c", "d");
    assert.deepEqual(result, { a: 1, b: 2 });
  });
});
