import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { generateSessionId, parsePlayerInput } from '../lib/utils';
import { fetchMembersFromSheets, membersToText } from '../lib/sheetsMembers';
import { GYM_OPTIONS } from '../types/session';
import { Sparkles, Download, Loader2 } from 'lucide-react';

// 現在日時を取得（時刻は12:00固定）
const getInitialDateTime = () => {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}T12:00`;
};

export function SessionCreate() {
  const navigate = useNavigate();
  const setSession = useSessionStore((state) => state.setSession);
  const { addPlayers } = usePlayerStore();
  const initializeCourts = useGameStore((state) => state.initializeCourts);

  const gasWebAppUrl = useSettingsStore((state) => state.gasWebAppUrl);
  const setGasWebAppUrl = useSettingsStore((state) => state.setGasWebAppUrl);
  const [gasUrlInput, setGasUrlInput] = useState(gasWebAppUrl);

  const [courtCount, setCourtCount] = useState(3);
  const [targetScore, setTargetScore] = useState(15);
  const [selectedGym, setSelectedGym] = useState('');
  const [practiceDateTime, setPracticeDateTime] = useState(getInitialDateTime);
  const [playerNames, setPlayerNames] = useState('');
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [loadingText, setLoadingText] = useState('読み込み中...');
  const [loadError, setLoadError] = useState('');

  const handleLoadFromSheets = async () => {
    const url = gasUrlInput || gasWebAppUrl;
    if (!url) {
      setLoadError('GAS Web App URLを入力してください');
      return;
    }
    if (url !== gasWebAppUrl) {
      setGasWebAppUrl(url);
    }
    setIsLoadingMembers(true);
    setLoadingText('読み込み中...');
    setLoadError('');
    const result = await fetchMembersFromSheets(url, () => {
      setLoadingText('再試行中...');
    });
    if (result.success) {
      setPlayerNames(membersToText(result.members));
    } else {
      setLoadError(result.message);
    }
    setIsLoadingMembers(false);
  };

  const handleCreate = () => {
    if (playerNames.trim()) {
      const inputs = playerNames
        .split('\n')
        .map(line => parsePlayerInput(line))
        .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null);
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
            <div className="flex gap-3 justify-start">
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
            <div className="flex gap-3 justify-start">
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
            <div className="max-w-[240px]">
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
          </div>

          {/* 練習開始日時 */}
          <div>
            <label className="label">
              練習開始日時
            </label>
            <div className="relative max-w-[240px]">
              <input
                type="datetime-local"
                value={practiceDateTime}
                onChange={(e) => setPracticeDateTime(e.target.value)}
                className="input-field opacity-0 absolute inset-0 w-full h-full cursor-pointer"
              />
              <div className="input-field text-center text-blue-600 pointer-events-none">
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
            <div className="mb-2">
              <div className="mb-2 max-w-[240px]">
                <input
                  type="url"
                  value={gasUrlInput}
                  onChange={(e) => setGasUrlInput(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                  className="input-field min-h-[44px] text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">
                  GAS Web App URLを入力
                </p>
              </div>
              <button
                onClick={handleLoadFromSheets}
                disabled={isLoadingMembers}
                className="btn-outline text-sm flex items-center justify-center gap-2"
              >
                {isLoadingMembers ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {loadingText}
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Sheetsから読み込み
                  </>
                )}
              </button>
              {loadError && (
                <p className="text-xs text-red-500 mt-1">{loadError}</p>
              )}
            </div>
            <div className="max-w-[240px]">
              <textarea
                value={playerNames}
                onChange={(e) => setPlayerNames(e.target.value)}
                placeholder={"星野真吾  男  1500\n山口裕史\n佐野朋美  女"}
                rows={5}
                className="textarea-field"
                style={{ WebkitAppearance: 'none' }}
              />
              <p className="text-xs text-gray-400 mt-2">
                1行に1人ずつ入力（スペース2つ区切りで性別・レートも可）
              </p>
            </div>
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
