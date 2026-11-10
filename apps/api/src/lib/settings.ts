import { prisma } from '../db.js';
import { AppSettings, DEFAULT_SETTINGS } from '../config.js';

const SETTINGS_KEY = 'app_settings';

export async function getAppSettings(): Promise<AppSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row || typeof row.value !== 'object' || row.value === null) {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...(row.value as Partial<AppSettings>) };
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getAppSettings();
  const updated: AppSettings = { ...current, ...patch };
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: updated as unknown as object },
    update: { value: updated as unknown as object },
  });
  return updated;
}

