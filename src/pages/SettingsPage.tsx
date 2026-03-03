import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUndoStore } from '../stores/undoStore';
import { GYM_OPTIONS } from '../types/session';
import { sendMatchesToSheets } from '../lib/sheetsApi';
import { ArrowLeft, Trash2, Users, Settings as SettingsIcon, Clock, MapPin, Upload, Loader2, Copy, Shield } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';

export function SettingsPage() {
  const navigate = useNavigate();
  const { session, updateConfig, clearSession, isCreator } = useSessionStore();
  const { players } = usePlayerStore();
  const { clearPlayers } = usePlayerStore();
  const { matchHistory, clearHistory, initializeCourts } = useGameStore();
  const { gasWebAppUrl, setGasWebAppUrl, useStayDurationPriority, setUseStayDurationPriority, recordScores, setRecordScores } = useSettingsStore();
  const { clearAll: clearUndo } = useUndoStore();
  const toast = useToast();
  const [isUploading, setIsUploading] = useState(false);
  
  // Phase 1: 権限判定
  const isAdmin = isCreator();

  if (!session) {
    navigate('/');
    return null;
  }

  const handleCourtCountChange = (count: number) => {
    updateConfig({ courtCount: count });
    initializeCourts(count);
  };

  const handleTargetScoreChange = (score: number) => {
    updateConfig({ targetScore: score });
  };

  const handleUpload = async () => {
    if (!session || !gasWebAppUrl || isUploading) return;
    setIsUploading(true);
    try {
      const result = await sendMatchesToSheets(
        gasWebAppUrl,
        matchHistory,
        players,
        session
      );
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    if (!confirm('すべてのデータをリセットしますか？\n\n※ この操作は取り消せません')) {
      return;
    }
    
    clearHistory();
    clearPlayers();
    clearUndo();
    clearSession();
    navigate('/');
  };
  
  // Phase 1: 履歴コピー機能
  const handleCopyHistory = () => {
    if (matchHistory.length === 0) {
      toast.error('コピーする履歴がありません');
      return;
    }
    
    // フォーマット: 日付 + ヘッダー + データ行（タブ区切り）
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    let text = `${dateStr}\n\n`;
    text += `連番\tペアA\tペアB\tスコア\t時刻\t試合時間\n`;
    
    // 完了した試合のみ（finishedAtが存在する）
    const finishedMatches = matchHistory.filter(m => m.finishedAt > 0);
    
    finishedMatches.forEach((match, idx) => {
      const pairA = `${match.teamA[0]}・${match.teamA[1]}`;
      const pairB = `${match.teamB[0]}・${match.teamB[1]}`;
      const scoreStr = `${match.scoreA}-${match.scoreB}`;
      const time = new Date(match.startedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      const duration = match.finishedAt 
        ? `${Math.floor((match.finishedAt - match.startedAt) / 60000)}分`
        : '-';
      
      text += `${idx + 1}\t${pairA}\t${pairB}\t${scoreStr}\t${time}\t${duration}\n`;
    });
    
    // クリップボードにコピー
    navigator.clipboard.writeText(text)
      .then(() => {
        toast.success(`履歴をコピーしました（${finishedMatches.length}件）`);
      })
      .catch((err) => {
        console.error('Failed to copy:', err);
        toast.error('コピーに失敗しました');
      });
  };

  return (
    <div className="bg-app pb-20">
      {/* ヘッダー */}
      <div className="header-gradient text-gray-800 p-3">
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

      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* コート設定 */}
        <div className="card p-6">
          <h2 className="section-title mb-5 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <span className="text-lg">🏸</span>
            </span>
            コート設定
          </h2>
          <div className="space-y-4">
            <div>
              <label className="label">コート数</label>
              <div className="flex gap-3">
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    onClick={() => handleCourtCountChange(count)}
                    className={`select-button ${
                      session.config.courtCount === count
                        ? 'select-button-active'
                        : 'select-button-inactive'
                    }`}
                  >
                    {session.config.courtCount === count && <span className="mr-1">✓</span>}
                    {count}
                  </button>
                ))}
              </div>
            </div>

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
              <label className="label flex items-center gap-1.5">
                <MapPin size={14} />
                体育館
              </label>
              <select
                value={session.config.gym || ''}
                onChange={(e) => updateConfig({ gym: e.target.value || undefined })}
                className="select-field min-h-[52px] w-auto"
              >
                <option value="">選択してください</option>
                {GYM_OPTIONS.map((gym) => (
                  <option key={gym} value={gym}>
                    {gym}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">配置モード</label>
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
              <p className="text-xs text-gray-600 mt-2">
                {useStayDurationPriority
                  ? '滞在時間が長い人を優先します'
                  : '試合回数が少ない人を優先します（待機時間を考慮しない）'}
              </p>
            </div>

            <div>
              <label className="label">勝敗記録</label>
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
              <p className="text-xs text-gray-600 mt-2">
                {recordScores
                  ? '終了時に勝敗を記録します'
                  : '勝敗記録なし（推奨しません）'}
              </p>
            </div>
          </div>
        </div>

        {/* 練習開始日時 */}
        <div className="card p-6">
          <h2 className="section-title mb-5 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <Clock size={18} className="text-amber-600" />
            </span>
            練習開始日時
          </h2>
          <input
            type="datetime-local"
            value={new Date(session.config.practiceStartTime - new Date(session.config.practiceStartTime).getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
            onChange={(e) => {
              const newTime = new Date(e.target.value).getTime();
              if (!isNaN(newTime)) {
                updateConfig({ practiceStartTime: newTime });
              }
            }}
            className="input-field min-h-[52px] w-auto"
          />
        </div>

        {/* 参加者管理 */}
        <div className="card p-6">
          <h2 className="section-title mb-5 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <Users size={18} className="text-green-600" />
            </span>
            参加者管理
          </h2>
          <button
            onClick={() => navigate('/players')}
            className="btn-primary flex items-center gap-2"
          >
            <Users size={18} />
            参加者を管理
          </button>
        </div>

        {/* Google Sheets連携 */}
        <div className="card p-6">
          <h2 className="section-title mb-5 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Upload size={18} className="text-emerald-600" />
            </span>
            Google Sheets連携
          </h2>
          <div className="space-y-4">
            <div>
              <label className="label">GAS Web App URL</label>
              <input
                type="url"
                value={gasWebAppUrl}
                onChange={(e) => setGasWebAppUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/..."
                className="input-field min-h-[52px]"
              />
            </div>
            <button
              onClick={handleUpload}
              disabled={!gasWebAppUrl || matchHistory.length === 0 || isUploading}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Upload size={18} />
              )}
              {isUploading
                ? '送信中...'
                : `Sheetsにアップロード（${matchHistory.length}件）`}
            </button>
          </div>
        </div>

        {/* セッション管理（管理者のみ）*/}
        {isAdmin && (
          <div className="card p-6">
            <h2 className="section-title mb-5 flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                <Shield size={18} className="text-purple-600" />
              </span>
              セッション管理
              <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                管理者
              </span>
            </h2>
            
            {/* セッション情報 */}
            {session.createdBy && (
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">管理者</span>
                    <span className="font-medium text-gray-800">{session.createdBy}</span>
                  </div>
                  {session.id && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">セッションID</span>
                      <span className="font-mono text-gray-800">{session.id}</span>
                    </div>
                  )}
                  {session.participants && session.participants.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">参加者</span>
                      <span className="font-medium text-gray-800">{session.participants.length}人</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* 管理者専用アクション */}
            <div className="space-y-3">
              {/* 履歴コピー */}
              <button
                onClick={handleCopyHistory}
                disabled={matchHistory.length === 0}
                className="w-full btn-secondary min-h-[48px] py-3 flex items-center justify-center gap-2
                         disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Copy size={18} />
                履歴をコピー（{matchHistory.filter(m => m.finishedAt > 0).length}件）
              </button>
              
              {/* 練習リセット */}
              <button
                onClick={handleReset}
                className="w-full btn-danger min-h-[48px] py-3 flex items-center justify-center gap-2"
              >
                <Trash2 size={18} />
                練習をリセット
              </button>
            </div>
          </div>
        )}
        
        {/* 一般ユーザー向け注意事項 */}
        {!isAdmin && session.createdBy && (
          <div className="card p-6 bg-blue-50 border border-blue-200">
            <div className="flex items-start gap-3">
              <span className="text-2xl">ℹ️</span>
              <div>
                <h3 className="font-semibold text-blue-900 mb-1">
                  参加者モード
                </h3>
                <p className="text-sm text-blue-800">
                  セッション管理・リセット・履歴コピーは管理者（{session.createdBy}）のみが実行できます。
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}
    </div>
  );
}
