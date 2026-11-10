import { describe, expect, it } from 'vitest';
import {
  advanceStudyStep,
  createInitialSessionState,
  submitQuizAnswer,
  WordForQuiz,
} from './lib/sessionEngine.js';
import { generateStudySchedule } from './lib/planGenerator.js';
import { computeLeitnerUpdate } from './lib/srs.js';

function makeMockWords(count: number): WordForQuiz[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    headword: `word_${i + 1}`,
    pos: 'n',
    meaningVi: `nghĩa_${i + 1}`,
    ipaUk: 'ipa',
    ipaUs: 'ipa',
    exampleEn: `This is **word_${i + 1}** in a sentence.`,
    exampleVi: `Đây là câu ví dụ ${i + 1}.`,
  }));
}

describe('Learning Engine (5 words -> 20 checkpoint -> topic test)', () => {
  it('progresses through 5-word batches, triggers 20-word checkpoint, and finishes with full topic test', () => {
    const pool = makeMockWords(25);
    const wordIds = pool.map((w) => w.id);
    let state = createInitialSessionState(
      wordIds,
      { batchSize: 5, checkpointSize: 20, passRate: 0.8, gate: true },
      'learn',
      pool
    );

    expect(state.step).toBe('study_batch');
    expect(state.currentStudyWordIds).toEqual([1, 2, 3, 4, 5]);

    // Helper to finish studying current batch
    const studyAllCards = () => {
      while (state.step === 'study_batch' || state.step === 'remedial_study') {
        state = advanceStudyStep(state, pool);
      }
    };

    // Helper to answer all active quiz questions correctly
    const answerAllCorrect = () => {
      const activeStep = state.step;
      while (state.step === activeStep) {
        const q = state.quizQueue[state.quizCursor];
        const res = submitQuizAnswer(state, q.correctAnswer, pool);
        state = res.state;
      }
    };

    // Batch 1 (words 1..5)
    studyAllCards();
    expect(state.step).toBe('quick_test');
    expect(state.quizQueue).toHaveLength(5);
    answerAllCorrect();

    // Batch 2 (words 6..10)
    expect(state.step).toBe('study_batch');
    expect(state.batchStartIndex).toBe(5);
    studyAllCards();
    expect(state.step).toBe('quick_test');
    answerAllCorrect();

    // Batch 3 (words 11..15)
    expect(state.step).toBe('study_batch');
    expect(state.batchStartIndex).toBe(10);
    studyAllCards();
    answerAllCorrect();

    // Batch 4 (words 16..20) -> after quick_test, should trigger 20-word checkpoint_test!
    expect(state.step).toBe('study_batch');
    expect(state.batchStartIndex).toBe(15);
    studyAllCards();
    expect(state.step).toBe('quick_test');
    answerAllCorrect();

    expect(state.step).toBe('checkpoint_test');
    expect(state.quizQueue).toHaveLength(20);
    answerAllCorrect();

    // Batch 5 (words 21..25) -> last 5 words
    expect(state.step).toBe('study_batch');
    expect(state.batchStartIndex).toBe(20);
    studyAllCards();
    expect(state.step).toBe('quick_test');
    answerAllCorrect();

    // End of topic reached -> checkpoint on remaining 5 words (21..25)
    expect(state.step).toBe('checkpoint_test');
    expect(state.quizQueue).toHaveLength(5);
    answerAllCorrect();

    // Final Topic Test on all 25 words
    expect(state.step).toBe('topic_test');
    expect(state.quizQueue).toHaveLength(25);
    answerAllCorrect();

    expect(state.step).toBe('completed');
    expect(state.completedCheckpoints).toBe(2);
  });

  it('sends wrong words to remedial_study when quick_test fails', () => {
    const pool = makeMockWords(5);
    let state = createInitialSessionState(
      [1, 2, 3, 4, 5],
      { batchSize: 5, checkpointSize: 20, passRate: 0.8, gate: true },
      'learn',
      pool
    );

    while (state.step === 'study_batch') {
      state = advanceStudyStep(state, pool);
    }
    expect(state.step).toBe('quick_test');

    // Answer first question wrong, rest right
    const firstQ = state.quizQueue[0];
    state = submitQuizAnswer(state, 'wrong_answer', pool).state;
    for (let i = 1; i < 5; i++) {
      const q = state.quizQueue[state.quizCursor];
      state = submitQuizAnswer(state, q.correctAnswer, pool).state;
    }

    expect(state.step).toBe('remedial_study');
    expect(state.currentStudyWordIds).toEqual([firstQ.wordId]);
  });
});

describe('Study Plan Generator & Leitner SRS', () => {
  it('generates 30-day book schedule (3 topics/day) and 90-day steady schedule (1 topic/day)', () => {
    const book30 = generateStudySchedule('2026-11-10', {
      pace: 'book_30d',
      topicsPerDay: 3,
      includeL900: false,
    });
    expect(book30).toHaveLength(30);
    expect(book30[0].phase).toBe(1);
    expect(book30[10].phase).toBe(2);
    expect(book30[20].phase).toBe(3);

    const steady90 = generateStudySchedule('2026-11-10', {
      pace: 'steady_1d',
      topicsPerDay: 1,
      includeL900: false,
    });
    expect(steady90).toHaveLength(90);
  });

  it('updates Leitner box and weak flag accurately', () => {
    const s1 = computeLeitnerUpdate(null, false);
    expect(s1.box).toBe(1);
    expect(s1.weak).toBe(true);

    const s2 = computeLeitnerUpdate(s1, true);
    expect(s2.box).toBe(2);
    expect(s2.weak).toBe(true); // needs 2 consecutive correct to clear weak

    const s3 = computeLeitnerUpdate(s2, true);
    expect(s3.box).toBe(3);
    expect(s3.weak).toBe(false);
  });
});

