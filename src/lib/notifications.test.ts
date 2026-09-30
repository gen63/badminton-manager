import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifyOperatorAssigned, closeOperatorAssignedNotification } from './notifications';

/** 内部の showNotificationSafely は非同期 IIFE なのでマイクロタスクをフラッシュする。 */
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('notifyOperatorAssigned', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // navigator.serviceWorker は jsdom にデフォルトで存在しないため、
    // テストで生やしたものは明示的に削除して次のテストに影響させない。
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('SW registration が active を持つとき showNotification が呼ばれる', async () => {
    const showNotificationMock = vi.fn().mockResolvedValue(undefined);
    const getRegistrationMock = vi.fn().mockResolvedValue({
      active: {},
      showNotification: showNotificationMock,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: getRegistrationMock },
      configurable: true,
    });

    class NotificationMock {
      static permission: NotificationPermission = 'granted';
    }
    vi.stubGlobal('Notification', NotificationMock);

    notifyOperatorAssigned('①付近で待機し、試合が終わったら終了→配置→開始をお願いします');
    await flushPromises();

    expect(getRegistrationMock).toHaveBeenCalled();
    expect(showNotificationMock).toHaveBeenCalledWith(
      '試合配置担当です',
      expect.objectContaining({
        body: '①付近で待機し、試合が終わったら終了→配置→開始をお願いします',
        tag: 'operator-assigned',
        vibrate: [200, 100, 200],
      })
    );
  });

  it('SW 登録が無いとき new Notification にフォールバックする', async () => {
    // navigator.serviceWorker 自体を生やさない = 'serviceWorker' in navigator が false
    const ctorSpy = vi.fn();
    class NotificationMock {
      static permission: NotificationPermission = 'granted';
      constructor(title: string, options?: NotificationOptions) {
        ctorSpy(title, options);
      }
    }
    vi.stubGlobal('Notification', NotificationMock);

    notifyOperatorAssigned('body');
    await flushPromises();

    expect(ctorSpy).toHaveBeenCalledWith(
      '試合配置担当です',
      expect.objectContaining({ body: 'body', tag: 'operator-assigned' })
    );
  });

  it('コンストラクタが throw しても呼び出し側に伝播しない', async () => {
    class ThrowingNotification {
      static permission: NotificationPermission = 'granted';
      constructor() {
        throw new Error('Illegal constructor');
      }
    }
    vi.stubGlobal('Notification', ThrowingNotification);

    expect(() => notifyOperatorAssigned('body')).not.toThrow();
    await flushPromises();
  });

  it('Notification.permission が granted でないとき何もしない', async () => {
    const getRegistrationMock = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: getRegistrationMock },
      configurable: true,
    });

    class NotificationMock {
      static permission: NotificationPermission = 'default';
    }
    vi.stubGlobal('Notification', NotificationMock);

    notifyOperatorAssigned('body');
    await flushPromises();

    expect(getRegistrationMock).not.toHaveBeenCalled();
  });
});

describe('closeOperatorAssignedNotification', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  it('tag で取得した通知を close する', async () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const getNotifications = vi.fn().mockResolvedValue([{ close: closeA }, { close: closeB }]);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockResolvedValue({ getNotifications }) },
      configurable: true,
    });

    closeOperatorAssignedNotification();
    await flushPromises();

    expect(getNotifications).toHaveBeenCalledWith({ tag: 'operator-assigned' });
    expect(closeA).toHaveBeenCalled();
    expect(closeB).toHaveBeenCalled();
  });

  it('getRegistration が reject しても throw しない', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn().mockRejectedValue(new Error('boom')) },
      configurable: true,
    });

    expect(() => closeOperatorAssignedNotification()).not.toThrow();
    await flushPromises();
    errorSpy.mockRestore();
  });

  it('serviceWorker が無い環境では何もしない', async () => {
    expect(() => closeOperatorAssignedNotification()).not.toThrow();
    await flushPromises();
  });
});
