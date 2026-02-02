import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { GYM_OPTIONS } from '../types/session';
import { ArrowLeft, Trash2, Users, Settings as SettingsIcon, Clock, MapPin } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';

export function SettingsPage() {
  const navigate = useNavigate();
  const { session, updateConfig, clearSession } = useSessionStore();
  const { clearPlayers } = usePlayerStore();
  const { clearHistory, initializeCourts } = useGameStore();
  const toast = useToast();

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

  const handleReset = () => {
    clearHistory();
    clearPlayers();
    clearSession();
    navigate('/');
  };

  return (
    <div className="bg-app pb-20">
      {/* ヘッダー */}
      <div className="header-gradient text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/main')}
            aria-label="戻る"
            className="icon-btn bg-white/20 hover:bg-white/30 text-white border border-white/20"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <SettingsIcon size={20} />
            <h1 className="text-lg font-bold">設定</h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-5 space-y-4">
        {/* コート設定 */}
        <div className="card p-6">
          <h2 className="section-title mb-5 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <span className="text-lg">🏸</span>
            </span>
            コート設定
          </h2>
          <div className="space-y-5">
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
                {[11, 15, 21].map((score) => (
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
                className="select-field min-h-[52px]"
              >
                <option value="">選択してください</option>
                {GYM_OPTIONS.map((gym) => (
                  <option key={gym} value={gym}>
                    {gym}
                  </option>
                ))}
              </select>
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
            value={new Date(session.config.practiceStartTime).toISOString().slice(0, 16)}
            onChange={(e) => {
              const newTime = new Date(e.target.value).getTime();
              if (!isNaN(newTime)) {
                updateConfig({ practiceStartTime: newTime });
              }
            }}
            className="input-field min-h-[52px]"
          />
          <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
            <span className="w-1 h-1 bg-gray-400 rounded-full" />
            滞在時間の計算に使用されます
          </p>
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
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Users size={18} />
            参加者を管理
          </button>
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
            className="w-full min-h-[48px] bg-gradient-to-r from-red-500 to-red-600 text-white py-3 rounded-full font-semibold hover:from-red-600 hover:to-red-700 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2 shadow-lg"
          >
            <Trash2 size={18} />
            セッションをリセット
          </button>
          <p className="text-xs text-red-500 text-center mt-3 flex items-center justify-center gap-1">
            <span className="w-1 h-1 bg-red-400 rounded-full" />
            すべてのデータが削除されます
          </p>
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
