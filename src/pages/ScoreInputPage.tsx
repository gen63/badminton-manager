import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { X, Trash2 } from 'lucide-react';

export function ScoreInputPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { matchId } = useParams<{ matchId: string }>();
  const matchHistory = useGameStore((state) => state.matchHistory);
  const players = usePlayerStore((state) => state.players);
  const fromPage = (location.state as { from?: string })?.from || '/history';

  const match = matchHistory.find((m) => m.id === matchId);
  
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

  const handleConfirm = () => {
    if (inputHistory.length !== 2) {
      alert('両チームのスコアを入力してください');
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
    <div className="min-h-screen bg-gray-100">
      {/* ヘッダー */}
      <div className="bg-white p-4 shadow-sm">
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

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* 対戦カード */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs text-gray-500 text-center mb-3">コート {match.courtId}</div>
          
          {selectedPlayer && (
            <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 text-center">
              メンバーを選択中 — 交換したい相手をタップ
            </div>
          )}
          
          <div className="space-y-3">
            {/* チームA */}
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-xs text-gray-500 mb-2 text-center">チームA</div>
              <div className="flex gap-2">
                {match.teamA.map((playerId, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePlayerTap(idx)}
                    className={`flex-1 min-h-[44px] p-2 rounded-full text-sm font-medium transition-all duration-150 ${
                      selectedPlayer?.position === idx
                        ? 'bg-blue-500 text-white ring-2 ring-blue-300 scale-105'
                        : 'bg-white border border-gray-200 text-gray-800 hover:border-gray-300 active:bg-gray-100 active:scale-[0.98]'
                    }`}
                  >
                    {getPlayerName(playerId)}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-center text-gray-400 text-xs">vs</div>

            {/* チームB */}
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-xs text-gray-500 mb-2 text-center">チームB</div>
              <div className="flex gap-2">
                {match.teamB.map((playerId, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePlayerTap(idx + 2)}
                    className={`flex-1 min-h-[44px] p-2 rounded-full text-sm font-medium transition-all duration-150 ${
                      selectedPlayer?.position === idx + 2
                        ? 'bg-blue-500 text-white ring-2 ring-blue-300 scale-105'
                        : 'bg-white border border-gray-200 text-gray-800 hover:border-gray-300 active:bg-gray-100 active:scale-[0.98]'
                    }`}
                  >
                    {getPlayerName(playerId)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* スコア表示 */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-800">
              {inputHistory.length > 0 ? (
                <>
                  <span className="text-blue-500">{scoreA}</span>
                  {inputHistory.length === 2 && (
                    <>
                      <span className="text-gray-400 mx-4">-</span>
                      <span className="text-blue-500">{scoreB}</span>
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
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="grid grid-cols-8 gap-1.5">
            {Array.from({ length: 31 }, (_, i) => i).map((num) => (
              <button
                key={num}
                onClick={() => handleNumberClick(num)}
                disabled={inputHistory.length >= 2}
                className="aspect-square min-h-[36px] bg-gray-100 hover:bg-blue-100 active:bg-blue-200 active:scale-[0.95] rounded-xl text-sm font-medium text-gray-800 transition-all duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        {/* アクションボタン */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleClear}
            className="min-h-[48px] py-3 bg-gray-100 text-gray-600 rounded-full font-semibold hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2"
          >
            <Trash2 size={18} />
            クリア
          </button>
          <button
            onClick={handleConfirm}
            disabled={inputHistory.length !== 2}
            className="min-h-[48px] py-3 bg-blue-500 text-white rounded-full font-semibold hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
