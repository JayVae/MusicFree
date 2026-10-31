import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useMemo } from "react";

import type { ISubscriptionPluginCandidate } from "@/types/core/pluginManager";

export type { ISubscriptionPluginCandidate };

export interface ISubscriptionInstallProgress {
    subscriptionId: string;
    total: number;
    completed: number;
    success: number;
    failed: number;
    running: boolean;
    cancelled?: boolean;
}

const subscriptionInstallProgressAtom = atom<
    Record<string, ISubscriptionInstallProgress>
>({});

const cancelledSubscriptionInstallIds = new Set<string>();

export function setSubscriptionInstallProgress(
    progress: ISubscriptionInstallProgress,
) {
    const store = getDefaultStore();
    store.set(subscriptionInstallProgressAtom, {
        ...store.get(subscriptionInstallProgressAtom),
        [progress.subscriptionId]: progress,
    });
}

export function requestCancelSubscriptionInstall(subscriptionId: string) {
    cancelledSubscriptionInstallIds.add(subscriptionId);
}

export function isSubscriptionInstallCancelled(subscriptionId: string) {
    return cancelledSubscriptionInstallIds.has(subscriptionId);
}

export function clearSubscriptionInstallCancellation(subscriptionId: string) {
    cancelledSubscriptionInstallIds.delete(subscriptionId);
}

export function useSubscriptionInstallProgress(): ISubscriptionInstallProgress | null {
    const progressMap = useAtomValue(subscriptionInstallProgressAtom);
    return useMemo(
        () => Object.values(progressMap).find(it => it.running) ?? null,
        [progressMap],
    );
}
