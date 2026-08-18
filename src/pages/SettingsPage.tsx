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
import { buildSessionUrl, copyToClipboard } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { useDevMode } from '../hooks/useDevMode';
import { Toast } from '../components/Toast';
import { ArrowLeft, Trash2, Settings as SettingsIcon, Shield, Check, Loader2, Volume2, Link as LinkIcon, Copy } from 'lucide-react';

export function SettingsPage() {
  const navigate = useNavigate();
  const session = useSessionStore((s) => s.session);
  const clearSession = useSessionStore((s) => s.clearSession);
  const isCreator = useSessionStore((s) => s.isCreator);
  const isAdmin = useSessionStore((s) => s.isAdmin);
  const currentUser = useSessionStore((s) => s.currentUser);
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);
  const [selectedAdmins, setSelectedAdmins] = useState<string[]>([]);
  const [isAddingAdmins, setIsAddingAdmins] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [showChangeCreatorModal, setShowChangeCreatorModal] = useState(false);
  const [selectedNewCreator, setSelectedNewCreator] = useState<string | null>(null);
  const [isChangingCreator, setIsChangingCreator] = useState(false);
  const toast = useToast();
  const devMode = useDevMode();

  const userIsAdmin = isAdmin();
  const userIsCreator = isCreator();
  const players = usePlayerStore((s) => s.players);
  const useStayDurationPriority = useSettingsStore((s) => s.useStayDurationPriority);
  const recordScores = useSettingsStore((s) => s.recordScores);
  const forceBulkAssignment = useSettingsStore((s) => s.forceBulkAssignment);
  const practiceType = useSettingsStore((s) => s.practiceType);
  const lateBalanceMode = useSettingsStore((s) => s.lateBalanceMode);
  const reservationBlockThreshold = useSettingsStore((s) => s.reservationBlockThreshold);
  const adminMatchCallAnnounce = useSettingsStore((s) => s.adminMatchCallAnnounce);
  const setAdminMatchCallAnnounce = useSettingsStore((s) => s.setAdminMatchCallAnnounce);
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

  // セッション URL。共有 UI は 2026-05-07 に撤去したが、一覧の自動非表示
  // （最後の試合から30分）で見つけられなくなった場合の緊急避難措置として復活させた。
  // BrowserRouter の basename と同じ import.meta.env.BASE_URL を使う。
  const sessionUrl = buildSessionUrl(
    window.location.origin,
    import.meta.env.BASE_URL,
    session.id,
  );

  const handleCopyUrl = async () => {
    const ok = await copyToClipboard(sessionUrl);
    if (!ok) {
      toast.error('コピーに失敗しました');
      return;
    }
    setUrlCopied(true);
    toast.success('セッションURLをコピーしました');
    setTimeout(() => setUrlCopied(false), 2000);
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
      '※他の参加者も影響を受けます'
    );

    if (!confirmed) return;

    // 共有ゲーム状態（コート / プレイヤー休憩 / 履歴 / 予約）を 1 transaction で
    // アトミックに更新。途中失敗でコートだけ消えて履歴が残る、といった中途半端な
    // 状態にならないようにする。
    await writer.resetMatchState();

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
      '※他の参加者も影響を受けます'
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
    if (selectedAdmins.length === 0 || isAddingAdmins) return;
    setIsAddingAdmins(true);
    try {
      const ok = await updateAdmins([...(session.admins || []), ...selectedAdmins]);
      if (!ok) return; // 失敗時はモーダルと選択を維持してリトライできるようにする
      setSelectedAdmins([]);
      setShowAddAdminModal(false);
    } finally {
      setIsAddingAdmins(false);
    }
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
    if (!session.id || !selectedNewCreator || selectedNewCreator === session.createdBy || isChangingCreator) return;
    const confirmed = window.confirm(
      `作成者を ${session.createdBy} から ${selectedNewCreator} に変更しますか？\n\n` +
      'この操作は Firestore のセッションドキュメントを書き換えます。'
    );
    if (!confirmed) return;
    setIsChangingCreator(true);
    try {
      await updateCreator(session.id, selectedNewCreator);
      useSessionStore.getState().updateSession({ createdBy: selectedNewCreator });
      toast.success(`作成者を ${selectedNewCreator} に変更しました`);
      setSelectedNewCreator(null);
      setShowChangeCreatorModal(false);
    } catch (error) {
      console.error('Failed to update creator:', error);
      toast.error('作成者の変更に失敗しました');
    } finally {
      setIsChangingCreator(false);
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
                  onClick={() => void writer.setUseStayDurationPriority(true)}
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
                  onClick={() => void writer.setUseStayDurationPriority(false)}
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
              const onActive = isRelaxedMode || (!isSinglesMode && forceBulkAssignment);
              const offActive = isSinglesMode || (!isRelaxedMode && !forceBulkAssignment);
              return (
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">一括配置強制</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => !isLocked && void writer.setForceBulkAssignment(true)}
                      disabled={isLocked}
                      className={`flex-1 select-button text-xs px-2 ${
                        onActive
                          ? 'select-button-active'
                          : 'select-button-inactive'
                      } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {onActive && <span className="mr-1">✓</span>}
                      ON
                    </button>
                    <button
                      onClick={() => !isLocked && void writer.setForceBulkAssignment(false)}
                      disabled={isLocked}
                      className={`flex-1 select-button text-xs px-2 ${
                        offActive
                          ? 'select-button-active'
                          : 'select-button-inactive'
                      } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {offActive && <span className="mr-1">✓</span>}
                      OFF
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {isSinglesMode
                      ? 'シングルスでは一括配置強制は無効です'
                      : isRelaxedMode
                      ? '楽では一括配置強制が適用されます'
                      : forceBulkAssignment
                      ? '余りが少ない時は2面空くまで待ってまとめて配置'
                      : '空きが出たら1面ずつ即座に配置'}
                  </p>
                </div>
              );
            })()}

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">後半均等化</label>
              <div className="flex gap-2">
                <button
                  onClick={() => void writer.setLateBalanceMode(true)}
                  className={`flex-1 select-button text-xs px-2 ${
                    lateBalanceMode ? 'select-button-active' : 'select-button-inactive'
                  }`}
                >
                  {lateBalanceMode && <span className="mr-1">✓</span>}
                  ON
                </button>
                <button
                  onClick={() => void writer.setLateBalanceMode(false)}
                  className={`flex-1 select-button text-xs px-2 ${
                    !lateBalanceMode ? 'select-button-active' : 'select-button-inactive'
                  }`}
                >
                  {!lateBalanceMode && <span className="mr-1">✓</span>}
                  OFF
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {lateBalanceMode
                  ? useStayDurationPriority
                    ? '滞在時間あたりの試合数のバラつきを抑えます（組み合わせの質より順番を優先）'
                    : '試合数のバラつきを抑えます（組み合わせの質より順番を優先）'
                  : '練習開始から120分経過で自動的にONになります'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">予約の試合数制限</label>
              <div className="flex gap-2">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => void writer.setReservationBlockThreshold(n)}
                    className={`flex-1 select-button text-xs px-2 ${
                      reservationBlockThreshold === n
                        ? 'select-button-active'
                        : 'select-button-inactive'
                    }`}
                  >
                    {reservationBlockThreshold === n && <span className="mr-1">✓</span>}
                    +{n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                予約メンバーの試合数が中央値+{reservationBlockThreshold}以上のとき、その予約を保留します（多く試合した人が予約で順番を飛ばし続けるのを防止）
              </p>
            </div>
          </div>
        </div>

        {/* 呼び出しアナウンス（管理者） */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Volume2 size={14} className="text-indigo-600" />
            </span>
            呼び出しアナウンス
            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">管理者</span>
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setAdminMatchCallAnnounce(true)}
              className={`flex-1 select-button text-xs px-2 ${
                adminMatchCallAnnounce ? 'select-button-active' : 'select-button-inactive'
              }`}
            >
              {adminMatchCallAnnounce && <span className="mr-1">✓</span>}
              ON
            </button>
            <button
              onClick={() => setAdminMatchCallAnnounce(false)}
              className={`flex-1 select-button text-xs px-2 ${
                !adminMatchCallAnnounce ? 'select-button-active' : 'select-button-inactive'
              }`}
            >
              {!adminMatchCallAnnounce && <span className="mr-1">✓</span>}
              OFF
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            この端末のみの設定です。本人への呼び出しの30秒後に、対象者を読み上げます。
          </p>
        </div>

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

        {/* セッションURL共有 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-700">
            <span className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center">
              <LinkIcon size={14} className="text-blue-600" />
            </span>
            セッションURL
          </h2>
          <p className="text-[11px] text-muted-foreground mb-3">
            一覧から見つけられないメンバーへ、このURLを送れば参加できます。
          </p>
          <div className="bg-muted rounded-xl p-3 mb-3">
            <p className="text-xs font-mono break-all text-foreground">{sessionUrl}</p>
          </div>
          <button
            onClick={handleCopyUrl}
            className="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 border-2 border-blue-200 rounded-xl p-3 text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98] min-h-[44px]"
          >
            {urlCopied ? <Check size={16} /> : <Copy size={16} />}
            {urlCopied ? 'コピーしました' : 'URLをコピー'}
          </button>
        </div>

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
                disabled={isAddingAdmins}
                className="flex-1 btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                キャンセル
              </button>
              <button
                onClick={handleAddAdmins}
                disabled={selectedAdmins.length === 0 || isAddingAdmins}
                className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isAddingAdmins ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    追加中...
                  </>
                ) : (
                  <>追加 {selectedAdmins.length > 0 && `(${selectedAdmins.length})`}</>
                )}
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
                disabled={isChangingCreator}
                className="flex-1 btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                キャンセル
              </button>
              <button
                onClick={handleChangeCreator}
                disabled={!selectedNewCreator || isChangingCreator}
                className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isChangingCreator ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    変更中...
                  </>
                ) : (
                  '変更'
                )}
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
