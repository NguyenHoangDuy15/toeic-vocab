import topicsData from './data/topics.json';
import day01Data from './data/day01.json';
import practice1Data from './data/practice-1.json';
import idiomsData from './data/idioms.json';

// Simple in-browser mock engine for standalone mobile demo (e.g. Vercel)
interface StoredProgress {
  stats: {
    streak: number;
    lastDate: string;
  };
  sessions: Record<string, any>;
  attempts: Record<string, any>;
}

function getStore(): StoredProgress {
  try {
    const raw = localStorage.getItem('toeic_mock_store');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return {
    stats: { streak: 1, lastDate: new Date().toISOString().slice(0, 10) },
    sessions: {},
    attempts: {},
  };
}

function saveStore(store: StoredProgress) {
  try {
    localStorage.setItem('toeic_mock_store', JSON.stringify(store));
  } catch (e) {}
}

export async function handleMockApi(path: string, options?: RequestInit): Promise<any> {
  const method = options?.method?.toUpperCase() || 'GET';
  const body = options?.body ? JSON.parse(options.body as string) : {};
  const store = getStore();
  const todayYmd = new Date().toISOString().slice(0, 10);

  // 1. GET /api/plan/today
  if (path.startsWith('/api/plan/today')) {
    const activeSession = Object.values(store.sessions).find((s: any) => s.status === 'active') || null;
    return {
      todayYmd,
      plan: {
        id: 1,
        target: 800,
        startDate: todayYmd,
        totalDays: 30,
        totalTasks: 60,
        doneTasks: Object.keys(store.attempts).length + (activeSession ? 0 : 1),
      },
      activeDay: {
        id: 1,
        dayIndex: 1,
        date: todayYmd,
        phase: 1,
        label: 'Giai đoạn 1 — Từ trọng tâm (Day 01)',
        tasks: [
          {
            id: 101,
            orderNo: 1,
            type: 'learn_core',
            topicId: 1,
            status: activeSession ? 'in_progress' : 'pending',
            topic: { id: 1, dayNo: 1, title: day01Data.coreWords ? 'Thoát cảnh thất nghiệp' : 'Tuyển dụng', category: 'Tuyển dụng' },
          },
          {
            id: 102,
            orderNo: 2,
            type: 'daily_checkup',
            topicId: 1,
            exerciseCode: 'day01-checkup',
            status: store.attempts['day01-checkup'] ? 'done' : 'pending',
            topic: { id: 1, dayNo: 1, title: 'Thoát cảnh thất nghiệp', category: 'Tuyển dụng' },
          },
        ],
      },
      overdueCount: 0,
      activeSession: activeSession ? { id: activeSession.id, status: 'active' } : null,
      dueWordsCount: 5,
      weakWordsCount: 2,
    };
  }

  // 2. GET /api/topics
  if (path === '/api/topics') {
    const formatted = topicsData.map((t: any) => ({
      id: t.dayNo,
      dayNo: t.dayNo,
      title: t.title,
      category: t.category,
      pageStart: t.pageStart,
      pageEnd: t.pageEnd,
      exercises: [{ id: t.dayNo, code: `day${String(t.dayNo).padStart(2, '0')}-checkup`, type: 'daily_checkup', title: `DAY ${t.dayNo} Checkup` }],
      counts: {
        core: t.dayNo === 1 ? day01Data.coreWords.length : 0,
        learnedCore: t.dayNo === 1 ? 40 : 0,
        masteredCore: t.dayNo === 1 ? 25 : 0,
        basic: t.dayNo === 1 ? 28 : 0,
        l800: t.dayNo === 1 ? 58 : 0,
        weakCount: t.dayNo === 1 ? 2 : 0,
      },
    }));
    return { topics: formatted };
  }

  // 3. POST /api/sessions/start
  if (path === '/api/sessions/start') {
    const words = day01Data.coreWords.map((w: any) => ({
      id: w.no,
      orderNo: w.no,
      headword: w.word,
      stars: w.stars || 2,
      partTag: w.part || 'P56',
      ipaUk: w.ipaUk,
      ipaUs: w.ipaUs,
      pos: w.senses?.[0]?.pos || 'n',
      meaningVi: w.senses?.[0]?.meaning || '',
      sourcePage: w.page,
      senses: (w.senses || []).map((s: any, idx: number) => ({
        id: idx + 1,
        pos: s.pos,
        meaningVi: s.meaning,
        examples: (s.examples || []).map((ex: any, exIdx: number) => ({
          id: exIdx + 1,
          sentenceEn: ex.en,
          sentenceVi: ex.vi,
        })),
      })),
      relations: (w.relations || []).map((r: any, idx: number) => ({
        id: idx + 1,
        type: r.type,
        text: r.text,
        pos: r.pos,
        meaningVi: r.meaning,
      })),
      notes: (w.notes || []).map((n: any, idx: number) => ({
        id: idx + 1,
        type: n.type,
        title: n.title,
        content: n.content,
      })),
    }));

    const sessionId = 1;
    const batchSize = 5;
    const sessionObj = {
      id: sessionId,
      status: 'active',
      words,
      step: 'study_batch',
      studyCursor: 0,
      batchStartIndex: 0,
      batchSize,
      checkpointSize: 20,
      quizQueue: [] as any[],
      quizCursor: 0,
      quizCorrectCount: 0,
      quizWrongCount: 0,
      totalAnswered: 0,
      totalCorrect: 0,
    };
    store.sessions[sessionId] = sessionObj;
    saveStore(store);

    return buildSessionResponse(sessionObj);
  }

  // 4. GET /api/sessions/:id
  if (path.startsWith('/api/sessions/')) {
    const parts = path.split('/');
    const id = parts[3];
    const session = store.sessions[id] || Object.values(store.sessions)[0];
    if (!session) throw new Error('Session not found');

    if (path.endsWith('/next-card')) {
      if (session.step === 'study_batch' || session.step === 'remedial_study') {
        const curBatchCount = Math.min(session.batchSize, session.words.length - session.batchStartIndex);
        if (session.studyCursor + 1 < curBatchCount) {
          session.studyCursor += 1;
        } else {
          // Switch to quick test!
          session.step = 'quick_test';
          session.quizCursor = 0;
          session.quizCorrectCount = 0;
          session.quizWrongCount = 0;
          // Generate 5 quick questions
          const batchWords = session.words.slice(session.batchStartIndex, session.batchStartIndex + curBatchCount);
          session.quizQueue = batchWords.map((w: any) => {
            const distractors = session.words.filter((d: any) => d.id !== w.id).slice(0, 3);
            const options = [w.meaningVi, ...distractors.map((d: any) => d.meaningVi)].sort(() => Math.random() - 0.5);
            return {
              wordId: w.id,
              qType: 'en_to_vi',
              prompt: w.headword,
              subPrompt: `(${w.pos}) [${w.ipaUs || w.ipaUk || ''}]`,
              options,
              correctAnswer: w.meaningVi,
              explanation: `${w.headword}: ${w.meaningVi}`,
            };
          });
        }
      }
      saveStore(store);
      return buildSessionResponse(session);
    }

    if (path.endsWith('/answer')) {
      const q = session.quizQueue[session.quizCursor];
      const correct = q && body.answer?.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
      session.totalAnswered += 1;
      if (correct) {
        session.totalCorrect += 1;
        session.quizCorrectCount += 1;
      } else {
        session.quizWrongCount += 1;
      }

      let stepFinished = false;
      if (session.quizCursor + 1 < session.quizQueue.length) {
        session.quizCursor += 1;
      } else {
        stepFinished = true;
        // Finished quick test! Check if we should trigger checkpoint
        const nextBatchStart = session.batchStartIndex + session.batchSize;
        if (nextBatchStart >= 20 && session.step === 'quick_test') {
          session.step = 'checkpoint_test';
          session.quizCursor = 0;
          const checkpointWords = session.words.slice(0, 20);
          session.quizQueue = checkpointWords.slice(0, 10).map((w: any) => ({
            wordId: w.id,
            qType: 'en_to_vi',
            prompt: w.headword,
            options: [w.meaningVi, 'thảo luận', 'hủy bỏ', 'chấp thuận'].sort(() => Math.random() - 0.5),
            correctAnswer: w.meaningVi,
            explanation: `${w.headword}: ${w.meaningVi}`,
          }));
        } else if (nextBatchStart < session.words.length) {
          session.batchStartIndex = nextBatchStart;
          session.studyCursor = 0;
          session.step = 'study_batch';
        } else {
          session.step = 'completed';
          session.status = 'completed';
        }
      }

      saveStore(store);
      const res = buildSessionResponse(session);
      return {
        feedback: {
          correct,
          userAnswer: body.answer,
          correctAnswer: q?.correctAnswer,
          explanation: q?.explanation,
          stepFinished,
        },
        ...res,
      };
    }

    return buildSessionResponse(session);
  }

  // 5. GET /api/exercises/:code
  if (path.startsWith('/api/exercises/')) {
    const code = path.split('/')[3];
    if (path.endsWith('/submit')) {
      const exCode = path.split('/')[3];
      const answers = body.answers || {};
      let questions: any[] = [];
      if (exCode.includes('checkup')) {
        day01Data.dailyCheckup.groups.forEach((g: any) => questions.push(...g.questions));
      } else if (exCode.includes('practice')) {
        practice1Data.groups.forEach((g: any) => questions.push(...g.questions));
      } else {
        idiomsData.quizzes.forEach((qz: any) => {
          qz.questions.forEach((q: any) => questions.push({ no: q[0], answer: q[1] }));
        });
      }

      let score = 0;
      const details = questions.map((q: any) => {
        const userAns = answers[String(q.no)] || '';
        const isRight = userAns.toLowerCase() === q.answer.toLowerCase();
        if (isRight) score++;
        return {
          questionId: q.no,
          orderNo: q.no,
          userAnswer: userAns,
          correctAnswer: q.answer,
          correct: isRight,
          explanation: q.explanation || `Đáp án đúng là ${q.answer.toUpperCase()}`,
        };
      });

      store.attempts[exCode] = { score, total: questions.length };
      saveStore(store);

      return { score, total: questions.length, details };
    }

    if (code.includes('checkup')) {
      let qList: any[] = [];
      day01Data.dailyCheckup.groups.forEach((g: any, gIdx: number) => {
        g.questions.forEach((q: any) => {
          qList.push({
            id: q.no,
            orderNo: q.no,
            groupNo: gIdx + 1,
            instruction: g.instruction,
            hint: g.hint || null,
            passage: null,
            prompt: q.prompt,
            options: g.options,
            answer: q.answer,
            explanation: `Đáp án trong sách: (${q.answer.toUpperCase()})`,
          });
        });
      });
      return {
        exercise: {
          id: 1,
          code: 'day01-checkup',
          title: 'DAY 01 Daily Checkup',
          sourcePage: day01Data.dailyCheckup.page,
          questions: qList,
          attempts: store.attempts['day01-checkup'] ? [store.attempts['day01-checkup']] : [],
        },
      };
    }

    if (code.includes('practice')) {
      let qList: any[] = [];
      practice1Data.groups.forEach((g: any, gIdx: number) => {
        g.questions.forEach((q: any) => {
          qList.push({
            id: q.no,
            orderNo: q.no,
            groupNo: gIdx + 1,
            instruction: g.instruction,
            hint: null,
            passage: g.passage || null,
            prompt: q.prompt,
            options: q.options.map(([k, t]: any) => ({ key: k, text: t })),
            answer: q.answer,
            explanation: q.explanation,
          });
        });
      });
      return {
        exercise: {
          id: 2,
          code: practice1Data.code,
          title: practice1Data.title,
          sourcePage: practice1Data.page,
          questions: qList,
          attempts: store.attempts[practice1Data.code] ? [store.attempts[practice1Data.code]] : [],
        },
      };
    }
  }

  // 6. GET /api/stats/overview
  if (path === '/api/stats/overview') {
    return {
      totalWords: 7600,
      byListType: [
        { listType: 'core', _count: { _all: 1200 } },
        { listType: 'l800', _count: { _all: 2400 } },
      ],
      progByStatus: [
        { status: 'mastered', _count: { _all: 25 } },
        { status: 'learning', _count: { _all: 15 } },
      ],
      weakCount: 2,
      dueCount: 5,
      streak: store.stats.streak,
      studiedToday: true,
      recentAttemptsCount: Object.keys(store.attempts).length,
    };
  }

  // 7. GET /api/settings
  if (path === '/api/settings') {
    return {
      settings: {
        batchSize: 5,
        checkpointSize: 20,
        passRate: 0.8,
        gate: true,
        reminderEnabled: true,
        reminderTime: '07:30',
        eveningReminderTime: '21:00',
        telegramChatId: '',
      },
      envTelegramConfigured: false,
      envGeminiConfigured: false,
    };
  }

  return {};
}

function buildSessionResponse(session: any) {
  const curBatchWords = session.words.slice(session.batchStartIndex, session.batchStartIndex + session.batchSize);
  const curWord = curBatchWords[session.studyCursor] || session.words[0];
  const curQ = session.quizQueue[session.quizCursor] || null;

  return {
    session: {
      id: session.id,
      topicId: 1,
      topic: { dayNo: 1, title: 'Thoát cảnh thất nghiệp', category: 'Tuyển dụng' },
      listType: 'core',
      mode: 'learn',
      status: session.status,
      attemptNo: 1,
    },
    state: {
      step: session.step,
      totalWords: session.words.length,
      batchStartIndex: session.batchStartIndex,
      batchSize: session.batchSize,
      checkpointSize: session.checkpointSize,
      lastCheckpointIndex: 0,
      studyCursor: session.studyCursor,
      studyTotal: curBatchWords.length,
      quizCursor: session.quizCursor,
      quizTotal: session.quizQueue.length,
      quizCorrectCount: session.quizCorrectCount,
      quizWrongCount: session.quizWrongCount,
      totalAnswered: session.totalAnswered,
      totalCorrect: session.totalCorrect,
      completedCheckpoints: 0,
      lastTestSummary: null,
    },
    currentWord: (session.step === 'study_batch' || session.step === 'remedial_study') ? curWord : null,
    currentQuestion: curQ,
  };
}
