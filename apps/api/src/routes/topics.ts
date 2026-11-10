import { FastifyInstance } from 'fastify';
import { ListType } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { addDays, localYmd } from '../lib/dates.js';
import { getAppSettings, updateAppSettings } from '../lib/settings.js';
import { sendDailyReminder } from '../lib/reminder.js';

export async function registerTopicAndWordRoutes(app: FastifyInstance) {
  app.get('/api/topics', async () => {
    const topics = await prisma.topic.findMany({
      orderBy: { dayNo: 'asc' },
      include: {
        exercises: { select: { id: true, code: true, type: true, title: true } },
        words: {
          select: {
            id: true,
            listType: true,
            progress: { select: { status: true, weak: true, box: true } },
          },
        },
      },
    });

    const formatted = topics.map((t) => {
      const counts = {
        core: 0,
        basic: 0,
        l800: 0,
        l900: 0,
        learnedCore: 0,
        masteredCore: 0,
        weakCount: 0,
      };
      for (const w of t.words) {
        if (w.listType === 'core') {
          counts.core++;
          if (w.progress && w.progress.status !== 'new') counts.learnedCore++;
          if (w.progress?.status === 'mastered') counts.masteredCore++;
        } else if (w.listType === 'basic') counts.basic++;
        else if (w.listType === 'l800') counts.l800++;
        else if (w.listType === 'l900') counts.l900++;
        if (w.progress?.weak) counts.weakCount++;
      }

      return {
        id: t.id,
        dayNo: t.dayNo,
        title: t.title,
        category: t.category,
        pageStart: t.pageStart,
        pageEnd: t.pageEnd,
        exercises: t.exercises,
        counts,
      };
    });

    return { topics: formatted };
  });

  app.get<{ Params: { dayNo: string } }>('/api/topics/:dayNo', async (req, reply) => {
    const dayNo = Number(req.params.dayNo);
    const topic = await prisma.topic.findUnique({
      where: { dayNo },
      include: {
        exercises: {
          include: {
            attempts: { orderBy: { createdAt: 'desc' }, take: 3 },
          },
        },
        words: {
          orderBy: [{ listType: 'asc' }, { orderNo: 'asc' }],
          include: {
            senses: {
              orderBy: { orderNo: 'asc' },
              include: { examples: true },
            },
            relations: true,
            notes: true,
            progress: true,
          },
        },
      },
    });
    if (!topic) return reply.code(404).send({ error: 'Topic not found' });
    return { topic };
  });

  // Reset progress for a topic to relearn from scratch
  app.post<{ Params: { dayNo: string }; Body: { listType?: ListType } }>(
    '/api/topics/:dayNo/reset-progress',
    async (req, reply) => {
      const dayNo = Number(req.params.dayNo);
      const topic = await prisma.topic.findUnique({ where: { dayNo } });
      if (!topic) return reply.code(404).send({ error: 'Topic not found' });

      const listType = req.body?.listType;
      const words = await prisma.word.findMany({
        where: { topicId: topic.id, ...(listType ? { listType } : {}) },
        select: { id: true },
      });

      await prisma.wordProgress.deleteMany({
        where: { wordId: { in: words.map((w) => w.id) } },
      });

      await prisma.learningSession.updateMany({
        where: { topicId: topic.id, status: 'active' },
        data: { status: 'abandoned' },
      });

      return { ok: true, resetCount: words.length };
    }
  );

  // List/filter words (weak words, due words, search, idioms)
  app.get<{
    Querystring: {
      q?: string;
      filter?: 'weak' | 'due' | 'mastered' | 'idiom' | 'all';
      topicId?: string;
      listType?: ListType;
    };
  }>('/api/words', async (req) => {
    const { q, filter = 'all', topicId, listType } = req.query;

    const where: Record<string, unknown> = {};
    if (topicId) where.topicId = Number(topicId);
    if (listType) where.listType = listType;
    if (filter === 'idiom') where.listType = 'idiom';
    if (filter === 'weak') where.progress = { weak: true };
    if (filter === 'due') where.progress = { dueAt: { lte: new Date() } };
    if (filter === 'mastered') where.progress = { status: 'mastered' };
    if (q && q.trim()) {
      where.OR = [
        { headword: { contains: q.trim(), mode: 'insensitive' } },
        { meaningVi: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }

    const words = await prisma.word.findMany({
      where,
      orderBy: [{ topicId: 'asc' }, { orderNo: 'asc' }],
      take: 200,
      include: {
        topic: { select: { dayNo: true, title: true } },
        senses: {
          orderBy: { orderNo: 'asc' },
          include: { examples: true },
        },
        relations: true,
        notes: true,
        progress: true,
      },
    });

    return { words };
  });

  // Edit word (for fixing book typos / OCR corrections)
  app.patch<{
    Params: { id: string };
    Body: {
      headword?: string;
      pos?: string;
      meaningVi?: string;
      ipaUk?: string;
      ipaUs?: string;
      verified?: boolean;
    };
  }>('/api/words/:id', async (req) => {
    const id = Number(req.params.id);
    const updated = await prisma.word.update({
      where: { id },
      data: req.body,
    });
    return { word: updated };
  });

  // Overview stats & study streak
  app.get('/api/stats/overview', async () => {
    const totalWords = await prisma.word.count();
    const byListType = await prisma.word.groupBy({
      by: ['listType'],
      _count: { _all: true },
    });

    const progByStatus = await prisma.wordProgress.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const weakCount = await prisma.wordProgress.count({ where: { weak: true } });
    const dueCount = await prisma.wordProgress.count({
      where: { dueAt: { lte: new Date() } },
    });

    // Calculate daily streak from SessionItem + ExerciseAttempt
    const recentItems = await prisma.sessionItem.findMany({
      orderBy: { answeredAt: 'desc' },
      take: 2000,
      select: { answeredAt: true, correct: true },
    });
    const recentAttempts = await prisma.exerciseAttempt.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { createdAt: true, score: true, total: true },
    });

    const activeDaysSet = new Set<string>();
    for (const it of recentItems) {
      activeDaysSet.add(localYmd(it.answeredAt, config.timezone));
    }
    for (const at of recentAttempts) {
      activeDaysSet.add(localYmd(at.createdAt, config.timezone));
    }

    const todayYmd = localYmd(new Date(), config.timezone);
    let streak = 0;
    let cursor = activeDaysSet.has(todayYmd) ? todayYmd : addDays(todayYmd, -1);
    while (activeDaysSet.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }

    return {
      totalWords,
      byListType,
      progByStatus,
      weakCount,
      dueCount,
      streak,
      studiedToday: activeDaysSet.has(todayYmd),
      recentAttemptsCount: recentAttempts.length,
    };
  });

  // Settings & Reminders
  app.get('/api/settings', async () => {
    const settings = await getAppSettings();
    return {
      settings,
      envTelegramConfigured: Boolean(config.telegramToken),
      envGeminiConfigured: Boolean(config.geminiApiKey),
    };
  });

  app.put<{ Body: Record<string, unknown> }>('/api/settings', async (req) => {
    const settings = await updateAppSettings(req.body ?? {});
    return { settings };
  });

  app.post('/api/reminders/test', async () => {
    const res = await sendDailyReminder(true);
    return res;
  });
}

