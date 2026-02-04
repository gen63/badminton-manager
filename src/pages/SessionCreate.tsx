import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { generateSessionId } from '../lib/utils';
import { GYM_OPTIONS } from '../types/session';
import { Sparkles } from 'lucide-react';

// 現在日時を取得（時刻は12:00固定）
const getInitialDateTime = () => {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return now.toISOString().slice(0, 16);
};

export function SessionCreate() {
  const navigate = useNavigate();
  const setSession = useSessionStore((state) => state.setSession);
  const { addPlayers } = usePlayerStore();
  const initializeCourts = useGameStore((state) => state.initializeCourts);

  const [courtCount, setCourtCount] = useState(3);
  const [targetScore, setTargetScore] = useState(21);
  const [selectedGym, setSelectedGym] = useState('');
  const [practiceDateTime, setPracticeDateTime] = useState(getInitialDateTime);
  const [playerNames, setPlayerNames] = useState('');

  // 入力をパース: "名前 レーティング" or "名前\tレーティング" or "名前"
  const parsePlayerInput = (line: string): { name: string; rating?: number } | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // タブまたは2つ以上のスペースで分割
    const parts = trimmed.split(/\t|\s{2,}/);
    const name = parts[0].trim();
    if (!name) return null;

    if (parts.length >= 2) {
      const ratingStr = parts[parts.length - 1].trim();
      const rating = parseInt(ratingStr, 10);
      if (!isNaN(rating)) {
        return { name, rating };
      }
    }
    return { name };
  };

  const handleCreate = () => {
    if (playerNames.trim()) {
      const inputs = playerNames
        .split('\n')
        .map(parsePlayerInput)
        .filter((input): input is { name: string; rating?: number } => input !== null);
      if (inputs.length > 0) {
        addPlayers(inputs);
      }
    }

    const sessionId = generateSessionId();
    const now = Date.now();
    const practiceTime = new Date(practiceDateTime).getTime();
    const session = {
      id: sessionId,
      config: {
        courtCount,
        targetScore,
        practiceDate: practiceDateTime.split('T')[0],
        practiceStartTime: practiceTime,
        gym: selectedGym || undefined,
      },
      createdAt: now,
      updatedAt: now,
    };

    setSession(session);
    initializeCourts(courtCount);
    navigate('/main');
  };

  return (
    <div className="bg-app overflow-x-hidden">
      <div className="max-w-md mx-auto w-full px-4 py-6">
        <div className="card p-6 space-y-6 overflow-hidden">
          {/* コート数 */}
          <div>
            <label className="label">
              コート数
            </label>
            <div className="flex gap-3 justify-center">
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  onClick={() => setCourtCount(count)}
                  className={`select-button ${
                    courtCount === count
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {courtCount === count && <span className="mr-1">✓</span>}
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* 点数 */}
          <div>
            <label className="label">
              目標点数
            </label>
            <div className="flex gap-3 justify-center">
              {[15, 21].map((score) => (
                <button
                  key={score}
                  onClick={() => setTargetScore(score)}
                  className={`select-button ${
                    targetScore === score
                      ? 'select-button-active'
                      : 'select-button-inactive'
                  }`}
                >
                  {targetScore === score && <span className="mr-1">✓</span>}
                  {score}
                </button>
              ))}
            </div>
          </div>

          {/* 体育館 */}
          <div>
            <label className="label">
              体育館
            </label>
            <select
              value={selectedGym}
              onChange={(e) => setSelectedGym(e.target.value)}
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

          {/* 練習開始日時 */}
          <div>
            <label className="label">
              練習開始日時
            </label>
            <div className="relative">
              <input
                type="datetime-local"
                value={practiceDateTime}
                onChange={(e) => setPracticeDateTime(e.target.value)}
                className="input-field opacity-0 absolute inset-0 w-full h-full cursor-pointer"
              />
              <div className="input-field text-center text-indigo-600 pointer-events-none">
                {(() => {
                  const d = new Date(practiceDateTime);
                  const year = d.getFullYear();
                  const month = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  const hour = String(d.getHours()).padStart(2, '0');
                  const min = String(d.getMinutes()).padStart(2, '0');
                  return `${year}/${month}/${day} ${hour}:${min}`;
                })()}
              </div>
            </div>
          </div>

          {/* 当日参加者 */}
          <div>
            <label className="label">
              練習参加メンバー
            </label>
            <textarea
              value={playerNames}
              onChange={(e) => setPlayerNames(e.target.value)}
              placeholder="田中太郎&#10;山田花子&#10;佐藤次郎"
              rows={5}
              className="textarea-field"
              style={{ WebkitAppearance: 'none' }}
            />
            <p className="text-xs text-gray-400 mt-2 text-center">
              1行に1人ずつ入力してください（任意）
            </p>
          </div>

          {/* 作成ボタン */}
          <div className="flex justify-center">
            <button
              onClick={handleCreate}
              className="btn-primary text-base flex items-center justify-center gap-2"
            >
              <Sparkles size={18} />
              開始
            </button>
          </div>
        </div>

        {/* バージョン表示 */}
        <p className="text-center text-xs text-gray-400 mt-4">
          v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
