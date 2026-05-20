import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionStore } from './sessionStore';
import type { SessionInformation } from '../types/session';

// Firebase関連のモック
const mockUpdateSession = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/sessionService', () => ({
  updateSession: (...args: never[]) => mockUpdateSession(...args),
}));

const mockDeleteField = vi.fn(() => '__deleteField_sentinel__');
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ __docRef: true }));
const mockArrayUnion = vi.fn((value: string) => ({ __arrayUnion: [value] }));
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('firebase/firestore');
  return {
    ...actual,
    deleteField: () => mockDeleteField(),
    updateDoc: mockUpdateDoc,
    doc: mockDoc,
    arrayUnion: mockArrayUnion,
  };
});

vi.mock('../lib/firebase', () => ({
  db: { __mockDb: true },
}));

describe('sessionStore - Information機能', () => {
  beforeEach(() => {
    // ストアとモックをリセット
    useSessionStore.setState({
      session: null,
      currentUser: null,
    });
    vi.clearAllMocks();
  });

  describe('updateInformation', () => {
    it('テキストを保存できる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('テスト周知事項');

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeDefined();
      expect(session?.information?.text).toBe('テスト周知事項');
      expect(session?.information?.updatedBy).toBe('TestUser');
      expect(session?.information?.readBy).toEqual(['TestUser']);
    });

    it('空文字列で削除される', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: '既存の情報',
            updatedAt: Date.now(),
            readBy: ['TestUser'],
          },
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('');

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeUndefined();
    });

    it('空白文字列（スペースのみ）でも削除される', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: '既存の情報',
            updatedAt: Date.now(),
            readBy: ['TestUser'],
          },
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('   ');

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeUndefined();
    });

    it('前後の空白がトリムされる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'TestUser',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('  テスト  ');

      const session = useSessionStore.getState().session;
      expect(session?.information?.text).toBe('テスト');
    });

    it('更新時に編集者のみreadByに含まれる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: '既存の情報',
            updatedAt: Date.now(),
            readBy: ['User1', 'User2', 'Admin'],
          },
        },
        currentUser: 'Admin',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('更新された情報');

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin']);
    });
  });

  describe('updateInformation（オンラインモード）', () => {
    it('保存時にFirestoreへ同期される', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
        },
        currentUser: 'Admin',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('オンラインテスト');

      expect(mockUpdateSession).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({
          information: expect.objectContaining({
            text: 'オンラインテスト',
            readBy: ['Admin'],
          }),
        }),
      );
    });

    it('削除時にdeleteField()がFirestoreに送信される', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
          information: { text: '削除対象', updatedAt: Date.now(), readBy: ['Admin'] },
        },
        currentUser: 'Admin',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('');

      // deleteFieldが呼ばれたことを確認
      expect(mockDeleteField).toHaveBeenCalled();
      // updateSessionにdeleteFieldのセンチネル値が渡されたことを確認
      expect(mockUpdateSession).toHaveBeenCalledWith(
        'test-session',
        expect.objectContaining({
          information: '__deleteField_sentinel__',
        }),
      );
    });

    it('Firebase同期エラー時もローカル状態は更新される', async () => {
      mockUpdateSession.mockRejectedValueOnce(new Error('Network error'));

      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
        },
        currentUser: 'Admin',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('エラーテスト');

      // ローカル状態は更新されている
      const session = useSessionStore.getState().session;
      expect(session?.information?.text).toBe('エラーテスト');
    });

    it('currentUser=null (裏管理) の場合、updatedBy は undefined ではなく省略される', async () => {
      // Firestore は `ignoreUndefinedProperties` 未設定のため、
      // `updatedBy: undefined` を含んだ payload を送ると write 自体が
      // 例外で失敗する。裏管理（観覧専用入室）で currentUser=null の場合、
      // updatedBy はオブジェクトに含めない（プロパティ自体を省略する）。
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
        },
        currentUser: null,
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('裏管理が書き込み');

      const session = useSessionStore.getState().session;
      expect(session?.information?.text).toBe('裏管理が書き込み');
      expect(session?.information).not.toHaveProperty('updatedBy');
      expect(session?.information?.readBy).toEqual([]);

      const call = mockUpdateSession.mock.calls.find((c) => c[0] === 'test-session');
      const information = call?.[1]?.information;
      expect(information).not.toHaveProperty('updatedBy');
    });
  });

  describe('markInformationAsRead', () => {
    it('未読から既読になる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin', 'Member1']);
    });

    it('既読済みの場合は重複しない', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin', 'Member1'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin', 'Member1']);
    });

    it('readByがundefinedの場合でも動作する', async () => {
      const oldInformation = {
        text: 'テスト情報',
        updatedAt: Date.now(),
      };

      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: oldInformation as unknown as SessionInformation,
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Member1']);
    });

    it('informationがない場合は何もしない', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information).toBeUndefined();
    });

    it('currentUserがない場合は何もしない', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin'],
          },
        },
        currentUser: null,
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      expect(session?.information?.readBy).toEqual(['Admin']);
    });
  });

  describe('markInformationAsRead（オンラインモード）', () => {
    it('arrayUnionでFirestoreにアトミックに既読追加される', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      // arrayUnionが使われたことを確認
      expect(mockArrayUnion).toHaveBeenCalledWith('Member1');
      // updateDocが呼ばれたことを確認
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        { 'information.readBy': expect.anything() },
      );
    });

    it('既読済みの場合はFirestore呼び出しをスキップする', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin', 'Member1'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      // 既読済みなのでFirestore呼び出しなし
      expect(mockUpdateDoc).not.toHaveBeenCalled();
      expect(mockArrayUnion).not.toHaveBeenCalled();
    });
  });

  describe('未読バッジの判定ロジック', () => {
    it('管理者が更新後、メンバーは未読になる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        currentUser: 'Admin',
      });

      const { updateInformation } = useSessionStore.getState();
      await updateInformation('新しいお知らせ');

      // メンバー視点
      useSessionStore.setState({
        currentUser: 'Member1',
      });

      const session = useSessionStore.getState().session;
      const currentUser = useSessionStore.getState().currentUser;
      const isUnread = session?.information?.text && currentUser && !session.information.readBy?.includes(currentUser);

      expect(isUnread).toBe(true);
    });

    it('メンバーが既読後、未読ではなくなる', async () => {
      useSessionStore.setState({
        session: {
          id: 'test-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          information: {
            text: 'テスト情報',
            updatedAt: Date.now(),
            readBy: ['Admin'],
          },
        },
        currentUser: 'Member1',
      });

      const { markInformationAsRead } = useSessionStore.getState();
      await markInformationAsRead();

      const session = useSessionStore.getState().session;
      const currentUser = useSessionStore.getState().currentUser;
      const isUnread = session?.information?.text && currentUser && !session.information.readBy?.includes(currentUser);

      expect(isUnread).toBe(false);
    });
  });

  describe('updateAccounting', () => {
    const baseSnapshot = {
      exemptCount: 2,
      maleCount: 4,
      femaleCount: 3,
      maleFee: 800,
      femaleFee: 600,
      gymCost: 900,
      shuttlePrice: 480,
      shuttleCount: 2,
      matchCount: 10,
      practiceType: '複',
      otherDescription: 'ツムラ',
      otherAmount: 400,
    };

    it('ローカルセッションにマージされる', async () => {
      useSessionStore.setState({
        session: {
          id: 'local-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      });

      const { updateAccounting } = useSessionStore.getState();
      await updateAccounting(baseSnapshot);

      const session = useSessionStore.getState().session;
      expect(session?.accounting).toEqual(baseSnapshot);
    });

    it('既存 accounting に patch をマージする', async () => {
      useSessionStore.setState({
        session: {
          id: 'local-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accounting: baseSnapshot,
        },
      });

      const { updateAccounting } = useSessionStore.getState();
      await updateAccounting({ maleCount: 5 });

      const session = useSessionStore.getState().session;
      expect(session?.accounting?.maleCount).toBe(5);
      expect(session?.accounting?.femaleCount).toBe(3);
      expect(session?.accounting?.otherDescription).toBe('ツムラ');
    });

    it('session が null の状態では Firestore に送信しない', async () => {
      useSessionStore.setState({ session: null });

      const { updateAccounting } = useSessionStore.getState();
      await updateAccounting(baseSnapshot);

      expect(mockUpdateSession).not.toHaveBeenCalled();
    });

    it('オンラインモードでは Firestore に accounting 全体が送信される', async () => {
      useSessionStore.setState({
        session: {
          id: 'online-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
        },
        currentUser: 'Admin',
      });

      const { updateAccounting } = useSessionStore.getState();
      await updateAccounting(baseSnapshot);

      expect(mockUpdateSession).toHaveBeenCalledWith(
        'online-session',
        expect.objectContaining({
          accounting: expect.objectContaining({
            maleCount: 4,
            otherDescription: 'ツムラ',
          }),
        }),
      );
    });

    it('Firebase 同期エラー時もローカル状態は更新される', async () => {
      mockUpdateSession.mockRejectedValueOnce(new Error('Network error'));

      useSessionStore.setState({
        session: {
          id: 'online-session',
          config: { courtCount: 1, targetScore: 21, practiceStartTime: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'Admin',
        },
        currentUser: 'Admin',
      });

      const { updateAccounting } = useSessionStore.getState();
      await updateAccounting(baseSnapshot);

      const session = useSessionStore.getState().session;
      expect(session?.accounting?.maleCount).toBe(4);
    });

    it('session が null の場合は何もしない', async () => {
      useSessionStore.setState({ session: null });

      const { updateAccounting } = useSessionStore.getState();
      await updateAccounting(baseSnapshot);

      expect(useSessionStore.getState().session).toBeNull();
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });
  });
});

describe('sessionStore - persist (Phase B: ローカル保持を currentUser のみに縮小)', () => {
  it('session は localStorage に書かれない (currentUser のみが書かれる)', () => {
    useSessionStore.setState({
      session: {
        id: 'sess-1',
        config: { courtCount: 2, targetScore: 21, practiceStartTime: Date.now() },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'Admin',
        accounting: { maleCount: 5 } as never,
      },
      currentUser: 'TestUser',
    });

    const raw = localStorage.getItem('badminton-session');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const stored = parsed.state ?? parsed;
    expect(stored).not.toHaveProperty('session');
    expect(stored).toHaveProperty('currentUser', 'TestUser');
  });

  it('migrate (version 0 → 1) で旧 persisted state から session を剥がし currentUser を残す', () => {
    // sessionStore.ts の migrate と同じロジックを再現してテストする
    const migrate = (persisted: unknown, version: number): unknown => {
      if (version < 1 && persisted && typeof persisted === 'object') {
        const obj = persisted as Record<string, unknown>;
        return { currentUser: obj.currentUser ?? null };
      }
      return persisted;
    };

    const oldState = {
      session: { id: 'sess-1', config: { courtCount: 2, targetScore: 21, practiceStartTime: 0 }, createdAt: 0, updatedAt: 0 },
      currentUser: 'Alice',
    };
    const migrated = migrate(oldState, 0) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('session');
    expect(migrated.currentUser).toBe('Alice');
  });

  it('migrate: currentUser が無い旧データでも null で復元する', () => {
    const migrate = (persisted: unknown, version: number): unknown => {
      if (version < 1 && persisted && typeof persisted === 'object') {
        const obj = persisted as Record<string, unknown>;
        return { currentUser: obj.currentUser ?? null };
      }
      return persisted;
    };

    const oldState = {
      session: { id: 'sess-1', config: { courtCount: 1, targetScore: 21, practiceStartTime: 0 }, createdAt: 0, updatedAt: 0 },
      // currentUser 欠落
    };
    const migrated = migrate(oldState, 0) as Record<string, unknown>;
    expect(migrated.currentUser).toBeNull();
  });
});
