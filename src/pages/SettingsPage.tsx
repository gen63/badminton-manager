import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUndoStore } from '../stores/undoStore';
import { useAccountingStore } from '../stores/accountingStore';
import { useReservationStore } from '../stores/reservationStore';
import { deleteSession } from '../services/sessionService';
import { SessionURLDisplay } from '../components/SessionURLDisplay';
import { clearAppBadge } from '../lib/badge';
import { ArrowLeft, Trash2, Settings as SettingsIcon, Shield, Wifi, WifiOff, QrCode, Copy, Check } from 'lucide-react';

export function SettingsPage() {
  const navigate = useNavigate();
  const { session, updateConfig, clearSession, isCreator, isAdmin: checkIsAdmin } = useSessionStore();
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const [sessionIdCopied, setSessionIdCopied] = useState(false);
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);

  // 権限判定
  const isAdmin = checkIsAdmin();
  const isCreatorUser = isCreator();
  const { players, clearPlayers } = usePlayerStore();
  const { clearHistory } = useGameStore();
  const { useStayDurationPriority, setUseStayDurationPriority, recordScores, setRecordScores, prioritizeDiversity, setPrioritizeDiversity } = useSettingsStore();
  const { clearAll: clearUndo } = useUndoStore();
  const { clearRecords } = useAccountingStore();
  const { clearReservations } = useReservationStore();

  if (!session) {
    navigate('/');
    return null;
  }

  // 管理者権限チェック
  if (!isAdmin) {
    navigate('/main');
    return null;
  }

  const handleTargetScoreChange = (score: number) => {
    updateConfig({ targetScore: score });
  };

  const handleCopySessionId = async () => {
    if (!session.id) return;
    try {
      await navigator.clipboard.writeText(session.id);
      setSessionIdCopied(true);
      setTimeout(() => setSessionIdCopied(false), 2000);
    } catch {
      // フォールバック
      const input = document.createElement('input');
      input.value = session.id;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setSessionIdCopied(true);
      setTimeout(() => setSessionIdCopied(false), 2000);
    }
  };

  const handleReset = async () => {
    const confirmed = window.confirm(
      'セッションをリセットしますか？\n\n' +
      '・すべての参加者\n' +
      '・試合履歴\n' +
      '・会計記録\n' +
      'がすべて削除されます。\n\n' +
      '※オンラインモードの場合、他の参加者も影響を受けます'
    );

    if (!confirmed) return;

    // Firebase共有セッションの場合、Firestoreドキュメントを削除
    if (session.id && session.createdBy) {
      try {
        await deleteSession(session.id);
      } catch (error) {
        console.error('Failed to delete session from Firestore:', error);
        // エラーが出てもローカルはクリアする
      }
    }

    // ローカルストアをクリア
    clearHistory();
    clearPlayers();
    clearUndo();
    clearRecords();
    clearReservations();
    clearSession();
    
    // PWAバッジをクリア
    await clearAppBadge();
    
    navigate('/');
  };

  const handleAddAdmin = async (name: string) => {
    if (!session.id || !session.createdBy) return;
    
    const updatedAdmins = [...(session.admins || []), name];
    
    // Firebase更新
    const { updateSession: updateFirebaseSession } = await import('../services/sessionService');
    try {
      await updateFirebaseSession(session.id, { admins: updatedAdmins });
      // ローカルストア更新
      useSessionStore.getState().updateSession({ admins: updatedAdmins });
    } catch (error) {
      console.error('Failed to add admin:', error);
    }
    
    setShowAddAdminModal(false);
  };

  const handleRemoveAdmin = async (name: string) => {
    if (!session.id || !session.createdBy) return;
    
    const updatedAdmins = (session.admins || []).filter(admin => admin !== name);
    
    // Firebase更新
    const { updateSession: updateFirebaseSession } = await import('../services/sessionService');
    try {
      await updateFirebaseSession(session.id, { admins: updatedAdmins });
      // ローカルストア更新
      useSessionStore.getState().updateSession({ admins: updatedAdmins });
    } catch (error) {
      console.error('Failed to remove admin:', error);
    }
  };

  return (
    <div className="bg-app pb-6">
      {/* ヘッダー */}
      <div className="header-gradient text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/main')}
            aria-label="戻る"
            className="icon-btn"
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
                  onClick={() => setRecordScores(true)}
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
                  onClick={() => setRecordScores(false)}
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
                  : '勝敗記録なし'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1.5 block">配置タイミング</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPrioritizeDiversity(true)}
                  className={`flex-1 select-button text-xs px-2 ${
                    prioritizeDiversity
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {prioritizeDiversity && <span className="mr-1">✓</span>}
                  多様性優先
                </button>
                <button
                  onClick={() => setPrioritizeDiversity(false)}
                  className={`flex-1 select-button text-xs px-2 ${
                    !prioritizeDiversity
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {!prioritizeDiversity && <span className="mr-1">✓</span>}
                  回数優先
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {prioritizeDiversity
                  ? '組み合わせの多様性を優先（余り人数が少ない時は一括配置を推奨）'
                  : '空きが出たら即座に配置'}
              </p>
            </div>
          </div>
        </div>

        {/* モード表示 */}
        <div className={`card p-4 ${session.createdBy ? 'bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200' : 'bg-gradient-to-br from-gray-50 to-slate-50 border-2 border-gray-200'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${session.createdBy ? 'bg-blue-500' : 'bg-gray-500'}`}>
              {session.createdBy ? (
                <Wifi size={20} className="text-white" />
              ) : (
                <WifiOff size={20} className="text-white" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-foreground">
                  {session.createdBy ? 'オンラインモード' : 'ローカルモード'}
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {session.createdBy 
                  ? 'リアルタイム同期中・複数デバイスで共有'
                  : 'このデバイスのみで使用中'
                }
              </p>
            </div>
          </div>
          
          {/* オンラインモード時のみセッション情報表示ボタン */}
          {session.createdBy && (
            <button
              onClick={() => setShowSessionInfo(true)}
              className="w-full btn-secondary flex items-center justify-center gap-2 text-sm"
            >
              <QrCode size={16} />
              セッション情報を表示
            </button>
          )}
        </div>

        {/* セッション管理（オンラインモード: 管理者のみ） */}
        {isAdmin && session.createdBy && (
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

        {/* 管理者管理（オンラインモード: 作成者のみ） */}
        {isCreatorUser && session.createdBy && (
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

        {/* 一般ユーザー向け注意事項（オンラインモード） */}
        {!isAdmin && session.createdBy && (
          <div className="card p-4 bg-blue-50 border border-blue-200">
            <p className="text-xs text-blue-800">
              セッション管理・リセットは管理者（{session.createdBy}）のみが実行できます。
            </p>
          </div>
        )}

        {/* アクション */}
        {isAdmin && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <button
                onClick={handleReset}
                className="btn-danger flex items-center justify-center gap-2 py-3 px-6"
              >
                <Trash2 size={18} />
                リセット
              </button>
            </div>
          </div>
        )}
      </div>

      {/* セッション情報モーダル */}
      {showSessionInfo && session.id && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="max-w-md w-full">
            <SessionURLDisplay
              sessionId={session.id}
              onClose={() => setShowSessionInfo(false)}
            />
          </div>
        </div>
      )}

      {/* 管理者追加モーダル */}
      {showAddAdminModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-foreground mb-4">管理者を追加</h3>
            <p className="text-xs text-muted-foreground mb-4">
              管理者にしたいプレイヤーを選択してください
            </p>
            
            <div className="space-y-2 mb-6">
              {players
                .filter(player => player.name !== session.createdBy && !session.admins?.includes(player.name))
                .map((player) => (
                  <button
                    key={player.id}
                    onClick={() => handleAddAdmin(player.name)}
                    className="w-full bg-muted hover:bg-muted/70 rounded-xl p-3 text-left text-sm font-medium text-foreground transition-colors flex items-center gap-2"
                  >
                    <span className="text-lg">👤</span>
                    {player.name}
                  </button>
                ))}
              
              {players.filter(player => player.name !== session.createdBy && !session.admins?.includes(player.name)).length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  管理者に追加できるプレイヤーがいません
                </p>
              )}
            </div>

            <button
              onClick={() => setShowAddAdminModal(false)}
              className="w-full btn-secondary"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
