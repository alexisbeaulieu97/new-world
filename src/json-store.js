// @ts-check

import { randomUUID } from "node:crypto";
import { access, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Simple async mutex for serializing operations within a single process.
 *
 * Note: Does NOT provide cross-process locking. For multi-process safety,
 * use external file locking mechanisms (e.g., proper-lockfile, fs-ext).
 *
 * Limitation: No timeout or cancellation support. If an operation hangs,
 * all subsequent queued operations will stall indefinitely.
 */
class AsyncMutex {
  /** @type {Promise<void>} */
  #queue = Promise.resolve();

  /**
   * Execute a function with exclusive access.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async runExclusive(fn) {
    /** @type {() => void} */
    let release;
    /** @type {Promise<void>} */
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const prev = this.#queue;
    this.#queue = next;
    await prev;
    try {
      return await fn();
    } finally {
      // @ts-expect-error - release is assigned synchronously in Promise constructor before await
      release();
    }
  }
}

/**
 * A JSON file-backed data store with atomic writes and dirty tracking.
 *
 * Features:
 * - Atomic writes using temp file + rename
 * - fsync for durability (survives process crash, best-effort for power loss)
 * - Dirty tracking for unsaved changes
 * - Mutex for serializing concurrent operations within a single process
 *
 * Limitations:
 * - Single-process only: No cross-process locking. Multiple processes writing
 *   to the same file will cause data loss. Use external locking if needed.
 * - Requires Node.js 17+ (uses structuredClone)
 * - Durability caveat: fsync is performed on the file but NOT on the directory
 *   after rename. On power loss, the rename may not be durable on all filesystems.
 *   This provides "best-effort" durability, not full ACID guarantees.
 *
 * @template {Record<string, unknown>} [T=Record<string, unknown>]
 */
export class JSONStore {
  /** @type {string} */
  #filePath;

  /** @type {T} */
  #data;

  /** @type {boolean} */
  #initialized = false;

  /** @type {boolean} */
  #dirty = false;

  /** @type {AsyncMutex} */
  #mutex = new AsyncMutex();

  /** @type {() => T} */
  #defaultFactory;

  /**
   * Creates a new JSONStore instance.
   *
   * @param {string} filePath - Path to the JSON file
   * @param {object} [options] - Configuration options
   * @param {() => T} [options.defaultFactory] - Factory function returning default data when file doesn't exist. Defaults to empty object.
   */
  constructor(filePath, options = {}) {
    this.#filePath = filePath;
    this.#defaultFactory =
      options.defaultFactory ?? (() => /** @type {T} */ ({}));
    this.#data = this.#defaultFactory();
  }

  /**
   * Loads data from the JSON file. Creates default data if file doesn't exist.
   * Must be called before accessing data.
   *
   * @returns {Promise<this>}
   * @throws {Error} If directory doesn't exist, JSON is malformed, or write fails
   */
  async load() {
    return this.#mutex.runExclusive(async () => {
      const dir = dirname(this.#filePath);
      try {
        await access(dir);
      } catch {
        throw new Error(`Directory does not exist: ${dir}`);
      }

      /** @type {T} */
      let loadedData;

      try {
        const content = await readFile(this.#filePath, "utf-8");
        try {
          loadedData = JSON.parse(content);
        } catch (parseError) {
          throw new Error(
            `Failed to parse JSON from ${this.#filePath}: ${/** @type {Error} */ (parseError).message}`,
            { cause: parseError }
          );
        }
      } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
          loadedData = this.#defaultFactory();
          // Temporarily set data for writeAtomic, restore on failure
          const originalData = this.#data;
          this.#data = loadedData;
          try {
            await this.#writeAtomic();
          } catch (writeErr) {
            this.#data = originalData;
            throw writeErr;
          }
        } else {
          throw err;
        }
      }

      this.#data = loadedData;
      this.#initialized = true;
      this.#dirty = false;
      return this;
    });
  }

  /**
   * Reloads data from disk, discarding any unsaved changes.
   *
   * Requires that load() was called first. Unlike load(), this does NOT
   * create the file if it doesn't exist - it throws ENOENT instead.
   *
   * @returns {Promise<this>}
   * @throws {Error} If not initialized, file doesn't exist, or JSON is malformed
   */
  async reload() {
    this.#assertInitialized();
    return this.#mutex.runExclusive(async () => {
      const content = await readFile(this.#filePath, "utf-8");
      /** @type {T} */
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        throw new Error(
          `Failed to parse JSON from ${this.#filePath}: ${/** @type {Error} */ (parseError).message}`,
          { cause: parseError }
        );
      }
      // Only update state after successful parse
      this.#data = parsed;
      this.#dirty = false;
      return this;
    });
  }

  /**
   * Writes current data to the JSON file atomically.
   *
   * Uses write-to-temp + fsync + rename pattern for durability.
   * Cleans up temp file on failure.
   *
   * @returns {Promise<void>}
   */
  async #writeAtomic() {
    const tmpPath = `${this.#filePath}.${randomUUID()}.tmp`;

    try {
      const handle = await open(tmpPath, "w");
      try {
        await handle.writeFile(JSON.stringify(this.#data, null, 2), "utf-8");
        await handle.sync();
      } finally {
        await handle.close();
      }

      await rename(tmpPath, this.#filePath);
    } catch (err) {
      try {
        await unlink(tmpPath);
      } catch {
        // Ignore cleanup errors - file may not exist
      }
      throw err;
    }
  }

  /**
   * Returns a deep clone of the current data.
   *
   * Note: Uses structuredClone which may be expensive for large data.
   * For read-only access in subclasses, use _getDataSnapshot() instead.
   *
   * @returns {T}
   */
  get data() {
    this.#assertInitialized();
    return structuredClone(this.#data);
  }

  /**
   * Returns whether there are unsaved changes.
   * @returns {boolean}
   */
  get isDirty() {
    return this.#dirty;
  }

  /**
   * Returns whether the store has been initialized via load().
   * @returns {boolean}
   */
  get isInitialized() {
    return this.#initialized;
  }

  /**
   * Updates the store data in memory without saving to disk.
   *
   * Accepts either:
   * - A partial object for shallow merge (nested objects are replaced, not merged)
   * - A function that receives a clone and mutates it (changes applied only if function succeeds)
   *
   * @param {Partial<T> | ((current: T) => void)} updater - Object to shallow merge, or function that mutates a clone
   * @returns {void}
   */
  update(updater) {
    this.#assertInitialized();

    if (typeof updater === "function") {
      const cloned = structuredClone(this.#data);
      updater(cloned);
      this.#data = cloned;
    } else {
      this.#data = { ...this.#data, ...updater };
    }

    this.#dirty = true;
  }

  /**
   * Saves the current data to disk.
   *
   * @returns {Promise<void>}
   */
  async save() {
    this.#assertInitialized();
    await this.#mutex.runExclusive(async () => {
      await this.#writeAtomic();
      this.#dirty = false;
    });
  }

  /**
   * Updates the store data and immediately saves to disk.
   *
   * This is atomic: if the save fails, in-memory changes are rolled back.
   *
   * @param {Partial<T> | ((current: T) => void)} updater - Object to shallow merge, or function that mutates a clone
   * @returns {Promise<void>}
   */
  async updateAndSave(updater) {
    this.#assertInitialized();
    await this.#mutex.runExclusive(async () => {
      const backup = this.#data;
      try {
        if (typeof updater === "function") {
          const cloned = structuredClone(this.#data);
          updater(cloned);
          this.#data = cloned;
        } else {
          this.#data = { ...this.#data, ...updater };
        }
        await this.#writeAtomic();
        this.#dirty = false;
      } catch (err) {
        this.#data = backup;
        throw err;
      }
    });
  }

  /**
   * Returns the file path for this store.
   * @returns {string}
   * @protected
   */
  _getFilePath() {
    return this.#filePath;
  }

  /**
   * Returns a frozen shallow copy of the internal data for subclasses.
   *
   * The returned object is frozen to prevent accidental mutation that would
   * bypass dirty tracking. For mutations, use update() or _setData().
   *
   * Note: Only the top-level object is frozen (shallow freeze). Nested objects
   * remain mutable. For complex read-modify-write operations, use _runExclusive()
   * to ensure atomicity.
   *
   * @returns {Readonly<T>}
   * @protected
   */
  _getDataSnapshot() {
    this.#assertInitialized();
    return Object.freeze({ ...this.#data });
  }

  /**
   * Directly sets the internal data for subclasses.
   * Marks the store as dirty. Use with caution.
   *
   * @param {T} data
   * @protected
   */
  _setData(data) {
    this.#assertInitialized();
    this.#data = data;
    this.#dirty = true;
  }

  /**
   * Executes a function with exclusive access to the mutex.
   * Useful for subclasses that need to perform atomic read-modify-write operations.
   *
   * @template R
   * @param {() => Promise<R>} fn
   * @returns {Promise<R>}
   * @protected
   */
  _runExclusive(fn) {
    return this.#mutex.runExclusive(fn);
  }

  /**
   * Throws if the store hasn't been initialized via load().
   * @returns {void}
   */
  #assertInitialized() {
    if (!this.#initialized) {
      throw new Error("JSONStore not initialized. Call load() first.");
    }
  }
}
