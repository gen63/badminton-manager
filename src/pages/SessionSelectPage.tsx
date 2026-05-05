import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { isFirebaseConfigured } from '../lib/firebase';
import { listRecentActiveSessions } from '../services/sessionService';
import { clearAppBadge } from '../lib/badge';
import { useDevMode } from '../hooks/useDevMode';
import type { Session } from '../types/session';
import { Loader2, Plus, Users, MapPin, Calendar, Trophy, StickyNote } from 'lucide-react';

/** 日付をフォーマット（4/16(水)） */
function formatSessionDate(practiceStartTime: number): string {
  const date = new Date(practiceStartTime);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}(${weekday})`;
}

/** 練習種別の表示ラベル */
const PRACTICE_TYPE_LABEL: Record<'単' | '複' | '楽', string> = {
  単: 'シングルス',
  複: 'ダブルス',
  楽: '楽しく',
};

export function SessionSelectPage() {
  const navigate = useNavigate();
  const devMode = useDevMode();
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

    // SESSION1 fix: devMode 切替中に古い fetch が後から resolve すると
    // 新リストを上書きしてしまうので cancelled フラグで遮断する。
    let cancelled = false;
    listRecentActiveSessions(50, { includeArchived: devMode })
      .then((data) => {
        if (cancelled) return;
        setSessions(data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[SessionSelect] Failed to fetch sessions:', err);
        setError('セッション一覧の取得に失敗しました');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [devMode]);

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
                        {formatSessionDate(session.config.practiceStartTime)}
                      </span>
                    </div>

                    {/* 参加者数 + 練習種別 + 試合数 */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {session.participants?.length ?? 0}名参加中
                      </span>
                      {session.practiceType && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-foreground font-semibold">
                          練習種別: {PRACTICE_TYPE_LABEL[session.practiceType]}
                        </span>
                      )}
                      {typeof session.matchCount === 'number' && session.matchCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Trophy size={12} />
                          {session.matchCount}試合
                        </span>
                      )}
                    </div>

                    {/* メモ（周知事項） */}
                    {session.information?.text?.trim() && (
                      <div className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
                        <StickyNote size={12} className="flex-shrink-0 mt-0.5" />
                        <span className="line-clamp-2 whitespace-pre-wrap break-words">
                          {session.information.text}
                        </span>
                      </div>
                    )}
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
          </div>
        ) : null}

        {/* アクションボタン（開発モードのみ） */}
        {devMode && (
          <div className="space-y-3 pt-2">
            <button
              onClick={() => navigate('/session/create')}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              新しいセッションを作成
            </button>
          </div>
        )}

        {/* バージョン表示 */}
        <p className="text-center text-xs text-muted-foreground pt-2">
          v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
