const pad = (value: number) => String(value).padStart(2, '0');

export function currentLocalDateTime(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function currentLocalDate(): string {
  return currentLocalDateTime().slice(0, 10);
}

export function hasTradeDate(value?: string): boolean {
  return Boolean(value && /^\d{4}[-/]?\d{2}[-/]?\d{2}/.test(value.trim()));
}

export function tradeDateTimeFields(value?: string | Date): { date: string; time: string } {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return {
      date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
      time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
    };
  }
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
    || text.match(/^(\d{4})(\d{2})(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    return {
      date: `${year}-${pad(Number(month))}-${pad(Number(day))}`,
      time: hour === undefined ? '' : `${pad(Number(hour))}:${minute}`,
    };
  }
  const clock = text.match(/^(\d{1,2}):(\d{2})/);
  if (clock) return { date: currentLocalDate(), time: `${pad(Number(clock[1]))}:${clock[2]}` };
  return { date: currentLocalDate(), time: '' };
}

export function toStoredTradeTime(date: string, time?: string): string {
  return time ? `${date} ${time}` : date;
}

export function formatTradeTimestamp(value?: string): { date?: string; time?: string } {
  const text = String(value ?? '').trim();
  const dateMatch = text.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  const clockMatch = text.match(/(?:T|\s)?(\d{1,2}):(\d{2})/);
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : undefined;
  const time = clockMatch ? `${pad(Number(clockMatch[1]))}:${clockMatch[2]}` : undefined;
  return { date, time };
}
