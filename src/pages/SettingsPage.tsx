import { useState } from 'react';
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
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
    setShowResetConfirm(false);
    clearHistory();
    clearPlayers();
    clearSession();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#faf6f1] pb-20">
      {/* ヘッダー */}
      <div className="bg-[#f0e6da] p-4 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/main')}
            className="p-2 hover:bg-[#e8ddd0] rounded-full transition"
          >
            <ArrowLeft size={24} className="text-gray-600" />
          </button>
          <h1 className="text-xl font-semibold text-gray-700">設定</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* コート設定 */}
        <div className="bg-[#f0e6da] rounded-2xl p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">コート設定</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-2">
                コート数
              </label>
              <div className="flex gap-2">
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    onClick={() => handleCourtCountChange(count)}
                    className={`flex-1 py-3 rounded-full font-semibold transition-all ${
                      session.config.courtCount === count
                        ? 'bg-white text-gray-800 shadow-md ring-2 ring-gray-300'
                        : 'bg-[#e8ddd0] text-gray-500 hover:bg-[#e0d5c8]'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-2">
                点数
              </label>
              <div className="flex gap-2">
                {[11, 15, 21].map((score) => (
                  <button
                    key={score}
                    onClick={() => handleTargetScoreChange(score)}
                    className={`flex-1 py-3 rounded-full font-semibold transition-all ${
                      session.config.targetScore === score
                        ? 'bg-white text-gray-800 shadow-md ring-2 ring-gray-300'
                        : 'bg-[#e8ddd0] text-gray-500 hover:bg-[#e0d5c8]'
                    }`}
                  >
                    {score}点
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 参加者管理 */}
        <div className="bg-[#f0e6da] rounded-2xl p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">参加者管理</h2>
          <button
            onClick={() => navigate('/players')}
            className="w-full bg-[#d4c4b0] text-gray-700 py-3 rounded-full font-semibold hover:bg-[#c9b9a5] transition"
          >
            参加者を管理
          </button>
        </div>

        {/* データ管理 */}
        <div className="bg-[#f0e6da] rounded-2xl p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">データ管理</h2>
          <button
            onClick={() => setShowResetConfirm(true)}
            className="w-full bg-[#e8a87c] text-white py-3 rounded-full font-semibold hover:bg-[#d4956b] transition flex items-center justify-center gap-2"
          >
            <Trash2 size={18} />
            セッションをリセット
          </button>
          <p className="text-xs text-gray-500 text-center mt-2">
            ※ すべてのデータが削除されます
          </p>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-[#faf6f1] rounded-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-3">
              セッションをリセットしますか？
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              すべての試合データ、参加者情報、設定が削除されます。
              この操作は元に戻せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 bg-white text-gray-700 rounded-full font-semibold hover:bg-gray-50 transition border border-gray-200"
              >
                キャンセル
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-3 bg-[#e8a87c] text-white rounded-full font-semibold hover:bg-[#d4956b] transition"
              >
                リセット
              </button>
            </div>
          </div>
        </div>
      )}

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
