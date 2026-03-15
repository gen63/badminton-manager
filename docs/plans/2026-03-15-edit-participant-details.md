# 参加者の名前・性別編集機能

**日付**: 2026-03-15

## 概要

参加者管理画面（PlayerSelect）で、既存の参加者の名前と性別を編集できるようにする。
削除ボタンの隣に編集ボタン（ペンアイコン）を追加し、タップするとモーダルで編集できる。

## 実装方針

### 1. PlayerEditModal コンポーネント（新規作成）

- `src/components/PlayerEditModal.tsx`
- Props: `player`（現在の名前・性別）, `onSave`, `onCancel`
- 名前入力フィールド（text input）
- 性別選択ボタン（男/女/未設定）
- 保存・キャンセルボタン
- 重複名チェック（保存時）

### 2. PlayerSelect に編集ボタン追加

- 削除ボタン（Trash2）の隣に編集ボタン（Pencil）を配置
- 同じサイズ・スタイル（w-5 h-5 の丸ボタン）
- タップで PlayerEditModal を表示
- admin権限チェック（タブモード時）

### 3. 既存の updatePlayer を利用

- `playerStore.ts` に既にある `updatePlayer(id, updates)` で name/gender を更新
- 重複名バリデーションは UI 側で実施

## 影響範囲

- `src/components/PlayerEditModal.tsx`（新規）
- `src/pages/PlayerSelect.tsx`（編集ボタン追加、モーダル統合）
