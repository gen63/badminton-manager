import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { deleteField } from 'firebase/firestore';
import { isFirebaseConfigured } from '../lib/firebase';
import { subscribeToRecentActiveSessions, updateSession } from '../services/sessionService';
import { setPracticeType as setPracticeTypeMutation } from '../services/sessionMutations';
import { clearAppBadge } from '../lib/badge';
import { useDevMode } from '../hooks/useDevMode';
import { useSessionStore } from '../stores/sessionStore';
import type { Session } from '../types/session';
import { Loader2, Plus, Users, MapPin, Calendar, Trophy, StickyNote, Pencil, X, Info } from 'lucide-react';

type PracticeType = '単' | '複' | '楽';
const PRACTICE_TYPES: readonly PracticeType[] = ['単', '複', '楽'];

/** 日付をフォーマット（M/D と曜日に分割。M/D は min-width で 4 文字分相当を確保） */
function formatSessionDate(practiceStartTime: number): { md: string; weekday: string } {
  const date = new Date(practiceStartTime);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return { md: `${month}/${day}`, weekday: weekdays[date.getDay()] };
}

/**
 * 練習種別の表示ラベルを解決する。
 * 1. gameState.settings.practiceType（実データ）
 * 2. config.gameMode から派生（singles → 単 / doubles → 複）
 * 3. どちらも無ければ「不明」
 */
function resolvePracticeTypeLabel(session: Session): string {
  if (session.practiceType) return session.practiceType;
  if (session.config.gameMode === 'singles') return '単';
  if (session.config.gameMode === 'doubles') return '複';
  return '不明';
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
  const [editingPracticeType, setEditingPracticeType] = useState<PracticeType | ''>('');
  const [saving, setSaving] = useState(false);

  const openEdit = (session: Session) => {
    setEditingSession(session);
    setEditingText(session.information?.text ?? '');
    setEditingPracticeType(session.practiceType ?? '');
    // 別セッションの編集を開くたびに前回のエラーをクリア
    setError('');
  };

  const handleSave = async () => {
    if (!editingSession || saving) return;
    const trimmed = editingText.trim();
    const initialInfoText = editingSession.information?.text ?? '';
    const initialPracticeType = editingSession.practiceType ?? '';
    const infoChanged = trimmed !== initialInfoText;
    const practiceTypeChanged =
      editingPracticeType !== '' && editingPracticeType !== initialPracticeType;

    if (!infoChanged && !practiceTypeChanged) {
      setEditingSession(null);
      return;
    }

    setSaving(true);
    setError('');
    // 部分成功時の再試行で同じ書き込みを繰り返さないため、ステップ毎に
    // ローカルスナップショットを進める。
    let localEditing: Session = editingSession;
    try {
      // 1) 練習種別（gameState.settings.practiceType）— sessionMutations のトランザクションで書き込み
      if (practiceTypeChanged) {
        const nextPracticeType = editingPracticeType as PracticeType;
        await setPracticeTypeMutation(editingSession.id, nextPracticeType);
        localEditing = { ...localEditing, practiceType: nextPracticeType };
        setEditingSession(localEditing);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === editingSession.id ? { ...s, practiceType: nextPracticeType } : s,
          ),
        );
      }
      // 2) 周知事項（session.information）— トップレベル update
      if (infoChanged) {
        if (!trimmed) {
          await updateSession(editingSession.id, {
            information: deleteField() as unknown as Session['information'],
          });
          localEditing = { ...localEditing, information: undefined };
          setEditingSession(localEditing);
          setSessions((prev) =>
            prev.map((s) => (s.id === editingSession.id ? { ...s, information: undefined } : s)),
          );
        } else {
          // updatedBy は undefined を含めると Firestore（ignoreUndefinedProperties 未設定）が
          // 例外を投げるため、currentUser がある時だけプロパティを差し込む。
          const newInformation: NonNullable<Session['information']> = {
            text: trimmed,
            updatedAt: Date.now(),
            readBy: currentUser ? [currentUser] : [],
            ...(currentUser ? { updatedBy: currentUser } : {}),
          };
          await updateSession(editingSession.id, { information: newInformation });
          localEditing = { ...localEditing, information: newInformation };
          setEditingSession(localEditing);
          setSessions((prev) =>
            prev.map((s) =>
              s.id === editingSession.id ? { ...s, information: newInformation } : s,
            ),
          );
        }
      }
      setEditingSession(null);
    } catch (err) {
      console.error('[SessionSelect] Failed to save session info:', err);
      // SessionError 等の具体メッセージがあればそれを表示
      const message = err instanceof Error && err.message
        ? err.message
        : 'セッション情報の保存に失敗しました';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // PWAバッジをクリア（セッション未参加状態）
  useEffect(() => {
    clearAppBadge();
  }, []);

  // セッション一覧をリアルタイム購読（一覧画面を開いている間に新規作成された
  // セッションも自動で表示する）。devMode 切替時はローダーに戻さず、新しい
  // snapshot が届くまでは旧リストをそのまま表示する。
  useEffect(() => {
    if (!isFirebaseConfigured()) return;

    const unsubscribe = subscribeToRecentActiveSessions(
      50,
      { includeArchived: devMode },
      (data) => {
        setSessions(data);
        setLoading(false);
      },
      (err) => {
        console.error('[SessionSelect] Failed to subscribe to sessions:', err);
        setError('セッション一覧の取得に失敗しました');
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [devMode]);

  // Firebase未設定時はローカルモードにリダイレクト（レンダーで即時、フラッシュなし）
  if (!isFirebaseConfigured()) {
    return <Navigate to="/local" replace />;
  }

  // ローディング
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">セッションを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* ヘッダー */}
      <div
        className="text-foreground px-3 pb-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-md mx-auto flex items-center gap-2">
          <h1 className="text-lg font-bold">セッション選択</h1>
        </div>
      </div>

      <div className="max-w-md mx-auto w-full p-4 space-y-4 flex flex-col flex-1">
        {/* エラー表示 */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* セッション一覧 */}
        {sessions.length > 0 ? (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.id} className="card overflow-hidden">
                <div className="flex items-stretch">
                  <button
                    onClick={() => navigate(`/session/${session.id}`)}
                    className="flex-1 min-w-0 text-left px-3 py-2.5 transition-all duration-150 active:scale-[0.98]"
                  >
                    <div className="min-w-0">
                      {/* 1行目: 練習種別 + 日付 + 参加者数 + 体育館 + 試合数 (+ 開発モード時 収入合計) */}
                      <div className="flex items-center gap-x-1 flex-nowrap min-w-0">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-foreground text-xs font-semibold flex-shrink-0">
                          {resolvePracticeTypeLabel(session)}
                        </span>
                        {(() => {
                          const d = formatSessionDate(session.config.practiceStartTime);
                          return (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                              <Calendar size={12} className="flex-shrink-0" />
                              <span className="inline-block min-w-[3rem]">{d.md}({d.weekday})</span>
                            </span>
                          );
                        })()}
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                          <Users size={12} />
                          <span className="inline-block min-w-[1.75rem]">{session.paidCount ?? 0}名</span>
                        </span>
                        {session.config.gym && (
                          <span className="flex items-center gap-0.5 text-sm font-semibold text-foreground min-w-[3.5rem]">
                            <MapPin size={12} className="text-primary flex-shrink-0" />
                            <span className="truncate">{session.config.gym}</span>
                          </span>
                        )}
                        {typeof session.matchCount === 'number' && session.matchCount > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                            <Trophy size={12} />
                            {session.matchCount}試合
                          </span>
                        )}
                        {devMode && typeof session.incomeTotal === 'number' && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                            <span>💵</span>
                            {session.incomeTotal.toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* 2行目: メモ（周知事項の最初の1行）— あるときだけ表示し、上に余白を入れる */}
                      {session.information?.text?.trim() && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground min-w-0">
                          <StickyNote size={12} className="flex-shrink-0" />
                          <span className="truncate">
                            {session.information.text.split('\n')[0]}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>

                  {/* セッション情報を編集する導線（開発モード限定） */}
                  {devMode && (
                    <button
                      onClick={() => openEdit(session)}
                      className="text-primary px-3 hover:bg-muted/50 transition-colors flex-shrink-0 flex items-center"
                      aria-label="編集"
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                </div>
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

        {/* バージョン表示 — 画面下端に固定 */}
        <p
          className="text-center text-xs text-muted-foreground mt-auto pt-2"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          v{__APP_VERSION__}
        </p>
      </div>

      {/* セッション情報編集モーダル（開発モード限定の導線から呼び出し） */}
      {editingSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Info size={20} className="text-blue-600" />
                セッション情報を編集（{editingSession.id}）
              </h3>
              <button
                onClick={() => setEditingSession(null)}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                disabled={saving}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mb-4 space-y-4">
              {/* 練習種別 */}
              <div>
                <label className="text-sm font-semibold text-foreground mb-2 block">
                  練習種別
                </label>
                <div className="flex gap-2">
                  {PRACTICE_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => setEditingPracticeType(type)}
                      disabled={saving}
                      className={`flex-1 py-2 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                        editingPracticeType === type
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground hover:bg-muted/70'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                {editingPracticeType === '' && (
                  <p className="text-xs text-muted-foreground mt-1">未設定（保存しても変更されません）</p>
                )}
              </div>

              {/* 周知事項 */}
              <div>
                <label className="text-sm font-semibold text-foreground mb-2 block">
                  周知事項
                </label>
                <textarea
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  className="w-full min-h-[160px] p-3 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="メンバーへの周知事項を入力..."
                  disabled={saving}
                />
              </div>
            </div>

            {/* 保存失敗時のエラーをモーダル内にも表示（黒背景でページ上部のエラーが
                見えなくなるため） */}
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded-lg text-xs mb-3">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setEditingSession(null)}
                className="flex-1 btn-secondary"
                disabled={saving}
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                className="flex-1 btn-primary"
                disabled={saving}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
