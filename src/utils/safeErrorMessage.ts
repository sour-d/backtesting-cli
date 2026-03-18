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
