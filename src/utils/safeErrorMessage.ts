function toLogValue(v: unknown): unknown {
  if (v == null || typeof v !== 'object') return v;
  try {
    const o = v as Record<string, unknown>;
    if (typeof o.retCode !== 'undefined' || typeof o.retMsg !== 'undefined')
      return { retCode: o.retCode, retMsg: o.retMsg, result: o.result };
    if (typeof o.data !== 'undefined') return { data: toLogValue(o.data) };
    if (typeof o.status !== 'undefined' && typeof o.statusText !== 'undefined')
      return { status: o.status, statusText: o.statusText, data: toLogValue(o.data) };
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Serialize an error for full logging (message, stack, response body, retCode, etc.).
 * Use when you need to log why a request failed (e.g. Forbidden).
 * Nested objects are flattened so logs don't show [object Object].
 */
export function serializeErrorForLog(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err == null) return out;
  if (err instanceof Error) {
    out.message = err.message;
    out.name = err.name;
    if (err.stack) out.stack = err.stack;
    const anyErr = err as unknown as Record<string, unknown>;
    if (anyErr.response != null) out.response = toLogValue(anyErr.response);
    if (anyErr.body != null) out.body = toLogValue(anyErr.body);
    if (anyErr.status != null) out.status = anyErr.status;
    if (anyErr.code != null) out.code = anyErr.code;
    if (anyErr.retCode != null) out.retCode = anyErr.retCode;
    if (anyErr.retMsg != null) out.retMsg = anyErr.retMsg;
    return out;
  }
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>;
    for (const k of ['message', 'msg', 'retMsg', 'retCode', 'code', 'status', 'response', 'body']) {
      if (o[k] !== undefined) out[k] = toLogValue(o[k]);
    }
  }
  return out;
}

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
