import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { deleteField } from 'firebase/firestore';
import { isFirebaseConfigured } from '../lib/firebase';
import { listRecentActiveSessions, updateSession } from '../services/sessionService';
import { clearAppBadge } from '../lib/badge';
import { useDevMode } from '../hooks/useDevMode';
import { useSessionStore } from '../stores/sessionStore';
import type { Session } from '../types/session';
import { Loader2, Plus, Users, MapPin, Calendar, Trophy, StickyNote, Pencil, X, Info } from 'lucide-react';

/** 日付をフォーマット（4/16(水)） */
function formatSessionDate(practiceStartTime: number): string {
  const date = new Date(practiceStartTime);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}(${weekday})`;
}

export function SessionSelectPage() {
  const navigate = useNavigate();
  const devMode = useDevMode();
  const currentUser = useSessionStore((s) => s.currentUser);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savingInformation, setSavingInformation] = useState(false);

  const handleSaveInformation = async () => {
    if (!editingSession) return;
    const trimmed = editingText.trim();
    setSavingInformation(true);
    try {
      if (!trimmed) {
        await updateSession(editingSession.id, {
          information: deleteField() as unknown as Session['information'],
        });
        setSessions((prev) =>
          prev.map((s) => (s.id === editingSession.id ? { ...s, information: undefined } : s)),
        );
      } else {
        const newInformation = {
          text: trimmed,
          updatedAt: Date.now(),
          updatedBy: currentUser ?? undefined,
          readBy: currentUser ? [currentUser] : [],
        };
        await updateSession(editingSession.id, { information: newInformation });
        setSessions((prev) =>
          prev.map((s) =>
            s.id === editingSession.id ? { ...s, information: newInformation } : s,
          ),
        );
      }
      setEditingSession(null);
    } catch (err) {
      console.error('[SessionSelect] Failed to save information:', err);
      setError('周知事項の保存に失敗しました');
    } finally {
      setSavingInformation(false);
    }
  };

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
              <div key={session.id} className="card overflow-hidden">
                <button
                  onClick={() => navigate(`/session/${session.id}`)}
                  className="block w-full text-left p-4 transition-all duration-150 active:scale-[0.98]"
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
                            練習種別: {session.practiceType}
                          </span>
                        )}
                        {typeof session.matchCount === 'number' && session.matchCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Trophy size={12} />
                            {session.matchCount}試合
                          </span>
                        )}
                      </div>

                      {/* メモ（周知事項の最初の1行） */}
                      {session.information?.text?.trim() && (
                        <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                          <StickyNote size={12} className="flex-shrink-0" />
                          <span className="truncate">
                            {session.information.text.split('\n')[0]}
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

                {/* 周知事項を編集する導線（開発モード限定） */}
                {devMode && (
                  <div className="border-t border-border px-4 py-2 flex justify-end">
                    <button
                      onClick={() => {
                        setEditingSession(session);
                        setEditingText(session.information?.text ?? '');
                      }}
                      className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      <Pencil size={12} />
                      周知事項を編集
                    </button>
                  </div>
                )}
              </div>
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

      {/* 周知事項編集モーダル（開発モード限定の導線から呼び出し） */}
      {editingSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Info size={20} className="text-blue-600" />
                周知事項を編集（{editingSession.id}）
              </h3>
              <button
                onClick={() => setEditingSession(null)}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                disabled={savingInformation}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mb-4">
              <textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="w-full min-h-[200px] p-3 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="メンバーへの周知事項を入力..."
                disabled={savingInformation}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setEditingSession(null)}
                className="flex-1 btn-secondary"
                disabled={savingInformation}
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveInformation}
                className="flex-1 btn-primary"
                disabled={savingInformation}
              >
                {savingInformation ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
