import { useMemo } from "react";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";

export enum PluginOriginType {
    Subscription = "subscription",
    Local = "local",
    Network = "network",
    Builtin = "builtin",
}

export interface IPluginOriginRecord {
    pluginHash: string;
    pluginName: string;
    originType: PluginOriginType;
    /** 订阅来源使用订阅 ID；逻辑组使用固定 ID。 */
    originId: string;
    originName?: string;
    sourceUrl?: string;
    installedAt: number;
    updatedAt: number;
    archivedAsDuplicate?: boolean;
    uninstalledAt?: number;
    supersededAt?: number;
}

export interface IPluginOriginGroup {
    key: string;
    originType: PluginOriginType;
    originId: string;
    originName?: string;
    plugins: Array<{ hash: string; name: string }>;
    pluginCount: number;
    latestChangedAt?: number;
}

interface IPluginLike {
    hash: string;
    name: string;
}

export const LOCAL_PLUGIN_ORIGIN_ID = "local";
export const NETWORK_PLUGIN_ORIGIN_ID = "network";
export const BUILTIN_PLUGIN_ORIGIN_ID = "builtin";

const pluginOriginStore = getOrCreateMMKV("plugin.origin");

function loadPluginOriginRecords(): Record<string, IPluginOriginRecord> {
    return safeParse<Record<string, IPluginOriginRecord>>(
        pluginOriginStore.getString("records"),
    ) ?? {};
}

const pluginOriginAtom = atom<Record<string, IPluginOriginRecord>>(
    loadPluginOriginRecords(),
);

function getPluginOriginRecords() {
    return getDefaultStore().get(pluginOriginAtom);
}

function savePluginOriginRecords(
    records: Record<string, IPluginOriginRecord>,
) {
    pluginOriginStore.set("records", safeStringify(records));
    getDefaultStore().set(pluginOriginAtom, records);
}

function getOriginRecordKey(record: IPluginOriginRecord) {
    return `${record.originType}:${record.originId}:${record.pluginHash}`;
}

function isOriginRecordActive(record: IPluginOriginRecord) {
    return !record.uninstalledAt && !record.supersededAt;
}

export function getPluginOrigin(
    pluginHash?: string | null,
): IPluginOriginRecord | null {
    if (!pluginHash) {
        return null;
    }
    return Object.values(getPluginOriginRecords())
        .filter(record => record.pluginHash === pluginHash && isOriginRecordActive(record))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

export function recordPluginOrigin(input: {
    pluginHash: string;
    pluginName: string;
    originType: PluginOriginType;
    originId: string;
    originName?: string;
    sourceUrl?: string;
    archivedAsDuplicate?: boolean;
}) {
    const records = { ...getPluginOriginRecords() };
    const now = Date.now();
    const nextRecord: IPluginOriginRecord = {
        pluginHash: input.pluginHash,
        pluginName: input.pluginName,
        originType: input.originType,
        originId: input.originId,
        originName: input.originName,
        sourceUrl: input.sourceUrl,
        installedAt: now,
        updatedAt: now,
        archivedAsDuplicate: input.archivedAsDuplicate,
    };

    Object.keys(records).forEach(key => {
        const record = records[key];
        if (record.pluginHash !== input.pluginHash || !isOriginRecordActive(record)) {
            return;
        }
        if (key === getOriginRecordKey(nextRecord)) {
            nextRecord.installedAt = Math.min(record.installedAt, now);
            return;
        }
        records[key] = {
            ...record,
            supersededAt: now,
        };
    });

    records[getOriginRecordKey(nextRecord)] = nextRecord;
    savePluginOriginRecords(records);
}

export function markPluginOriginUninstalled(pluginHash: string) {
    const records = { ...getPluginOriginRecords() };
    const now = Date.now();
    let changed = false;

    Object.keys(records).forEach(key => {
        const record = records[key];
        if (
            record.pluginHash === pluginHash &&
            isOriginRecordActive(record) &&
            !record.uninstalledAt
        ) {
            records[key] = {
                ...record,
                uninstalledAt: now,
            };
            changed = true;
        }
    });

    if (changed) {
        savePluginOriginRecords(records);
    }
}

/** 卸载全部插件时同步清理逻辑分组关系。 */
export function clearPluginOriginRecords() {
    savePluginOriginRecords({});
}

export function usePluginOriginRecords(): IPluginOriginRecord[] {
    const records = useAtomValue(pluginOriginAtom);
    return useMemo(
        () => Object.values(records).filter(isOriginRecordActive),
        [records],
    );
}

export function buildPluginOriginGroups(
    plugins: IPluginLike[],
    originRecords: IPluginOriginRecord[],
    subscriptions: Array<{ id: string; name: string }> = [],
    subscriptionPlugins: Array<{
        pluginHash: string;
        subscriptionId: string;
        installedAt?: number;
    }> = [],
): IPluginOriginGroup[] {
    const recordsByHash = new Map<string, IPluginOriginRecord>();
    originRecords.forEach(record => {
        const oldRecord = recordsByHash.get(record.pluginHash);
        if (!oldRecord || record.updatedAt > oldRecord.updatedAt) {
            recordsByHash.set(record.pluginHash, record);
        }
    });

    const subscriptionByHash = new Map<string, {
        subscriptionId: string;
        installedAt?: number;
    }>();
    subscriptionPlugins.forEach(record => {
        const oldRecord = subscriptionByHash.get(record.pluginHash);
        if (!oldRecord ||
            (record.installedAt ?? 0) >= (oldRecord.installedAt ?? 0)) {
            subscriptionByHash.set(record.pluginHash, record);
        }
    });

    const groups = new Map<string, IPluginOriginGroup>();
    const ensureGroup = (
        originType: PluginOriginType,
        originId: string,
        originName?: string,
    ): IPluginOriginGroup => {
        const key = `${originType}:${originId}`;
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                originType,
                originId,
                originName,
                plugins: [],
                pluginCount: 0,
            };
            groups.set(key, group);
        }
        if (originName) {
            group.originName = originName;
        }
        return group;
    };

    plugins.forEach(plugin => {
        const record = recordsByHash.get(plugin.hash);
        let originType = PluginOriginType.Network;
        let originId = NETWORK_PLUGIN_ORIGIN_ID;
        let originName: string | undefined;
        let changedAt = record?.updatedAt;

        const subscriptionRecord = subscriptionByHash.get(plugin.hash);
        if (record) {
            originType = record.originType;
            originId = record.originId;
            originName = record.originName;
        } else if (subscriptionRecord) {
            // R5 历史订阅记录没有 origin 记录时，启动后仍按订阅分组。
            originType = PluginOriginType.Subscription;
            originId = subscriptionRecord.subscriptionId;
            changedAt = subscriptionRecord.installedAt;
        }

        if (originType === PluginOriginType.Subscription) {
            const subscription = subscriptions.find(it => it.id === originId);
            originName = subscription?.name ?? originName ?? originId;
        }

        const group = ensureGroup(originType, originId, originName);
        group.plugins.push(plugin);
        group.pluginCount += 1;
        group.latestChangedAt = [group.latestChangedAt, changedAt]
            .filter((it): it is number => typeof it === "number")
            .sort((a, b) => b - a)[0];
    });

    // 添加但尚未拉取成功的订阅也要出现在来源列表中。
    subscriptions.forEach(subscription => {
        ensureGroup(
            PluginOriginType.Subscription,
            subscription.id,
            subscription.name,
        );
    });

    return [...groups.values()];
}
