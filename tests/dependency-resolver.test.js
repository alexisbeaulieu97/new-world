import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DependencyResolver } from "../src/migration/dependency-resolver.js";

/**
 * Mock JSONStore that implements the actual JSONStore API methods used by DependencyResolver.
 */
class MockJSONStore {
  constructor(initialData = {}) {
    this._data = initialData;
    this.saveCount = 0;
  }

  /**
   * Gets a value at a nested path (mirrors JSONStore.getPath)
   * @param  {...string} keys
   * @returns {unknown}
   */
  getPath(...keys) {
    let current = this._data;
    for (const key of keys) {
      if (current == null || typeof current !== "object") {
        return undefined;
      }
      current = current[key];
    }
    // Clone objects to prevent mutation (like real JSONStore)
    if (current !== null && typeof current === "object") {
      return structuredClone(current);
    }
    return current;
  }

  /**
   * Sets a value at a nested path and saves (mirrors JSONStore.setPathAndSave)
   * @param {string[]} keys
   * @param {unknown} value
   */
  async setPathAndSave(keys, value) {
    let current = this._data;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (current[key] == null) {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
    this.saveCount++;
  }
}

describe("DependencyResolver", () => {
  describe("Construction", () => {
    it("creates resolver with context", () => {
      const idMap = new MockJSONStore();
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.environment, "prod");
      assert.equal(resolver.category, "standard");
    });

    it("accepts custom scoped types", () => {
      const idMap = new MockJSONStore({
        customType: { "OLD-1": { custom: { prod: "NEW-1" } } },
      });
      const resolver = new DependencyResolver(idMap, "prod", "custom", {
        scopedTypes: ["customType"],
      });

      assert.equal(resolver.require("customType", "OLD-1"), "NEW-1");
    });
  });

  describe("require", () => {
    it("returns new ID for existing simple mapping", () => {
      const idMap = new MockJSONStore({
        projects: { "OLD-123": "NEW-456" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.require("projects", "OLD-123"), "NEW-456");
    });

    it("returns new ID for existing scoped mapping", () => {
      const idMap = new MockJSONStore({
        inventories: { "OLD-789": { standard: { prod: "NEW-ABC" } } },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.require("inventories", "OLD-789"), "NEW-ABC");
    });

    it("throws for missing dependency with context info", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.require("projects", "OLD-123"),
        (err) => {
          assert.ok(err.message.includes("projects"));
          assert.ok(err.message.includes("OLD-123"));
          assert.ok(err.message.includes("prod"));
          assert.ok(err.message.includes("standard"));
          assert.ok(err.message.includes("must be migrated first"));
          return true;
        },
      );
    });

    it("throws for missing scoped mapping with context info", () => {
      const idMap = new MockJSONStore({
        inventories: { "OLD-789": { standard: { prod: "NEW-ABC" } } },
      });
      const resolver = new DependencyResolver(idMap, "staging", "kyndryl");

      assert.throws(
        () => resolver.require("inventories", "OLD-789"),
        (err) => {
          assert.ok(err.message.includes("inventories"));
          assert.ok(err.message.includes("OLD-789"));
          assert.ok(err.message.includes("staging"));
          assert.ok(err.message.includes("kyndryl"));
          assert.ok(err.message.includes("must be migrated first"));
          return true;
        },
      );
    });

    it("throws when type map does not exist", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(() => resolver.require("projects", "OLD-123"));
    });

    it("throws TypeError for empty type", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.require("", "OLD-123"),
        (err) => err instanceof TypeError && err.message.includes("type"),
      );
    });

    it("throws TypeError for empty oldId", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.require("projects", ""),
        (err) => err instanceof TypeError && err.message.includes("oldId"),
      );
    });

    it("throws TypeError for null type", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.require(null, "OLD-123"),
        (err) => err instanceof TypeError,
      );
    });

    it("throws TypeError for null oldId", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.require("projects", null),
        (err) => err instanceof TypeError,
      );
    });
  });

  describe("optional", () => {
    it("returns new ID for existing mapping", () => {
      const idMap = new MockJSONStore({
        credentials: { "OLD-111": "NEW-222" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.optional("credentials", "OLD-111"), "NEW-222");
    });

    it("returns null for missing mapping", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.optional("credentials", "MISSING"), null);
    });

    it("returns null when oldId is null", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.optional("credentials", null), null);
    });

    it("returns null when oldId is undefined", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.optional("credentials", undefined), null);
    });

    it("returns null when oldId is empty string", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.optional("credentials", ""), null);
    });

    it("returns new ID for existing scoped mapping", () => {
      const idMap = new MockJSONStore({
        credentials: { "OLD-111": { standard: { prod: "NEW-222" } } },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.optional("credentials", "OLD-111"), "NEW-222");
    });

    it("throws TypeError for empty type", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.optional("", "OLD-123"),
        (err) => err instanceof TypeError && err.message.includes("type"),
      );
    });
  });

  describe("has", () => {
    it("returns true for existing mapping", () => {
      const idMap = new MockJSONStore({
        projects: { "OLD-123": "NEW-456" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.has("projects", "OLD-123"), true);
    });

    it("returns false for missing mapping", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.has("projects", "OLD-123"), false);
    });

    it("returns true for existing scoped mapping", () => {
      const idMap = new MockJSONStore({
        inventories: { "OLD-789": { standard: { prod: "NEW-ABC" } } },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.has("inventories", "OLD-789"), true);
    });

    it("returns false when scoped mapping has different env/category", () => {
      const idMap = new MockJSONStore({
        inventories: { "OLD-789": { standard: { prod: "NEW-ABC" } } },
      });
      const resolver = new DependencyResolver(idMap, "staging", "kyndryl");

      assert.equal(resolver.has("inventories", "OLD-789"), false);
    });

    it("throws TypeError for empty type", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.has("", "OLD-123"),
        (err) => err instanceof TypeError,
      );
    });

    it("throws TypeError for empty oldId", () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.throws(
        () => resolver.has("projects", ""),
        (err) => err instanceof TypeError,
      );
    });
  });

  describe("record", () => {
    it("records simple mapping and saves", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("projects", "OLD-123", "NEW-456");

      assert.equal(idMap._data.projects["OLD-123"], "NEW-456");
      assert.equal(idMap.saveCount, 1);
    });

    it("records scoped mapping and saves", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("inventories", "OLD-789", "NEW-ABC");

      assert.deepEqual(idMap._data.inventories["OLD-789"], {
        standard: { prod: "NEW-ABC" },
      });
      assert.equal(idMap.saveCount, 1);
    });

    it("preserves existing mappings for same oldId in different scope", async () => {
      const idMap = new MockJSONStore({
        inventories: {
          "OLD-789": {
            standard: { prod: "EXISTING" },
          },
        },
      });
      const resolver = new DependencyResolver(idMap, "staging", "kyndryl");

      await resolver.record("inventories", "OLD-789", "NEW-STAGING");

      assert.deepEqual(idMap._data.inventories["OLD-789"], {
        standard: { prod: "EXISTING" },
        kyndryl: { staging: "NEW-STAGING" },
      });
    });

    it("adds to existing type map", async () => {
      const idMap = new MockJSONStore({
        projects: { "OLD-111": "NEW-111" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("projects", "OLD-222", "NEW-222");

      assert.equal(idMap._data.projects["OLD-111"], "NEW-111");
      assert.equal(idMap._data.projects["OLD-222"], "NEW-222");
    });

    it("overwrites existing simple mapping", async () => {
      const idMap = new MockJSONStore({
        projects: { "OLD-123": "OLD-VALUE" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("projects", "OLD-123", "NEW-VALUE");

      assert.equal(idMap._data.projects["OLD-123"], "NEW-VALUE");
    });

    it("overwrites existing scoped mapping for same env/category", async () => {
      const idMap = new MockJSONStore({
        inventories: {
          "OLD-789": { standard: { prod: "OLD-VALUE" } },
        },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("inventories", "OLD-789", "NEW-VALUE");

      assert.equal(
        idMap._data.inventories["OLD-789"].standard.prod,
        "NEW-VALUE",
      );
    });

    it("throws TypeError for empty type", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await assert.rejects(
        () => resolver.record("", "OLD-123", "NEW-456"),
        (err) => err instanceof TypeError && err.message.includes("type"),
      );
    });

    it("throws TypeError for empty oldId", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await assert.rejects(
        () => resolver.record("projects", "", "NEW-456"),
        (err) => err instanceof TypeError && err.message.includes("oldId"),
      );
    });

    it("throws TypeError for empty newId", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await assert.rejects(
        () => resolver.record("projects", "OLD-123", ""),
        (err) => err instanceof TypeError && err.message.includes("newId"),
      );
    });

    it("throws TypeError for null parameters", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await assert.rejects(
        () => resolver.record(null, "OLD-123", "NEW-456"),
        TypeError,
      );
      await assert.rejects(
        () => resolver.record("projects", null, "NEW-456"),
        TypeError,
      );
      await assert.rejects(
        () => resolver.record("projects", "OLD-123", null),
        TypeError,
      );
    });
  });

  describe("scoping configuration", () => {
    it("uses simple mapping for non-scoped types", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("projects", "OLD-123", "NEW-456");

      // Should be simple direct mapping
      assert.equal(typeof idMap._data.projects["OLD-123"], "string");
      assert.equal(idMap._data.projects["OLD-123"], "NEW-456");
    });

    it("uses scoped mapping for inventories by default", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("inventories", "OLD-789", "NEW-ABC");

      // Should be scoped mapping
      assert.equal(typeof idMap._data.inventories["OLD-789"], "object");
      assert.deepEqual(idMap._data.inventories["OLD-789"], {
        standard: { prod: "NEW-ABC" },
      });
    });

    it("uses scoped mapping for credentials by default", async () => {
      const idMap = new MockJSONStore({});
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      await resolver.record("credentials", "OLD-999", "NEW-999");

      assert.deepEqual(idMap._data.credentials["OLD-999"], {
        standard: { prod: "NEW-999" },
      });
    });
  });

  describe("context access", () => {
    it("exposes environment as read-only property", () => {
      const idMap = new MockJSONStore();
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.environment, "prod");
    });

    it("exposes category as read-only property", () => {
      const idMap = new MockJSONStore();
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.category, "standard");
    });
  });

  describe("legacy data compatibility", () => {
    it("resolves simple mapping for scoped type (legacy data)", () => {
      // Legacy data: inventories stored as simple mapping before scoping was added
      const idMap = new MockJSONStore({
        inventories: { "OLD-LEGACY": "NEW-LEGACY" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      // Should still resolve the legacy simple mapping
      assert.equal(resolver.require("inventories", "OLD-LEGACY"), "NEW-LEGACY");
    });

    it("has() returns true for legacy simple mapping on scoped type", () => {
      const idMap = new MockJSONStore({
        credentials: { "OLD-LEGACY": "NEW-LEGACY" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(resolver.has("credentials", "OLD-LEGACY"), true);
    });

    it("optional() returns value for legacy simple mapping on scoped type", () => {
      const idMap = new MockJSONStore({
        inventories: { "OLD-LEGACY": "NEW-LEGACY" },
      });
      const resolver = new DependencyResolver(idMap, "prod", "standard");

      assert.equal(
        resolver.optional("inventories", "OLD-LEGACY"),
        "NEW-LEGACY",
      );
    });
  });
});
