import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { generateStudySchedule, PlanConfig } from '../lib/planGenerator.js';
import { localYmd, ymdToDate } from '../lib/dates.js';

interface TopicSeed {
  dayNo: number;
  title: string;
  category: string;
  pageStart?: number;
  pageEnd?: number;
}

interface DaySeed {
  dayNo: number;
  coreWords: Array<{
    no: number;
    word: string;
    stars?: number;
    part?: string;
    ipaUk?: string;
    ipaUs?: string;
    page?: number;
    senses: Array<{
      pos: string;
      meaning: string;
      examples: Array<{ en: string; vi?: string }>;
    }>;
    relations?: Array<{ type: string; text: string; pos?: string; meaning?: string }>;
    notes?: Array<{ type: string; title: string; content: string }>;
  }>;
  completeVocab?: {
    basic?: Record<string, Array<[string, string, string]>>;
    l800?: Record<string, Array<[string, string, string]>>;
    l900?: Record<string, Array<[string, string, string]>>;
  };
  dailyCheckup?: {
    page?: number;
    groups: Array<{
      instruction?: string;
      hint?: string;
      options: Array<{ key: string; text: string }>;
      questions: Array<{ no: number; prompt: string; answer: string }>;
    }>;
  };
}

export async function seedDatabase(): Promise<{
  topics: number;
  words: number;
  exercises: number;
}> {
  const topicsPath = path.join(config.dataDir, 'topics.json');
  const topicsData: TopicSeed[] = JSON.parse(fs.readFileSync(topicsPath, 'utf-8'));

  const topicMap = new Map<number, number>(); // dayNo -> topic.id

  for (const t of topicsData) {
    const row = await prisma.topic.upsert({
      where: { dayNo: t.dayNo },
      create: {
        dayNo: t.dayNo,
        title: t.title,
        category: t.category,
        pageStart: t.pageStart,
        pageEnd: t.pageEnd,
      },
      update: {
        title: t.title,
        category: t.category,
        pageStart: t.pageStart,
        pageEnd: t.pageEnd,
      },
    });
    topicMap.set(t.dayNo, row.id);
  }

  let wordCount = 0;
  let exerciseCount = 0;

  // Seed all dayXX.json files in data/days
  const daysDir = path.join(config.dataDir, 'days');
  if (fs.existsSync(daysDir)) {
    const files = fs
      .readdirSync(daysDir)
      .filter((f) => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      const dayData: DaySeed = JSON.parse(fs.readFileSync(path.join(daysDir, file), 'utf-8'));
      const topicId = topicMap.get(dayData.dayNo);
      if (!topicId) continue;

      // 1. Core words
      for (const cw of dayData.coreWords) {
        const posSummary = Array.from(new Set(cw.senses.map((s) => s.pos))).join(', ');
        const meaningSummary = cw.senses.map((s) => `(${s.pos}) ${s.meaning}`).join('; ');

        const wordRow = await prisma.word.upsert({
          where: {
            topicId_listType_orderNo: {
              topicId,
              listType: 'core',
              orderNo: cw.no,
            },
          },
          create: {
            topicId,
            listType: 'core',
            orderNo: cw.no,
            headword: cw.word,
            stars: cw.stars ?? 2,
            partTag: cw.part ?? 'P56',
            ipaUk: cw.ipaUk,
            ipaUs: cw.ipaUs,
            pos: posSummary,
            meaningVi: meaningSummary,
            sourcePage: cw.page,
            verified: true,
          },
          update: {
            headword: cw.word,
            stars: cw.stars ?? 2,
            partTag: cw.part ?? 'P56',
            ipaUk: cw.ipaUk,
            ipaUs: cw.ipaUs,
            pos: posSummary,
            meaningVi: meaningSummary,
            sourcePage: cw.page,
            verified: true,
          },
        });
        wordCount++;

        // Recreate senses, relations, notes cleanly
        await prisma.wordSense.deleteMany({ where: { wordId: wordRow.id } });
        await prisma.wordRelation.deleteMany({ where: { wordId: wordRow.id } });
        await prisma.wordNote.deleteMany({ where: { wordId: wordRow.id } });

        for (let sIdx = 0; sIdx < cw.senses.length; sIdx++) {
          const s = cw.senses[sIdx];
          await prisma.wordSense.create({
            data: {
              wordId: wordRow.id,
              orderNo: sIdx + 1,
              pos: s.pos,
              meaningVi: s.meaning,
              examples: {
                create: s.examples.map((ex) => ({
                  sentenceEn: ex.en,
                  sentenceVi: ex.vi,
                })),
              },
            },
          });
        }

        if (cw.relations?.length) {
          await prisma.wordRelation.createMany({
            data: cw.relations.map((r) => ({
              wordId: wordRow.id,
              type: r.type,
              text: r.text,
              pos: r.pos,
              meaningVi: r.meaning,
            })),
          });
        }

        if (cw.notes?.length) {
          await prisma.wordNote.createMany({
            data: cw.notes.map((n) => ({
              wordId: wordRow.id,
              type: n.type,
              title: n.title,
              content: n.content,
            })),
          });
        }
      }

      // 2. Complete Vocab (basic, l800, l900)
      const tiers = ['basic', 'l800', 'l900'] as const;
      for (const tier of tiers) {
        const tierMap = dayData.completeVocab?.[tier];
        if (!tierMap) continue;
        let orderNo = 1;
        for (const [section, items] of Object.entries(tierMap)) {
          for (const [headword, pos, meaningVi] of items) {
            await prisma.word.upsert({
              where: {
                topicId_listType_orderNo: {
                  topicId,
                  listType: tier,
                  orderNo,
                },
              },
              create: {
                topicId,
                listType: tier,
                section,
                orderNo,
                headword,
                pos,
                meaningVi,
                verified: true,
              },
              update: {
                section,
                headword,
                pos,
                meaningVi,
                verified: true,
              },
            });
            orderNo++;
            wordCount++;
          }
        }
      }

      // 3. Daily Checkup
      if (dayData.dailyCheckup) {
        const code = `day${String(dayData.dayNo).padStart(2, '0')}-checkup`;
        const ex = await prisma.exercise.upsert({
          where: { code },
          create: {
            code,
            type: 'daily_checkup',
            topicId,
            title: `DAY ${String(dayData.dayNo).padStart(2, '0')} Daily Checkup`,
            sourcePage: dayData.dailyCheckup.page,
          },
          update: {
            title: `DAY ${String(dayData.dayNo).padStart(2, '0')} Daily Checkup`,
            sourcePage: dayData.dailyCheckup.page,
          },
        });
        exerciseCount++;

        await prisma.question.deleteMany({ where: { exerciseId: ex.id } });
        for (let gIdx = 0; gIdx < dayData.dailyCheckup.groups.length; gIdx++) {
          const g = dayData.dailyCheckup.groups[gIdx];
          for (const q of g.questions) {
            await prisma.question.create({
              data: {
                exerciseId: ex.id,
                orderNo: q.no,
                groupNo: gIdx + 1,
                instruction: g.instruction,
                hint: g.hint,
                prompt: q.prompt,
                options: g.options,
                answer: q.answer,
              },
            });
          }
        }
      }
    }
  }

  // Seed Practice Tests (data/practice/*.json)
  const practiceDir = path.join(config.dataDir, 'practice');
  if (fs.existsSync(practiceDir)) {
    const files = fs
      .readdirSync(practiceDir)
      .filter((f) => f.endsWith('.json'))
      .sort();

    for (const file of files) {
      const pData = JSON.parse(fs.readFileSync(path.join(practiceDir, file), 'utf-8'));
      const ex = await prisma.exercise.upsert({
        where: { code: pData.code },
        create: {
          code: pData.code,
          type: 'practice_test',
          title: pData.title,
          sourcePage: pData.page,
        },
        update: {
          title: pData.title,
          sourcePage: pData.page,
        },
      });
      exerciseCount++;

      await prisma.question.deleteMany({ where: { exerciseId: ex.id } });
      for (let gIdx = 0; gIdx < pData.groups.length; gIdx++) {
        const g = pData.groups[gIdx];
        for (const q of g.questions) {
          const opts = (q.options as Array<[string, string]>).map(([key, text]) => ({
            key,
            text,
          }));
          await prisma.question.create({
            data: {
              exerciseId: ex.id,
              orderNo: q.no,
              groupNo: gIdx + 1,
              instruction: g.instruction,
              passage: g.passage,
              prompt: q.prompt,
              options: opts,
              answer: q.answer,
              explanation: q.explanation,
            },
          });
        }
      }
    }
  }

  // Seed Idioms (data/idioms.json)
  const idiomsPath = path.join(config.dataDir, 'idioms.json');
  if (fs.existsSync(idiomsPath)) {
    const idiomsData = JSON.parse(fs.readFileSync(idiomsPath, 'utf-8'));
    for (const [orderNo, headword, meaningVi] of idiomsData.items as Array<
      [number, string, string]
    >) {
      const existing = await prisma.word.findFirst({
        where: { topicId: null, listType: 'idiom', orderNo },
      });
      if (existing) {
        await prisma.word.update({
          where: { id: existing.id },
          data: { headword, meaningVi, pos: 'idiom', verified: true },
        });
      } else {
        await prisma.word.create({
          data: {
            topicId: null,
            listType: 'idiom',
            orderNo,
            headword,
            pos: 'idiom',
            meaningVi,
            verified: true,
          },
        });
      }
      wordCount++;
    }

    if (idiomsData.quizzes) {
      for (const qz of idiomsData.quizzes) {
        const [start, end] = qz.range as [number, number];
        const code = `idioms-${start}-${end}`;
        const ex = await prisma.exercise.upsert({
          where: { code },
          create: {
            code,
            type: 'idiom_quiz',
            title: `QUIZ Thành ngữ (${start}–${end})`,
          },
          update: {
            title: `QUIZ Thành ngữ (${start}–${end})`,
          },
        });
        exerciseCount++;

        await prisma.question.deleteMany({ where: { exerciseId: ex.id } });
        const opts = (qz.options as Array<[string, string]>).map(([key, text]) => ({
          key,
          text,
        }));
        for (let i = 0; i < qz.questions.length; i++) {
          const [prompt, answer] = qz.questions[i] as [string, string];
          await prisma.question.create({
            data: {
              exerciseId: ex.id,
              orderNo: i + 1,
              groupNo: 1,
              instruction: 'Hãy nối mỗi cụm từ ở cột bên trái với nghĩa tương ứng ở cột bên phải.',
              prompt,
              options: opts,
              answer,
            },
          });
        }
      }
    }
  }

  // Create default active StudyPlan if none exists
  const activePlan = await prisma.studyPlan.findFirst({ where: { active: true } });
  if (!activePlan) {
    const todayYmd = localYmd(new Date(), config.timezone);
    const defaultConfig: PlanConfig = {
      pace: 'steady_1d',
      topicsPerDay: 1,
      includeL900: false,
    };
    const schedule = generateStudySchedule(todayYmd, defaultConfig);

    const plan = await prisma.studyPlan.create({
      data: {
        target: 800,
        startDate: ymdToDate(todayYmd),
        config: defaultConfig as unknown as object,
        active: true,
      },
    });

    for (const d of schedule) {
      const planDay = await prisma.planDay.create({
        data: {
          planId: plan.id,
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
  }

  return { topics: topicsData.length, words: wordCount, exercises: exerciseCount };
}

// Allow running directly via `npm run seed -w apps/api`
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then((res) => {
      console.log('Seed completed:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

