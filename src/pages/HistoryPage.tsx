import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { calculatePlayerStats } from '../lib/algorithm';
import { formatTime, formatDuration, copyToClipboard } from '../lib/utils';
import { ArrowLeft, Copy } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';

export function HistoryPage() {
  const navigate = useNavigate();
  const { matchHistory } = useGameStore();
  const { players } = usePlayerStore();
  const toast = useToast();

  const stats = calculatePlayerStats(players, matchHistory);
  const sortedStats = [...stats].sort((a, b) => b.gamesPlayed - a.gamesPlayed);

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '不明';
  };

  const handleCopyHistory = async () => {
    let text = '=== 試合履歴 ===\n\n';
    matchHistory.forEach((match, index) => {
      const teamANames = match.teamA.map(getPlayerName).join(' / ');
      const teamBNames = match.teamB.map(getPlayerName).join(' / ');
      text += `試合 ${index + 1}\n`;
      text += `${teamANames} ${match.scoreA} - ${match.scoreB} ${teamBNames}\n`;
      text += `勝者: チーム ${match.winner}\n`;
      text += `時刻: ${formatTime(match.finishedAt)}\n\n`;
    });

    text += '\n=== 統計 ===\n\n';
    sortedStats.forEach((stat) => {
      text += `${stat.name}: ${stat.gamesPlayed}試合 ${stat.wins}勝${stat.losses}敗 (${stat.points}点)\n`;
    });

    const success = await copyToClipboard(text);
    if (success) {
      toast.success('履歴をコピーしました！');
    } else {
      toast.error('コピーに失敗しました');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ヘッダー */}
      <div className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate('/main')}
            className="p-2 hover:bg-blue-700 rounded-lg transition"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">試合履歴・統計</h1>
          </div>
          <button
            onClick={handleCopyHistory}
            className="p-2 bg-blue-700 rounded-lg hover:bg-blue-800 transition"
          >
            <Copy size={24} />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        {/* 統計 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">プレイヤー統計</h2>
          {stats.length === 0 ? (
            <EmptyState
              icon="📊"
              title="まだ試合データがありません"
              description="試合を行うと、ここに統計が表示されます。"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      順位
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                      名前
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
                      試合数
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
                      勝敗
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
                      得点
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStats.map((stat, index) => (
                    <tr key={stat.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">{index + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {stat.name}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-800">
                        {stat.gamesPlayed}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-green-600 font-semibold">
                          {stat.wins}
                        </span>
                        <span className="text-gray-400 mx-1">-</span>
                        <span className="text-red-600 font-semibold">
                          {stat.losses}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-blue-600">
                        {stat.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 試合履歴 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            試合履歴 ({matchHistory.length}試合)
          </h2>
          {matchHistory.length === 0 ? (
            <EmptyState
              icon="🏸"
              title="まだ試合がありません"
              description="メイン画面でゲームを開始すると、ここに履歴が表示されます。"
              action={{
                label: 'メイン画面へ',
                onClick: () => navigate('/main'),
              }}
            />
          ) : (
            <div className="space-y-4">
              {[...matchHistory].reverse().map((match, index) => {
                const teamANames = match.teamA.map(getPlayerName).join(' / ');
                const teamBNames = match.teamB.map(getPlayerName).join(' / ');
                const duration = formatDuration(
                  match.startedAt,
                  match.finishedAt
                );

                return (
                  <div
                    key={match.id}
                    className="border border-gray-200 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-600">
                        試合 #{matchHistory.length - index}
                      </span>
                      <div className="text-sm text-gray-500">
                        {formatTime(match.finishedAt)} ({duration})
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 items-center">
                      <div
                        className={`text-center p-3 rounded-lg ${
                          match.winner === 'A'
                            ? 'bg-blue-100 border-2 border-blue-400'
                            : 'bg-gray-50'
                        }`}
                      >
                        <div className="text-sm text-gray-600 mb-1">
                          チーム A
                        </div>
                        <div className="font-medium text-gray-800">
                          {teamANames}
                        </div>
                        <div className="text-2xl font-bold text-blue-600 mt-2">
                          {match.scoreA}
                        </div>
                      </div>

                      <div className="text-center text-gray-400 font-bold">
                        VS
                      </div>

                      <div
                        className={`text-center p-3 rounded-lg ${
                          match.winner === 'B'
                            ? 'bg-red-100 border-2 border-red-400'
                            : 'bg-gray-50'
                        }`}
                      >
                        <div className="text-sm text-gray-600 mb-1">
                          チーム B
                        </div>
                        <div className="font-medium text-gray-800">
                          {teamBNames}
                        </div>
                        <div className="text-2xl font-bold text-red-600 mt-2">
                          {match.scoreB}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}
    </div>
  );
}
