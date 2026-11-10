import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { apiFetch } from '../api';

interface QuestionRow {
  id: number;
  orderNo: number;
  groupNo: number;
  instruction: string | null;
  hint: string | null;
  passage: string | null;
  prompt: string;
  options: Array<{ key: string; text: string }>;
  answer: string;
  explanation: string | null;
}

interface ExerciseDetail {
  id: number;
  code: string;
  type: string;
  title: string;
  sourcePage: number | null;
  questions: QuestionRow[];
  attempts: Array<{ id: number; score: number; total: number; createdAt: string }>;
}

interface SubmitResult {
  score: number;
  total: number;
  details: Array<{
    questionId: number;
    orderNo: number;
    prompt: string;
    userAnswer: string;
    correctAnswer: string;
    correct: boolean;
    explanation: string | null;
  }>;
}

export function ExercisePlayer({
  code,
  taskId,
  onExit,
}: {
  code: string;
  taskId?: number;
  onExit: () => void;
}) {
  const [ex, setEx] = useState<ExerciseDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setAnswers({});
    setError(null);
    apiFetch<{ exercise: ExerciseDetail }>(`/api/exercises/${code}`)
      .then((res) => setEx(res.exercise))
      .catch((err) => setError(err.message));
  }, [code]);

  if (error) {
    return (
      <div className="card">
        <h3>Chưa có dữ liệu bài tập ({code})</h3>
        <p style={{ color: 'var(--text-muted)' }}>{error}</p>
        <button className="btn btn-secondary" onClick={onExit}>
          Quay lại
        </button>
      </div>
    );
  }

  if (!ex) {
    return <div className="card">Đang tải bài tập...</div>;
  }

  const handleSubmit = async () => {
    const res = await apiFetch<SubmitResult>(`/api/exercises/${code}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers, taskId }),
    });
    setResult(res);
  };

  // Group questions by groupNo
  const groups = new Map<number, QuestionRow[]>();
  for (const q of ex.questions) {
    const list = groups.get(q.groupNo) ?? [];
    list.push(q);
    groups.set(q.groupNo, list);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>{ex.title}</h2>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {ex.sourcePage ? `Trang ${ex.sourcePage} trong sách • ` : ''}
            {ex.questions.length} câu hỏi
          </div>
        </div>
        <button className="btn btn-secondary" onClick={onExit}>
          Quay lại
        </button>
      </div>

      {result && (
        <div
          className="card"
          style={{
            borderColor: result.score / result.total >= 0.8 ? 'var(--success)' : 'var(--accent)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0 }}>
                Kết quả: {result.score} / {result.total} câu đúng (
                {Math.round((result.score / result.total) * 100)}%)
              </h3>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Xem chi tiết đáp án và giải thích bên dưới từng câu.
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setResult(null);
                setAnswers({});
              }}
            >
              <RotateCcw size={16} /> Làm lại bài tập
            </button>
          </div>
        </div>
      )}

      {Array.from(groups.entries()).map(([gNo, qs]) => {
        const first = qs[0];
        return (
          <div key={gNo} className="card">
            {first.instruction && (
              <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: 8 }}>
                {first.instruction}
              </div>
            )}
            {first.hint && (
              <div className="note-box" style={{ marginBottom: 12 }}>
                💡 Mẹo TOEIC: {first.hint}
              </div>
            )}
            {first.passage && (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  background: '#0f172a',
                  padding: 14,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  marginBottom: 16,
                }}
              >
                {first.passage}
              </pre>
            )}

            {qs.map((q) => {
              const detail = result?.details.find((d) => d.questionId === q.id);
              const selected = answers[String(q.id)] ?? '';
              return (
                <div
                  key={q.id}
                  style={{
                    padding: '12px 0',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    <span style={{ color: '#fbbf24', marginRight: 8 }}>
                      {String(q.orderNo).padStart(2, '0')}.
                    </span>
                    {q.prompt}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {q.options.map((opt) => {
                      const active = selected.toLowerCase() === opt.key.toLowerCase();
                      const isRightOption =
                        detail && opt.key.toLowerCase() === detail.correctAnswer.toLowerCase();
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() =>
                            !result &&
                            setAnswers((prev) => ({
                              ...prev,
                              [String(q.id)]: opt.key,
                            }))
                          }
                          className="btn"
                          style={{
                            background: isRightOption
                              ? 'rgba(16, 185, 129, 0.25)'
                              : active
                              ? 'var(--primary)'
                              : '#0f172a',
                            borderColor: isRightOption
                              ? '#10b981'
                              : active
                              ? 'var(--primary)'
                              : 'var(--border)',
                            color: '#fff',
                          }}
                        >
                          ({opt.key.toUpperCase()}) {opt.text}
                        </button>
                      );
                    })}
                  </div>

                  {detail && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: '0.88rem',
                        color: detail.correct ? '#34d399' : '#f87171',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {detail.correct ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                      <span>
                        Đáp án đúng: <strong>({detail.correctAnswer.toUpperCase()})</strong>
                        {detail.explanation ? ` — ${detail.explanation}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {!result && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 32 }}>
          <button className="btn btn-primary" onClick={handleSubmit}>
            Nộp bài & Chấm điểm
          </button>
        </div>
      )}
    </div>
  );
}

