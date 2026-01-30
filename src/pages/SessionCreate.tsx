import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { useGameStore } from '../stores/gameStore';
import { generateSessionId } from '../lib/utils';

export function SessionCreate() {
  const navigate = useNavigate();
  const setSession = useSessionStore((state) => state.setSession);
  const initializeCourts = useGameStore((state) => state.initializeCourts);

  const [courtCount, setCourtCount] = useState(2);
  const [targetScore, setTargetScore] = useState(21);
  const [practiceDate, setPracticeDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  const handleCreate = () => {
    const sessionId = generateSessionId();
    const session = {
      id: sessionId,
      config: {
        courtCount,
        targetScore,
        practiceDate,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSession(session);
    initializeCourts(courtCount);
    navigate('/players');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            🏸 バドミントン練習管理
          </h1>
          <p className="text-gray-600">新しいセッションを作成</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          {/* 練習日 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              練習日
            </label>
            <input
              type="date"
              value={practiceDate}
              onChange={(e) => setPracticeDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* コート数 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              コート数
            </label>
            <div className="flex gap-2">
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  onClick={() => setCourtCount(count)}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-all duration-150 ${
                    courtCount === count
                      ? 'bg-blue-600 text-white shadow-lg border-4 border-blue-400 scale-105'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 border-2 border-transparent'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* 点数 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              点数
            </label>
            <div className="flex gap-2">
              {[11, 15, 21].map((score) => (
                <button
                  key={score}
                  onClick={() => setTargetScore(score)}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-all duration-150 ${
                    targetScore === score
                      ? 'bg-blue-600 text-white shadow-lg border-4 border-blue-400 scale-105'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 border-2 border-transparent'
                  }`}
                >
                  {score}点
                </button>
              ))}
            </div>
          </div>

          {/* 作成ボタン */}
          <button
            onClick={handleCreate}
            className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            セッションを作成
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Phase 0 - プロトタイプ版</p>
          <p className="mt-1">LocalStorage保存</p>
        </div>
      </div>
    </div>
  );
}
