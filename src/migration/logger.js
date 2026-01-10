/**
 * Structured logging for migration operations.
 * Tracks migrated, skipped, and failed items with audit trail support.
 */

/**
 * @typedef {Object} MigratedEntry
 * @property {string} type - Object type (e.g., 'projects', 'inventories')
 * @property {string} oldId - Original ID from source system
 * @property {string} newId - New ID in target system
 * @property {Object} [details] - Optional additional details
 * @property {string} timestamp - ISO timestamp of the operation
 */

/**
 * @typedef {Object} SkippedEntry
 * @property {string} type - Object type
 * @property {string} oldId - Original ID
 * @property {string} reason - Reason for skipping
 * @property {string} timestamp - ISO timestamp
 */

/**
 * @typedef {Object} FailedEntry
 * @property {string} type - Object type
 * @property {string} oldId - Original ID
 * @property {string} error - Error message
 * @property {string} timestamp - ISO timestamp
 */

export class MigrationLogger {
  /** @type {MigratedEntry[]} */
  #migrated = [];

  /** @type {SkippedEntry[]} */
  #skipped = [];

  /** @type {FailedEntry[]} */
  #failed = [];

  /**
   * Records a successfully migrated item.
   *
   * @param {string} type - Object type (e.g., 'projects')
   * @param {string} oldId - Original ID
   * @param {string} newId - New ID in target system
   * @param {Object} [details] - Optional additional details
   */
  migrated(type, oldId, newId, details) {
    const entry = {
      type,
      oldId,
      newId,
      timestamp: new Date().toISOString(),
    };
    if (details !== undefined) {
      entry.details = details;
    }
    this.#migrated.push(entry);
    console.log(`✓ ${type} ${oldId} → ${newId}`);
  }

  /**
   * Records a skipped item.
   *
   * @param {string} type - Object type
   * @param {string} oldId - Original ID
   * @param {string} reason - Reason for skipping
   */
  skipped(type, oldId, reason) {
    this.#skipped.push({
      type,
      oldId,
      reason,
      timestamp: new Date().toISOString(),
    });
    console.log(`⊘ ${type} ${oldId} skipped: ${reason}`);
  }

  /**
   * Records a failed item.
   *
   * @param {string} type - Object type
   * @param {string} oldId - Original ID
   * @param {Error|string} error - Error object or message
   */
  failed(type, oldId, error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.#failed.push({
      type,
      oldId,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
    console.log(`✗ ${type} ${oldId} failed: ${errorMessage}`);
  }

  /**
   * Prints a summary of all migration operations to the console.
   */
  summary() {
    const counts = this.getCounts();

    console.log("\n" + "═".repeat(50));
    console.log("Migration Summary");
    console.log("═".repeat(50));
    console.log(`  Migrated: ${counts.migrated}`);
    console.log(`  Skipped:  ${counts.skipped}`);
    console.log(`  Failed:   ${counts.failed}`);
    console.log(`  Total:    ${counts.total}`);

    if (this.#failed.length > 0) {
      console.log("\nFailures:");
      for (const entry of this.#failed) {
        console.log(`  • ${entry.type} ${entry.oldId}: ${entry.error}`);
      }
    }

    console.log("═".repeat(50) + "\n");
  }

  /**
   * Exports all logs as a JSON-serializable object.
   *
   * @returns {{ migrated: MigratedEntry[], skipped: SkippedEntry[], failed: FailedEntry[] }}
   */
  toJSON() {
    return {
      migrated: [...this.#migrated],
      skipped: [...this.#skipped],
      failed: [...this.#failed],
    };
  }

  /**
   * Returns counts for each log category.
   *
   * @returns {{ migrated: number, skipped: number, failed: number, total: number }}
   */
  getCounts() {
    return {
      migrated: this.#migrated.length,
      skipped: this.#skipped.length,
      failed: this.#failed.length,
      total: this.#migrated.length + this.#skipped.length + this.#failed.length,
    };
  }

  /**
   * Returns all log entries for a specific object type.
   *
   * @param {string} type - Object type to filter by
   * @returns {{ migrated: MigratedEntry[], skipped: SkippedEntry[], failed: FailedEntry[] }}
   */
  getByType(type) {
    return {
      migrated: this.#migrated.filter((e) => e.type === type),
      skipped: this.#skipped.filter((e) => e.type === type),
      failed: this.#failed.filter((e) => e.type === type),
    };
  }

  /**
   * Checks if any failures have been recorded.
   *
   * @returns {boolean}
   */
  hasFailures() {
    return this.#failed.length > 0;
  }
}
