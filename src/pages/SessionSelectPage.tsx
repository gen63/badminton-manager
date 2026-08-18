import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { deleteField } from 'firebase/firestore';
import { isFirebaseConfigured } from '../lib/firebase';
import { subscribeToRecentActiveSessions, updateSession } from '../services/sessionService';
import { setPracticeType as setPracticeTypeMutation } from '../services/sessionMutations';
import { getDefaultAnnouncement, setDefaultAnnouncement } from '../services/appConfigService';
import { isSessionVisible } from '../lib/sessionArchive';
import { clearAppBadge } from '../lib/badge';
import { useDevMode } from '../hooks/useDevMode';
import { getMatchUploadBadge, needsAccountingUploadBadge } from '../lib/uploadStatus';
import { useSessionStore } from '../stores/sessionStore';
import {
  resolvePracticeTypeLabel,
  deriveFilterOptions,
  applySessionFilters,
  summarizeSessionMedians,
  parseMonthFilterValue,
  formatMonthLabel,
  DEFAULT_SESSION_FILTER,
  CLEARED_SESSION_FILTER,
  RECENT_MONTHS,
  RECENT_MONTHS_LABEL,
  type SessionFilterState,
} from '../lib/sessionFilters';
import type { Session } from '../types/session';
import { Loader2, Plus, Users, MapPin, Calendar, Trophy, StickyNote, Pencil, X, Info, Megaphone, ChevronDown } from 'lucide-react';

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
 * 未アップロード警告バッジ（開発モード限定）。済んだものは何も表示しない。
 * 1行目は既に情報が詰まっているため、専用の行として独立させ、幅が
 * 足りない場合は折り返す（他要素とのオーバーラップを避ける）。
 */
function UploadStatusBadges({ session }: { session: Session }) {
  const matchBadge = getMatchUploadBadge(session);
  const accountingBadge = needsAccountingUploadBadge(session);
  if (matchBadge === 'none' && !accountingBadge) return null;
  const badgeClass =
    'inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs font-semibold';
  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {matchBadge === 'not-uploaded' && <span className={badgeClass}>試合未</span>}
      {matchBadge === 'stale' && <span className={badgeClass}>試合差</span>}
      {accountingBadge && <span className={badgeClass}>会計未</span>}
    </div>
  );
}

/** フィルタバーの1軸分（体育館 / 種別 / 月）のドロップダウン。選択肢が2未満の軸は呼び出し側で描画しない */
function FilterSelect({
  axisLabel,
  options,
  selected,
  onSelect,
}: {
  axisLabel: string;
  options: { value: string; display: string }[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <div className="relative flex-1 min-w-0">
      <select
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value === '' ? null : e.target.value)}
        aria-label={axisLabel}
        className="w-full bg-input border border-border rounded-xl pl-3 pr-8 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50"
        style={{ WebkitAppearance: 'none' }}
      >
        <option value="">{`${axisLabel}：すべて`}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.display}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export function SessionSelectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const devMode = useDevMode();
  const currentUser = useSessionStore((s) => s.currentUser);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'error' | 'warning'; message: string } | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingPracticeType, setEditingPracticeType] = useState<PracticeType | ''>('');
  const [saving, setSaving] = useState(false);
  // デフォルト周知事項（appConfig/global）。dev モード限定で表示・編集。
  const [defaultAnnouncementText, setDefaultAnnouncementText] = useState('');
  const [defaultAnnouncementExpanded, setDefaultAnnouncementExpanded] = useState(false);
  const [editingDefault, setEditingDefault] = useState(false);
  const [editingDefaultText, setEditingDefaultText] = useState('');
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultError, setDefaultError] = useState('');

  // useFirebaseSync からセッション削除/TTL 切れで遷移してきた場合、
  // location.state.notice を読み取って一度だけバナー表示する。
  // 表示後は history state をクリアしてブラウザバックで再表示されないようにする。
  useEffect(() => {
    const stateNotice = (location.state as { notice?: { type: 'error' | 'warning'; message: string } } | null)?.notice;
    if (stateNotice) {
      setNotice(stateNotice);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

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

  const openDefaultEdit = () => {
    setEditingDefaultText(defaultAnnouncementText);
    setDefaultError('');
    setEditingDefault(true);
  };

  const handleSaveDefault = async () => {
    if (savingDefault) return;
    const trimmed = editingDefaultText.trim();
    if (trimmed === defaultAnnouncementText) {
      setEditingDefault(false);
      return;
    }
    setSavingDefault(true);
    setDefaultError('');
    try {
      await setDefaultAnnouncement(trimmed, currentUser ?? undefined);
      setDefaultAnnouncementText(trimmed);
      setEditingDefault(false);
    } catch (err) {
      console.error('[SessionSelect] Failed to save default announcement:', err);
      const message = err instanceof Error && err.message
        ? err.message
        : 'デフォルト周知事項の保存に失敗しました';
      setDefaultError(message);
    } finally {
      setSavingDefault(false);
    }
  };

  // デフォルト周知事項の現在値を取得（dev モード限定 UI なので dev モード時のみ）
  useEffect(() => {
    if (!devMode || !isFirebaseConfigured()) return;
    let cancelled = false;
    getDefaultAnnouncement()
      .then((announcement) => {
        if (!cancelled) setDefaultAnnouncementText(announcement?.text.trim() ?? '');
      })
      .catch((err) => {
        // 未設定/rules 未対応でも一覧表示は妨げない
        console.warn('[SessionSelect] Failed to load default announcement:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [devMode]);

  // PWAバッジをクリア（セッション未参加状態）
  useEffect(() => {
    clearAppBadge();
  }, []);

  // セッション一覧をリアルタイム購読。フィルタはレンダー時に now ベースで
  // 行うため、ここでは常に全件 (includeArchived: true) を取得する。これにより
  // 90 分前ルールに引っ掛かったセッションも client にキープされ、tick で
  // 自動的に表示に切り替わる。
  useEffect(() => {
    // Firebase 未設定時はサブスクライブできないので空一覧でローディング解除する。
    // 未設定の通知は App level の FirebaseConfigBanner が担当する。
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }

    const unsubscribe = subscribeToRecentActiveSessions(
      50,
      { includeArchived: true },
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
  }, []);

  // 60 秒毎の now tick。これに依存して isSessionVisible を再評価することで、
  // 「開始 90 分前」を画面開きっぱなしで迎えたときも自動でセッションが出現する。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // dev モードは全件、それ以外は isSessionVisible で 90分前 / 最終試合から30分の判定。
  const visibleSessions = useMemo(
    () => (devMode ? sessions : sessions.filter((s) => isSessionVisible(s, now))),
    [sessions, devMode, now],
  );

  // 体育館 / 種別 / 月フィルタ。ephemeral（persist しない）。月は「直近2ヶ月」が初期選択。
  const [filter, setFilter] = useState<SessionFilterState>(DEFAULT_SESSION_FILTER);
  const options = useMemo(() => deriveFilterOptions(visibleSessions), [visibleSessions]);
  // フィルタ UI は devMode 限定なので、絞り込みも devMode のときだけ適用する
  // （初期選択の「直近2ヶ月」が、解除 UI を持たない一般参加者に効かないようにする）。
  const filteredSessions = useMemo(
    () => (devMode ? applySessionFilters(visibleSessions, filter, now) : visibleSessions),
    [visibleSessions, filter, devMode, now],
  );
  // 絞り込み後の実績サマリ（開催を1データ点とした試合数中央値）
  const filteredSummary = useMemo(
    () => summarizeSessionMedians(filteredSessions),
    [filteredSessions],
  );
  const clearFilter = () => setFilter(CLEARED_SESSION_FILTER);

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
        {/* セッション切断/TTL 切れ等の通知（useFirebaseSync から navigate state で渡される） */}
        {notice && (
          <div
            className={
              notice.type === 'error'
                ? 'bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm flex items-start justify-between gap-3'
                : 'bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-sm flex items-start justify-between gap-3'
            }
          >
            <span>{notice.message}</span>
            <button
              onClick={() => setNotice(null)}
              aria-label="通知を閉じる"
              className="flex-shrink-0 opacity-70 hover:opacity-100"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* エラー表示 */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* デフォルト周知事項（開発モード限定）— 新規セッション作成時に自動設定される。
            アコーディオンで開閉し、開くと全文を表示する。 */}
        {devMode && (
          <div className="card overflow-hidden">
            <div className="flex items-stretch">
              <button
                onClick={() => setDefaultAnnouncementExpanded((prev) => !prev)}
                className="flex-1 min-w-0 text-left px-3 py-2.5 transition-colors hover:bg-muted/50"
                aria-expanded={defaultAnnouncementExpanded}
              >
                <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                  <Megaphone size={14} className="text-primary flex-shrink-0" />
                  デフォルト周知事項
                  <ChevronDown
                    size={14}
                    className={`ml-auto flex-shrink-0 text-muted-foreground transition-transform duration-200 ${
                      defaultAnnouncementExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
                {!defaultAnnouncementExpanded && (
                  <div className="mt-1 text-xs text-muted-foreground min-w-0">
                    {defaultAnnouncementText ? (
                      <span className="block truncate">
                        {defaultAnnouncementText.split('\n')[0]}
                      </span>
                    ) : (
                      <span>未設定（新規セッション作成時に周知事項へ自動設定されます）</span>
                    )}
                  </div>
                )}
              </button>
              <button
                onClick={openDefaultEdit}
                className="text-primary px-3 hover:bg-muted/50 transition-colors flex-shrink-0 flex items-center"
                aria-label="デフォルト周知事項を編集"
              >
                <Pencil size={16} />
              </button>
            </div>
            {defaultAnnouncementExpanded && (
              <div className="px-3 pb-3 -mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {defaultAnnouncementText || '未設定（新規セッション作成時に周知事項へ自動設定されます）'}
              </div>
            )}
          </div>
        )}

        {/* フィルタバー（体育館 / 種別 / 月）— 開発モード限定。
            体育館 / 種別は選択肢が2未満の軸を出さない。月は「直近60日」が初期選択で、
            解除できないと困るため常に描画する。 */}
        {devMode && visibleSessions.length > 0 && (
          <div className="card p-3">
            <div className="flex gap-2">
              {options.gyms.length >= 2 && (
                <FilterSelect
                  axisLabel="体育館"
                  options={options.gyms.map((g) => ({ value: g, display: g }))}
                  selected={filter.gym}
                  onSelect={(value) => setFilter((prev) => ({ ...prev, gym: value }))}
                />
              )}
              {options.practiceTypes.length >= 2 && (
                <FilterSelect
                  axisLabel="種別"
                  options={options.practiceTypes.map((t) => ({ value: t, display: t }))}
                  selected={filter.practiceType}
                  onSelect={(value) => setFilter((prev) => ({ ...prev, practiceType: value }))}
                />
              )}
              <FilterSelect
                axisLabel="月"
                options={[
                  { value: RECENT_MONTHS, display: RECENT_MONTHS_LABEL },
                  ...options.months.map((m) => ({ value: String(m), display: formatMonthLabel(m) })),
                ]}
                selected={filter.month !== null ? String(filter.month) : null}
                onSelect={(value) =>
                  setFilter((prev) => ({ ...prev, month: parseMonthFilterValue(value) }))
                }
              />
            </div>

            {/* 絞り込み結果のサマリ。中央値は「開催を1データ点」とした中央値
                （各開催の試合数中央値の中央値）。試合数ゼロの開催は母集団から除く */}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
              <span>{filteredSessions.length}開催</span>
              {typeof filteredSummary.median === 'number' && (
                <span>
                  中央 {filteredSummary.median}（実績 {filteredSummary.sessionCount}開催）
                </span>
              )}
            </div>
          </div>
        )}

        {/* セッション一覧 */}
        {visibleSessions.length === 0 ? (
          !error ? (
            /* 空の状態 */
            <div className="card p-6 text-center">
              <div className="text-4xl mb-3">🏸</div>
              <h3 className="text-base font-semibold text-foreground mb-1">
                アクティブなセッションがありません
              </h3>
            </div>
          ) : null
        ) : devMode && filteredSessions.length === 0 ? (
          /* フィルタ結果が0件（フィルタバーは devMode 限定なので、この分岐も devMode 限定） */
          <div className="card p-6 text-center">
            <div className="text-4xl mb-3">🔍</div>
            <h3 className="text-base font-semibold text-foreground mb-3">
              条件に一致するセッションがありません
            </h3>
            <button onClick={clearFilter} className="btn-secondary">
              フィルタをクリア
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((session) => (
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

                      {/* 1.5行目: 未アップロード警告（開発モード限定）— 1行目とは別行にして
                          既存のタイトなアイコン行とのオーバーラップを避ける */}
                      {devMode && <UploadStatusBadges session={session} />}

                      {/* 2行目: 試合数中央値（開発モード限定） + メモ（周知事項の最初の1行）
                          — どちらか一方でもあれば表示し、上に余白を入れる。中央値チップは
                          固定幅にして全カードでメモの開始 x 座標を揃える */}
                      {(devMode && typeof session.medianGamesPlayed === 'number') ||
                      session.information?.text?.trim() ? (
                        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground min-w-0">
                          {devMode && typeof session.medianGamesPlayed === 'number' && (
                            <span className="inline-block flex-shrink-0 min-w-[3.75rem] tabular-nums">
                              中央 {session.medianGamesPlayed}
                            </span>
                          )}
                          {session.information?.text?.trim() && (
                            <>
                              <StickyNote size={12} className="flex-shrink-0" />
                              <span className="truncate">
                                {session.information.text.split('\n')[0]}
                              </span>
                            </>
                          )}
                        </div>
                      ) : null}
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
        )}

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

      {/* デフォルト周知事項編集モーダル（開発モード限定の導線から呼び出し） */}
      {editingDefault && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Megaphone size={20} className="text-primary" />
                デフォルト周知事項
              </h3>
              <button
                onClick={() => setEditingDefault(false)}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                disabled={savingDefault}
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mb-4">
              <p className="text-xs text-muted-foreground mb-2">
                新規セッション作成時（手動・自動とも）に周知事項として自動設定されます。
                既存セッションの周知事項は変わりません。空にすると自動設定されなくなります。
              </p>
              <textarea
                value={editingDefaultText}
                onChange={(e) => setEditingDefaultText(e.target.value)}
                className="w-full min-h-[160px] p-3 bg-muted border border-border rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="メンバーへの周知事項を入力..."
                disabled={savingDefault}
              />
            </div>

            {defaultError && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded-lg text-xs mb-3">
                {defaultError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setEditingDefault(false)}
                className="flex-1 btn-secondary"
                disabled={savingDefault}
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveDefault}
                className="flex-1 btn-primary"
                disabled={savingDefault}
              >
                {savingDefault ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

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
