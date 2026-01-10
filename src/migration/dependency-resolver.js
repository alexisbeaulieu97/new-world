/**
 * Context-aware ID mapping resolver for migration dependencies.
 * Wraps a JSONStore-based ID mapping and provides require/optional semantics
 * with environment and category scoping.
 */

/**
 * Default set of object types that use scoped (env/category) mappings.
 * Other types use simple direct mappings.
 * @type {Set<string>}
 */
const DEFAULT_SCOPED_TYPES = new Set(["inventories", "credentials"]);

/**
 * Validates that a value is a non-empty string.
 * @param {unknown} value - Value to validate
 * @param {string} name - Parameter name for error message
 * @returns {string} - The validated string
 * @throws {TypeError} - If value is not a non-empty string
 */
function validateNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

/**
 * Resolves old IDs to new IDs for migration dependencies.
 * Supports both simple mappings and environment/category-scoped mappings.
 */
export class DependencyResolver {
  /** @type {import('../json-store.js').JSONStore} */
  #idMap;

  /** @type {string} */
  #environment;

  /** @type {string} */
  #category;

  /** @type {Set<string>} */
  #scopedTypes;

  /**
   * Creates a new DependencyResolver instance.
   *
   * @param {import('../json-store.js').JSONStore} idMap - JSONStore instance for ID mappings
   * @param {string} environment - Environment context (e.g., 'prod', 'staging')
   * @param {string} category - Category context (e.g., 'standard', 'kyndryl')
   * @param {object} [options] - Configuration options
   * @param {string[]} [options.scopedTypes] - Object types that use scoped mappings. Defaults to ['inventories', 'credentials']
   */
  constructor(idMap, environment, category, options = {}) {
    this.#idMap = idMap;
    this.#environment = environment;
    this.#category = category;
    this.#scopedTypes = options.scopedTypes
      ? new Set(options.scopedTypes)
      : DEFAULT_SCOPED_TYPES;
  }

  /**
   * The environment context for this resolver.
   * @readonly
   * @type {string}
   */
  get environment() {
    return this.#environment;
  }

  /**
   * The category context for this resolver.
   * @readonly
   * @type {string}
   */
  get category() {
    return this.#category;
  }

  /**
   * Checks if a type uses scoped mappings.
   * @param {string} type - Object type
   * @returns {boolean}
   */
  #isScoped(type) {
    return this.#scopedTypes.has(type);
  }

  /**
   * Resolves a new ID from the mapping store using JSONStore's getPath API.
   * @param {string} type - Object type
   * @param {string} oldId - Original ID
   * @returns {string | null} - New ID or null if not found
   */
  #resolve(type, oldId) {
    // Try scoped path first for scoped types
    if (this.#isScoped(type)) {
      const scopedValue = this.#idMap.getPath(
        type,
        oldId,
        this.#category,
        this.#environment,
      );
      if (typeof scopedValue === "string") {
        return scopedValue;
      }
    }

    // Try simple path (works for non-scoped types, or legacy scoped data)
    const simpleValue = this.#idMap.getPath(type, oldId);
    if (typeof simpleValue === "string") {
      return simpleValue;
    }

    return null;
  }

  /**
   * Requires a mandatory dependency. Throws if the mapping is not found.
   *
   * @param {string} type - Object type (e.g., 'projects', 'inventories')
   * @param {string} oldId - Original ID from source system
   * @returns {string} - New ID in target system
   * @throws {TypeError} - If type or oldId is not a non-empty string
   * @throws {Error} - If the dependency is not found
   */
  require(type, oldId) {
    validateNonEmptyString(type, "type");
    validateNonEmptyString(oldId, "oldId");

    const newId = this.#resolve(type, oldId);

    if (newId === null) {
      throw new Error(
        `Dependency not found: ${type} "${oldId}" for environment "${this.#environment}" and category "${this.#category}" must be migrated first`,
      );
    }

    return newId;
  }

  /**
   * Resolves an optional dependency. Returns null if not found.
   *
   * @param {string} type - Object type (e.g., 'credentials')
   * @param {string | null | undefined} oldId - Original ID, or null/undefined
   * @returns {string | null} - New ID or null if not found or oldId is null/undefined
   * @throws {TypeError} - If type is not a non-empty string
   */
  optional(type, oldId) {
    validateNonEmptyString(type, "type");

    if (oldId === null || oldId === undefined) {
      return null;
    }
    if (typeof oldId !== "string" || oldId.trim() === "") {
      return null;
    }
    return this.#resolve(type, oldId);
  }

  /**
   * Checks if a mapping exists for the given type and old ID.
   *
   * @param {string} type - Object type
   * @param {string} oldId - Original ID
   * @returns {boolean} - True if mapping exists, false otherwise
   * @throws {TypeError} - If type or oldId is not a non-empty string
   */
  has(type, oldId) {
    validateNonEmptyString(type, "type");
    validateNonEmptyString(oldId, "oldId");

    return this.#resolve(type, oldId) !== null;
  }

  /**
   * Records a new ID mapping to the store.
   * Uses scoped mapping for configured types, simple mapping otherwise.
   *
   * @param {string} type - Object type
   * @param {string} oldId - Original ID
   * @param {string} newId - New ID
   * @returns {Promise<void>}
   * @throws {TypeError} - If any parameter is not a non-empty string
   */
  async record(type, oldId, newId) {
    validateNonEmptyString(type, "type");
    validateNonEmptyString(oldId, "oldId");
    validateNonEmptyString(newId, "newId");

    const keys = this.#isScoped(type)
      ? [type, oldId, this.#category, this.#environment]
      : [type, oldId];

    await this.#idMap.setPathAndSave(keys, newId);
  }
}
