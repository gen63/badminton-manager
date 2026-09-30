# 「まもなく出番です」OS通知の廃止 ＋「試合配置担当です」OS通知の追加

## Context
PWA の OS 通知（プッシュ通知）は現在2種類。そのうち「まもなく出番です」（4:30 経過時に
次の試合がほぼ確定した本人へ出す）は実際の試合時間と噛み合わず機能していないため削除する。
代わりに、運用上いちばん行動を求めたい相手＝**操作担当**（`selectOperatorIds` の結果。
次の試合の 終了→配置→開始 をする人。予測バーの「配置予測（操作担当）」）に、
**担当になった時点**で「試合配置担当です」と OS 通知を出す。

## 変更内容

### 1. `src/lib/notifications.ts`
- `notifyNextMatchSoon` を削除。
- `notifyOperatorAssigned(body: string)` を追加。タイトル `試合配置担当です`、
  tag `operator-assigned`、振動 `[200, 100, 200]`、既存の `showNotificationSafely` を使用
  （権限チェック・SW 優先・throw しない性質はそのまま）。
- body 例: `①付近で待機し、試合が終わったら終了→配置→開始をお願いします`
  （待機コートは既存の待機ガイドと同じ判定を流用。取れなければ `コート付近で待機し…`）。

### 2. `src/lib/finishOperationGuide.ts`（判定は純粋関数で）
- `decideOperatorNotification({ operatorIds, myPlayerId, courts, alreadyNotified, firstAfterResume })` を追加:
  - `myPlayerId` が null / 既に通知済み / 自分がいずれかのコートに乗っている / 担当でない → `'none'`
  - 担当で `firstAfterResume` → `'markOnly'`（通知は出さず通知済みにする）
  - それ以外で担当 → `'notify'`
- body 組み立て `buildOperatorAssignedMessage(courtIds)` も同ファイルに置き、
  待機コートは既存の待機ガイド判定（`FinishOperationGuide` が使う近接コート集合の関数）を再利用。

### 3. `src/pages/MainPage.tsx`
- 4:30 の本人向け呼び出しから `notifyNextMatchSoon(body)` の呼び出しだけを外す
  （チャイム・振動・読み上げ `fireMatchCallAlert(speech)` と画面ガイドは残す）。
- 新しい useEffect（`operatorIds` / `courts` / `myPlayerId` / `isGameStateLoaded` 依存）:
  - `canEvaluateMatchCall`（`src/lib/nextMatchCall.ts`）で「同期済み・復帰直後でない」ときだけ判定
    （古い状態での誤通知防止。既存の `becameVisibleAtRef` を共用）。
  - `decideOperatorNotification` が `'notify'` なら `notifyOperatorAssigned(body)` を出し
    `notifiedOperatorRef = true`。
  - **1回の待機期間につき1回**: 既存の `calledForNextMatchRef` と同じく、自分がコートに
    配置された時点でフラグを戻す（予測のブレで担当が出入りしても何度も鳴らさない）。
- **遅れて届く通知の防止**（docs/plans/2026-08-22-match-call-stale-audio-on-resume.md と同じ考え方）:
  1. 判定は `canEvaluateMatchCall` を通ったときだけ（`isGameStateLoaded` が true＝再購読後の最新
     スナップショット受信済み、かつ visible 復帰から `MATCH_CALL_RESUME_GUARD_MS` 経過）。
     復帰直後の古い `courts` / 予測では判定しない。
  2. **復帰後の最初の判定では OS 通知を出さない**: バックグラウンドから戻って最初に判定が
     通ったとき、担当なら「通知済み」扱いにするだけ（画面の予測バー／待機ガイドが既に担当を
     示しているため）。これで「アプリを開いたら少し遅れて通知が鳴る」を防ぐ。
     実装は `becameVisibleAtRef` に加え `resumeHandledRef`（復帰ごとに false → 最初の判定で true）。
  3. **古い通知を片付ける**: 自分がコートに配置された／担当から外れたら、
     `registration.getNotifications({ tag: 'operator-assigned' })` で残っている通知を `close()`
     （`notifications.ts` に `closeOperatorAssignedNotification()` を追加、失敗は握り潰す）。
     通知センターに古い「試合配置担当です」が残り続けない。
  4. tag 固定なので、連続で出ても通知センターでは上書きされ1件のみ。
- 制約（明記）: サーバープッシュ（FCM）は使っていないため、iOS で PWA が完全にバックグラウンド
  停止中は通知自体が出ない（従来の「まもなく出番です」と同じ）。止まっていた間の分を
  復帰時にまとめて出すことはしない（上記2で抑止）。
- 通知許可のリクエスト導線は既存のまま（`requestNotificationPermission` 呼び出し箇所は変更なし）。

### 4. テスト
- `src/lib/notifications.test.ts`: `notifyNextMatchSoon` のテストを `notifyOperatorAssigned` に置き換え
  （タイトル・tag・フォールバック・非 granted 時何もしない）。`closeOperatorAssignedNotification` のテストも追加。
- 判定（復帰直後は出さず通知済み扱い）は純粋関数 `decideOperatorNotification({ ..., firstAfterResume })`
  → `'notify' | 'markOnly' | 'none'` にしてテストで押さえる。
- `src/lib/finishOperationGuide.test.ts`: `decideOperatorNotification` / `buildOperatorAssignedMessage` のケース追加
  （担当でない・コート上・通知済み・myPlayerId null・担当になった）。

### 5. ドキュメント
- `docs/plans/2026-09-30-operator-assigned-notification.md` にこの plan を保存し、
  `docs/plans/INDEX.md` に1行追記。コメント中の「4:30 の呼び出し通知は OS 通知・…」等の記述
  （`finishOperationGuide.ts` 冒頭、`MainPage.tsx` の呼び出し部）を実態に合わせて修正。

## 範囲外（変更しない）
- 「未対応のため休憩」OS通知、4:30/5:00 のチャイム・読み上げ、終了時刻アナウンス。

## 検証
- `npm run build` / `npm run lint` / `npm run test:run` をすべて通す。
- 実機確認: 担当になった端末に通知が出ること、バックグラウンドから復帰した直後には出ないこと、コートに入ると通知センターから消えること。
