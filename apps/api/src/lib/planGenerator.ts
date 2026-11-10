import { addDays } from './dates.js';

export type PlanPace = 'book_30d' | 'steady_1d' | 'custom';

export interface PlanConfig {
  pace: PlanPace;
  topicsPerDay: number; // 3 for book_30d, 1 for steady_1d, or custom 1..3
  includeL900: boolean;
}

export interface GeneratedPlanTask {
  orderNo: number;
  type:
    | 'learn_core'
    | 'review_core'
    | 'learn_basic'
    | 'learn_l800'
    | 'learn_l900'
    | 'daily_checkup'
    | 'practice_test'
    | 'idioms';
  topicDayNo?: number;
  exerciseCode?: string;
}

export interface GeneratedPlanDay {
  dayIndex: number;
  date: string; // YYYY-MM-DD
  phase: number;
  label: string;
  tasks: GeneratedPlanTask[];
}

/**
 * Generates the full 3-phase study schedule following Hackers TOEIC Vocabulary's 800+ plan:
 * - Phase 1: Learn Core Vocabulary + Daily Checkup for each topic (1..30)
 * - Phase 2: Review Core Vocabulary + Learn Basic TOEIC Vocabulary for each topic (1..30)
 * - Phase 3: Review Core Vocabulary + Learn 800-level Vocabulary (+ Practice Tests 1/2/3 at Day 10/20/30)
 */
export function generateStudySchedule(
  startDateYmd: string,
  config: PlanConfig
): GeneratedPlanDay[] {
  const k = Math.max(1, Math.min(5, config.topicsPerDay));
  const groups: number[][] = [];
  for (let d = 1; d <= 30; d += k) {
    const chunk: number[] = [];
    for (let j = d; j < d + k && j <= 30; j++) {
      chunk.push(j);
    }
    groups.push(chunk);
  }

  const days: GeneratedPlanDay[] = [];
  let dayIdx = 1;

  // Phase 1: Core words + Daily Checkup
  for (const chunk of groups) {
    const tasks: GeneratedPlanTask[] = [];
    let order = 1;
    for (const dayNo of chunk) {
      tasks.push({ orderNo: order++, type: 'learn_core', topicDayNo: dayNo });
      tasks.push({ orderNo: order++, type: 'daily_checkup', topicDayNo: dayNo });
    }
    if (chunk.includes(30)) {
      tasks.push({ orderNo: order++, type: 'idioms' });
    }
    days.push({
      dayIndex: dayIdx,
      date: addDays(startDateYmd, dayIdx - 1),
      phase: 1,
      label: `Giai đoạn 1 — Từ trọng tâm (Day ${chunk.join(', ')})`,
      tasks,
    });
    dayIdx++;
  }

  // Phase 2: Review Core + Learn Basic TOEIC Vocab
  for (const chunk of groups) {
    const tasks: GeneratedPlanTask[] = [];
    let order = 1;
    for (const dayNo of chunk) {
      tasks.push({ orderNo: order++, type: 'review_core', topicDayNo: dayNo });
      tasks.push({ orderNo: order++, type: 'learn_basic', topicDayNo: dayNo });
    }
    if (chunk.includes(30)) {
      tasks.push({ orderNo: order++, type: 'idioms' });
    }
    days.push({
      dayIndex: dayIdx,
      date: addDays(startDateYmd, dayIdx - 1),
      phase: 2,
      label: `Giai đoạn 2 — Ôn trọng tâm & Từ cơ bản (Day ${chunk.join(', ')})`,
      tasks,
    });
    dayIdx++;
  }

  // Phase 3: Review Core + Learn 800-level Vocab + Practice Tests 1, 2, 3
  for (const chunk of groups) {
    const tasks: GeneratedPlanTask[] = [];
    let order = 1;
    for (const dayNo of chunk) {
      tasks.push({ orderNo: order++, type: 'review_core', topicDayNo: dayNo });
      tasks.push({ orderNo: order++, type: 'learn_l800', topicDayNo: dayNo });
      if (config.includeL900) {
        tasks.push({ orderNo: order++, type: 'learn_l900', topicDayNo: dayNo });
      }
      if (dayNo === 10) {
        tasks.push({ orderNo: order++, type: 'practice_test', exerciseCode: 'practice-1' });
      } else if (dayNo === 20) {
        tasks.push({ orderNo: order++, type: 'practice_test', exerciseCode: 'practice-2' });
      } else if (dayNo === 30) {
        tasks.push({ orderNo: order++, type: 'practice_test', exerciseCode: 'practice-3' });
      }
    }
    if (chunk.includes(30)) {
      tasks.push({ orderNo: order++, type: 'idioms' });
    }
    days.push({
      dayIndex: dayIdx,
      date: addDays(startDateYmd, dayIdx - 1),
      phase: 3,
      label: `Giai đoạn 3 — Chinh phục 800+ & Luyện đề (Day ${chunk.join(', ')})`,
      tasks,
    });
    dayIdx++;
  }

  return days;
}

