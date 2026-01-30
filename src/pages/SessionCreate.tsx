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
    <div className="min-h-screen bg-[#faf6f1] p-6">
      <div className="max-w-sm mx-auto">
        <div className="text-center mb-6">
          <h1 className="text-lg font-medium text-gray-600">
            🏸 バドミントン練習管理
          </h1>
        </div>

        <div className="bg-[#f0e6da] rounded-2xl p-6 space-y-6">

          {/* コート数 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-3">
              コート数
            </label>
            <div className="flex gap-3">
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  onClick={() => setCourtCount(count)}
                  className={`flex-1 py-3 rounded-full font-semibold text-lg transition-all ${
                    courtCount === count
                      ? 'bg-white text-gray-800 shadow-md ring-2 ring-gray-300'
                      : 'bg-[#e8ddd0] text-gray-500 hover:bg-[#e0d5c8]'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* 点数 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-3">
              点数
            </label>
            <div className="flex gap-3">
              {[11, 15, 21].map((score) => (
                <button
                  key={score}
                  onClick={() => setTargetScore(score)}
                  className={`flex-1 py-3 rounded-full font-semibold text-lg transition-all ${
                    targetScore === score
                      ? 'bg-white text-gray-800 shadow-md ring-2 ring-gray-300'
                      : 'bg-[#e8ddd0] text-gray-500 hover:bg-[#e0d5c8]'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
          </div>

          {/* 当日参加者 */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-3">
              練習参加メンバー（1行に1人）
            </label>
            <textarea
              value={playerNames}
              onChange={(e) => setPlayerNames(e.target.value)}
              placeholder="田中太郎&#10;山田花子&#10;佐藤次郎"
              rows={5}
              className="w-full px-4 py-3 bg-white border-none rounded-2xl focus:ring-2 focus:ring-gray-300 focus:outline-none resize-none text-sm"
            />
            <p className="text-xs text-gray-500 mt-2 text-center">
              改行で入力（任意）
            </p>
          </div>

          {/* 作成ボタン */}
          <button
            onClick={handleCreate}
            className="w-full bg-[#d4c4b0] text-gray-700 py-3 rounded-full font-semibold hover:bg-[#c9b9a5] transition"
          >
            次へ {playerCount > 0 && `(${playerCount}人)`}
          </button>
        </div>
      </div>
    </div>
  );
}
