import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { ArrowLeft, Trash2 } from 'lucide-react';
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
    <div className="min-h-screen bg-gray-100 pb-20">
      {/* ヘッダー */}
      <div className="bg-white p-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/main')}
            aria-label="戻る"
            className="p-3 hover:bg-gray-100 active:bg-gray-200 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={24} className="text-gray-600" />
          </button>
          <h1 className="text-base font-medium text-gray-600">設定</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-5 space-y-4">
        {/* コート設定 */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">コート設定</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-3">コート数</label>
              <div className="flex gap-3">
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    onClick={() => handleCourtCountChange(count)}
                    className={`flex-1 min-h-[44px] py-3 rounded-full font-semibold transition-all duration-150 ${
                      session.config.courtCount === count
                        ? 'bg-blue-500 text-white shadow-lg ring-2 ring-blue-300 scale-105'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98]'
                    }`}
                  >
                    {session.config.courtCount === count && '✓ '}{count}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-3">点数</label>
              <div className="flex gap-3">
                {[11, 15, 21].map((score) => (
                  <button
                    key={score}
                    onClick={() => handleTargetScoreChange(score)}
                    className={`flex-1 min-h-[44px] py-3 rounded-full font-semibold transition-all duration-150 ${
                      session.config.targetScore === score
                        ? 'bg-blue-500 text-white shadow-lg ring-2 ring-blue-300 scale-105'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98]'
                    }`}
                  >
                    {session.config.targetScore === score && '✓ '}{score}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 練習開始日時 */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">練習開始日時</h2>
          <input
            type="datetime-local"
            value={new Date(session.config.practiceStartTime).toISOString().slice(0, 16)}
            onChange={(e) => {
              const newTime = new Date(e.target.value).getTime();
              if (!isNaN(newTime)) {
                updateConfig({ practiceStartTime: newTime });
              }
            }}
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-base focus:ring-2 focus:ring-blue-300 focus:border-transparent focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-2">
            ※ 滞在時間の計算に使用されます
          </p>
        </div>

        {/* 参加者管理 */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">参加者管理</h2>
          <button
            onClick={() => navigate('/players')}
            className="w-full bg-blue-500 text-white min-h-[44px] py-3 rounded-full font-semibold hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150"
          >
            参加者を管理
          </button>
        </div>

        {/* データ管理 */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">データ管理</h2>
          <button
            onClick={handleReset}
            className="w-full bg-red-500 text-white min-h-[44px] py-3 rounded-full font-semibold hover:bg-red-600 active:bg-red-700 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
          >
            <Trash2 size={18} />
            セッションをリセット
          </button>
          <p className="text-xs text-gray-500 text-center mt-2">
            ※ すべてのデータが削除されます
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
