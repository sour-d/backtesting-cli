/**
 * Turn an unknown (Error, API object, etc.) into a string for logging.
 * Avoids "[object Object]" when the value is a plain object.
 */
export function safeErrorMessage(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null && 'message' in value && typeof (value as { message: unknown }).message === 'string') {
    return (value as { message: string }).message;
  }
  if (typeof value === 'object' && value !== null && 'msg' in value && typeof (value as { msg: unknown }).msg === 'string') {
    return (value as { msg: string }).msg;
  }
  try {
    const s = JSON.stringify(value);
    if (s !== '{}' && s !== '[]') return s;
  } catch {
    // circular or non-serializable
  }
  return String(value);
}

/**
 * Sanitize log data so no value is stored as an object that would display as "[object Object]".
 * Use before persisting to DB (e.g. in PersistentLogger).
 */
export function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) {
      out[k] = v;
    } else if (typeof v === 'object') {
      if (Array.isArray(v)) {
        out[k] = v.map((x) => (typeof x === 'object' && x !== null ? safeErrorMessage(x) : x));
      } else {
        out[k] = safeErrorMessage(v);
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}
