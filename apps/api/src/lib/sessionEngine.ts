/**
 * Learning Engine State Machine (5 words batch -> Quick 5 test -> 20 words checkpoint -> Full topic test)
 */

export type SessionStep =
  | 'study_batch'
  | 'quick_test'
  | 'checkpoint_test'
  | 'topic_test'
  | 'remedial_study'
  | 'completed';

export type QuestionType = 'en_to_vi' | 'vi_to_en_mc' | 'vi_to_en_type' | 'cloze';

export interface GeneratedQuestion {
  wordId: number;
  qType: QuestionType;
  prompt: string;
  subPrompt?: string;
  options?: string[]; // present for multiple-choice
  correctAnswer: string;
  explanation?: string;
}

export interface SessionConfig {
  batchSize: number; // default 5
  checkpointSize: number; // default 20
  passRate: number; // default 0.8
  gate: boolean; // default true
}

export interface SessionState {
  config: SessionConfig;
  wordIds: number[]; // All target words in this session
  step: SessionStep;

  // Progress pointers
  batchStartIndex: number; // index into wordIds for current 5-word batch
  lastCheckpointIndex: number; // index into wordIds where last 20-word checkpoint finished
  studyCursor: number; // 0..currentStudyWordIds.length - 1

  // Current active study list (either the 5-word slice or remedial wrong words)
  currentStudyWordIds: number[];
  resumeStepAfterRemedial?: 'quick_test' | 'checkpoint_test' | 'topic_test';

  // Active quiz queue
  quizQueue: GeneratedQuestion[];
  quizCursor: number;
  quizCorrectCount: number;
  quizWrongWordIds: number[];

  // Cumulative stats
  totalAnswered: number;
  totalCorrect: number;
  completedCheckpoints: number;
  lastTestSummary?: {
    step: string;
    score: number;
    total: number;
    passed: boolean;
    wrongWordIds: number[];
  };
}

export interface WordForQuiz {
  id: number;
  headword: string;
  pos: string | null;
  meaningVi: string;
  ipaUk?: string | null;
  ipaUs?: string | null;
  exampleEn?: string | null;
  exampleVi?: string | null;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

export function buildQuizQuestions(
  targetWordIds: number[],
  wordPool: WordForQuiz[],
  preferVariety = true
): GeneratedQuestion[] {
  const byId = new Map(wordPool.map((w) => [w.id, w]));
  const types: QuestionType[] = ['en_to_vi', 'vi_to_en_mc', 'cloze', 'vi_to_en_type'];

  return targetWordIds.map((wid, idx) => {
    const w = byId.get(wid);
    if (!w) {
      throw new Error(`Word ${wid} not found in pool`);
    }

    let qType: QuestionType = preferVariety ? types[idx % types.length] : 'en_to_vi';
    if (qType === 'cloze' && !w.exampleEn) {
      qType = 'en_to_vi';
    }

    const distractors = pickRandom(
      wordPool.filter((other) => other.id !== w.id),
      3
    );

    if (qType === 'en_to_vi') {
      const options = pickRandom([w.meaningVi, ...distractors.map((d) => d.meaningVi)], 4);
      return {
        wordId: w.id,
        qType,
        prompt: w.headword,
        subPrompt: w.pos ? `(${w.pos}) ${w.ipaUs ? `[${w.ipaUs}]` : ''}`.trim() : undefined,
        options,
        correctAnswer: w.meaningVi,
        explanation: w.exampleEn
          ? `${w.headword}: ${w.meaningVi} — "${w.exampleEn.replace(/\*\*/g, '')}"`
          : `${w.headword}: ${w.meaningVi}`,
      };
    }

    if (qType === 'vi_to_en_mc') {
      const options = pickRandom([w.headword, ...distractors.map((d) => d.headword)], 4);
      return {
        wordId: w.id,
        qType,
        prompt: w.meaningVi,
        subPrompt: w.pos ? `Từ loại: ${w.pos}` : undefined,
        options,
        correctAnswer: w.headword,
        explanation: `${w.headword} (${w.pos ?? ''}): ${w.meaningVi}`,
      };
    }

    if (qType === 'cloze' && w.exampleEn) {
      const masked = w.exampleEn.replace(/\*\*([^*]+)\*\*/, '_______');
      const options = pickRandom([w.headword, ...distractors.map((d) => d.headword)], 4);
      return {
        wordId: w.id,
        qType: 'cloze',
        prompt: masked,
        subPrompt: w.exampleVi ?? w.meaningVi,
        options,
        correctAnswer: w.headword,
        explanation: w.exampleEn.replace(/\*\*/g, ''),
      };
    }

    // vi_to_en_type
    const hint =
      w.headword.length > 2
        ? `${w.headword[0]}${'_'.repeat(Math.max(1, w.headword.length - 2))}${w.headword[w.headword.length - 1]}`
        : w.headword[0] + '_';
    return {
      wordId: w.id,
      qType: 'vi_to_en_type',
      prompt: w.meaningVi,
      subPrompt: `Gợi ý: ${hint} ${w.pos ? `(${w.pos})` : ''}`.trim(),
      correctAnswer: w.headword,
      explanation: `${w.headword}: ${w.meaningVi}`,
    };
  });
}

export function createInitialSessionState(
  wordIds: number[],
  config: SessionConfig,
  mode: 'learn' | 'relearn' | 'wrong_only' | 'review',
  wordPool: WordForQuiz[]
): SessionState {
  if (wordIds.length === 0) {
    return {
      config,
      wordIds: [],
      step: 'completed',
      batchStartIndex: 0,
      lastCheckpointIndex: 0,
      studyCursor: 0,
      currentStudyWordIds: [],
      quizQueue: [],
      quizCursor: 0,
      quizCorrectCount: 0,
      quizWrongWordIds: [],
      totalAnswered: 0,
      totalCorrect: 0,
      completedCheckpoints: 0,
    };
  }

  // Review mode jumps straight into testing all due words
  if (mode === 'review') {
    const questions = buildQuizQuestions(wordIds, wordPool, true);
    return {
      config,
      wordIds,
      step: 'topic_test',
      batchStartIndex: 0,
      lastCheckpointIndex: 0,
      studyCursor: 0,
      currentStudyWordIds: [],
      quizQueue: questions,
      quizCursor: 0,
      quizCorrectCount: 0,
      quizWrongWordIds: [],
      totalAnswered: 0,
      totalCorrect: 0,
      completedCheckpoints: 0,
    };
  }

  const firstBatch = wordIds.slice(0, config.batchSize);
  return {
    config,
    wordIds,
    step: 'study_batch',
    batchStartIndex: 0,
    lastCheckpointIndex: 0,
    studyCursor: 0,
    currentStudyWordIds: firstBatch,
    quizQueue: [],
    quizCursor: 0,
    quizCorrectCount: 0,
    quizWrongWordIds: [],
    totalAnswered: 0,
    totalCorrect: 0,
    completedCheckpoints: 0,
  };
}

/**
 * Advance study cursor or transition from study_batch / remedial_study to quiz step
 */
export function advanceStudyStep(state: SessionState, wordPool: WordForQuiz[]): SessionState {
  const next = structuredClone(state);

  if (next.step !== 'study_batch' && next.step !== 'remedial_study') {
    return next;
  }

  if (next.studyCursor + 1 < next.currentStudyWordIds.length) {
    next.studyCursor += 1;
    return next;
  }

  // Finished viewing flashcards in current study list -> start quiz
  if (next.step === 'remedial_study') {
    const targetStep = next.resumeStepAfterRemedial ?? 'quick_test';
    let quizIds: number[] = [];
    if (targetStep === 'quick_test') {
      quizIds = next.currentStudyWordIds;
    } else if (targetStep === 'checkpoint_test') {
      const end = Math.min(next.wordIds.length, next.batchStartIndex + next.config.batchSize);
      quizIds = next.wordIds.slice(next.lastCheckpointIndex, end);
    } else {
      quizIds = [...next.wordIds];
    }

    next.step = targetStep;
    next.quizQueue = buildQuizQuestions(pickRandom(quizIds, quizIds.length), wordPool, true);
    next.quizCursor = 0;
    next.quizCorrectCount = 0;
    next.quizWrongWordIds = [];
    next.resumeStepAfterRemedial = undefined;
    return next;
  }

  // Normal study_batch finished -> start quick_test on these 5 words
  const batchIds = next.currentStudyWordIds;
  next.step = 'quick_test';
  next.quizQueue = buildQuizQuestions(pickRandom(batchIds, batchIds.length), wordPool, true);
  next.quizCursor = 0;
  next.quizCorrectCount = 0;
  next.quizWrongWordIds = [];
  return next;
}

export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Grade current quiz question and transition state when quiz finishes
 */
export function submitQuizAnswer(
  state: SessionState,
  userAnswer: string,
  wordPool: WordForQuiz[]
): {
  state: SessionState;
  correct: boolean;
  question: GeneratedQuestion;
} {
  const next = structuredClone(state);
  const currentQ = next.quizQueue[next.quizCursor];
  if (!currentQ) {
    throw new Error('No active quiz question');
  }

  const isCorrect = normalizeAnswer(userAnswer) === normalizeAnswer(currentQ.correctAnswer);
  next.totalAnswered += 1;
  if (isCorrect) {
    next.totalCorrect += 1;
    next.quizCorrectCount += 1;
  } else if (!next.quizWrongWordIds.includes(currentQ.wordId)) {
    next.quizWrongWordIds.push(currentQ.wordId);
  }

  // Still more questions in the current quiz
  if (next.quizCursor + 1 < next.quizQueue.length) {
    next.quizCursor += 1;
    return { state: next, correct: isCorrect, question: currentQ };
  }

  // Quiz finished! Evaluate score and decide next transition
  const totalQ = next.quizQueue.length;
  const score = next.quizCorrectCount;
  const ratio = totalQ > 0 ? score / totalQ : 1;
  const passed =
    next.step === 'quick_test'
      ? next.quizWrongWordIds.length === 0
      : ratio >= next.config.passRate;

  next.lastTestSummary = {
    step: next.step,
    score,
    total: totalQ,
    passed,
    wrongWordIds: [...next.quizWrongWordIds],
  };

  // If failed and gate is enabled -> go to remedial_study on wrong words
  if (!passed && next.config.gate && next.quizWrongWordIds.length > 0) {
    const failedStep = next.step as 'quick_test' | 'checkpoint_test' | 'topic_test';
    next.step = 'remedial_study';
    next.resumeStepAfterRemedial = failedStep;
    next.currentStudyWordIds = [...next.quizWrongWordIds];
    next.studyCursor = 0;
    return { state: next, correct: isCorrect, question: currentQ };
  }

  // Passed (or gate disabled): transition forward!
  if (next.step === 'quick_test') {
    const nextBatchStart = next.batchStartIndex + next.config.batchSize;
    const wordsSinceCheckpoint =
      Math.min(next.wordIds.length, nextBatchStart) - next.lastCheckpointIndex;
    const reachedCheckpoint =
      wordsSinceCheckpoint >= next.config.checkpointSize ||
      nextBatchStart >= next.wordIds.length;

    if (reachedCheckpoint) {
      // Trigger 20-word checkpoint test (or remaining words at end of topic)
      const end = Math.min(next.wordIds.length, nextBatchStart);
      const checkpointIds = next.wordIds.slice(next.lastCheckpointIndex, end);
      next.step = 'checkpoint_test';
      next.quizQueue = buildQuizQuestions(
        pickRandom(checkpointIds, checkpointIds.length),
        wordPool,
        true
      );
      next.quizCursor = 0;
      next.quizCorrectCount = 0;
      next.quizWrongWordIds = [];
      return { state: next, correct: isCorrect, question: currentQ };
    }

    // Move to next 5-word batch
    next.batchStartIndex = nextBatchStart;
    next.currentStudyWordIds = next.wordIds.slice(
      next.batchStartIndex,
      next.batchStartIndex + next.config.batchSize
    );
    next.studyCursor = 0;
    next.step = 'study_batch';
    return { state: next, correct: isCorrect, question: currentQ };
  }

  if (next.step === 'checkpoint_test') {
    next.completedCheckpoints += 1;
    const nextBatchStart = next.batchStartIndex + next.config.batchSize;
    next.lastCheckpointIndex = Math.min(next.wordIds.length, nextBatchStart);

    if (nextBatchStart < next.wordIds.length) {
      // More batches left in topic
      next.batchStartIndex = nextBatchStart;
      next.currentStudyWordIds = next.wordIds.slice(
        next.batchStartIndex,
        next.batchStartIndex + next.config.batchSize
      );
      next.studyCursor = 0;
      next.step = 'study_batch';
      return { state: next, correct: isCorrect, question: currentQ };
    }

    // All batches & checkpoints done -> Final comprehensive Topic Test!
    next.step = 'topic_test';
    next.quizQueue = buildQuizQuestions(
      pickRandom(next.wordIds, next.wordIds.length),
      wordPool,
      true
    );
    next.quizCursor = 0;
    next.quizCorrectCount = 0;
    next.quizWrongWordIds = [];
    return { state: next, correct: isCorrect, question: currentQ };
  }

  if (next.step === 'topic_test') {
    next.step = 'completed';
    return { state: next, correct: isCorrect, question: currentQ };
  }

  return { state: next, correct: isCorrect, question: currentQ };
}

