/**
 * Parses a time string (e.g., "0h30", "1.5h", "1d", "30p") into a float number of hours.
 * 1d = 8 hours (working day)
 */
export function parseTimeToHours(input: string): number {
  const clean = input.toLowerCase().replace(/,/g, ".").trim();
  if (!clean) return 0;

  // Pattern for days: e.g., "1d", "1.5d", "1 d"
  const dayMatch = clean.match(/^([\d.]+)\s*d$/);
  if (dayMatch) {
    return parseFloat(dayMatch[1]) * 8; // 1d = 8h
  }

  // Pattern for hours and minutes: e.g., "1h30", "0h30", "1h30p", "1h30m"
  const hmMatch = clean.match(/^(\d+)\s*h\s*(\d+)\s*(m|p|min)?$/);
  if (hmMatch) {
    const hours = parseInt(hmMatch[1], 10);
    const minutes = parseInt(hmMatch[2], 10);
    return hours + minutes / 60;
  }

  // Pattern for hours only: e.g., "1.5h", "2h", "1 h"
  const hMatch = clean.match(/^([\d.]+)\s*h$/);
  if (hMatch) {
    return parseFloat(hMatch[1]);
  }

  // Pattern for minutes only: e.g., "30m", "15p", "45 min"
  const mMatch = clean.match(/^(\d+)\s*(m|p|min)$/);
  if (mMatch) {
    return parseInt(mMatch[1], 10) / 60;
  }

  // Fallback to plain number
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Formats a float number of hours into a human-readable time string.
 * - Multiples of 8 hours are formatted as days, e.g. 8 -> "1d", 12 -> "1.5d".
 * - Fractional hours are formatted as e.g. "0.5" -> "30p" or "1h30".
 */
export function formatHours(hours: number): string {
  if (hours <= 0) return "0h";

  // If it is divisible by 8 (multiples of days)
  if (hours % 8 === 0) {
    return `${hours / 8}d`;
  }

  // Fractional days (e.g. 12 hours -> 1.5d, 20 hours -> 2.5d)
  if (hours > 8) {
    const days = hours / 8;
    if (days % 0.25 === 0) {
      return `${days}d`;
    }
  }

  // Format hours and minutes
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);

  if (h === 0 && m > 0) {
    return `${m}p`;
  }

  if (h > 0 && m > 0) {
    return `${h}h${m.toString().padStart(2, '0')}`;
  }

  return `${h}h`;
}
