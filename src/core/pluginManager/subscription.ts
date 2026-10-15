import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import CryptoJs from "crypto-js";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useMemo } from "react";

export interface ISubscriptionItem {
    id: string;
    name: string;
    url: string;
}

export interface ISubscriptionInfo {
    subscriptionId: string;
    lastUpdatedAt?: number;
    pluginCount?: number;
}

export interface IPluginSubscriptionRecord {
    pluginHash: string;
    pluginName: string;
    subscriptionId: string;
    sourceUrl: string;
    installedAt: number;
    installedVersion?: string;
    missingFromSubscription?: boolean;
    archivedAsDuplicate?: boolean;
    uninstalledAt?: number;
    supersededAt?: number;
}

const subscriptionStore = getOrCreateMMKV("plugin.subscription");

const subscriptionRecordsAtom = atom<Record<string, IPluginSubscriptionRecord>>(
    loadSubscriptionRecords(),
);

const subscriptionInfosAtom = atom<Record<string, ISubscriptionInfo>>(
    loadSubscriptionInfos(),
);

function loadSubscriptionRecords(): Record<string, IPluginSubscriptionRecord> {
    return safeParse<Record<string, IPluginSubscriptionRecord>>(
        subscriptionStore.getString("records"),
    ) ?? {};
}

function loadSubscriptionInfos(): Record<string, ISubscriptionInfo> {
    return safeParse<Record<string, ISubscriptionInfo>>(
        subscriptionStore.getString("infos"),
    ) ?? {};
}

function saveSubscriptionRecords(
    records: Record<string, IPluginSubscriptionRecord>,
) {
    subscriptionStore.set("records", safeStringify(records));
    getDefaultStore().set(subscriptionRecordsAtom, records);
}

function saveSubscriptionInfos(infos: Record<string, ISubscriptionInfo>) {
    subscriptionStore.set("infos", safeStringify(infos));
    getDefaultStore().set(subscriptionInfosAtom, infos);
}

function getSubscriptionRecords() {
    return getDefaultStore().get(subscriptionRecordsAtom);
}

function getSubscriptionInfos() {
    return getDefaultStore().get(subscriptionInfosAtom);
}

export function getSubscriptionIdFromUrl(url: string) {
    return `sub-${CryptoJs.SHA256(url.trim()).toString()}`;
}

export function getSubscriptionRecordKey(
    subscriptionId: string,
    pluginHash: string,
    sourceUrl: string,
) {
    return `${subscriptionId}::${pluginHash || "-"}::${sourceUrl}`;
}

function isRecordActive(record: IPluginSubscriptionRecord) {
    return !record.uninstalledAt && !record.supersededAt;
}

export function parseSubscriptionConfig(raw?: string | null): ISubscriptionItem[] {
    if (!raw?.trim()) {
        return [];
    }
    try {
        const parsed = safeParse<ISubscriptionItem[] | string>(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter(it => !!it?.url).map(it => ({
                id: it.id || getSubscriptionIdFromUrl(it.url),
                name: it.name || it.url,
                url: it.url,
            }));
        }
        if (typeof parsed === "string" && parsed.trim()) {
            return [{
                id: getSubscriptionIdFromUrl(parsed),
                name: parsed,
                url: parsed,
            }];
        }
    } catch {
        // old data is a plain URL
        return [{
            id: getSubscriptionIdFromUrl(raw),
            name: raw,
            url: raw,
        }];
    }
    return [];
}

interface IOldSubscribeItem {
    id?: string;
    name: string;
    url: string;
}

export function withSubscriptionId(item: IOldSubscribeItem): ISubscriptionItem {
    return {
        id: item.id || getSubscriptionIdFromUrl(item.url),
        name: item.name,
        url: item.url,
    };
}

export function recordSubscriptionInstall(input: {
    subscriptionId?: string;
    pluginHash: string;
    pluginName: string;
    sourceUrl: string;
    installedVersion?: string;
    archivedAsDuplicate?: boolean;
}) {
    if (!input.subscriptionId || !input.pluginHash) {
        return;
    }
    const records = getSubscriptionRecords();
    const now = Date.now();
    const nextRecords = { ...records };
    if (!input.archivedAsDuplicate) {
        Object.keys(nextRecords).forEach(key => {
            const record = nextRecords[key];
            if (
                isRecordActive(record) &&
                record.pluginName === input.pluginName &&
                record.pluginHash !== input.pluginHash
            ) {
                nextRecords[key] = {
                    ...record,
                    supersededAt: now,
                };
            }
        });
    }

    const key = getSubscriptionRecordKey(
        input.subscriptionId,
        input.pluginHash,
        input.sourceUrl,
    );
    nextRecords[key] = {
        pluginHash: input.pluginHash,
        pluginName: input.pluginName,
        subscriptionId: input.subscriptionId,
        sourceUrl: input.sourceUrl,
        installedAt: now,
        installedVersion: input.installedVersion,
        archivedAsDuplicate: input.archivedAsDuplicate,
        missingFromSubscription: false,
        uninstalledAt: undefined,
        supersededAt: undefined,
    };
    saveSubscriptionRecords(nextRecords);
}

export function markPluginArchivedAsDuplicate(input: {
    subscriptionId?: string;
    pluginHash: string;
    pluginName: string;
    sourceUrl: string;
    installedVersion?: string;
}) {
    recordSubscriptionInstall({
        ...input,
        archivedAsDuplicate: true,
    });
}

export function markPluginUninstalled(pluginHash: string) {
    const records = getSubscriptionRecords();
    const nextRecords = { ...records };
    Object.keys(nextRecords).forEach(key => {
        if (nextRecords[key].pluginHash === pluginHash && isRecordActive(nextRecords[key])) {
            nextRecords[key] = {
                ...nextRecords[key],
                uninstalledAt: Date.now(),
            };
        }
    });
    saveSubscriptionRecords(nextRecords);
}

export function markSubscriptionSnapshot(
    subscriptionId: string,
    expectedPluginHashes: Set<string>,
    expectedSourceUrls: Set<string>,
) {
    const records = getSubscriptionRecords();
    const nextRecords = { ...records };
    Object.keys(nextRecords).forEach(key => {
        const record = nextRecords[key];
        if (record.subscriptionId !== subscriptionId || !isRecordActive(record)) {
            return;
        }
        const exists = expectedPluginHashes.has(record.pluginHash) ||
            expectedSourceUrls.has(record.sourceUrl);
        if (record.missingFromSubscription !== !exists) {
            nextRecords[key] = {
                ...record,
                missingFromSubscription: !exists,
            };
        }
    });
    saveSubscriptionRecords(nextRecords);
}

export function updateSubscriptionInfo(
    subscriptionId: string,
    info: Partial<Omit<ISubscriptionInfo, "subscriptionId">>,
) {
    const infos = getSubscriptionInfos();
    const oldInfo = infos[subscriptionId];
    saveSubscriptionInfos({
        ...infos,
        [subscriptionId]: {
            subscriptionId,
            pluginCount: info.pluginCount ?? oldInfo?.pluginCount,
            lastUpdatedAt: info.lastUpdatedAt ?? oldInfo?.lastUpdatedAt,
        },
    });
}

export function removeSubscriptionData(subscriptionId: string) {
    const records = getSubscriptionRecords();
    const infos = getSubscriptionInfos();
    const nextRecords = { ...records };
    Object.keys(nextRecords).forEach(key => {
        if (nextRecords[key].subscriptionId === subscriptionId) {
            delete nextRecords[key];
        }
    });
    const nextInfos = { ...infos };
    delete nextInfos[subscriptionId];
    saveSubscriptionRecords(nextRecords);
    saveSubscriptionInfos(nextInfos);
}

export function getActiveSubscriptionRecords(
    subscriptionId?: string,
): IPluginSubscriptionRecord[] {
    return Object.values(getSubscriptionRecords()).filter(record =>
        isRecordActive(record) &&
        (!subscriptionId || record.subscriptionId === subscriptionId)
    );
}

export function useSubscriptionItems(rawConfig?: string): ISubscriptionItem[] {
    return useMemo(() => parseSubscriptionConfig(rawConfig), [rawConfig]);
}

export function useSubscriptionInfos(): Record<string, ISubscriptionInfo> {
    return useAtomValue(subscriptionInfosAtom);
}

export function useSubscriptionRecords(
    subscriptionId?: string,
): IPluginSubscriptionRecord[] {
    const records = useAtomValue(subscriptionRecordsAtom);
    return useMemo(
        () => Object.values(records).filter(record =>
            isRecordActive(record) &&
            (!subscriptionId || record.subscriptionId === subscriptionId)
        ),
        [records, subscriptionId],
    );
}

export function usePluginSubscriptionRecord(
    pluginHash: string,
): IPluginSubscriptionRecord | null {
    const records = useAtomValue(subscriptionRecordsAtom);
    return useMemo(
        () => Object.values(records).find(record =>
            isRecordActive(record) && record.pluginHash === pluginHash
        ) ?? null,
        [records, pluginHash],
    );
}
