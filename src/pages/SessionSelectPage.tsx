import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { isFirebaseConfigured } from '../lib/firebase';
import { listRecentActiveSessions } from '../services/sessionService';
import { clearAppBadge } from '../lib/badge';
import type { Session } from '../types/session';
import { Loader2, Plus, LogIn, Users, MapPin, Calendar, Trophy } from 'lucide-react';

/** 日付をフォーマット（4/16(水)） */
function formatSessionDate(practiceDate: string): string {
  const date = new Date(practiceDate + 'T00:00:00');
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}(${weekday})`;
}

/** 時刻をフォーマット（19:00） */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function SessionSelectPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // PWAバッジをクリア（セッション未参加状態）
  useEffect(() => {
    clearAppBadge();
  }, []);

  // セッション一覧を取得
  useEffect(() => {
    if (!isFirebaseConfigured()) return;

    listRecentActiveSessions()
      .then((data) => {
        setSessions(data);
      })
      .catch((err) => {
        console.error('[SessionSelect] Failed to fetch sessions:', err);
        setError('セッション一覧の取得に失敗しました');
      })
      .finally(() => setLoading(false));
  }, []);

  // Firebase未設定時はローカルモードにリダイレクト（レンダーで即時、フラッシュなし）
  if (!isFirebaseConfigured()) {
    return <Navigate to="/local" replace />;
  }

  // ローディング
  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">セッションを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app">
      {/* ヘッダー */}
      <div className="header-gradient text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <h1 className="text-lg font-bold">セッション選択</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto w-full p-4 space-y-4">
        {/* エラー表示 */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* セッション一覧 */}
        {sessions.length > 0 ? (
          <div className="space-y-3">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => navigate(`/session/${session.id}`)}
                className="card p-4 w-full text-left transition-all duration-150 active:scale-[0.98]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* 体育館名 + 日付 */}
                    <div className="flex items-center gap-2 mb-1.5">
                      {session.config.gym && (
                        <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                          <MapPin size={14} className="text-primary flex-shrink-0" />
                          {session.config.gym}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar size={14} className="flex-shrink-0" />
                        {formatSessionDate(session.config.practiceDate)}
                        {session.config.practiceStartTime > 0 && (
                          <> {formatTime(session.config.practiceStartTime)}</>
                        )}
                      </span>
                    </div>

                    {/* 参加者数 + 種別 + 試合数 */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {session.participants?.length ?? 0}名参加中
                      </span>
                      {session.practiceType && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-foreground font-semibold">
                          {session.practiceType}
                        </span>
                      )}
                      {typeof session.matchCount === 'number' && session.matchCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Trophy size={12} />
                          {session.matchCount}試合
                        </span>
                      )}
                    </div>
                  </div>

                  {/* セッションID */}
                  <div className="flex-shrink-0 bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-lg tracking-wider">
                    {session.id}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : !error ? (
          /* 空の状態 */
          <div className="card p-6 text-center">
            <div className="text-4xl mb-3">🏸</div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              アクティブなセッションがありません
            </h3>
            <p className="text-sm text-muted-foreground">
              新しいセッションを作成するか、セッションIDで参加してください
            </p>
          </div>
        ) : null}

        {/* アクションボタン */}
        <div className="space-y-3 pt-2">
          <button
            onClick={() => navigate('/session/create')}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            新しいセッションを作成
          </button>

          <div className="flex gap-3">
            <button
              onClick={() => navigate('/local', { state: { showJoinMode: true } })}
              className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
            >
              <LogIn size={16} />
              IDで参加
            </button>
            <button
              onClick={() => navigate('/local')}
              className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
            >
              ローカルモード
            </button>
          </div>
        </div>

        {/* バージョン表示 */}
        <p className="text-center text-xs text-muted-foreground pt-2">
          v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
