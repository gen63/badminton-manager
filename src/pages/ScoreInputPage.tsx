import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { X, Trash2 } from 'lucide-react';

export function ScoreInputPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { matchId } = useParams<{ matchId: string }>();
  const matchHistory = useGameStore((state) => state.matchHistory);
  const players = usePlayerStore((state) => state.players);
  const fromPage = (location.state as { from?: string })?.from || '/history';

  const match = matchHistory.find((m) => m.id === matchId);
  const session = useSessionStore((state) => state.session);
  const targetScore = session?.config.targetScore || 21;
  
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<{
    position: number;
  } | null>(null);

  if (!match) {
    navigate(fromPage);
    return null;
  }

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '不明';
  };

  const handlePlayerTap = (position: number) => {
    if (!selectedPlayer) {
      setSelectedPlayer({ position });
    } else if (selectedPlayer.position === position) {
      setSelectedPlayer(null);
    } else {
      const allPlayers = [...match.teamA, ...match.teamB];
      const temp = allPlayers[selectedPlayer.position];
      allPlayers[selectedPlayer.position] = allPlayers[position];
      allPlayers[position] = temp;

      const updatedHistory = matchHistory.map((m) =>
        m.id === matchId
          ? {
              ...m,
              teamA: [allPlayers[0], allPlayers[1]] as [string, string],
              teamB: [allPlayers[2], allPlayers[3]] as [string, string],
            }
          : m
      );

      useGameStore.setState({ matchHistory: updatedHistory });
      setSelectedPlayer(null);
    }
  };

  const handleNumberClick = (num: number) => {
    if (inputHistory.length === 0) {
      setScoreA(num);
      setInputHistory([`${num}`]);
    } else if (inputHistory.length === 1) {
      setScoreB(num);
      setInputHistory([...inputHistory, `${num}`]);
    }
  };

  const handleClear = () => {
    setScoreA(0);
    setScoreB(0);
    setInputHistory([]);
  };

  // 目標点数に対する最大点数を取得
  const getMaxScore = (target: number): number => {
    switch (target) {
      case 21: return 30;
      case 15: return 21;
      default: return target + 9;
    }
  };

  const maxScore = getMaxScore(targetScore);

  // スコアバリデーション
  const validateScore = (a: number, b: number): string | null => {
    // 同点禁止
    if (a === b) {
      return '同点は入力できません';
    }
    
    // 最大点数到達時は2点差不要（先取で勝利）
    if (a === maxScore || b === maxScore) {
      return null;
    }
    
    // 両方targetScore以上の場合（デュース突入後）、2点差が必要
    if (a >= targetScore && b >= targetScore) {
      if (Math.abs(a - b) !== 2) {
        return 'デュース後は2点差で終了する必要があります';
      }
    }
    
    return null; // バリデーションOK
  };

  const handleConfirm = () => {
    if (inputHistory.length !== 2) {
      alert('両チームのスコアを入力してください');
      return;
    }

    const validationError = validateScore(scoreA, scoreB);
    if (validationError) {
      alert(validationError);
      return;
    }

    const updatedHistory = matchHistory.map((m) =>
      m.id === matchId
        ? {
            ...m,
            scoreA,
            scoreB,
            winner: scoreA > scoreB ? ('A' as const) : ('B' as const),
          }
        : m
    );

    useGameStore.setState({ matchHistory: updatedHistory });
    navigate(fromPage);
  };

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      {/* ヘッダー */}
      <div className="bg-white p-2 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="text-base font-medium text-gray-600">スコア入力</h1>
          <button
            onClick={() => navigate(fromPage)}
            aria-label="閉じる"
            className="p-3 hover:bg-gray-100 active:bg-gray-200 active:scale-[0.98] rounded-full transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X size={24} className="text-gray-600" />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-3 space-y-2">
        {/* 対戦カード */}
        <div className="bg-white rounded-2xl shadow-sm p-3">
          {selectedPlayer && (
            <div className="mb-2 p-2 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-700 text-center">
              メンバーを選択中 — 交換したい相手をタップ
            </div>
          )}

          {/* A  VS  C */}
          {/* B      D */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-1.5">
            {/* A */}
            <button
              onClick={() => handlePlayerTap(0)}
              className={`min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                selectedPlayer?.position === 0
                  ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                  : 'bg-white border border-gray-200 text-gray-800 hover:border-gray-300 active:bg-gray-100 active:scale-[0.98]'
              }`}
            >
              {getPlayerName(match.teamA[0])}
            </button>

            {/* VS */}
            <span className="text-gray-400 font-bold text-xs row-span-2 self-center">VS</span>

            {/* C */}
            <button
              onClick={() => handlePlayerTap(2)}
              className={`min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                selectedPlayer?.position === 2
                  ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                  : 'bg-white border border-gray-200 text-gray-800 hover:border-gray-300 active:bg-gray-100 active:scale-[0.98]'
              }`}
            >
              {getPlayerName(match.teamB[0])}
            </button>

            {/* B */}
            <button
              onClick={() => handlePlayerTap(1)}
              className={`min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                selectedPlayer?.position === 1
                  ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                  : 'bg-white border border-gray-200 text-gray-800 hover:border-gray-300 active:bg-gray-100 active:scale-[0.98]'
              }`}
            >
              {getPlayerName(match.teamA[1])}
            </button>

            {/* (VSのrow-span-2で埋まる) */}

            {/* D */}
            <button
              onClick={() => handlePlayerTap(3)}
              className={`min-h-[40px] p-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                selectedPlayer?.position === 3
                  ? 'bg-indigo-500 text-white ring-2 ring-indigo-300 scale-105'
                  : 'bg-white border border-gray-200 text-gray-800 hover:border-gray-300 active:bg-gray-100 active:scale-[0.98]'
              }`}
            >
              {getPlayerName(match.teamB[1])}
            </button>
          </div>
        </div>

        {/* スコア表示 */}
        <div className="bg-white rounded-2xl shadow-sm p-3">
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-800">
              {inputHistory.length > 0 ? (
                <>
                  <span className="text-indigo-500">{scoreA}</span>
                  {inputHistory.length === 2 && (
                    <>
                      <span className="text-gray-400 mx-4">-</span>
                      <span className="text-indigo-500">{scoreB}</span>
                    </>
                  )}
                  {inputHistory.length === 1 && (
                    <span className="text-gray-400 mx-4">- ?</span>
                  )}
                </>
              ) : (
                <span className="text-gray-400 text-base font-normal">点数を順番にタップ</span>
              )}
            </div>
          </div>
        </div>

        {/* 点数ボタングリッド */}
        <div className="bg-white rounded-2xl shadow-sm p-3">
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 31 }, (_, i) => i).map((num) => {
              // targetScore付近（±2）を目立たせる
              const isHighlighted = Math.abs(num - targetScore) <= 2;

              return (
                <button
                  key={num}
                  onClick={() => handleNumberClick(num)}
                  disabled={inputHistory.length >= 2}
                  className={`min-h-[36px] rounded-lg text-sm font-semibold transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isHighlighted
                      ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 active:bg-indigo-300 active:scale-[0.95]'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200 active:bg-gray-300 active:scale-[0.95]'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* アクションボタン - 画面下部に固定 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 pb-safe">
        <div className="max-w-2xl mx-auto grid grid-cols-2 gap-3">
          <button
            onClick={handleClear}
            className="btn-secondary min-h-[44px] py-2 flex items-center justify-center gap-2"
          >
            <Trash2 size={18} />
            クリア
          </button>
          <button
            onClick={handleConfirm}
            disabled={inputHistory.length !== 2}
            className="btn-primary min-h-[44px] py-2 font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
