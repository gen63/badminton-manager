import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { X, Trash2 } from 'lucide-react';

export function ScoreInputPage() {
  const navigate = useNavigate();
  const { matchId } = useParams<{ matchId: string }>();
  const { matchHistory } = useGameStore((state) => ({
    matchHistory: state.matchHistory,
  }));
  const { players } = usePlayerStore();

  const match = matchHistory.find((m) => m.id === matchId);
  const [scoreA, setScoreA] = useState(match?.scoreA || 0);
  const [scoreB, setScoreB] = useState(match?.scoreB || 0);
  const [inputHistory, setInputHistory] = useState<string[]>([]);

  if (!match) {
    navigate('/main');
    return null;
  }

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '不明';
  };

  const teamANames = match.teamA.map(getPlayerName).join('・');
  const teamBNames = match.teamB.map(getPlayerName).join('・');

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

    navigate('/main');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate('/main')}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X size={24} />
          </button>
          <h1 className="text-xl font-bold text-gray-800">スコア入力</h1>
          <div className="w-10" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* 対戦カード */}
        <div className="bg-white rounded-lg shadow p-6 text-center">
          <div className="text-sm text-gray-500 mb-4">コート {match.courtId}</div>
          
          <div className="space-y-4">
            <div className="text-lg font-semibold text-gray-800">
              {teamANames}
            </div>
            <div className="text-2xl font-bold text-gray-400">vs</div>
            <div className="text-lg font-semibold text-gray-800">
              {teamBNames}
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
        <div className="bg-white rounded-lg shadow p-6">
          <div className="grid grid-cols-6 gap-2">
            {Array.from({ length: 31 }, (_, i) => i).map((num) => (
              <button
                key={num}
                onClick={() => handleNumberClick(num)}
                disabled={inputHistory.length >= 2}
                className="aspect-square bg-gray-100 hover:bg-blue-100 active:bg-blue-200 rounded-lg font-semibold text-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
