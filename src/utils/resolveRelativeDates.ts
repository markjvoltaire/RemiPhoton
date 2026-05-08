function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysUTC(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

const WEEKDAY_TO_DOW: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function resolveWeekdayToDateISO(weekdayLower: string, todayUTC: Date, isNext: boolean): string | null {
  const target = WEEKDAY_TO_DOW[weekdayLower];
  if (target === undefined) return null;

  const dow = todayUTC.getUTCDay();
  let delta = (target - dow + 7) % 7;

  // For plain "monday", allow "today" if today is Monday (delta=0).
  // If explicitly "next monday", always mean the following week.
  if (delta === 0 && !isNext) {
    return formatDate(todayUTC);
  }

  if (delta === 0) delta = 7;
  if (isNext) delta += 7;

  return formatDate(addDaysUTC(todayUTC, delta));
}

export function resolveRelativeDates(text: string, todayISO: string): { resolvedText: string; changed: boolean } {
  // Keep this intentionally small + deterministic for SMS: weekdays, today, tomorrow.
  const todayUTC = new Date(`${todayISO}T00:00:00.000Z`);
  if (Number.isNaN(todayUTC.getTime())) return { resolvedText: text, changed: false };

  let changed = false;
  let out = text;

  // today / tomorrow
  out = out.replace(/\b(today)\b/gi, () => {
    changed = true;
    return todayISO;
  });
  out = out.replace(/\b(tomorrow)\b/gi, () => {
    changed = true;
    return formatDate(addDaysUTC(todayUTC, 1));
  });

  // next <weekday> OR <weekday>
  out = out.replace(
    /\b(?:(next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    (match, nextWord: string | undefined, weekday: string) => {
      const resolved = resolveWeekdayToDateISO(String(weekday).toLowerCase(), todayUTC, Boolean(nextWord));
      if (!resolved) return match;
      changed = true;
      return resolved;
    },
  );

  return { resolvedText: out, changed };
}

