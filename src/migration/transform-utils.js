/**
 * Transform utilities for migration data manipulation.
 * All mutating functions modify the object in place for efficiency.
 */

/**
 * Removes specified keys from an object (mutates in place).
 * Non-existent keys are silently ignored.
 *
 * @param {Object} obj - The object to modify
 * @param {...string} keys - Keys to remove
 * @returns {void}
 *
 * @example
 * const data = { a: 1, b: 2, c: 3 };
 * removeKeys(data, 'b', 'd');
 * // data is now { a: 1, c: 3 }
 */
export function removeKeys(obj, ...keys) {
  for (const key of keys) {
    delete obj[key];
  }
}

/**
 * Renames a key in an object (mutates in place).
 * If the old key doesn't exist, no change is made.
 * If the new key already exists, it will be overwritten.
 *
 * @param {Object} obj - The object to modify
 * @param {string} oldKey - The key to rename
 * @param {string} newKey - The new key name
 * @returns {void}
 *
 * @example
 * const data = { oldName: 'value', other: 1 };
 * renameKey(data, 'oldName', 'newName');
 * // data is now { newName: 'value', other: 1 }
 */
export function renameKey(obj, oldKey, newKey) {
  if (oldKey === newKey || !Object.hasOwn(obj, oldKey)) {
    return;
  }
  obj[newKey] = obj[oldKey];
  delete obj[oldKey];
}

/**
 * Adds default values to an object for keys that don't exist (mutates in place).
 * Existing keys are preserved, including those with null values.
 *
 * @param {Object} obj - The object to modify
 * @param {Object} defaults - Object containing default key-value pairs
 * @returns {void}
 *
 * @example
 * const data = { a: 1, b: null };
 * addDefaults(data, { b: 'default', c: 3 });
 * // data is now { a: 1, b: null, c: 3 }
 */
export function addDefaults(obj, defaults) {
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(obj, key)) {
      obj[key] = defaults[key];
    }
  }
}

/**
 * Returns a new object containing only the specified keys from the source.
 * Non-existent keys are ignored. Original object is not modified.
 *
 * @param {Object} obj - The source object
 * @param {...string} keys - Keys to include in the result
 * @returns {Object} A new object with only the specified keys
 *
 * @example
 * const data = { a: 1, b: 2, c: 3 };
 * const result = pick(data, 'a', 'c', 'missing');
 * // result is { a: 1, c: 3 }, data unchanged
 */
export function pick(obj, ...keys) {
  const result = {};
  for (const key of keys) {
    if (Object.hasOwn(obj, key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Returns a new object containing all keys except the specified ones.
 * Non-existent keys to omit are silently ignored. Original object is not modified.
 *
 * @param {Object} obj - The source object
 * @param {...string} keys - Keys to exclude from the result
 * @returns {Object} A new object without the specified keys
 *
 * @example
 * const data = { a: 1, b: 2, c: 3 };
 * const result = omit(data, 'b');
 * // result is { a: 1, c: 3 }, data unchanged
 */
export function omit(obj, ...keys) {
  const keysToOmit = new Set(keys);
  const result = {};
  for (const key of Object.keys(obj)) {
    if (!keysToOmit.has(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}
