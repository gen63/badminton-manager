import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { generateSessionId, parsePlayerInput } from '../lib/utils';
import { fetchMembersFromSheets, membersToText } from '../lib/sheetsMembers';
import { GYM_OPTIONS } from '../types/session';
import { Sparkles, Download, Loader2 } from 'lucide-react';

// 現在日時を取得（曜日に応じて時刻を設定）
const getInitialDateTime = () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0:日曜, 1:月曜, ..., 6:土曜
  
  // 曜日に応じて時刻を設定
  let hour: number;
  if (dayOfWeek === 0) {
    // 日曜: 17:00
    hour = 17;
  } else if (dayOfWeek === 6) {
    // 土曜: 12:00
    hour = 12;
  } else {
    // 平日（月〜金）: 19:00
    hour = 19;
  }
  
  now.setHours(hour, 0, 0, 0);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hourStr = String(hour).padStart(2, '0');
  return `${year}-${month}-${day}T${hourStr}:00`;
};

// 曜日に応じて体育館の初期値を設定
const getInitialGym = () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0:日曜, 1:月曜, ..., 6:土曜
  
  if (dayOfWeek === 0) {
    // 日曜: 高松
    return '高松';
  } else if (dayOfWeek === 6) {
    // 土曜: 目白
    return '目白';
  } else {
    // 平日（月〜金）: ぴいす
    return 'ぴいす';
  }
};

export function SessionCreate() {
  const navigate = useNavigate();
  const setSession = useSessionStore((state) => state.setSession);
  const { addPlayers } = usePlayerStore();
  const initializeCourts = useGameStore((state) => state.initializeCourts);

  const gasWebAppUrl = useSettingsStore((state) => state.gasWebAppUrl);

  // PWA更新検知 & 自動リロード
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      // 画面表示時 & フォーカス時に更新チェック
      const checkForUpdates = () => {
        r?.update().catch(() => {});
      };

      checkForUpdates();

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          checkForUpdates();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
    },
  });

  // 更新検知時に自動リロード
  useEffect(() => {
    if (needRefresh) {
      updateServiceWorker(true); // true = skipWaitingで即座に適用してリロード
    }
  }, [needRefresh, updateServiceWorker]);

  const [courtCount, setCourtCount] = useState(3);
  const [targetScore, setTargetScore] = useState(15);
  const [selectedGym, setSelectedGym] = useState(getInitialGym);
  const [practiceDateTime, setPracticeDateTime] = useState(getInitialDateTime);
  const [playerNames, setPlayerNames] = useState('');
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [allRated, setAllRated] = useState(false);


  const handleLoadFromSheets = async () => {
    if (!gasWebAppUrl) {
      setLoadError('設定画面でGAS Web App URLを設定してください');
      return;
    }
    setIsLoadingMembers(true);
    setLoadError('');
    const result = await fetchMembersFromSheets(gasWebAppUrl);
    
    if (result.success) {
      // 入力欄に名前があるかチェック
      const hasInputNames = playerNames.trim().length > 0;
      
      let inputs: { name: string; rating?: number; gender?: 'M' | 'F' }[];
      let hasAllRatings = false;
      
      if (!hasInputNames) {
        // パターン1: 入力欄が空 → 今まで通り全データ取得
        setPlayerNames(membersToText(result.members));
        hasAllRatings = result.members.length > 0 &&
          result.members.every(m => m.rating != null && m.rating >= 1);
        
        inputs = result.members.map((member) => ({
          name: member.name,
          rating: member.rating,
          gender: member.gender,
        }));
      } else {
        // パターン2: 入力欄に名前あり → 性別だけを補完
        const inputLines = playerNames
          .split('\n')
          .map(line => parsePlayerInput(line))
          .filter((input): input is { name: string; rating?: number; gender?: 'M' | 'F' } => input !== null);
        
        // Sheetsから取得した性別情報でマッチング
        const sheetsMembersMap = new Map(
          result.members.map(m => [m.name, m.gender])
        );
        
        inputs = inputLines.map((input) => {
          const genderFromSheets = sheetsMembersMap.get(input.name);
          return {
            name: input.name,
            rating: input.rating, // 入力済みのレーティングがあればそれを使う（なければundefined）
            gender: input.gender || genderFromSheets, // 入力済みの性別優先、なければSheetsから補完
          };
        });
        
        // 入力欄を更新（性別が補完された状態）
        const updatedText = inputs.map((input) => {
          const parts = [input.name];
          if (input.gender) {
            parts.push(input.gender === 'M' ? '男' : '女');
          }
          if (input.rating) {
            parts.push(String(input.rating));
          }
          return parts.join('  ');
        }).join('\n');
        setPlayerNames(updatedText);
        
        hasAllRatings = false; // 名前入力モードではレーティングは不要
      }
      
      setAllRated(hasAllRatings);
      
      // パターン1のみ自動開始（入力欄が空だった場合）
      if (!hasInputNames && inputs.length > 0) {
        addPlayers(inputs);

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
        
        // ローディング状態を解除してから遷移
        setIsLoadingMembers(false);
        
        // 少し待ってから遷移（状態更新の完了を待つ）
        setTimeout(() => {
          navigate('/main');
        }, 100);
        return;
      }
      
      // パターン2（名前入力済み）の場合は、性別補完後に留まる
      setIsLoadingMembers(false);
    } else {
      setLoadError(result.message);
    }
    setIsLoadingMembers(false);
  };

  const handleCreate = () => {
    if (playerNames.trim()) {
      const inputs = playerNames
        .split('\n')
        .map((line) => parsePlayerInput(line))
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
              <input
                type="text"
                list="gym-options"
                value={selectedGym}
                onChange={(e) => setSelectedGym(e.target.value)}
                placeholder="選択または入力してください"
                className="input-field min-h-[52px]"
              />
              <datalist id="gym-options">
                {GYM_OPTIONS.map((gym) => (
                  <option key={gym} value={gym} />
                ))}
              </datalist>
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
            <div className="max-w-[240px] relative">
              <textarea
                value={playerNames}
                onChange={(e) => setPlayerNames(e.target.value)}
                placeholder="星野真吾  男&#10;山口裕史  男&#10;佐野朋美  女"
                rows={5}
                className="textarea-field"
                style={{ WebkitAppearance: 'none' }}
              />
              
              {/* 小さいアイコンボタン */}
              <button
                onClick={handleLoadFromSheets}
                disabled={isLoadingMembers}
                className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:opacity-50 flex items-center justify-center transition-colors"
                title="Sheetsから読み込み"
              >
                {isLoadingMembers ? (
                  <Loader2 size={14} className="animate-spin text-gray-600" />
                ) : (
                  <Download size={14} className="text-gray-600" />
                )}
              </button>
              
              {/* Rバッジとエラー表示 */}
              <div className="flex items-center gap-2 mt-2">
                {allRated && (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold">
                    R
                  </span>
                )}
                {loadError && (
                  <p className="text-xs text-red-500">{loadError}</p>
                )}
              </div>
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
