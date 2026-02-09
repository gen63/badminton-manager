import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { GYM_OPTIONS } from '../types/session';
import { sendMatchesToSheets } from '../lib/sheetsApi';
import { ArrowLeft, Trash2, Users, Settings as SettingsIcon, Clock, MapPin, Upload, Loader2 } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';

export function SettingsPage() {
  const navigate = useNavigate();
  const { session, updateConfig, clearSession } = useSessionStore();
  const { players } = usePlayerStore();
  const { clearPlayers } = usePlayerStore();
  const { matchHistory, clearHistory, initializeCourts } = useGameStore();
  const { gasWebAppUrl, setGasWebAppUrl, useStayDurationPriority, setUseStayDurationPriority } = useSettingsStore();
  const toast = useToast();
  const [isUploading, setIsUploading] = useState(false);

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
    clearHistory();
    clearPlayers();
    clearSession();
    navigate('/');
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
              <div className="flex gap-3">
                <button
                  onClick={() => setUseStayDurationPriority(true)}
                  className={`select-button ${
                    useStayDurationPriority
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {useStayDurationPriority && <span className="mr-1">✓</span>}
                  待機時間モード
                </button>
                <button
                  onClick={() => setUseStayDurationPriority(false)}
                  className={`select-button ${
                    !useStayDurationPriority
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {!useStayDurationPriority && <span className="mr-1">✓</span>}
                  試合回数モード
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2">
                {useStayDurationPriority
                  ? '滞在時間が長い人を優先します'
                  : '試合回数が少ない人を優先します（待機時間を考慮しない）'}
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

        {/* データ管理 */}
        <div className="card p-6">
          <h2 className="section-title mb-5 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
              <Trash2 size={18} className="text-red-500" />
            </span>
            データ管理
          </h2>
          <button
            onClick={handleReset}
            className="btn-danger min-h-[48px] py-3 flex items-center gap-2"
          >
            <Trash2 size={18} />
            リセット
          </button>
        </div>
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
