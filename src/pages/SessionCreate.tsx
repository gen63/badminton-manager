import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { generateSessionId } from '../lib/utils';

export function SessionCreate() {
  const navigate = useNavigate();
  const setSession = useSessionStore((state) => state.setSession);
  const { addPlayers } = usePlayerStore();
  const initializeCourts = useGameStore((state) => state.initializeCourts);

  const [courtCount, setCourtCount] = useState(2);
  const [targetScore, setTargetScore] = useState(21);
  const [playerNames, setPlayerNames] = useState('');

  // 入力された名前の数をカウント
  const playerCount = playerNames
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0).length;

  const handleCreate = () => {
    // 参加者を事前登録
    if (playerNames.trim()) {
      const names = playerNames
        .split('\n')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (names.length > 0) {
        addPlayers(names);
      }
    }

    const sessionId = generateSessionId();
    const session = {
      id: sessionId,
      config: {
        courtCount,
        targetScore,
        practiceDate: new Date().toISOString().split('T')[0],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setSession(session);
    initializeCourts(courtCount);
    navigate('/main');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-6">
      <div className="max-w-sm mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-lg font-medium text-gray-600">
            🏸 バドミントン練習管理
          </h1>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">

          {/* コート数 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              コート数
            </label>
            <div className="flex gap-3">
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  onClick={() => setCourtCount(count)}
                  className={`flex-1 py-4 rounded-lg font-bold text-lg transition-all duration-200 ${
                    courtCount === count
                      ? 'bg-blue-600 text-white shadow-xl ring-4 ring-blue-300 scale-110'
                      : 'bg-white text-gray-400 border-2 border-gray-200 hover:border-blue-300 hover:text-gray-600'
                  }`}
                >
                  {courtCount === count && '✓ '}{count}
                </button>
              ))}
            </div>
          </div>

          {/* 点数 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              点数
            </label>
            <div className="flex gap-3">
              {[11, 15, 21].map((score) => (
                <button
                  key={score}
                  onClick={() => setTargetScore(score)}
                  className={`flex-1 py-4 rounded-lg font-bold text-lg transition-all duration-200 ${
                    targetScore === score
                      ? 'bg-blue-600 text-white shadow-xl ring-4 ring-blue-300 scale-110'
                      : 'bg-white text-gray-400 border-2 border-gray-200 hover:border-blue-300 hover:text-gray-600'
                  }`}
                >
                  {targetScore === score && '✓ '}{score}点
                </button>
              ))}
            </div>
          </div>

          {/* 当日参加者 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              練習参加メンバー（1行に1人）
            </label>
            <textarea
              value={playerNames}
              onChange={(e) => setPlayerNames(e.target.value)}
              placeholder="田中太郎&#10;山田花子&#10;佐藤次郎"
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              改行またはカンマ区切りで入力（任意）
            </p>
          </div>

          {/* 作成ボタン */}
          <button
            onClick={handleCreate}
            className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            次へ {playerCount > 0 && `(${playerCount}人)`}
          </button>
        </div>
      </div>
    </div>
  );
}
