import { addDays, startOfDay, format } from "date-fns";

export function getDays(startDate: Date, count: number = 7) {
  const start = startOfDay(startDate);
  return Array.from({ length: count }).map((_, i) => addDays(start, i));
}

export function formatDateStr(date: Date) {
  return format(date, "yyyy-MM-dd");
}
