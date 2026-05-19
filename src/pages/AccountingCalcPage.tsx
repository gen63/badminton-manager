import { useNavigate } from 'react-router-dom';
import { copyToClipboard } from '../lib/utils';
import { GYM_OPTIONS } from '../types/session';
import { DollarSign, Copy, ArrowLeft, MapPin, Calendar } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import {
  buildAccountingCopyText,
  calculateAccountingTotals,
  calculateAppropriateFee,
  PRACTICE_TYPE_OPTIONS,
  toGymShortName,
} from '../lib/accountingCalc';

const STORAGE_KEY = 'accounting-calc-last-input';

interface CalcInput {
  date: string;
  gym: string;
  practiceType: string;
  exemptCount: number;
  maleCount: number;
  femaleCount: number;
  maleFee: number;
  femaleFee: number;
  gymCost: number;
  shuttlePrice: number;
  shuttleCount: number;
  matchCount: number;
  otherDescription: string;
  otherAmount: number;
}

function loadSavedInput(): CalcInput | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

function todayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDefaults(): CalcInput {
  return {
    date: todayString(),
    gym: '',
    practiceType: '複',
    exemptCount: 0,
    maleCount: 0,
    femaleCount: 0,
    maleFee: 800,
    femaleFee: 600,
    gymCost: 900,
    shuttlePrice: 510,
    shuttleCount: 0,
    matchCount: 0,
    otherDescription: '',
    otherAmount: 0,
  };
}

export function AccountingCalcPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const initial = loadSavedInput() || getDefaults();

  const [date, setDate] = useState(initial.date || todayString());
  const [gym, setGym] = useState(initial.gym);
  const [practiceType, setPracticeType] = useState(initial.practiceType);
  const [exemptCount, setExemptCount] = useState(initial.exemptCount);
  const [maleCount, setMaleCount] = useState(initial.maleCount);
  const [femaleCount, setFemaleCount] = useState(initial.femaleCount);
  const [maleFee, setMaleFee] = useState(initial.maleFee);
  const [femaleFee, setFemaleFee] = useState(initial.femaleFee);
  const [gymCost, setGymCost] = useState(initial.gymCost);
  const [shuttlePrice, setShuttlePrice] = useState(initial.shuttlePrice);
  const [shuttleCount, setShuttleCount] = useState(initial.shuttleCount);
  const [matchCount, setMatchCount] = useState(initial.matchCount);
  const [otherDescription, setOtherDescription] = useState(initial.otherDescription);
  const [otherAmount, setOtherAmount] = useState(initial.otherAmount);
  // 保存値に入力があればアコーディオンを開いた状態で表示
  const [isOtherExpanded, setIsOtherExpanded] = useState(
    !!(initial.otherDescription || initial.otherAmount),
  );

  const saveAll = useCallback((overrides: Partial<CalcInput> = {}) => {
    const data: CalcInput = {
      date: overrides.date ?? date,
      gym: overrides.gym ?? gym,
      practiceType: overrides.practiceType ?? practiceType,
      exemptCount: overrides.exemptCount ?? exemptCount,
      maleCount: overrides.maleCount ?? maleCount,
      femaleCount: overrides.femaleCount ?? femaleCount,
      maleFee: overrides.maleFee ?? maleFee,
      femaleFee: overrides.femaleFee ?? femaleFee,
      gymCost: overrides.gymCost ?? gymCost,
      shuttlePrice: overrides.shuttlePrice ?? shuttlePrice,
      shuttleCount: overrides.shuttleCount ?? shuttleCount,
      matchCount: overrides.matchCount ?? matchCount,
      otherDescription: overrides.otherDescription ?? otherDescription,
      otherAmount: overrides.otherAmount ?? otherAmount,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }, [date, gym, practiceType, exemptCount, maleCount, femaleCount, maleFee, femaleFee, gymCost, shuttlePrice, shuttleCount, matchCount, otherDescription, otherAmount]);

  // 入力値ベースの各種合計
  const { participantCount, maleTotal, femaleTotal, shuttleTotal, finalTotal } = calculateAccountingTotals({
    exemptCount, maleCount, femaleCount, maleFee, femaleFee,
    gymCost, shuttlePrice, shuttleCount, otherAmount,
  });

  const gymShortName = toGymShortName(gym);

  const appropriateFee = calculateAppropriateFee({
    gymCost, shuttleTotal, otherAmount, maleCount, femaleCount, practiceType,
  });

  // 日付フォーマット（YYYY/MM/DD）
  const formattedDate = date.replace(/-/g, '/');

  const generateCopyText = () => buildAccountingCopyText({
    date: formattedDate,
    gymShortName: gymShortName || gym,
    practiceType,
    exemptCount, maleCount, femaleCount, maleFee, femaleFee,
    gymCost, shuttlePrice, shuttleCount, otherAmount,
    matchCount, otherDescription,
  });

  const handleCopy = async () => {
    const text = generateCopyText();
    const ok = await copyToClipboard(text);
    if (ok) {
      toast.success('コピーしました');
    } else {
      toast.error('コピーに失敗しました');
    }
  };

  return (
    <div className="min-h-screen pb-8">
      {/* ヘッダー */}
      <div className="text-foreground p-3">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <DollarSign size={20} />
            <h1 className="text-lg font-bold">会計計算</h1>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-3 space-y-3">
        {/* 日付・体育館 */}
        <div className="card p-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1.5 block flex items-center gap-1.5">
              <Calendar size={12} />
              日付
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                saveAll({ date: e.target.value });
              }}
              className="input-field min-h-[44px] w-full"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1.5 block flex items-center gap-1.5">
              <MapPin size={12} />
              体育館
            </label>
            <input
              type="text"
              list="gym-options-calc"
              value={gym}
              onChange={(e) => {
                setGym(e.target.value);
                saveAll({ gym: e.target.value });
              }}
              placeholder="選択または入力してください"
              className="input-field min-h-[44px] w-full"
            />
            <datalist id="gym-options-calc">
              {GYM_OPTIONS.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
        </div>

        {/* 練習種別 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">練習種別</h2>
          <div className="flex gap-2">
            {PRACTICE_TYPE_OPTIONS.map((type) => (
              <button
                key={type.value}
                onClick={() => {
                  if (practiceType === type.value) return;
                  setPracticeType(type.value);
                  setMaleFee(type.maleFee);
                  setFemaleFee(type.femaleFee);
                  const overrides: Partial<CalcInput> = {
                    practiceType: type.value,
                    maleFee: type.maleFee,
                    femaleFee: type.femaleFee,
                  };
                  if (matchCount > 0) {
                    const newShuttleCount = type.value === '楽'
                      ? Math.ceil(matchCount / 4)
                      : Math.ceil(matchCount * 1.5);
                    setShuttleCount(newShuttleCount);
                    overrides.shuttleCount = newShuttleCount;
                  }
                  saveAll(overrides);
                }}
                className={`flex-1 select-button text-sm px-3 py-2 ${
                  practiceType === type.value
                    ? 'select-button-active'
                    : 'select-button-inactive'
                }`}
              >
                {practiceType === type.value && <span className="mr-1">✓</span>}
                {type.value}
              </button>
            ))}
          </div>
        </div>

        {/* 参加人数 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">参加人数・試合数</h2>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">合計</div>
              <div className="text-2xl font-bold text-blue-600">{participantCount}</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-xs text-muted-foreground mb-1 text-center">免除</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => {
                    const v = Math.max(0, exemptCount - 1);
                    setExemptCount(v);
                    saveAll({ exemptCount: v });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-muted-foreground hover:bg-muted active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-foreground">{exemptCount}</span>
                <button
                  onClick={() => {
                    const v = exemptCount + 1;
                    setExemptCount(v);
                    saveAll({ exemptCount: v });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-muted-foreground hover:bg-muted active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
            <div className="bg-blue-100 rounded-lg p-2">
              <div className="text-xs text-muted-foreground mb-1 text-center">男</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => {
                    const v = Math.max(0, maleCount - 1);
                    setMaleCount(v);
                    saveAll({ maleCount: v });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-blue-800">{maleCount}</span>
                <button
                  onClick={() => {
                    const v = maleCount + 1;
                    setMaleCount(v);
                    saveAll({ maleCount: v });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
            <div className="bg-pink-100 rounded-lg p-2">
              <div className="text-xs text-muted-foreground mb-1 text-center">女</div>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => {
                    const v = Math.max(0, femaleCount - 1);
                    setFemaleCount(v);
                    saveAll({ femaleCount: v });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-xl font-bold text-pink-800">{femaleCount}</span>
                <button
                  onClick={() => {
                    const v = femaleCount + 1;
                    setFemaleCount(v);
                    saveAll({ femaleCount: v });
                  }}
                  className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-200 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* 試合数 */}
          <div className="mt-3 bg-green-50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700 font-semibold">試合数</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const v = Math.max(0, matchCount - 1);
                    setMatchCount(v);
                    saveAll({ matchCount: v });
                  }}
                  className="w-7 h-7 rounded-full bg-white text-green-600 hover:bg-green-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  −
                </button>
                <span className="text-2xl font-bold text-green-700 w-12 text-center">{matchCount}</span>
                <button
                  onClick={() => {
                    const v = matchCount + 1;
                    setMatchCount(v);
                    saveAll({ matchCount: v });
                  }}
                  className="w-7 h-7 rounded-full bg-white text-green-600 hover:bg-green-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 収入 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">収入</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">男</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const v = Math.max(0, maleFee - 100);
                      setMaleFee(v);
                      saveAll({ maleFee: v });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={maleFee || ''}
                    min="0"
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setMaleFee(v);
                      saveAll({ maleFee: v });
                    }}
                    className="w-16 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <button
                    onClick={() => {
                      const v = maleFee + 100;
                      setMaleFee(v);
                      saveAll({ maleFee: v });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-blue-600 hover:bg-blue-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">×</span>
                <input
                  type="number"
                  value={maleCount || ''}
                  onChange={(e) => {
                    const newValue = Math.max(0, parseInt(e.target.value, 10) || 0);
                    setMaleCount(newValue);
                    saveAll({ maleCount: newValue });
                  }}
                  className="w-10 text-sm font-semibold bg-card rounded px-1 py-0.5 text-center"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                />
              </div>
              <span className="text-lg font-bold text-blue-600">
                {maleTotal.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between bg-pink-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">女</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const v = Math.max(0, femaleFee - 100);
                      setFemaleFee(v);
                      saveAll({ femaleFee: v });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={femaleFee || ''}
                    min="0"
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setFemaleFee(v);
                      saveAll({ femaleFee: v });
                    }}
                    className="w-16 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <button
                    onClick={() => {
                      const v = femaleFee + 100;
                      setFemaleFee(v);
                      saveAll({ femaleFee: v });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-pink-600 hover:bg-pink-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm text-muted-foreground">×</span>
                <input
                  type="number"
                  value={femaleCount || ''}
                  onChange={(e) => {
                    const newValue = Math.max(0, parseInt(e.target.value, 10) || 0);
                    setFemaleCount(newValue);
                    saveAll({ femaleCount: newValue });
                  }}
                  className="w-10 text-sm font-semibold bg-card rounded px-1 py-0.5 text-center"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                />
              </div>
              <span className="text-lg font-bold text-pink-600">
                {femaleTotal.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">免除</span>
                <span className="text-sm font-semibold">0</span>
                <span className="text-sm text-muted-foreground">×</span>
                <input
                  type="number"
                  value={exemptCount || ''}
                  onChange={(e) => {
                    const newValue = Math.max(0, parseInt(e.target.value, 10) || 0);
                    setExemptCount(newValue);
                    saveAll({ exemptCount: newValue });
                  }}
                  className="w-10 text-sm font-semibold bg-card rounded px-1 py-0.5 text-center"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                />
              </div>
              <span className="text-lg font-bold text-muted-foreground">0</span>
            </div>
          </div>
        </div>

        {/* 支出 */}
        <div className="card p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-700">支出</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
              <span className="text-sm text-muted-foreground">体育館</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">-</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const v = Math.max(0, gymCost - 100);
                      setGymCost(v);
                      saveAll({ gymCost: v });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={gymCost || ''}
                    min="0"
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setGymCost(v);
                      saveAll({ gymCost: v });
                    }}
                    className="w-20 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <button
                    onClick={() => {
                      const v = gymCost + 100;
                      setGymCost(v);
                      saveAll({ gymCost: v });
                    }}
                    className="w-6 h-6 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-red-50 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">シャトル使用数</span>
                <span className="text-lg font-bold text-red-600">
                  -{shuttleTotal.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="number"
                    value={shuttlePrice || ''}
                    min="0"
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setShuttlePrice(v);
                      saveAll({ shuttlePrice: v });
                    }}
                    className="w-16 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                    inputMode="numeric"
                  />
                  <span className="text-sm text-muted-foreground">×</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const v = Math.max(0, shuttleCount - 1);
                      setShuttleCount(v);
                      saveAll({ shuttleCount: v });
                    }}
                    className="w-7 h-7 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                  >
                    −
                  </button>
                  <span className="text-lg font-bold text-foreground w-10 text-center">{shuttleCount}</span>
                  <button
                    onClick={() => {
                      const v = shuttleCount + 1;
                      setShuttleCount(v);
                      saveAll({ shuttleCount: v });
                    }}
                    className="w-7 h-7 rounded-full bg-card text-red-600 hover:bg-red-100 active:scale-95 flex items-center justify-center font-bold text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* その他（アコーディオン） */}
        <div className="card overflow-hidden">
          <button
            onClick={() => setIsOtherExpanded(!isOtherExpanded)}
            className="w-full p-4 flex items-center justify-between hover:bg-muted/50 active:bg-muted transition-colors"
          >
            <h2 className="text-sm font-bold text-gray-700">その他</h2>
            <span className="text-muted-foreground text-sm">
              {isOtherExpanded ? '▲' : '▼'}
            </span>
          </button>

          {isOtherExpanded && (
            <div className="px-4 pb-4">
              <div className="bg-muted/50 rounded-lg px-3 py-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-16">説明</span>
                    <input
                      type="text"
                      value={otherDescription}
                      onChange={(e) => {
                        setOtherDescription(e.target.value);
                        saveAll({ otherDescription: e.target.value });
                      }}
                      placeholder="例：立替払い戻し、備品購入"
                      className="flex-1 text-sm bg-card rounded px-2 py-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground w-16">金額</span>
                    <button
                      onClick={() => {
                        const newValue = -otherAmount;
                        setOtherAmount(newValue);
                        saveAll({ otherAmount: newValue });
                      }}
                      className="w-8 h-8 rounded-full bg-card text-muted-foreground hover:bg-muted active:scale-95 flex items-center justify-center font-bold text-xs border border-border"
                    >
                      ±
                    </button>
                    <input
                      type="number"
                      value={Math.abs(otherAmount) || ''}
                      onChange={(e) => {
                        const absValue = Math.abs(parseInt(e.target.value, 10) || 0);
                        const newValue = otherAmount < 0 ? -absValue : absValue;
                        setOtherAmount(newValue);
                        saveAll({ otherAmount: newValue });
                      }}
                      placeholder="0"
                      className="flex-1 text-sm font-semibold bg-card rounded px-2 py-1 text-right"
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 適正会費との差額警告 */}
        {gymShortName !== '千川館' && gymCost <= 900 && (Math.abs(maleFee - appropriateFee.male) >= 200 || Math.abs(femaleFee - appropriateFee.female) >= 200) && (
          <div className="card p-4 bg-yellow-50 border-2 border-yellow-300">
            <p className="text-sm text-yellow-800 font-semibold text-center">
              ⚠️ 適正会費と会費の差が200円以上あります、調整を検討してください。
            </p>
          </div>
        )}

        {/* 合計 */}
        <div className="card p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200">
          <h2 className="text-sm font-bold mb-3 text-gray-700">合計</h2>
          <div className="text-xs text-muted-foreground mb-2 font-mono">
            {maleTotal.toLocaleString()}+{femaleTotal.toLocaleString()}-{gymCost.toLocaleString()}-{shuttleTotal.toLocaleString()}
            {otherAmount !== 0 && (otherAmount >= 0 ? `+${otherAmount.toLocaleString()}` : `${otherAmount.toLocaleString()}`)}
          </div>
          <div className={`text-4xl font-bold text-center ${finalTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {finalTotal >= 0 ? '+' : ''}{finalTotal.toLocaleString()}円
          </div>
        </div>

        {/* プレビュー */}
        <div className="card p-4 bg-muted/50">
          <h2 className="text-xs font-bold mb-2 text-muted-foreground">コピー内容プレビュー</h2>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-card p-6 rounded border border-border">
            {generateCopyText()}
          </pre>
        </div>

        {/* コピーボタン */}
        <div className="flex gap-3">
          <button
            onClick={handleCopy}
            className="flex-1 btn-primary flex items-center justify-center gap-2 py-3 px-6"
          >
            <Copy size={18} />
            コピー
          </button>
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
