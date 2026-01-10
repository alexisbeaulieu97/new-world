import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MigrationLogger } from "../src/migration/logger.js";

describe("MigrationLogger", () => {
  let logger;
  let originalLog;
  let logOutput;

  beforeEach(() => {
    logger = new MigrationLogger();
    logOutput = [];
    originalLog = console.log;
    console.log = (...args) => logOutput.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  describe("migrated", () => {
    it("records successful migration", () => {
      logger.migrated("projects", "OLD-123", "NEW-456");

      const json = logger.toJSON();
      assert.equal(json.migrated.length, 1);
      assert.equal(json.migrated[0].type, "projects");
      assert.equal(json.migrated[0].oldId, "OLD-123");
      assert.equal(json.migrated[0].newId, "NEW-456");
      assert.ok(json.migrated[0].timestamp);
    });

    it("prints success message to console", () => {
      logger.migrated("projects", "OLD-123", "NEW-456");
      assert.ok(logOutput.some((line) => line.includes("✓ projects OLD-123 → NEW-456")));
    });

    it("records migration with details", () => {
      logger.migrated("projects", "OLD-123", "NEW-456", { name: "My Project" });

      const json = logger.toJSON();
      assert.deepEqual(json.migrated[0].details, { name: "My Project" });
    });
  });

  describe("skipped", () => {
    it("records skipped item", () => {
      logger.skipped("projects", "OLD-123", "already migrated");

      const json = logger.toJSON();
      assert.equal(json.skipped.length, 1);
      assert.equal(json.skipped[0].type, "projects");
      assert.equal(json.skipped[0].oldId, "OLD-123");
      assert.equal(json.skipped[0].reason, "already migrated");
    });

    it("prints skip message to console", () => {
      logger.skipped("projects", "OLD-123", "already migrated");
      assert.ok(
        logOutput.some((line) =>
          line.includes("⊘ projects OLD-123 skipped: already migrated")
        )
      );
    });
  });

  describe("failed", () => {
    it("records failed item with Error object", () => {
      logger.failed("projects", "OLD-123", new Error("API timeout"));

      const json = logger.toJSON();
      assert.equal(json.failed.length, 1);
      assert.equal(json.failed[0].error, "API timeout");
    });

    it("records failed item with string error", () => {
      logger.failed("projects", "OLD-123", "Connection refused");

      const json = logger.toJSON();
      assert.equal(json.failed[0].error, "Connection refused");
    });

    it("prints error message to console", () => {
      logger.failed("projects", "OLD-123", new Error("API timeout"));
      assert.ok(
        logOutput.some((line) => line.includes("✗ projects OLD-123 failed: API timeout"))
      );
    });
  });

  describe("summary", () => {
    it("prints summary with all result types", () => {
      // Add 10 migrated
      for (let i = 0; i < 10; i++) {
        logger.migrated("projects", `OLD-${i}`, `NEW-${i}`);
      }
      // Add 3 skipped
      for (let i = 0; i < 3; i++) {
        logger.skipped("inventories", `SKP-${i}`, "duplicate");
      }
      // Add 2 failed
      logger.failed("credentials", "FAIL-1", "Error 1");
      logger.failed("credentials", "FAIL-2", "Error 2");

      logOutput = []; // Clear previous logs
      logger.summary();

      const output = logOutput.join("\n");
      assert.ok(output.includes("Migrated: 10"));
      assert.ok(output.includes("Skipped:  3"));
      assert.ok(output.includes("Failed:   2"));
      assert.ok(output.includes("Total:    15"));
      assert.ok(output.includes("Failures:"));
      assert.ok(output.includes("credentials FAIL-1: Error 1"));
      assert.ok(output.includes("credentials FAIL-2: Error 2"));
    });

    it("prints summary without failures section when no failures", () => {
      logger.migrated("projects", "OLD-1", "NEW-1");
      logger.skipped("projects", "OLD-2", "duplicate");

      logOutput = [];
      logger.summary();

      const output = logOutput.join("\n");
      assert.ok(output.includes("Migrated: 1"));
      assert.ok(output.includes("Skipped:  1"));
      assert.ok(output.includes("Failed:   0"));
      assert.ok(!output.includes("Failures:"));
    });
  });

  describe("toJSON", () => {
    it("exports logs with timestamps", () => {
      logger.migrated("projects", "OLD-1", "NEW-1");

      const json = logger.toJSON();
      assert.ok(json.migrated[0].timestamp);
      assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(json.migrated[0].timestamp));
    });

    it("exports empty logs", () => {
      const json = logger.toJSON();
      assert.deepEqual(json, { migrated: [], skipped: [], failed: [] });
    });

    it("returns copies of arrays", () => {
      logger.migrated("projects", "OLD-1", "NEW-1");

      const json1 = logger.toJSON();
      const json2 = logger.toJSON();
      assert.notEqual(json1.migrated, json2.migrated);
    });
  });

  describe("getCounts", () => {
    it("returns counts for each category", () => {
      for (let i = 0; i < 10; i++) {
        logger.migrated("projects", `OLD-${i}`, `NEW-${i}`);
      }
      for (let i = 0; i < 3; i++) {
        logger.skipped("inventories", `SKP-${i}`, "duplicate");
      }
      for (let i = 0; i < 2; i++) {
        logger.failed("credentials", `FAIL-${i}`, "error");
      }

      assert.deepEqual(logger.getCounts(), {
        migrated: 10,
        skipped: 3,
        failed: 2,
        total: 15,
      });
    });
  });

  describe("getByType", () => {
    it("filters by object type", () => {
      logger.migrated("projects", "P1", "NP1");
      logger.migrated("inventories", "I1", "NI1");
      logger.migrated("projects", "P2", "NP2");
      logger.skipped("projects", "P3", "duplicate");
      logger.failed("inventories", "I2", "error");

      const projects = logger.getByType("projects");
      assert.equal(projects.migrated.length, 2);
      assert.equal(projects.skipped.length, 1);
      assert.equal(projects.failed.length, 0);

      const inventories = logger.getByType("inventories");
      assert.equal(inventories.migrated.length, 1);
      assert.equal(inventories.skipped.length, 0);
      assert.equal(inventories.failed.length, 1);
    });
  });

  describe("hasFailures", () => {
    it("returns true when failures exist", () => {
      logger.failed("projects", "OLD-1", "error");
      assert.equal(logger.hasFailures(), true);
    });

    it("returns false when no failures", () => {
      logger.migrated("projects", "OLD-1", "NEW-1");
      logger.skipped("projects", "OLD-2", "duplicate");
      assert.equal(logger.hasFailures(), false);
    });
  });
});
