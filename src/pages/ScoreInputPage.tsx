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
      // 1回目のタップ：プレイヤーを選択
      setSelectedPlayer({ position });
    } else if (selectedPlayer.position === position) {
      // 同じプレイヤーをタップ：選択解除
      setSelectedPlayer(null);
    } else {
      // 2回目のタップ：交換実行
      const allPlayers = [...match.teamA, ...match.teamB];
      const temp = allPlayers[selectedPlayer.position];
      allPlayers[selectedPlayer.position] = allPlayers[position];
      allPlayers[position] = temp;

      // matchHistoryを更新
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

    // スコアを更新
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

    // Zustandストアを直接更新
    useGameStore.setState({ matchHistory: updatedHistory });

    navigate(fromPage);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-end">
          <button
            onClick={() => navigate(fromPage)}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* 対戦カード */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 text-center mb-4">コート {match.courtId}</div>
          
          {selectedPlayer && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 text-center">
              メンバーを選択中 - 交換したい相手をタップ
            </div>
          )}
          
          <div className="space-y-3">
            {/* チームA */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs text-gray-600 mb-2 text-center">チームA</div>
              <div className="flex gap-2">
                {match.teamA.map((playerId, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePlayerTap(idx)}
                    className={`flex-1 p-2 rounded text-sm font-medium transition ${
                      selectedPlayer?.position === idx
                        ? 'bg-blue-300 text-gray-800'
                        : 'bg-white hover:bg-blue-100 text-gray-800'
                    }`}
                  >
                    {getPlayerName(playerId)}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-center text-gray-400 font-bold">VS</div>

            {/* チームB */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-xs text-gray-600 mb-2 text-center">チームB</div>
              <div className="flex gap-2">
                {match.teamB.map((playerId, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePlayerTap(idx + 2)}
                    className={`flex-1 p-2 rounded text-sm font-medium transition ${
                      selectedPlayer?.position === idx + 2
                        ? 'bg-red-300 text-gray-800'
                        : 'bg-white hover:bg-red-100 text-gray-800'
                    }`}
                  >
                    {getPlayerName(playerId)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 入力履歴表示 */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-2">入力履歴</div>
            <div className="text-3xl font-bold text-gray-800">
              {inputHistory.length > 0 ? (
                <>
                  <span className="text-blue-600">{scoreA}</span>
                  {inputHistory.length === 2 && (
                    <>
                      <span className="text-gray-400 mx-4">-</span>
                      <span className="text-red-600">{scoreB}</span>
                    </>
                  )}
                  {inputHistory.length === 1 && (
                    <span className="text-gray-400 mx-4">- ?</span>
                  )}
                </>
              ) : (
                <span className="text-gray-400">点数を順番にタップ</span>
              )}
            </div>
          </div>
        </div>

        {/* 点数ボタングリッド */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="grid grid-cols-8 gap-1.5">
            {Array.from({ length: 31 }, (_, i) => i).map((num) => (
              <button
                key={num}
                onClick={() => handleNumberClick(num)}
                disabled={inputHistory.length >= 2}
                className="aspect-square bg-gray-100 hover:bg-blue-100 active:bg-blue-200 rounded text-sm font-medium text-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="py-4 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition flex items-center justify-center gap-2"
          >
            <Trash2 size={20} />
            クリア
          </button>
          <button
            onClick={handleConfirm}
            disabled={inputHistory.length !== 2}
            className="py-4 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
