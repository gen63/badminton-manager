import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useSessionStore } from '../stores/sessionStore';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { generateSessionId, parsePlayerInput } from '../lib/utils';
import { fetchMembersFromSheets, membersToText } from '../lib/sheetsMembers';
import { Sparkles, Download, Loader2, Play } from 'lucide-react';

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
  const { useStayDurationPriority, setUseStayDurationPriority, recordScores, setRecordScores, prioritizeDiversity, setPrioritizeDiversity } = useSettingsStore();

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

  const [targetScore] = useState(15);
  const [selectedGym] = useState(getInitialGym);
  const [practiceDateTime] = useState(getInitialDateTime);
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

        const adjustedCourtCount = 1;
        const sessionId = generateSessionId();
        const now = Date.now();
        const practiceTime = new Date(practiceDateTime).getTime();
        const session = {
          id: sessionId,
          config: {
            courtCount: adjustedCourtCount,
            targetScore,
            practiceDate: practiceDateTime.split('T')[0],
            practiceStartTime: practiceTime,
            gym: selectedGym || undefined,
          },
          createdAt: now,
          updatedAt: now,
        };

        setSession(session);
        initializeCourts(adjustedCourtCount);
        
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

    const adjustedCourtCount = 1;
    const sessionId = generateSessionId();
    const now = Date.now();
    const practiceTime = new Date(practiceDateTime).getTime();
    const session = {
      id: sessionId,
      config: {
        courtCount: adjustedCourtCount,
        targetScore,
        practiceDate: practiceDateTime.split('T')[0],
        practiceStartTime: practiceTime,
        gym: selectedGym || undefined,
      },
      createdAt: now,
      updatedAt: now,
    };

    setSession(session);
    initializeCourts(adjustedCourtCount);
    navigate('/main');
  };

  return (
    <div className="bg-app overflow-x-hidden">
      {/* ヘッダー */}
      <div className="header-gradient text-gray-800 p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Play size={20} />
            <h1 className="text-lg font-bold">セッション開始</h1>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto w-full px-4 py-6">
        <div className="card p-6 space-y-6 overflow-hidden">

          {/* 当日参加者 */}
          <div>
            <label className="label">
              練習参加メンバー
            </label>
            <div className="max-w-[240px]">
              <div className="relative">
                <textarea
                  value={playerNames}
                  onChange={(e) => setPlayerNames(e.target.value)}
                  placeholder="星野真吾  男&#10;山口裕史  男&#10;佐野朋美  女"
                  rows={5}
                  className="textarea-field w-full pr-12"
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
              </div>
              
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

          {/* 配置モード */}
          <div>
            <label className="label">配置モード</label>
            <div className="flex gap-2">
              <button
                onClick={() => setUseStayDurationPriority(true)}
                className={`flex-1 select-button text-xs px-2 ${
                  useStayDurationPriority ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {useStayDurationPriority && <span className="mr-1">✓</span>}
                待機時間
              </button>
              <button
                onClick={() => setUseStayDurationPriority(false)}
                className={`flex-1 select-button text-xs px-2 ${
                  !useStayDurationPriority ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {!useStayDurationPriority && <span className="mr-1">✓</span>}
                試合回数
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {useStayDurationPriority ? '滞在時間が長い人を優先' : '試合回数が少ない人を優先'}
            </p>
          </div>

          {/* 勝敗記録 */}
          <div>
            <label className="label">勝敗記録</label>
            <div className="flex gap-2">
              <button
                onClick={() => setRecordScores(true)}
                className={`flex-1 select-button text-xs px-2 ${
                  recordScores ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {recordScores && <span className="mr-1">✓</span>}
                ON
              </button>
              <button
                onClick={() => setRecordScores(false)}
                className={`flex-1 select-button text-xs px-2 ${
                  !recordScores ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {!recordScores && <span className="mr-1">✓</span>}
                OFF
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {recordScores ? '終了時に勝敗を記録' : '勝敗記録なし'}
            </p>
          </div>

          {/* 配置タイミング */}
          <div>
            <label className="label">配置タイミング</label>
            <div className="flex gap-2">
              <button
                onClick={() => setPrioritizeDiversity(true)}
                className={`flex-1 select-button text-xs px-2 ${
                  prioritizeDiversity ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {prioritizeDiversity && <span className="mr-1">✓</span>}
                多様性優先
              </button>
              <button
                onClick={() => setPrioritizeDiversity(false)}
                className={`flex-1 select-button text-xs px-2 ${
                  !prioritizeDiversity ? 'select-button-active' : 'select-button-inactive'
                }`}
              >
                {!prioritizeDiversity && <span className="mr-1">✓</span>}
                回数優先
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {prioritizeDiversity
                ? '組み合わせの多様性を優先（余り人数が少ない時は一括配置を推奨）'
                : '空きが出たら即座に配置'}
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
