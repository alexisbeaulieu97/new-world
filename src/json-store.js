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

      const loadedData = await this.#readOrCreateDefault();

      this.#data = loadedData;
      this.#initialized = true;
      this.#dirty = false;
      return this;
    });
  }

  /**
   * Reads existing file or creates default data.
   * @returns {Promise<T>}
   */
  async #readOrCreateDefault() {
    /** @type {string} */
    let content;

    try {
      content = await readFile(this.#filePath, "utf-8");
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") {
        throw err;
      }
      // File doesn't exist - create with defaults
      const defaultData = this.#defaultFactory();
      await this.#writeAtomic(defaultData);
      return defaultData;
    }

    try {
      return JSON.parse(content);
    } catch (parseError) {
      throw new Error(
        `Failed to parse JSON from ${this.#filePath}: ${/** @type {Error} */ (parseError).message}`,
        { cause: parseError }
      );
    }
  }

  /**
   * Reloads data from disk, discarding any unsaved changes.
   *
   * Requires that load() was called first. Unlike load(), this does NOT
   * create the file if it doesn't exist - it throws an error instead.
   *
   * @returns {Promise<this>}
   * @throws {Error} If not initialized, file doesn't exist, or JSON is malformed
   */
  async reload() {
    this.#assertInitialized();
    return this.#mutex.runExclusive(async () => {
      /** @type {string} */
      let content;
      try {
        content = await readFile(this.#filePath, "utf-8");
      } catch (err) {
        if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
          throw new Error(`File does not exist: ${this.#filePath}`, {
            cause: err,
          });
        }
        throw err;
      }

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
   * Writes data to the JSON file atomically.
   *
   * Uses write-to-temp + fsync + rename pattern for durability.
   * Cleans up temp file on failure.
   *
   * @param {T} data - The data to write
   * @returns {Promise<void>}
   */
  async #writeAtomic(data) {
    const tmpPath = `${this.#filePath}.${randomUUID()}.tmp`;

    try {
      const handle = await open(tmpPath, "w");
      try {
        await handle.writeFile(JSON.stringify(data, null, 2), "utf-8");
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
      await this.#writeAtomic(this.#data);
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
      const backup = structuredClone(this.#data);
      try {
        if (typeof updater === "function") {
          const cloned = structuredClone(this.#data);
          updater(cloned);
          this.#data = cloned;
        } else {
          this.#data = { ...this.#data, ...updater };
        }
        await this.#writeAtomic(this.#data);
        this.#dirty = false;
      } catch (err) {
        this.#data = backup;
        throw err;
      }
    });
  }

  /**
   * Validates that all keys are strings or finite numbers.
   * @param {unknown[]} keys
   * @returns {(string | number)[]}
   */
  #validateKeys(keys) {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof key === "number") {
        if (!Number.isFinite(key)) {
          throw new Error(
            `Invalid key at index ${i}: numbers must be finite (got ${key})`
          );
        }
      } else if (typeof key !== "string") {
        throw new Error(
          `Invalid key at index ${i}: expected string or number, got ${typeof key}`
        );
      }
    }
    return /** @type {(string | number)[]} */ (keys);
  }

  /**
   * Formats a path for error messages (e.g., "foo.bar[0].baz").
   * @param {(string | number)[]} keys
   * @returns {string}
   */
  #formatPath(keys) {
    if (keys.length === 0) return "(empty path)";

    let result = "";
    for (const key of keys) {
      if (typeof key === "number") {
        result += `[${key}]`;
      } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
        // Valid JS identifier - use dot notation
        result += result ? `.${key}` : key;
      } else {
        // Needs bracket notation
        result += `[${JSON.stringify(key)}]`;
      }
    }
    return result;
  }

  /**
   * Walks a path and sets a value, creating intermediate objects as needed.
   * @param {Record<string | number, unknown>} data - The root object to modify
   * @param {(string | number)[]} keys - The path segments
   * @param {unknown} value - The value to set
   */
  #setAtPath(data, keys, value) {
    /** @type {Record<string | number, unknown>} */
    let current = data;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const nextKey = keys[i + 1];

      if (current[key] == null) {
        if (typeof nextKey === "number") {
          const pathKeys = keys.slice(0, i + 1);
          const pathStr = this.#formatPath(pathKeys);
          const keysStr = pathKeys.map((k) => JSON.stringify(k)).join(", ");
          throw new Error(
            `Cannot auto-create array at '${pathStr}'. ` +
              `Initialize it first with setPath([${keysStr}], [])`
          );
        }
        current[key] = {};
      }

      const next = current[key];
      if (next == null || typeof next !== "object") {
        throw new Error(
          `Cannot traverse through non-object at '${this.#formatPath(keys.slice(0, i + 1))}'`
        );
      }
      current = /** @type {Record<string | number, unknown>} */ (next);
    }

    current[keys[keys.length - 1]] = value;
  }

  /**
   * Gets a value at a nested path.
   *
   * Works with both objects and arrays. Returns undefined if any segment
   * of the path doesn't exist.
   *
   * Note: This method does not acquire the mutex. If called concurrently with
   * write operations, you may read intermediate state. For sequential scripts,
   * this is not an issue.
   *
   * @param {...(string | number)} keys - The path segments
   * @returns {unknown} The value at the path, or undefined if not found
   *
   * @example
   * store.getPath('inventories', 'INV-123', 'kyndryl', 'prod') // → newID or undefined
   * store.getPath('projects', 'PROJ-456') // → newID or undefined
   * store.getPath('items', 0, 'name') // → works with arrays too
   */
  getPath(...keys) {
    this.#assertInitialized();
    const validKeys = this.#validateKeys(keys);

    /** @type {unknown} */
    let current = this.#data;
    for (const key of validKeys) {
      if (current == null || typeof current !== "object") {
        return undefined;
      }
      current = /** @type {Record<string | number, unknown>} */ (current)[key];
    }
    return current;
  }

  /**
   * Checks if a value exists at a nested path (is not undefined).
   *
   * @param {...(string | number)} keys - The path segments
   * @returns {boolean}
   *
   * @example
   * if (store.hasPath('inventories', oldID, 'kyndryl', 'prod')) {
   *   // Already migrated
   * }
   */
  hasPath(...keys) {
    return this.getPath(...keys) !== undefined;
  }

  /**
   * Sets a value at a nested path, creating intermediate objects as needed.
   *
   * - Auto-creates missing intermediate objects
   * - Throws if a numeric key would require auto-creating an array (arrays must be initialized explicitly)
   * - Throws if the path traverses through a non-object/non-array value
   *
   * @param {(string | number)[]} keys - The path segments (must be non-empty)
   * @param {unknown} value - The value to set
   *
   * @example
   * store.setPath(['inventories', 'INV-123', 'kyndryl', 'prod'], 'NEW-789');
   * store.setPath(['projects', 'PROJ-456'], 'NEW-123');
   *
   * // For arrays, initialize first:
   * store.setPath(['items'], []);
   * store.setPath(['items', 0], { name: 'first' });
   */
  setPath(keys, value) {
    const validKeys = this.#validateKeys(keys);
    if (validKeys.length === 0) {
      throw new Error("Path cannot be empty");
    }

    this.update((data) => {
      this.#setAtPath(data, validKeys, value);
    });
  }

  /**
   * Sets a value at a nested path and immediately saves to disk.
   *
   * Combines setPath + save atomically. If the save fails, changes are rolled back.
   *
   * @param {(string | number)[]} keys - The path segments (must be non-empty)
   * @param {unknown} value - The value to set
   * @returns {Promise<void>}
   *
   * @example
   * await store.setPathAndSave(['inventories', 'INV-123', 'kyndryl', 'prod'], 'NEW-789');
   */
  async setPathAndSave(keys, value) {
    const validKeys = this.#validateKeys(keys);
    if (validKeys.length === 0) {
      throw new Error("Path cannot be empty");
    }

    await this.updateAndSave((data) => {
      this.#setAtPath(data, validKeys, value);
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
   * Returns a deep clone of the internal data for subclasses.
   * Alias for `data` getter, provided for semantic clarity in subclass code.
   *
   * @returns {T}
   * @protected
   */
  _getDataSnapshot() {
    this.#assertInitialized();
    return structuredClone(this.#data);
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
