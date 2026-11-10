import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { normalizeAnswer } from '../lib/sessionEngine.js';

export async function registerExerciseRoutes(app: FastifyInstance) {
  app.get('/api/exercises', async () => {
    const exercises = await prisma.exercise.findMany({
      orderBy: { id: 'asc' },
      include: {
        topic: true,
        _count: { select: { questions: true, attempts: true } },
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    return { exercises };
  });

  app.get<{ Params: { code: string } }>('/api/exercises/:code', async (req, reply) => {
    const ex = await prisma.exercise.findUnique({
      where: { code: req.params.code },
      include: {
        topic: true,
        questions: { orderBy: { orderNo: 'asc' } },
        attempts: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!ex) {
      return reply.code(404).send({ error: 'Không tìm thấy bài tập này.' });
    }
    return { exercise: ex };
  });

  app.post<{
    Params: { code: string };
    Body: { answers: Record<string, string>; taskId?: number };
  }>('/api/exercises/:code/submit', async (req, reply) => {
    const ex = await prisma.exercise.findUnique({
      where: { code: req.params.code },
      include: { questions: { orderBy: { orderNo: 'asc' } } },
    });
    if (!ex) {
      return reply.code(404).send({ error: 'Không tìm thấy bài tập.' });
    }

    const { answers = {}, taskId } = req.body ?? {};
    let score = 0;

    const details = ex.questions.map((q) => {
      const userKey = answers[String(q.id)] ?? answers[String(q.orderNo)] ?? '';
      const isCorrect = normalizeAnswer(userKey) === normalizeAnswer(q.answer);
      if (isCorrect) score++;
      return {
        questionId: q.id,
        orderNo: q.orderNo,
        prompt: q.prompt,
        userAnswer: userKey,
        correctAnswer: q.answer,
        correct: isCorrect,
        explanation: q.explanation,
      };
    });

    const attempt = await prisma.exerciseAttempt.create({
      data: {
        exerciseId: ex.id,
        taskId: taskId ?? null,
        answers,
        score,
        total: ex.questions.length,
      },
    });

    if (taskId) {
      await prisma.planTask.update({
        where: { id: taskId },
        data: { status: 'done', completedAt: new Date() },
      });
    }

    return {
      attempt,
      score,
      total: ex.questions.length,
      details,
    };
  });
}

