/**
 * Leitner 5-box spaced repetition system:
 * Box 0: new / failed → due in 1 day
 * Box 1: 1 day
 * Box 2: 3 days
 * Box 3: 7 days
 * Box 4: 14 days
 * Box 5: 30 days (mastered)
 */

const BOX_INTERVALS_DAYS = [1, 1, 3, 7, 14, 30];

export interface LeitnerUpdateInput {
  box: number;
  correctCount: number;
  wrongCount: number;
  streak: number;
  weak: boolean;
}

export interface LeitnerUpdateOutput {
  status: 'new' | 'learning' | 'review' | 'mastered';
  box: number;
  dueAt: Date;
  correctCount: number;
  wrongCount: number;
  streak: number;
  weak: boolean;
  lastSeenAt: Date;
}

export function computeLeitnerUpdate(
  prev: LeitnerUpdateInput | null,
  correct: boolean,
  now: Date = new Date()
): LeitnerUpdateOutput {
  const cur = prev ?? {
    box: 0,
    correctCount: 0,
    wrongCount: 0,
    streak: 0,
    weak: false,
  };

  let nextBox = cur.box;
  let nextStreak = cur.streak;
  let nextWeak = cur.weak;

  if (correct) {
    nextStreak += 1;
    nextBox = Math.min(5, cur.box + 1);
    if (nextStreak >= 2) {
      nextWeak = false;
    }
  } else {
    nextStreak = 0;
    nextBox = Math.max(1, cur.box - 1);
    nextWeak = true;
  }

  const intervalDays = BOX_INTERVALS_DAYS[nextBox] ?? 1;
  const dueAt = new Date(now.getTime() + intervalDays * 86_400_000);

  let status: 'new' | 'learning' | 'review' | 'mastered' = 'learning';
  if (nextBox >= 5) {
    status = 'mastered';
  } else if (nextBox >= 2) {
    status = 'review';
  }

  return {
    status,
    box: nextBox,
    dueAt,
    correctCount: cur.correctCount + (correct ? 1 : 0),
    wrongCount: cur.wrongCount + (correct ? 0 : 1),
    streak: nextStreak,
    weak: nextWeak,
    lastSeenAt: now,
  };
}

