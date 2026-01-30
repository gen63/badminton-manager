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
    toast.success(`コート数を${count}に変更しました`);
  };

  const handleTargetScoreChange = (score: number) => {
    updateConfig({ targetScore: score });
    toast.success(`目標点数を${score}点に変更しました`);
  };

  const handleReset = () => {
    setShowResetConfirm(false);
    clearHistory();
    clearPlayers();
    clearSession();
    toast.success('セッションをリセットしました');
    setTimeout(() => navigate('/'), 1000);
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ヘッダー */}
      <div className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/main')}
            className="p-2 hover:bg-blue-700 rounded-lg transition"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-bold">設定</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* コート設定 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">コート設定</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                コート数
              </label>
              <div className="flex gap-2">
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    onClick={() => handleCourtCountChange(count)}
                    className={`flex-1 py-3 rounded-lg font-semibold transition-all duration-150 ${
                      session.config.courtCount === count
                        ? 'bg-blue-600 text-white shadow-lg border-4 border-blue-400 scale-105'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 border-2 border-transparent'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                点数
              </label>
              <div className="flex gap-2">
                {[11, 15, 21].map((score) => (
                  <button
                    key={score}
                    onClick={() => handleTargetScoreChange(score)}
                    className={`flex-1 py-3 rounded-lg font-semibold transition-all duration-150 ${
                      session.config.targetScore === score
                        ? 'bg-blue-600 text-white shadow-lg border-4 border-blue-400 scale-105'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 border-2 border-transparent'
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
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">参加者管理</h2>
          <button
            onClick={() => navigate('/players')}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            参加者を管理
          </button>
        </div>

        {/* データ管理 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">データ管理</h2>
          <div className="space-y-3">
            <button
              onClick={() => setShowResetConfirm(true)}
              className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition flex items-center justify-center gap-2"
            >
              <Trash2 size={20} />
              セッションをリセット
            </button>
            <p className="text-sm text-gray-500 text-center">
              ※ すべてのデータが削除されます
            </p>
          </div>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">
              セッションをリセットしますか？
            </h3>
            <p className="text-gray-600 mb-6">
              すべての試合データ、参加者情報、設定が削除されます。
              <br />
              この操作は元に戻せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200 transition"
              >
                キャンセル
              </button>
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition"
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
