import React, { useEffect, useState } from 'react';
import {
  Calendar,
  BookOpen,
  Award,
  Settings as SettingsIcon,
  Flame,
  Play,
  RotateCcw,
  Check,
  Clock,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from './api';
import { SessionPlayer } from './components/SessionPlayer';
import { ExercisePlayer } from './components/ExercisePlayer';

interface TodayPayload {
  todayYmd: string;
  plan: {
    id: number;
    target: number;
    startDate: string;
    totalDays: number;
    totalTasks: number;
    doneTasks: number;
  } | null;
  activeDay: {
    id: number;
    dayIndex: number;
    date: string;
    phase: number;
    label: string;
    tasks: Array<{
      id: number;
      orderNo: number;
      type: string;
      topicId: number | null;
      exerciseCode: string | null;
      status: string;
      topic?: { id: number; dayNo: number; title: string; category: string } | null;
    }>;
  } | null;
  overdueCount: number;
  activeSession: { id: number; status: string } | null;
  dueWordsCount: number;
  weakWordsCount: number;
}

interface TopicItem {
  id: number;
  dayNo: number;
  title: string;
  category: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  exercises: Array<{ id: number; code: string; type: string; title: string }>;
  counts: {
    core: number;
    learnedCore: number;
    masteredCore: number;
    basic: number;
    l800: number;
    weakCount: number;
  };
}

export function App() {
  const [tab, setTab] = useState<'today' | 'topics' | 'review' | 'settings'>('today');
  const [todayData, setTodayData] = useState<TodayPayload | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [activeExerciseCode, setActiveExerciseCode] = useState<string | null>(null);
  const [activeExerciseTaskId, setActiveExerciseTaskId] = useState<number | undefined>();
  const [stats, setStats] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const loadToday = async () => {
    try {
      const res = await apiFetch<TodayPayload>('/api/plan/today');
      setTodayData(res);
      if (res.activeSession && !activeSessionId && !activeExerciseCode) {
        // Option to resume existing active session
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadTopics = async () => {
    try {
      const res = await apiFetch<{ topics: TopicItem[] }>('/api/topics');
      setTopics(res.topics);
    } catch (e) {
      console.error(e);
    }
  };

  const loadStats = async () => {
    try {
      const res = await apiFetch<any>('/api/stats/overview');
      setStats(res);
    } catch (e) {}
  };

  const loadSettings = async () => {
    try {
      const res = await apiFetch<any>('/api/settings');
      setSettings(res);
    } catch (e) {}
  };

  useEffect(() => {
    loadToday();
    loadTopics();
    loadStats();
    loadSettings();
  }, []);

  const handleStartTopic = async (
    topicId: number,
    listType: string = 'core',
    mode: 'learn' | 'relearn' | 'wrong_only' = 'learn',
    taskId?: number
  ) => {
    const res = await apiFetch<any>('/api/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ topicId, listType, mode, taskId, forceNew: mode !== 'learn' }),
    });
    setActiveSessionId(res.session.id);
  };

  const handleStartReview = async () => {
    const res = await apiFetch<any>('/api/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ mode: 'review' }),
    });
    setActiveSessionId(res.session.id);
  };

  const handleReschedule = async () => {
    await apiFetch('/api/plan/reschedule', { method: 'POST' });
    await loadToday();
    setNotificationMsg('Đã dời các ngày bị trễ bắt đầu từ hôm nay!');
    setTimeout(() => setNotificationMsg(null), 3500);
  };

  if (activeSessionId) {
    return (
      <div className="main-content">
        <SessionPlayer
          sessionId={activeSessionId}
          onExit={() => {
            setActiveSessionId(null);
            loadToday();
            loadTopics();
            loadStats();
          }}
          onOpenExercise={(code) => {
            setActiveSessionId(null);
            setActiveExerciseCode(code);
          }}
        />
      </div>
    );
  }

  if (activeExerciseCode) {
    return (
      <div className="main-content">
        <ExercisePlayer
          code={activeExerciseCode}
          taskId={activeExerciseTaskId}
          onExit={() => {
            setActiveExerciseCode(null);
            setActiveExerciseTaskId(undefined);
            loadToday();
            loadStats();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>HACKERS TOEIC</h1>
          <p>Mục tiêu 800+ Vocab Coach</p>
        </div>

        <button
          className={`nav-btn ${tab === 'today' ? 'active' : ''}`}
          onClick={() => {
            setTab('today');
            loadToday();
          }}
        >
          <Calendar size={18} /> Lộ trình hôm nay
        </button>

        <button
          className={`nav-btn ${tab === 'topics' ? 'active' : ''}`}
          onClick={() => {
            setTab('topics');
            loadTopics();
          }}
        >
          <BookOpen size={18} /> 30 Chủ đề sách
        </button>

        <button
          className={`nav-btn ${tab === 'review' ? 'active' : ''}`}
          onClick={() => {
            setTab('review');
            loadStats();
          }}
        >
          <RotateCcw size={18} /> Ôn tập ({todayData?.dueWordsCount ?? 0})
        </button>

        <button
          className={`nav-btn ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => {
            setTab('settings');
            loadSettings();
          }}
        >
          <SettingsIcon size={18} /> Cài đặt & Nhắc học
        </button>

        <div style={{ marginTop: 'auto', padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', fontWeight: 700 }}>
            <Flame size={20} /> Chuỗi học: {stats?.streak ?? 0} ngày
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Học 5 từ/lượt • 20 từ kiểm tra • Cuối bài làm Checkup
          </div>
        </div>
      </aside>

      <main className="main-content">
        {notificationMsg && (
          <div className="card" style={{ borderColor: 'var(--success)', background: 'rgba(16, 185, 129, 0.15)' }}>
            {notificationMsg}
          </div>
        )}

        {/* TAB TODAY */}
        {tab === 'today' && todayData && (
          <div>
            <div className="grid-3">
              <div className="stat-card">
                <div className="label">Tiến độ lộ trình 800+</div>
                <div className="value">
                  {todayData.plan
                    ? `${Math.round((todayData.plan.doneTasks / Math.max(1, todayData.plan.totalTasks)) * 100)}%`
                    : '0%'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {todayData.plan?.doneTasks ?? 0} / {todayData.plan?.totalTasks ?? 0} nhiệm vụ
                </div>
              </div>

              <div className="stat-card">
                <div className="label">Từ cần ôn hôm nay (SRS)</div>
                <div className="value" style={{ color: todayData.dueWordsCount > 0 ? '#fbbf24' : '#fff' }}>
                  {todayData.dueWordsCount}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {todayData.weakWordsCount} từ đang bị đánh dấu yếu
                </div>
              </div>

              <div className="stat-card">
                <div className="label">Nhiệm vụ trễ hạn</div>
                <div className="value" style={{ color: todayData.overdueCount > 0 ? '#f87171' : '#fff' }}>
                  {todayData.overdueCount} ngày
                </div>
                {todayData.overdueCount > 0 && (
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '0.78rem', marginTop: 4 }}
                    onClick={handleReschedule}
                  >
                    Dời lịch từ hôm nay
                  </button>
                )}
              </div>
            </div>

            {/* Active or Resumable Session */}
            {todayData.activeSession && (
              <div
                className="card"
                style={{
                  borderColor: 'var(--primary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span className="badge badge-blue">Đang dở</span>
                  <strong style={{ marginLeft: 8 }}>Bạn có phiên học chưa kết thúc</strong>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Tiếp tục đúng từ bạn đang học trước khi thoát.
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => setActiveSessionId(todayData.activeSession!.id)}
                >
                  <Play size={16} /> Tiếp tục học ngay
                </button>
              </div>
            )}

            {/* Tasks of Today */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                    {todayData.activeDay?.label ?? 'Nhiệm vụ hôm nay'}
                  </h2>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Ngày {todayData.todayYmd} • Giai đoạn {todayData.activeDay?.phase ?? 1}
                  </div>
                </div>
              </div>

              {todayData.activeDay?.tasks.map((task) => {
                const isDone = task.status === 'done';
                return (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      marginBottom: 8,
                      borderRadius: 8,
                      background: isDone ? 'rgba(16, 185, 129, 0.08)' : '#0f172a',
                      border: `1px solid ${isDone ? 'rgba(16, 185, 129, 0.3)' : 'var(--border)'}`,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isDone && <Check size={16} color="#10b981" />}
                        {task.type === 'learn_core' && (
                          <span>Học từ vựng trọng tâm: Day {task.topic?.dayNo} ({task.topic?.title})</span>
                        )}
                        {task.type === 'review_core' && (
                          <span>Ôn từ vựng trọng tâm: Day {task.topic?.dayNo} ({task.topic?.title})</span>
                        )}
                        {task.type === 'learn_basic' && (
                          <span>Học từ vựng TOEIC cơ bản: Day {task.topic?.dayNo}</span>
                        )}
                        {task.type === 'learn_l800' && (
                          <span>Học từ vựng TOEIC mức 800: Day {task.topic?.dayNo}</span>
                        )}
                        {task.type === 'daily_checkup' && (
                          <span>Làm bài tập Daily Checkup: Day {task.topic?.dayNo}</span>
                        )}
                        {task.type === 'practice_test' && (
                          <span>Làm bài thi thực hành TOEIC ({task.exerciseCode})</span>
                        )}
                        {task.type === 'idioms' && <span>Học & kiểm tra Thành ngữ TOEIC</span>}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {task.type.includes('learn')
                          ? 'Phương pháp: 5 từ/lượt → 20 từ kiểm tra → kiểm tra chủ đề'
                          : 'Bài tập trắc nghiệm bám sát đề thi theo sách'}
                      </div>
                    </div>

                    <div>
                      {task.type.includes('learn') || task.type.includes('review') ? (
                        <button
                          className={`btn ${isDone ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() =>
                            task.topicId &&
                            handleStartTopic(
                              task.topicId,
                              task.type === 'learn_basic'
                                ? 'basic'
                                : task.type === 'learn_l800'
                                ? 'l800'
                                : 'core',
                              task.type.includes('review') ? 'relearn' : 'learn',
                              task.id
                            )
                          }
                        >
                          {isDone ? 'Học lại' : 'Bắt đầu học'}
                        </button>
                      ) : (
                        <button
                          className={`btn ${isDone ? 'btn-secondary' : 'btn-success'}`}
                          onClick={() => {
                            if (task.exerciseCode) {
                              setActiveExerciseCode(task.exerciseCode);
                              setActiveExerciseTaskId(task.id);
                            }
                          }}
                        >
                          {isDone ? 'Làm lại bài' : 'Làm bài tập'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB TOPICS */}
        {tab === 'topics' && (
          <div>
            <h2 style={{ margin: '0 0 16px' }}>30 Chủ đề sách Hackers TOEIC</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
              {topics.map((t) => (
                <div key={t.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span className="badge badge-blue">DAY {String(t.dayNo).padStart(2, '0')}</span>
                      <h3 style={{ margin: '6px 0 2px', fontSize: '1.1rem' }}>{t.title}</h3>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t.category}</div>
                    </div>
                  </div>

                  <div style={{ margin: '14px 0', fontSize: '0.85rem' }}>
                    <div>Trọng tâm: {t.counts.core} từ {t.counts.core > 0 ? `(Đã học ${t.counts.learnedCore})` : '(Chưa import)'}</div>
                    <div>Cơ bản: {t.counts.basic} • Mức 800: {t.counts.l800}</div>
                    {t.counts.weakCount > 0 && (
                      <span className="badge badge-red" style={{ marginTop: 4 }}>
                        {t.counts.weakCount} từ yếu cần học lại
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {t.counts.core > 0 ? (
                      <>
                        <button className="btn btn-primary" onClick={() => handleStartTopic(t.id, 'core', 'learn')}>
                          Học (5 từ/lượt)
                        </button>
                        <button className="btn btn-secondary" onClick={() => handleStartTopic(t.id, 'core', 'relearn')}>
                          Học lại
                        </button>
                        {t.counts.weakCount > 0 && (
                          <button className="btn btn-danger" onClick={() => handleStartTopic(t.id, 'core', 'wrong_only')}>
                            Chỉ học từ sai
                          </button>
                        )}
                        {t.exercises.length > 0 && (
                          <button
                            className="btn btn-success"
                            onClick={() => setActiveExerciseCode(t.exercises[0].code)}
                          >
                            Checkup
                          </button>
                        )}
                      </>
                    ) : (
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        Trang {t.pageStart}–{t.pageEnd} (Cần chạy import từ PDF)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB REVIEW */}
        {tab === 'review' && (
          <div className="card">
            <h2>Ôn tập ngắt quãng (Spaced Repetition)</h2>
            <p style={{ color: 'var(--text-muted)' }}>
              Thuật toán Leitner tự động đưa những từ bạn đã trả lời sai vào danh sách cần ôn hằng ngày.
            </p>

            <div style={{ margin: '20px 0' }}>
              <button
                className="btn btn-primary"
                style={{ padding: '12px 24px', fontSize: '1rem' }}
                onClick={handleStartReview}
                disabled={(todayData?.dueWordsCount ?? 0) === 0}
              >
                Bắt đầu phiên ôn ({todayData?.dueWordsCount ?? 0} từ đến hạn)
              </button>
            </div>
          </div>
        )}

        {/* TAB SETTINGS */}
        {tab === 'settings' && settings && (
          <div className="card">
            <h2>Cài đặt học & Nhắc học hằng ngày</h2>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const fd = new FormData(form);
                await apiFetch('/api/settings', {
                  method: 'PUT',
                  body: JSON.stringify({
                    batchSize: Number(fd.get('batchSize')),
                    checkpointSize: Number(fd.get('checkpointSize')),
                    reminderTime: String(fd.get('reminderTime')),
                    eveningReminderTime: String(fd.get('eveningReminderTime')),
                    telegramChatId: String(fd.get('telegramChatId')),
                  }),
                });
                await loadSettings();
                setNotificationMsg('Đã lưu cấu hình thành công!');
                setTimeout(() => setNotificationMsg(null), 3000);
              }}
            >
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  Số từ học mỗi lượt (Yêu cầu của bạn: 5 từ)
                </label>
                <input
                  name="batchSize"
                  type="number"
                  className="input"
                  defaultValue={settings.settings.batchSize}
                  style={{ maxWidth: 200 }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  Mốc kiểm tra lại (Yêu cầu của bạn: 20 từ)
                </label>
                <input
                  name="checkpointSize"
                  type="number"
                  className="input"
                  defaultValue={settings.settings.checkpointSize}
                  style={{ maxWidth: 200 }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  Giờ nhắc học buổi sáng (HH:mm)
                </label>
                <input
                  name="reminderTime"
                  type="text"
                  className="input"
                  defaultValue={settings.settings.reminderTime}
                  style={{ maxWidth: 200 }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  Giờ nhắc học buổi tối (nếu còn nhiệm vụ chưa xong)
                </label>
                <input
                  name="eveningReminderTime"
                  type="text"
                  className="input"
                  defaultValue={settings.settings.eveningReminderTime}
                  style={{ maxWidth: 200 }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                  Telegram Chat ID (để nhận nhắc học trên điện thoại)
                </label>
                <input
                  name="telegramChatId"
                  type="text"
                  className="input"
                  defaultValue={settings.settings.telegramChatId}
                  placeholder="Ví dụ: 123456789"
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Nếu chưa có token Telegram bot, cấu hình TELEGRAM_BOT_TOKEN trong file .env.
                </div>
              </div>

              <button type="submit" className="btn btn-primary">
                Lưu cài đặt
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

