import React from 'react';
import { create } from 'zustand';
import { useLocation, useNavigate } from 'react-router-dom';
import { featureOf, hasAnyUnsavedInput, unsavedInputOf } from './featureWork';

// 保存していない入力を失う前の確認。別の機能へ移る前と、アプリを閉じる前に、破棄してよいかを確認する。
// 機能の中の移動 (機能のタブの切り替え) では入力が残るため確認しない

// 確認中の操作 (別の機能への移動・アプリの終了)
type PendingAction = { kind: 'navigate'; route: string } | { kind: 'close' };

type GuardState = {
    pending: PendingAction | null;
    setPending(action: PendingAction | null): void;
};

export const useNavigationGuardStore = create<GuardState>(set => ({
    pending: null,
    setPending(pending) {
        set({ pending });
    },
}));

// 画面の移動。別の機能へ移る場合に、今の機能に保存していない入力があれば確認を出す
export function useGuardedNavigate(): (route: string) => void {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    return React.useCallback(
        (route: string) => {
            const current = featureOf(pathname);
            if (featureOf(route) !== current && unsavedInputOf(current)?.hasUnsaved()) {
                useNavigationGuardStore.getState().setPending({ kind: 'navigate', route });
                return;
            }
            navigate(route);
        },
        [navigate, pathname]
    );
}

// アプリを閉じる前の問い合わせへの返事。保存していない入力がどの機能にも無ければ、そのまま閉じる
export function handleCloseRequest(): void {
    if (hasAnyUnsavedInput()) {
        useNavigationGuardStore.getState().setPending({ kind: 'close' });
        return;
    }
    void window.kuraToolkit.confirmClose();
}

// 確認で破棄を選んだときに、確認中の操作を行う (移動は、今の機能の入力を破棄してから移る)
export function useConfirmPendingAction(): () => void {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    return React.useCallback(() => {
        const pending = useNavigationGuardStore.getState().pending;
        useNavigationGuardStore.getState().setPending(null);
        if (pending === null) return;
        if (pending.kind === 'close') {
            void window.kuraToolkit.confirmClose();
            return;
        }
        unsavedInputOf(featureOf(pathname))?.discard();
        navigate(pending.route);
    }, [navigate, pathname]);
}
