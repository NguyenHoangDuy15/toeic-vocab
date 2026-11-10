import { FastifyInstance } from 'fastify';
import { ListType } from '@prisma/client';
import { prisma } from '../db.js';
import { getAppSettings } from '../lib/settings.js';
import {
  advanceStudyStep,
  createInitialSessionState,
  SessionState,
  submitQuizAnswer,
  WordForQuiz,
} from '../lib/sessionEngine.js';
import { computeLeitnerUpdate } from '../lib/srs.js';

async function loadWordPool(wordIds: number[], topicId?: number | null): Promise<WordForQuiz[]> {
  const words = await prisma.word.findMany({
    where: topicId
      ? { topicId }
      : {
          id: { in: wordIds },
        },
    include: {
      senses: {
        orderBy: { orderNo: 'asc' },
        include: { examples: { take: 1 } },
      },
    },
  });

  // Ensure we have at least 4 words for multiple-choice distractors
  if (words.length < 4) {
    const extra = await prisma.word.findMany({
      where: { id: { notIn: words.map((w) => w.id) } },
      take: 10,
      include: {
        senses: {
          orderBy: { orderNo: 'asc' },
          include: { examples: { take: 1 } },
        },
      },
    });
    words.push(...extra);
  }

  return words.map((w) => {
    const firstEx = w.senses[0]?.examples[0];
    return {
      id: w.id,
      headword: w.headword,
      pos: w.pos,
      meaningVi: w.meaningVi,
      ipaUk: w.ipaUk,
      ipaUs: w.ipaUs,
      exampleEn: firstEx?.sentenceEn ?? null,
      exampleVi: firstEx?.sentenceVi ?? null,
    };
  });
}

async function hydrateSessionPayload(sessionId: number) {
  const session = await prisma.learningSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return null;

  const state = session.state as unknown as SessionState;
  let currentWord = null;

  if (
    (state.step === 'study_batch' || state.step === 'remedial_study') &&
    state.currentStudyWordIds[state.studyCursor]
  ) {
    const wid = state.currentStudyWordIds[state.studyCursor];
    currentWord = await prisma.word.findUnique({
      where: { id: wid },
      include: {
        topic: true,
        senses: {
          orderBy: { orderNo: 'asc' },
          include: { examples: true },
        },
        relations: true,
        notes: true,
        progress: true,
      },
    });
  }

  const currentQuestion =
    state.step === 'quick_test' ||
    state.step === 'checkpoint_test' ||
    state.step === 'topic_test'
      ? state.quizQueue[state.quizCursor] ?? null
      : null;

  const topic = session.topicId
    ? await prisma.topic.findUnique({ where: { id: session.topicId } })
    : null;

  return {
    session: {
      id: session.id,
      taskId: session.taskId,
      topicId: session.topicId,
      topic,
      listType: session.listType,
      mode: session.mode,
      status: session.status,
      attemptNo: session.attemptNo,
      startedAt: session.startedAt,
      finishedAt: session.finishedAt,
    },
    state: {
      step: state.step,
      totalWords: state.wordIds.length,
      batchStartIndex: state.batchStartIndex,
      batchSize: state.config.batchSize,
      checkpointSize: state.config.checkpointSize,
      lastCheckpointIndex: state.lastCheckpointIndex,
      studyCursor: state.studyCursor,
      studyTotal: state.currentStudyWordIds.length,
      quizCursor: state.quizCursor,
      quizTotal: state.quizQueue.length,
      quizCorrectCount: state.quizCorrectCount,
      quizWrongCount: state.quizWrongWordIds.length,
      totalAnswered: state.totalAnswered,
      totalCorrect: state.totalCorrect,
      completedCheckpoints: state.completedCheckpoints,
      lastTestSummary: state.lastTestSummary ?? null,
    },
    currentWord,
    currentQuestion: currentQuestion
      ? {
          wordId: currentQuestion.wordId,
          qType: currentQuestion.qType,
          prompt: currentQuestion.prompt,
          subPrompt: currentQuestion.subPrompt,
          options: currentQuestion.options,
        }
      : null,
  };
}

export async function registerSessionRoutes(app: FastifyInstance) {
  // Start or resume a learning session
  app.post<{
    Body: {
      taskId?: number;
      topicId?: number;
      listType?: ListType;
      mode?: 'learn' | 'relearn' | 'wrong_only' | 'review';
      forceNew?: boolean;
    };
  }>('/api/sessions/start', async (req, reply) => {
    const { taskId, topicId, listType = 'core', mode = 'learn', forceNew = false } = req.body ?? {};

    // Check if there's an existing active session matching the request
    if (!forceNew) {
      const existing = await prisma.learningSession.findFirst({
        where: {
          status: 'active',
          ...(taskId ? { taskId } : {}),
          ...(topicId ? { topicId, listType } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (existing) {
        return hydrateSessionPayload(existing.id);
      }
    } else if (topicId || taskId) {
      await prisma.learningSession.updateMany({
        where: {
          status: 'active',
          ...(taskId ? { taskId } : {}),
          ...(topicId ? { topicId } : {}),
        },
        data: { status: 'abandoned' },
      });
    }

    const settings = await getAppSettings();
    let targetWords: Array<{ id: number }> = [];

    if (mode === 'review' && !topicId) {
      // Due words across all topics
      const dueRows = await prisma.wordProgress.findMany({
        where: {
          OR: [{ dueAt: { lte: new Date() } }, { weak: true }],
        },
        orderBy: { dueAt: 'asc' },
        take: 30,
      });
      targetWords = dueRows.map((r) => ({ id: r.wordId }));
    } else if (mode === 'wrong_only' && topicId) {
      targetWords = await prisma.word.findMany({
        where: {
          topicId,
          listType,
          progress: {
            OR: [{ weak: true }, { wrongCount: { gt: 0 } }],
          },
        },
        orderBy: { orderNo: 'asc' },
        select: { id: true },
      });
      // Fallback to all words in topic if user has no wrong words yet
      if (targetWords.length === 0) {
        targetWords = await prisma.word.findMany({
          where: { topicId, listType },
          orderBy: { orderNo: 'asc' },
          select: { id: true },
        });
      }
    } else if (listType === 'idiom') {
      targetWords = await prisma.word.findMany({
        where: { listType: 'idiom' },
        orderBy: { orderNo: 'asc' },
        select: { id: true },
      });
    } else if (topicId) {
      targetWords = await prisma.word.findMany({
        where: { topicId, listType },
        orderBy: { orderNo: 'asc' },
        select: { id: true },
      });
    }

    if (targetWords.length === 0) {
      return reply.code(400).send({
        error: 'Chưa có dữ liệu từ vựng cho chủ đề này. Hãy import thêm trang từ PDF hoặc chọn Day 01.',
      });
    }

    const wordIds = targetWords.map((w) => w.id);
    const pool = await loadWordPool(wordIds, topicId);

    const initialState = createInitialSessionState(
      wordIds,
      {
        batchSize: settings.batchSize,
        checkpointSize: settings.checkpointSize,
        passRate: settings.passRate,
        gate: settings.gate,
      },
      mode,
      pool
    );

    const prevCount = await prisma.learningSession.count({
      where: { topicId: topicId ?? null, listType },
    });

    const created = await prisma.learningSession.create({
      data: {
        taskId: taskId ?? null,
        topicId: topicId ?? null,
        listType,
        mode,
        status: initialState.step === 'completed' ? 'completed' : 'active',
        attemptNo: prevCount + 1,
        state: initialState as unknown as object,
      },
    });

    if (taskId) {
      await prisma.planTask.update({
        where: { id: taskId },
        data: { status: 'in_progress' },
      });
    }

    return hydrateSessionPayload(created.id);
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const payload = await hydrateSessionPayload(Number(req.params.id));
    if (!payload) return reply.code(404).send({ error: 'Session not found' });
    return payload;
  });

  // Advance flashcard study step (Next card / Start 5-word quiz)
  app.post<{ Params: { id: string } }>('/api/sessions/:id/next-card', async (req, reply) => {
    const sessionId = Number(req.params.id);
    const session = await prisma.learningSession.findUnique({ where: { id: sessionId } });
    if (!session) return reply.code(404).send({ error: 'Session not found' });

    const state = session.state as unknown as SessionState;
    const pool = await loadWordPool(state.wordIds, session.topicId);
    const nextState = advanceStudyStep(state, pool);

    await prisma.learningSession.update({
      where: { id: sessionId },
      data: { state: nextState as unknown as object },
    });

    return hydrateSessionPayload(sessionId);
  });

  // Submit quiz answer
  app.post<{ Params: { id: string }; Body: { answer: string } }>(
    '/api/sessions/:id/answer',
    async (req, reply) => {
      const sessionId = Number(req.params.id);
      const { answer } = req.body ?? { answer: '' };

      const session = await prisma.learningSession.findUnique({ where: { id: sessionId } });
      if (!session) return reply.code(404).send({ error: 'Session not found' });

      const state = session.state as unknown as SessionState;
      const pool = await loadWordPool(state.wordIds, session.topicId);

      const stepBefore = state.step;
      const { state: nextState, correct, question } = submitQuizAnswer(state, answer, pool);

      // Record SessionItem
      await prisma.sessionItem.create({
        data: {
          sessionId,
          wordId: question.wordId,
          step: stepBefore,
          qType: question.qType,
          answer,
          correct,
        },
      });

      // Update WordProgress (Leitner box + due date)
      const prevProg = await prisma.wordProgress.findUnique({
        where: { wordId: question.wordId },
      });
      const srs = computeLeitnerUpdate(prevProg, correct);
      await prisma.wordProgress.upsert({
        where: { wordId: question.wordId },
        create: {
          wordId: question.wordId,
          ...srs,
        },
        update: srs,
      });

      const isCompleted = nextState.step === 'completed';
      await prisma.learningSession.update({
        where: { id: sessionId },
        data: {
          state: nextState as unknown as object,
          status: isCompleted ? 'completed' : 'active',
          finishedAt: isCompleted ? new Date() : null,
        },
      });

      if (isCompleted && session.taskId) {
        await prisma.planTask.update({
          where: { id: session.taskId },
          data: { status: 'done', completedAt: new Date() },
        });
      }

      const payload = await hydrateSessionPayload(sessionId);
      return {
        feedback: {
          correct,
          userAnswer: answer,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          stepFinished: nextState.step !== stepBefore,
          summary: nextState.step !== stepBefore ? nextState.lastTestSummary : null,
        },
        ...payload,
      };
    }
  );
}

