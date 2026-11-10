import cron from 'node-cron';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { dateToYmd, localHm, localYmd } from './dates.js';
import { getAppSettings } from './settings.js';

export async function buildReminderMessage(): Promise<{
  title: string;
  body: string;
  pendingCount: number;
  dueCount: number;
}> {
  const todayYmd = localYmd(new Date(), config.timezone);
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

  const dueCount = await prisma.wordProgress.count({
    where: { dueAt: { lte: new Date() } },
  });

  if (!plan) {
    return {
      title: 'TOEIC 800+ Vocab Coach',
      body: `Hôm nay (${todayYmd}): Bạn có ${dueCount} từ đến hạn ôn tập.`,
      pendingCount: dueCount,
      dueCount,
    };
  }

  const activeDay =
    plan.days.find((d) => dateToYmd(d.date) === todayYmd) ??
    plan.days.find((d) => d.tasks.some((t) => t.status !== 'done' && t.status !== 'skipped'));

  const pendingTasks =
    activeDay?.tasks.filter((t) => t.status !== 'done' && t.status !== 'skipped') ?? [];

  const taskLines = pendingTasks.map((t, idx) => {
    const topicLabel = t.topic ? `Day ${String(t.topic.dayNo).padStart(2, '0')} (${t.topic.title})` : '';
    return `${idx + 1}. [${t.type}] ${topicLabel}`.trim();
  });

  const body = [
    `📚 Nhắc học TOEIC 800+ (${todayYmd})`,
    activeDay ? `Lộ trình: ${activeDay.label}` : '',
    pendingTasks.length > 0
      ? `Còn ${pendingTasks.length} nhiệm vụ chưa hoàn thành:\n${taskLines.join('\n')}`
      : '🎉 Bạn đã hoàn thành hết nhiệm vụ lộ trình hôm nay!',
    dueCount > 0 ? `🔄 Có ${dueCount} từ đến hạn ôn tập ngắt quãng.` : '',
    'Phương pháp: 5 từ/lượt → Kiểm tra 20 từ → Kiểm tra cả chủ đề + Daily Checkup.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    title: 'Nhắc học TOEIC 800+',
    body,
    pendingCount: pendingTasks.length,
    dueCount,
  };
}

export async function sendDailyReminder(force = false): Promise<{
  sent: boolean;
  channel: string;
  message: string;
  error?: string;
}> {
  const settings = await getAppSettings();
  const msg = await buildReminderMessage();

  if (!force && msg.pendingCount === 0 && msg.dueCount === 0) {
    return { sent: false, channel: 'none', message: msg.body };
  }

  const chatId = settings.telegramChatId || config.telegramChatId;
  if (config.telegramToken && chatId) {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: msg.body,
          }),
        }
      );
      if (!resp.ok) {
        const errText = await resp.text();
        return { sent: false, channel: 'telegram', message: msg.body, error: errText };
      }
      return { sent: true, channel: 'telegram', message: msg.body };
    } catch (err) {
      return {
        sent: false,
        channel: 'telegram',
        message: msg.body,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    sent: true,
    channel: 'in_app',
    message: msg.body,
  };
}

let lastFiredMinute = '';

export function startReminderCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const settings = await getAppSettings();
      if (!settings.reminderEnabled) return;

      const now = new Date();
      const hm = localHm(now, config.timezone);
      const ymdHm = `${localYmd(now, config.timezone)} ${hm}`;
      if (ymdHm === lastFiredMinute) return;

      if (hm === settings.reminderTime || hm === settings.eveningReminderTime) {
        lastFiredMinute = ymdHm;
        await sendDailyReminder(false);
      }
    } catch (err) {
      console.error('Reminder cron error:', err);
    }
  });
}

