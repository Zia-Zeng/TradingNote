export const SAVED_RESULTS_EVENT = 'tradingnote:saved-results-updated';

export function saveLocalResult(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(SAVED_RESULTS_EVENT));
}

export function readLocalResult<T>(key: string): T | null {
  const value = localStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
