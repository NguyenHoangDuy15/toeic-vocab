import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerPlanRoutes } from './routes/plan.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerExerciseRoutes } from './routes/exercises.js';
import { registerTopicAndWordRoutes } from './routes/topics.js';
import { startReminderCron } from './lib/reminder.js';
import { extractDayWithGemini } from './importer/import.js';
import { seedDatabase } from './seed/seed.js';

export async function buildServer() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  await registerPlanRoutes(app);
  await registerSessionRoutes(app);
  await registerExerciseRoutes(app);
  await registerTopicAndWordRoutes(app);

  app.post<{ Body: { dayNo: number } }>('/api/importer/extract-day', async (req, reply) => {
    try {
      const dayNo = Number(req.body?.dayNo ?? 1);
      const res = await extractDayWithGemini(dayNo);
      return { ok: true, ...res };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/importer/reseed', async () => {
    const res = await seedDatabase();
    return { ok: true, ...res };
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer()
    .then(async (app) => {
      await seedDatabase();
      startReminderCron();
      await app.listen({ port: config.port, host: '0.0.0.0' });
      console.log(`TOEIC 800+ API running on http://localhost:${config.port}`);
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}

