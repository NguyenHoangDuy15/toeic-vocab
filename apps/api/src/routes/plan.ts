import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { addDays, dateToYmd, localYmd, ymdToDate } from '../lib/dates.js';
import { generateStudySchedule, PlanConfig } from '../lib/planGenerator.js';

export async function registerPlanRoutes(app: FastifyInstance) {
  app.get('/api/plan/today', async () => {
    const todayYmd = localYmd(new Date(), config.timezone);
    const plan = await prisma.studyPlan.findFirst({
      where: { active: true },
      include: {
        days: {
          orderBy: { dayIndex: 'asc' },
          include: {
            tasks: {
              orderBy: { orderNo: 'asc' },
              include: {
                topic: {
                  include: {
                    _count: { select: { words: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!plan) {
      return { todayYmd, plan: null };
    }

    // Find today's PlanDay or the earliest PlanDay with unfinished tasks
    let activeDay =
      plan.days.find((d) => dateToYmd(d.date) === todayYmd) ??
      plan.days.find((d) => d.tasks.some((t) => t.status !== 'done' && t.status !== 'skipped')) ??
      plan.days[plan.days.length - 1];

    // Overdue tasks from previous days
    const overdueDays = plan.days.filter(
      (d) =>
        dateToYmd(d.date) < todayYmd &&
        d.tasks.some((t) => t.status !== 'done' && t.status !== 'skipped')
    );

    // Find active learning session if any
    const activeSession = await prisma.learningSession.findFirst({
      where: { status: 'active' },
      orderBy: { updatedAt: 'desc' },
    });

    // Due words for spaced-repetition review
    const dueWordsCount = await prisma.wordProgress.count({
      where: {
        dueAt: { lte: new Date() },
      },
    });

    const weakWordsCount = await prisma.wordProgress.count({
      where: { weak: true },
    });

    const totalTasks = plan.days.reduce((acc, d) => acc + d.tasks.length, 0);
    const doneTasks = plan.days.reduce(
      (acc, d) => acc + d.tasks.filter((t) => t.status === 'done').length,
      0
    );

    return {
      todayYmd,
      plan: {
        id: plan.id,
        target: plan.target,
        startDate: dateToYmd(plan.startDate),
        config: plan.config,
        totalDays: plan.days.length,
        totalTasks,
        doneTasks,
      },
      activeDay: activeDay
        ? {
            id: activeDay.id,
            dayIndex: activeDay.dayIndex,
            date: dateToYmd(activeDay.date),
            phase: activeDay.phase,
            label: activeDay.label,
            tasks: activeDay.tasks,
          }
        : null,
      overdueCount: overdueDays.length,
      activeSession,
      dueWordsCount,
      weakWordsCount,
    };
  });

  app.get('/api/plan/all', async () => {
    const plan = await prisma.studyPlan.findFirst({
      where: { active: true },
      include: {
        days: {
          orderBy: { dayIndex: 'asc' },
          include: {
            tasks: {
              orderBy: { orderNo: 'asc' },
              include: { topic: true },
            },
          },
        },
      },
    });
    return { plan };
  });

  // Create or reset Study Plan with chosen pace
  app.post<{
    Body: {
      pace?: 'book_30d' | 'steady_1d' | 'custom';
      topicsPerDay?: number;
      includeL900?: boolean;
      startDate?: string;
    };
  }>('/api/plan/create', async (req) => {
    const body = req.body ?? {};
    const pace = body.pace ?? 'steady_1d';
    const topicsPerDay =
      pace === 'book_30d' ? 3 : pace === 'steady_1d' ? 1 : Math.max(1, body.topicsPerDay ?? 1);
    const includeL900 = Boolean(body.includeL900);
    const startYmd = body.startDate ?? localYmd(new Date(), config.timezone);

    const planConfig: PlanConfig = { pace, topicsPerDay, includeL900 };
    const schedule = generateStudySchedule(startYmd, planConfig);

    await prisma.studyPlan.updateMany({
      where: { active: true },
      data: { active: false },
    });

    const topics = await prisma.topic.findMany();
    const topicMap = new Map(topics.map((t) => [t.dayNo, t.id]));

    const newPlan = await prisma.studyPlan.create({
      data: {
        target: includeL900 ? 900 : 800,
        startDate: ymdToDate(startYmd),
        config: planConfig as unknown as object,
        active: true,
      },
    });

    for (const d of schedule) {
      const planDay = await prisma.planDay.create({
        data: {
          planId: newPlan.id,
          dayIndex: d.dayIndex,
          date: ymdToDate(d.date),
          phase: d.phase,
          label: d.label,
        },
      });

      for (const t of d.tasks) {
        const topicId = t.topicDayNo ? topicMap.get(t.topicDayNo) : undefined;
        const exCode =
          t.type === 'daily_checkup' && t.topicDayNo
            ? `day${String(t.topicDayNo).padStart(2, '0')}-checkup`
            : t.exerciseCode;

        await prisma.planTask.create({
          data: {
            planDayId: planDay.id,
            orderNo: t.orderNo,
            type: t.type,
            topicId,
            exerciseCode: exCode,
          },
        });
      }
    }

    return { ok: true, planId: newPlan.id, totalDays: schedule.length };
  });

  // Shift unfinished days starting from today so user is never stuck behind schedule
  app.post('/api/plan/reschedule', async () => {
    const todayYmd = localYmd(new Date(), config.timezone);
    const plan = await prisma.studyPlan.findFirst({
      where: { active: true },
      include: {
        days: {
          orderBy: { dayIndex: 'asc' },
          include: { tasks: true },
        },
      },
    });
    if (!plan) return { ok: false };

    const firstUnfinishedIdx = plan.days.findIndex((d) =>
      d.tasks.some((t) => t.status !== 'done' && t.status !== 'skipped')
    );
    if (firstUnfinishedIdx === -1) return { ok: true, shifted: 0 };

    let offset = 0;
    for (let i = firstUnfinishedIdx; i < plan.days.length; i++) {
      const newDateYmd = addDays(todayYmd, offset++);
      await prisma.planDay.update({
        where: { id: plan.days[i].id },
        data: { date: ymdToDate(newDateYmd) },
      });
    }

    return { ok: true, shifted: offset };
  });

  app.patch<{ Params: { id: string }; Body: { status: 'pending' | 'done' | 'skipped' } }>(
    '/api/plan/tasks/:id',
    async (req) => {
      const taskId = Number(req.params.id);
      const { status } = req.body;
      const updated = await prisma.planTask.update({
        where: { id: taskId },
        data: {
          status,
          completedAt: status === 'done' ? new Date() : null,
        },
      });
      return { task: updated };
    }
  );
}

