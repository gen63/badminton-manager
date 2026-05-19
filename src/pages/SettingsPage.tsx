import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUndoStore } from '../stores/undoStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useReservationStore } from '../stores/reservationStore';
import { useSessionWriterWithToast } from '../hooks/useSessionWriterToast';
import { deleteSession, updateSession as updateFirebaseSession, updateCreator } from '../services/sessionService';
import { clearAppBadge } from '../lib/badge';
import { copyToClipboard } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { useDevMode } from '../hooks/useDevMode';
import { Toast } from '../components/Toast';
import { ArrowLeft, Trash2, Settings as SettingsIcon, Shield, Wifi, Copy, Check } from 'lucide-react';

export function SettingsPage() {
  const navigate = useNavigate();
  const session = useSessionStore((s) => s.session);
  const updateConfig = useSessionStore((s) => s.updateConfig);
  const clearSession = useSessionStore((s) => s.clearSession);
  const isCreator = useSessionStore((s) => s.isCreator);
  const isAdmin = useSessionStore((s) => s.isAdmin);
  const currentUser = useSessionStore((s) => s.currentUser);
  const [sessionIdCopied, setSessionIdCopied] = useState(false);
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);
  const [selectedAdmins, setSelectedAdmins] = useState<string[]>([]);
  const [showChangeCreatorModal, setShowChangeCreatorModal] = useState(false);
  const [selectedNewCreator, setSelectedNewCreator] = useState<string | null>(null);
  const toast = useToast();
  const devMode = useDevMode();

  const userIsAdmin = isAdmin();
  const userIsCreator = isCreator();
  const players = usePlayerStore((s) => s.players);
  const useStayDurationPriority = useSettingsStore((s) => s.useStayDurationPriority);
  const setUseStayDurationPriority = useSettingsStore((s) => s.setUseStayDurationPriority);
  const recordScores = useSettingsStore((s) => s.recordScores);
  const prioritizeDiversity = useSettingsStore((s) => s.prioritizeDiversity);
  const setPrioritizeDiversity = useSettingsStore((s) => s.setPrioritizeDiversity);
  const practiceType = useSettingsStore((s) => s.practiceType);
  const { clearAll: clearUndo } = useUndoStore();
  const { clearRecords } = useAccountingStore();
  const writer = useSessionWriterWithToast(toast);

  if (!session) {
    return <Navigate to="/" replace />;
  }

  // currentUser が未設定の場合はローディング（参加直後の僅かな期間）。
  // ただし裏管理（dev モードで観覧専用入室したユーザー）は currentUser=null
  // が意図的なので、isAdmin() で抜ける（dev モード時は常に true）。
  if (!currentUser && !userIsAdmin) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  // 管理者権限チェック
  if (!userIsAdmin) {
    navigate('/main');
    return null;
  }

  const handleTargetScoreChange = (score: number) => {
    updateConfig({ targetScore: score });
  };

  const handleCopySessionId = async () => {
    if (!session.id) return;
    await copyToClipboard(session.id);
    setSessionIdCopied(true);
    setTimeout(() => setSessionIdCopied(false), 2000);
  };

  const handleMatchReset = async () => {
    const confirmed = window.confirm(
      '試合をリセットしますか？\n\n' +
      '以下がリセットされます：\n' +
      '・試合履歴\n' +
      '・コート（すべてクリア）\n' +
      '・全員を休憩状態に\n' +
      '・試合予約\n' +
      '・会計記録\n\n' +
      '参加者リストは保持されます。\n\n' +
      '※オンラインモードの場合、他の参加者も影響を受けます'
    );

    if (!confirmed) return;

    // 共有ゲーム状態（コート / プレイヤー休憩 / 履歴 / 予約）を順次更新
    await writer.resetAllCourts();
    await writer.setAllPlayersResting();
    await writer.clearHistory();
    await writer.clearReservations();

    // ローカル専用ストアもクリア
    clearRecords();
    clearUndo();
  };

  const handleFullReset = async () => {
    const confirmed = window.confirm(
      'セッションを全リセットしますか？\n\n' +
      '以下がすべて削除されます：\n' +
      '・すべての参加者\n' +
      '・試合履歴\n' +
      '・会計記録\n' +
      '・試合予約\n\n' +
      'この操作は取り消せません。\n\n' +
      '※オンラインモードの場合、他の参加者も影響を受けます'
    );

    if (!confirmed) return;

    // Firestore document を削除（失敗してもローカルクリアは続行）
    if (session.id) {
      try {
        await deleteSession(session.id);
      } catch (error) {
        console.error('Failed to delete session from Firestore:', error);
      }
    }

    // ローカルストアをクリア（共有セッションは Firestore document 削除済みなので、
    // 残りのローカル zustand を空にしてから clearSession で離脱）
    useGameStore.setState({ matchHistory: [], courts: [] });
    usePlayerStore.setState({ players: [] });
    useReservationStore.setState({ reservations: [] });
    clearUndo();
    clearRecords();
    clearSession();

    // PWAバッジをクリア
    await clearAppBadge();

    navigate('/');
  };

  const handleDevDelete = async () => {
    const confirmed = window.confirm(
      '[DEV] このセッションを削除しますか？\n\n' +
      'Firestoreドキュメントとローカル状態をすべて削除します。\n' +
      'この操作は取り消せません。'
    );
    if (!confirmed) return;

    if (session.id) {
      try {
        await deleteSession(session.id);
      } catch (error) {
        console.error('Failed to delete session from Firestore:', error);
      }
    }
    useGameStore.setState({ matchHistory: [], courts: [] });
    usePlayerStore.setState({ players: [] });
    useReservationStore.setState({ reservations: [] });
    clearUndo();
    clearRecords();
    clearSession();
    await clearAppBadge();
    navigate('/');
  };

  // ADMIN1 fix: 失敗時に選択内容を維持できるよう成否を返す
  const updateAdmins = async (updatedAdmins: string[]): Promise<boolean> => {
    if (!session.id) return false;
    try {
      await updateFirebaseSession(session.id, { admins: updatedAdmins });
      useSessionStore.getState().updateSession({ admins: updatedAdmins });
      return true;
    } catch (error) {
      console.error('Failed to update admins:', error);
      toast.error('管理者の更新に失敗しました');
      return false;
    }
  };

  const handleAddAdmins = async () => {
    if (selectedAdmins.length === 0) return;
    const ok = await updateAdmins([...(session.admins || []), ...selectedAdmins]);
    if (!ok) return; // 失敗時はモーダルと選択を維持してリトライできるようにする
    setSelectedAdmins([]);
    setShowAddAdminModal(false);
  };

  const handleToggleAdmin = (name: string) => {
    setSelectedAdmins(prev =>
      prev.includes(name)
        ? prev.filter(n => n !== name)
        : [...prev, name]
    );
  };

  const handleRemoveAdmin = (name: string) => {
    updateAdmins((session.admins || []).filter(admin => admin !== name));
  };

  const handleChangeCreator = async () => {
    if (!session.id || !selectedNewCreator || selectedNewCreator === session.createdBy) return;
    const confirmed = window.confirm(
      `作成者を ${session.createdBy} から ${selectedNewCreator} に変更しますか？\n\n` +
      'この操作は Firestore のセッションドキュメントを書き換えます。'
    );
    if (!confirmed) return;
    try {
      await updateCreator(session.id, selectedNewCreator);
      useSessionStore.getState().updateSession({ createdBy: selectedNewCreator });
      toast.success(`作成者を ${selectedNewCreator} に変更しました`);
      setSelectedNewCreator(null);
      setShowChangeCreatorModal(false);
    } catch (error) {
      console.error('Failed to update creator:', error);
      toast.error('作成者の変更に失敗しました');
    }
  };

  const creatorCandidates = (session.participants || []).filter(
    (name) => name !== session.createdBy
  );

  const availableParticipants = players.filter(
    player => player.name !== session.createdBy && !session.admins?.includes(player.name)
  );

  return (
    <div className="pb-6">
      {/* ヘッダー */}
      <div className="text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/main')}
            aria-label="戻る"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <SettingsIcon size={20} />
            <h1 className="text-lg font-bold">設定</h1>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-3 space-y-3">
        {/* コート設定 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center text-sm">🏸</span>
            コート設定
          </h2>
          <div className="space-y-3">
            <div>
              <label className="label">目標点数</label>
              <div className="flex gap-3">
                {[15, 21].map((score) => (
                  <button
                    key={score}
                    onClick={() => handleTargetScoreChange(score)}
                    className={`select-button ${
                      session.config.targetScore === score
                        ? 'select-button-active'
                        : 'select-button-inactive'
                    }`}
                  >
                    {session.config.targetScore === score && <span className="mr-1">✓</span>}
                    {score}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">練習種別</label>
              <div className="flex gap-2">
                {(['単', '複', '楽'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => void writer.setPracticeType(type)}
                    className={`flex-1 select-button text-xs px-2 ${
                      practiceType === type ? 'select-button-active' : 'select-button-inactive'
                    }`}
                  >
                    {practiceType === type && <span className="mr-1">✓</span>}
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">配置モード</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setUseStayDurationPriority(true)}
                  className={`flex-1 select-button text-xs px-2 ${
                    useStayDurationPriority
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {useStayDurationPriority && <span className="mr-1">✓</span>}
                  待機時間
                </button>
                <button
                  onClick={() => setUseStayDurationPriority(false)}
                  className={`flex-1 select-button text-xs px-2 ${
                    !useStayDurationPriority
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {!useStayDurationPriority && <span className="mr-1">✓</span>}
                  試合回数
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {useStayDurationPriority
                  ? '滞在時間が長い人を優先'
                  : '試合回数が少ない人を優先'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">勝敗記録</label>
              <div className="flex gap-2">
                <button
                  onClick={() => void writer.setRecordScores(true)}
                  className={`flex-1 select-button text-xs px-2 ${
                    recordScores
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {recordScores && <span className="mr-1">✓</span>}
                  ON
                </button>
                <button
                  onClick={() => void writer.setRecordScores(false)}
                  className={`flex-1 select-button text-xs px-2 ${
                    !recordScores
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {!recordScores && <span className="mr-1">✓</span>}
                  OFF
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {recordScores
                  ? '終了時に勝敗を記録'
                  : '終了時に勝敗を記録しない'}
              </p>
            </div>

            {(() => {
              const isSinglesMode = practiceType === '単';
              const isRelaxedMode = practiceType === '楽';
              const isLocked = isSinglesMode || isRelaxedMode;
              const diversityActive = isRelaxedMode || (!isSinglesMode && prioritizeDiversity);
              const countActive = isSinglesMode || (!isRelaxedMode && !prioritizeDiversity);
              return (
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">配置タイミング</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => !isLocked && setPrioritizeDiversity(true)}
                      disabled={isLocked}
                      className={`flex-1 select-button text-xs px-2 ${
                        diversityActive
                          ? 'select-button-active'
                          : 'select-button-inactive'
                      } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {diversityActive && <span className="mr-1">✓</span>}
                      多様性優先
                    </button>
                    <button
                      onClick={() => !isLocked && setPrioritizeDiversity(false)}
                      disabled={isLocked}
                      className={`flex-1 select-button text-xs px-2 ${
                        countActive
                          ? 'select-button-active'
                          : 'select-button-inactive'
                      } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {countActive && <span className="mr-1">✓</span>}
                      回数優先
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {isSinglesMode
                      ? 'シングルスでは回数優先が適用されます'
                      : isRelaxedMode
                      ? '楽では多様性優先が適用されます'
                      : prioritizeDiversity
                      ? '組み合わせの多様性を優先（余り人数が少ない時は一括配置を推奨）'
                      : '空きが出たら即座に配置'}
                  </p>
                </div>
              );
            })()}
          </div>
        </div>

        {/* オンラインモード表示（Phase 4 でローカルモード廃止） */}
        <div className="card p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-500">
              <Wifi size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-foreground">オンラインモード</h3>
              <p className="text-xs text-muted-foreground">
                リアルタイム同期中・複数デバイスで共有
              </p>
            </div>
          </div>
        </div>

        {/* セッション管理（管理者のみ） */}
        {userIsAdmin && (
          <div className="card p-4">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
              <span className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center">
                <Shield size={14} className="text-purple-600" />
              </span>
              セッション情報
              <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">管理者</span>
            </h2>
            <div className="bg-muted rounded-xl p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-muted-foreground">管理者</span>
                <span className="font-medium">{session.createdBy}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">セッションID</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">{session.id}</span>
                  <button
                    onClick={handleCopySessionId}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="セッションIDをコピー"
                  >
                    {sessionIdCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              {session.participants && session.participants.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">参加者</span>
                  <span className="font-medium">{session.participants.length}人</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 管理者管理（作成者のみ） */}
        {userIsCreator && (
          <div className="card p-4">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
              <span className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Shield size={14} className="text-indigo-600" />
              </span>
              管理者管理
              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">作成者</span>
            </h2>
            <div className="space-y-2">
              {/* 作成者 */}
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">⭐️</span>
                  <div>
                    <div className="text-sm font-medium text-foreground">{session.createdBy}</div>
                    <div className="text-[10px] text-muted-foreground">作成者</div>
                  </div>
                </div>
              </div>

              {/* 追加管理者 */}
              {session.admins && session.admins.length > 0 && session.admins.map((admin) => (
                <div key={admin} className="bg-muted rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🛡</span>
                    <div className="text-sm font-medium text-foreground">{admin}</div>
                  </div>
                  <button
                    onClick={() => handleRemoveAdmin(admin)}
                    className="text-xs text-red-600 hover:text-red-700 font-medium"
                  >
                    削除
                  </button>
                </div>
              ))}

              {/* 追加ボタン */}
              <button
                onClick={() => setShowAddAdminModal(true)}
                className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <span className="text-lg">+</span>
                管理者を追加
              </button>
            </div>
          </div>
        )}

        {/* アクション */}
        {userIsAdmin && (
          <div className="card p-4">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
              <span className="w-6 h-6 rounded-lg bg-red-100 flex items-center justify-center">
                <Trash2 size={14} className="text-red-600" />
              </span>
              リセット
              <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">管理者</span>
            </h2>
            <div className="flex gap-2">
              <button
                onClick={handleMatchReset}
                className="flex-1 bg-orange-50 hover:bg-orange-100 text-orange-700 border-2 border-orange-200 rounded-xl p-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Trash2 size={16} />
                試合リセット
              </button>
              <button
                onClick={handleFullReset}
                className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 border-2 border-red-300 rounded-xl p-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Trash2 size={16} />
                全リセット
              </button>
            </div>
          </div>
        )}

        {devMode && (
          <div className="card p-4 border-2 border-dashed border-gray-400">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
              <span className="w-6 h-6 rounded-lg bg-gray-200 flex items-center justify-center">
                <Shield size={14} className="text-gray-700" />
              </span>
              作成者変更
              <span className="text-[10px] bg-gray-700 text-white px-1.5 py-0.5 rounded-full">DEV</span>
            </h2>
            <div className="bg-muted rounded-xl p-3 text-xs mb-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">現在の作成者</span>
                <span className="font-medium">{session.createdBy}</span>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedNewCreator(null);
                setShowChangeCreatorModal(true);
              }}
              disabled={creatorCandidates.length === 0}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 border-2 border-gray-400 rounded-xl p-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Shield size={16} />
              作成者を変更
            </button>
            {creatorCandidates.length === 0 && (
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                変更先の参加者がいません
              </p>
            )}
          </div>
        )}

        {devMode && (
          <div className="card p-4 border-2 border-dashed border-gray-400">
            <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
              <span className="w-6 h-6 rounded-lg bg-gray-200 flex items-center justify-center">
                <Trash2 size={14} className="text-gray-700" />
              </span>
              セッション削除
              <span className="text-[10px] bg-gray-700 text-white px-1.5 py-0.5 rounded-full">DEV</span>
            </h2>
            <button
              onClick={handleDevDelete}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 border-2 border-gray-400 rounded-xl p-3 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Trash2 size={16} />
              セッションを削除
            </button>
          </div>
        )}
      </div>

      {/* 管理者追加モーダル */}
      {showAddAdminModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <h3 className="text-lg font-bold text-foreground mb-2">管理者を追加</h3>
            <p className="text-xs text-muted-foreground mb-4">
              管理者にしたいプレイヤーを選択してください（複数選択可）
            </p>

            <div className="space-y-2 mb-4 overflow-y-auto flex-1">
              {availableParticipants.map((player) => {
                  const isSelected = selectedAdmins.includes(player.name);
                  return (
                    <button
                      key={player.id}
                      onClick={() => handleToggleAdmin(player.name)}
                      className={`w-full rounded-xl p-3 text-left text-sm font-medium transition-colors flex items-center gap-3 ${
                        isSelected
                          ? 'bg-indigo-100 text-indigo-900 border-2 border-indigo-500'
                          : 'bg-muted hover:bg-muted/70 text-foreground border-2 border-transparent'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-indigo-500' : 'bg-muted-foreground/20'
                      }`}>
                        {isSelected && <Check size={14} className="text-white" />}
                      </div>
                      <span className="text-lg">👤</span>
                      <span className="flex-1">{player.name}</span>
                    </button>
                  );
                })}

              {availableParticipants.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  管理者に追加できるプレイヤーがいません
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedAdmins([]);
                  setShowAddAdminModal(false);
                }}
                className="flex-1 btn-secondary"
              >
                キャンセル
              </button>
              <button
                onClick={handleAddAdmins}
                disabled={selectedAdmins.length === 0}
                className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                追加 {selectedAdmins.length > 0 && `(${selectedAdmins.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 作成者変更モーダル（DEV） */}
      {showChangeCreatorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col">
            <h3 className="text-lg font-bold text-foreground mb-2 flex items-center gap-2">
              作成者を変更
              <span className="text-[10px] bg-gray-700 text-white px-1.5 py-0.5 rounded-full">DEV</span>
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              新しい作成者を参加者から選択してください
            </p>

            <div className="space-y-2 mb-4 overflow-y-auto flex-1">
              {creatorCandidates.map((name) => {
                const isSelected = selectedNewCreator === name;
                return (
                  <button
                    key={name}
                    onClick={() => setSelectedNewCreator(name)}
                    className={`w-full rounded-xl p-3 text-left text-sm font-medium transition-colors flex items-center gap-3 ${
                      isSelected
                        ? 'bg-indigo-100 text-indigo-900 border-2 border-indigo-500'
                        : 'bg-muted hover:bg-muted/70 text-foreground border-2 border-transparent'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isSelected ? 'bg-indigo-500' : 'bg-muted-foreground/20'
                    }`}>
                      {isSelected && <Check size={14} className="text-white" />}
                    </div>
                    <span className="text-lg">👤</span>
                    <span className="flex-1">{name}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedNewCreator(null);
                  setShowChangeCreatorModal(false);
                }}
                className="flex-1 btn-secondary"
              >
                キャンセル
              </button>
              <button
                onClick={handleChangeCreator}
                disabled={!selectedNewCreator}
                className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                変更
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast表示 */}
      {toast.toasts.map((t) => (
        <Toast key={t.id} message={t.message} type={t.type} onClose={() => toast.hideToast(t.id)} />
      ))}
    </div>
  );
}
