export const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
export const UPDATE_SNOOZE = 2 * 24 * 60 * 60 * 1000;

export interface UpdateSchedule { checkedAt: number; remindAt: number }
export type UpdateCheckReason = 'startup' | 'scheduled' | 'manual';

export function readSchedule(value: unknown, now: number): UpdateSchedule {
  const saved = value && typeof value === 'object' ? value as Partial<UpdateSchedule> : {};
  return {
    checkedAt: Number.isFinite(saved.checkedAt) && saved.checkedAt! >= 0 && saved.checkedAt! <= now ? saved.checkedAt! : 0,
    remindAt: Number.isFinite(saved.remindAt) && saved.remindAt! > now ? Math.min(saved.remindAt!, now + UPDATE_SNOOZE) : 0,
  };
}

export function shouldCheck(schedule: UpdateSchedule, now: number, reason: UpdateCheckReason = 'scheduled'): boolean {
  if (reason === 'manual') return true;
  if (now < schedule.remindAt) return false;
  return reason === 'startup' || schedule.checkedAt === 0 || now - schedule.checkedAt >= UPDATE_INTERVAL;
}
