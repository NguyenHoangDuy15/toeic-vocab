import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // apps/api/src or apps/api/dist

export const config = {
  port: Number(process.env.PORT ?? 3000),
  timezone: process.env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh',
  dataDir: process.env.DATA_DIR ?? path.resolve(here, '../../../data'),
  pdfPath:
    process.env.PDF_PATH ?? path.resolve(here, '../../../HACKERS TOEIC VOCABULARY.pdf'),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
};

export interface AppSettings {
  batchSize: number; // words per learning batch
  checkpointSize: number; // test after every N words
  passRate: number; // 0..1
  gate: boolean; // must pass a test before moving on
  reminderEnabled: boolean;
  reminderTime: string; // HH:mm local
  eveningReminderTime: string; // HH:mm local, only if tasks still pending
  telegramChatId: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  batchSize: 5,
  checkpointSize: 20,
  passRate: 0.8,
  gate: true,
  reminderEnabled: true,
  reminderTime: '07:30',
  eveningReminderTime: '21:00',
  telegramChatId: '',
};

