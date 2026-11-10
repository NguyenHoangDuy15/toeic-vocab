import React, { useEffect, useState } from 'react';
import { Volume2, ArrowRight, RotateCcw, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { apiFetch, speakEnglish } from '../api';

interface SessionPayload {
  session: {
    id: number;
    taskId: number | null;
    topicId: number | null;
    topic?: { dayNo: number; title: string; category: string } | null;
    listType: string;
    mode: string;
    status: string;
    attemptNo: number;
  };
  state: {
    step:
      | 'study_batch'
      | 'quick_test'
      | 'checkpoint_test'
      | 'topic_test'
      | 'remedial_study'
      | 'completed';
    totalWords: number;
    batchStartIndex: number;
    batchSize: number;
    checkpointSize: number;
    lastCheckpointIndex: number;
    studyCursor: number;
    studyTotal: number;
    quizCursor: number;
    quizTotal: number;
    quizCorrectCount: number;
    quizWrongCount: number;
    totalAnswered: number;
    totalCorrect: number;
    completedCheckpoints: number;
    lastTestSummary: {
      step: string;
      score: number;
      total: number;
      passed: boolean;
      wrongWordIds: number[];
    } | null;
  };
  currentWord: {
    id: number;
    orderNo: number;
    headword: string;
    stars: number | null;
    partTag: string | null;
    ipaUk: string | null;
    ipaUs: string | null;
    pos: string | null;
    meaningVi: string;
    sourcePage: number | null;
    senses: Array<{
      id: number;
      pos: string;
      meaningVi: string;
      examples: Array<{ id: number; sentenceEn: string; sentenceVi: string | null }>;
    }>;
    relations: Array<{ id: number; type: string; text: string; pos: string | null; meaningVi: string | null }>;
    notes: Array<{ id: number; type: string; title: string; content: string }>;
  } | null;
  currentQuestion: {
    wordId: number;
    qType: string;
    prompt: string;
    subPrompt?: string;
    options?: string[];
  } | null;
  feedback?: {
    correct: boolean;
    userAnswer: string;
    correctAnswer: string;
    explanation?: string;
    stepFinished: boolean;
  };
}

export function SessionPlayer({
  sessionId,
  onExit,
  onOpenExercise,
}: {
  sessionId: number;
  onExit: () => void;
  onOpenExercise: (code: string) => void;
}) {
  const [data, setData] = useState<SessionPayload | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [lastFeedback, setLastFeedback] = useState<SessionPayload['feedback'] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const res = await apiFetch<SessionPayload>(`/api/sessions/${sessionId}`);
    setData(res);
  };

  useEffect(() => {
    load();
  }, [sessionId]);

  useEffect(() => {
    if (data?.currentWord?.headword) {
      speakEnglish(data.currentWord.headword);
    }
  }, [data?.currentWord?.id]);

  const handleNextCard = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<SessionPayload>(`/api/sessions/${sessionId}/next-card`, {
        method: 'POST',
      });
      setLastFeedback(null);
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnswer = async (ans: string) => {
    if (!ans.trim() || loading) return;
    setLoading(true);
    try {
      const res = await apiFetch<SessionPayload>(`/api/sessions/${sessionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer: ans }),
      });
      setLastFeedback(res.feedback ?? null);
      setTypedAnswer('');
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return <div className="card">Đang tải phiên học...</div>;
  }

  const { session, state, currentWord, currentQuestion } = data;
  const stepLabels: Record<string, string> = {
    study_batch: `Học 5 từ (Lượt ${Math.floor(state.batchStartIndex / state.batchSize) + 1})`,
    quick_test: 'Kiểm tra nhanh 5 từ vừa học',
    checkpoint_test: `Kiểm tra mốc ${state.checkpointSize} từ`,
    topic_test: 'Kiểm tra tổng kết toàn bộ chủ đề',
    remedial_study: 'Ôn lại các từ vừa trả lời sai',
    completed: 'Hoàn thành phiên học!',
  };

  const overallPercent =
    state.totalWords > 0
      ? Math.min(100, Math.round(((state.batchStartIndex + state.studyCursor + 1) / state.totalWords) * 100))
      : 100;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <span className="badge badge-blue" style={{ marginRight: 8 }}>
            {session.topic ? `DAY ${String(session.topic.dayNo).padStart(2, '0')} — ${session.topic.title}` : 'Ôn tập'}
          </span>
          <span className="badge badge-amber">{stepLabels[state.step] ?? state.step}</span>
        </div>
        <button className="btn btn-secondary" onClick={onExit}>
          Lưu & Quay lại
        </button>
      </div>

      <div className="progress-bar" style={{ marginBottom: 18 }}>
        <div className="progress-fill" style={{ width: `${state.step === 'completed' ? 100 : overallPercent}%` }} />
      </div>

      {/* Feedback Banner */}
      {lastFeedback && (
        <div
          className="card"
          style={{
            borderColor: lastFeedback.correct ? 'var(--success)' : 'var(--danger)',
            background: lastFeedback.correct ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
            {lastFeedback.correct ? (
              <>
                <CheckCircle2 size={20} color="#10b981" /> Chính xác!
              </>
            ) : (
              <>
                <XCircle size={20} color="#ef4444" /> Chưa đúng (Bạn chọn: "{lastFeedback.userAnswer}") — Đáp án:{' '}
                <span style={{ color: '#34d399' }}>{lastFeedback.correctAnswer}</span>
              </>
            )}
          </div>
          {lastFeedback.explanation && (
            <div style={{ marginTop: 6, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              {lastFeedback.explanation}
            </div>
          )}
        </div>
      )}

      {/* STEP 1: Flashcard Study (5 words / remedial) */}
      {(state.step === 'study_batch' || state.step === 'remedial_study') && currentWord && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Thẻ {state.studyCursor + 1} / {state.studyTotal} • Từ số #{currentWord.orderNo}{' '}
                {currentWord.sourcePage ? `• Trang ${currentWord.sourcePage}` : ''}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                <h2 style={{ fontSize: '2.1rem', margin: 0 }}>{currentWord.headword}</h2>
                {currentWord.stars && (
                  <span style={{ color: '#fbbf24', fontSize: '1.1rem' }}>
                    {'★'.repeat(currentWord.stars)}
                  </span>
                )}
                {currentWord.partTag && (
                  <span className="badge badge-blue">
                    {currentWord.partTag === 'P56' ? '● Part 5, 6' : '○ Part 7'}
                  </span>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 10px' }}
                  onClick={() => speakEnglish(currentWord.headword)}
                  title="Nghe phát âm"
                >
                  <Volume2 size={18} />
                </button>
              </div>
              {(currentWord.ipaUk || currentWord.ipaUs) && (
                <div style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: '0.92rem' }}>
                  {currentWord.ipaUk && <span style={{ marginRight: 12 }}>UK [{currentWord.ipaUk}]</span>}
                  {currentWord.ipaUs && <span>US [{currentWord.ipaUs}]</span>}
                </div>
              )}
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border)', margin: '16px 0' }} />

          {/* Senses & Examples */}
          {currentWord.senses.length > 0 ? (
            currentWord.senses.map((s) => (
              <div key={s.id} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>
                  <span className="badge badge-amber" style={{ marginRight: 8 }}>
                    {s.pos}
                  </span>
                  {s.meaningVi}
                </div>
                {s.examples.map((ex) => (
                  <div
                    key={ex.id}
                    style={{
                      marginTop: 8,
                      paddingLeft: 12,
                      borderLeft: '2px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        dangerouslySetInnerHTML={{
                          __html: ex.sentenceEn.replace(
                            /\*\*([^*]+)\*\*/g,
                            '<strong style="color:#60a5fa">$1</strong>'
                          ),
                        }}
                      />
                      <button
                        onClick={() => speakEnglish(ex.sentenceEn)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        <Volume2 size={15} />
                      </button>
                    </div>
                    {ex.sentenceVi && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        {ex.sentenceVi}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>
              {currentWord.pos && (
                <span className="badge badge-amber" style={{ marginRight: 8 }}>
                  {currentWord.pos}
                </span>
              )}
              {currentWord.meaningVi}
            </div>
          )}

          {/* Relations (der / syn / ant) */}
          {currentWord.relations.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {currentWord.relations.map((r) => (
                <span key={r.id} className="badge badge-blue" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                  [{r.type}.] <strong style={{ margin: '0 4px' }}>{r.text}</strong>
                  {r.pos ? `(${r.pos}) ` : ''}
                  {r.meaningVi ?? ''}
                </span>
              ))}
            </div>
          )}

          {/* TOEIC Notes */}
          {currentWord.notes.map((n) => (
            <div key={n.id} className="note-box">
              <div style={{ fontWeight: 700, color: '#93c5fd', marginBottom: 2 }}>
                💡 [{n.type.toUpperCase()}] {n.title}
              </div>
              <div>{n.content}</div>
            </div>
          ))}

          <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleNextCard} disabled={loading}>
              {state.studyCursor + 1 < state.studyTotal
                ? 'Từ tiếp theo (5 từ/lượt)'
                : 'Bắt đầu kiểm tra lượt này'}{' '}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Quiz (Quick 5 / Checkpoint 20 / Full Topic Test) */}
      {(state.step === 'quick_test' ||
        state.step === 'checkpoint_test' ||
        state.step === 'topic_test') &&
        currentQuestion && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <span>
                Câu hỏi {state.quizCursor + 1} / {state.quizTotal}
              </span>
              <span>
                Đúng: {state.quizCorrectCount} • Sai: {state.quizWrongCount}
              </span>
            </div>

            <div style={{ margin: '18px 0' }}>
              <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#60a5fa', fontWeight: 700 }}>
                {currentQuestion.qType === 'en_to_vi' && 'Chọn nghĩa tiếng Việt đúng'}
                {currentQuestion.qType === 'vi_to_en_mc' && 'Chọn từ tiếng Anh tương ứng'}
                {currentQuestion.qType === 'cloze' && 'Điền từ vào câu ví dụ TOEIC'}
                {currentQuestion.qType === 'vi_to_en_type' && 'Gõ từ tiếng Anh tương ứng'}
              </div>
              <h3 style={{ fontSize: '1.5rem', margin: '8px 0 4px' }}>{currentQuestion.prompt}</h3>
              {currentQuestion.subPrompt && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>
                  {currentQuestion.subPrompt}
                </div>
              )}
            </div>

            {currentQuestion.options ? (
              <div>
                {currentQuestion.options.map((opt, idx) => (
                  <button
                    key={idx}
                    className="option-btn"
                    onClick={() => handleSubmitAnswer(opt)}
                    disabled={loading}
                  >
                    <span>
                      <strong style={{ marginRight: 10, color: '#60a5fa' }}>{idx + 1}.</strong> {opt}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmitAnswer(typedAnswer);
                }}
                style={{ display: 'flex', gap: 10 }}
              >
                <input
                  className="input"
                  autoFocus
                  placeholder="Nhập từ tiếng Anh..."
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  Trả lời
                </button>
              </form>
            )}
          </div>
        )}

      {/* STEP 3: Completed */}
      {state.step === 'completed' && (
        <div className="card" style={{ textAlign: 'center', padding: '36px 24px' }}>
          <Sparkles size={48} color="#fbbf24" style={{ marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 8px' }}>Chúc mừng! Bạn đã hoàn thành toàn bộ chủ đề!</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 520, margin: '0 auto 20px' }}>
            Tổng số câu đã trả lời: <strong>{state.totalAnswered}</strong> • Chính xác:{' '}
            <strong>
              {state.totalAnswered > 0
                ? Math.round((state.totalCorrect / state.totalAnswered) * 100)
                : 100}
              %
            </strong>
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {session.topic && (
              <button
                className="btn btn-success"
                onClick={() =>
                  onOpenExercise(`day${String(session.topic!.dayNo).padStart(2, '0')}-checkup`)
                }
              >
                Làm bài tập Daily Checkup cuối chủ đề
              </button>
            )}
            <button className="btn btn-primary" onClick={onExit}>
              Về bảng lộ trình hôm nay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

