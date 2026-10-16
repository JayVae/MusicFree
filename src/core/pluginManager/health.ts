import Network from "@/utils/network";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { atomFamily } from "jotai/utils";

export enum PluginHealthStatus {
    Available = "available",
    Quarantined = "quarantined",
    UserInvalid = "user-invalid",
    Archived = "archived",
}

export enum PluginHealthErrorCategory {
    /** 插件本身或插件适配的平台接口异常 */
    Plugin = "plugin",
    /** 设备离线、DNS / TLS / 代理等全局网络问题 */
    GlobalNetwork = "global-network",
    Unknown = "unknown",
}

export interface IPluginHealthRecord {
    status: PluginHealthStatus;
    /** 连续插件级失败次数 */
    consecutiveFailures: number;
    /** 最后一次插件级失败原因 */
    reason?: string;
    /** 最后一次插件级失败时间 */
    failedAt?: number;
    /** 最后一次成功时间 */
    lastSuccessAt?: number;
    /** 产生记录时的插件内容 hash */
    pluginHash?: string;
}

export const PLUGIN_HEALTH_FAILURE_THRESHOLD = 5;

const pluginHealthStore = getOrCreateMMKV("plugin.health");

function loadHealthRecords(): Record<string, IPluginHealthRecord> {
    return safeParse<Record<string, IPluginHealthRecord>>(
        pluginHealthStore.getString("records"),
    ) ?? {};
}

const pluginHealthAtom = atom<Record<string, IPluginHealthRecord>>(
    loadHealthRecords(),
);

const nullPluginHealthAtom = atom<IPluginHealthRecord | null>(null);

const pluginHealthAtomFamily = atomFamily((pluginName: string) =>
    atom(get => get(pluginHealthAtom)[pluginName] ?? null)
);

function saveHealthRecords(records: Record<string, IPluginHealthRecord>) {
    pluginHealthStore.set("records", safeStringify(records));
    getDefaultStore().set(pluginHealthAtom, records);
}

function getHealthRecords() {
    return getDefaultStore().get(pluginHealthAtom);
}

function normalizeHealthKey(pluginName?: string | null) {
    return pluginName?.trim();
}

/** 应用启动时只恢复自动临时不可用，用户状态保持不变。 */
export function preparePluginHealthForLaunch() {
    const records = loadHealthRecords();
    let changed = false;

    Object.keys(records).forEach(pluginName => {
        if (records[pluginName].status === PluginHealthStatus.Quarantined) {
            delete records[pluginName];
            changed = true;
        }
    });

    if (changed) {
        saveHealthRecords(records);
    }
}

export function getPluginHealthStatus(
    pluginName?: string | null,
): PluginHealthStatus {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return PluginHealthStatus.Available;
    }

    return getHealthRecords()[key]?.status ?? PluginHealthStatus.Available;
}

export function isPluginAvailableForService(pluginName?: string | null) {
    return getPluginHealthStatus(pluginName) === PluginHealthStatus.Available;
}

export function usePluginHealthRecords(): Record<string, IPluginHealthRecord> {
    return useAtomValue(pluginHealthAtom);
}

export function usePluginHealth(pluginName?: string | null): IPluginHealthRecord | null {
    const key = normalizeHealthKey(pluginName);
    return useAtomValue(
        key ? pluginHealthAtomFamily(key) : nullPluginHealthAtom,
    );
}

/** 清空连续失败计数；不覆盖用户手动维护的状态。 */
export function recordPluginSuccess(pluginName?: string | null, pluginHash?: string) {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return;
    }

    const records = { ...getHealthRecords() };
    const record = records[key];
    if (!record) {
        return;
    }

    if (
        record.status === PluginHealthStatus.UserInvalid ||
        record.status === PluginHealthStatus.Archived
    ) {
        return;
    }

    if (
        record.status === PluginHealthStatus.Available &&
        record.consecutiveFailures === 0
    ) {
        return;
    }

    records[key] = {
        status: PluginHealthStatus.Available,
        consecutiveFailures: 0,
        lastSuccessAt: Date.now(),
        pluginHash,
    };
    saveHealthRecords(records);
}

/** 只统计插件级失败；调用方应先用 getPluginFailureCategory 过滤全局网络错误。 */
export function recordPluginFailure(
    pluginName?: string | null,
    pluginHash?: string,
    reason?: string,
) {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return;
    }

    const records = { ...getHealthRecords() };
    const record = records[key];
    if (
        record?.status === PluginHealthStatus.UserInvalid ||
        record?.status === PluginHealthStatus.Archived
    ) {
        return;
    }

    const consecutiveFailures =
        record?.status === PluginHealthStatus.Quarantined
            ? record.consecutiveFailures + 1
            : (record?.consecutiveFailures ?? 0) + 1;

    const nextRecord: IPluginHealthRecord = {
        status:
            consecutiveFailures >= PLUGIN_HEALTH_FAILURE_THRESHOLD
                ? PluginHealthStatus.Quarantined
                : PluginHealthStatus.Available,
        consecutiveFailures,
        reason: reason?.slice(0, 500),
        failedAt: Date.now(),
        pluginHash,
    };
    records[key] = nextRecord;
    saveHealthRecords(records);
}

/** 卸载插件时清理其健康状态，避免同名新插件继承旧状态。 */
export function removePluginHealth(pluginName?: string | null) {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return;
    }

    const records = { ...getHealthRecords() };
    if (!records[key]) {
        return;
    }
    delete records[key];
    saveHealthRecords(records);
}

/** 卸载全部插件时清空自动健康状态。 */
export function clearAllPluginHealth() {
    saveHealthRecords({});
}

/** 可用性测试双探测失败时立即进入既有临时不可用状态。 */
export function markPluginQuarantined(
    pluginName?: string | null,
    pluginHash?: string,
    reason?: string,
) {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return;
    }

    const records = { ...getHealthRecords() };
    records[key] = {
        status: PluginHealthStatus.Quarantined,
        consecutiveFailures: (records[key]?.consecutiveFailures ?? 0) + 1,
        reason: reason?.slice(0, 500) ?? "availability-test-failed",
        failedAt: Date.now(),
        pluginHash,
    };
    saveHealthRecords(records);
}

/** 用户手动把插件标记为失效。 */
export function markPluginInvalid(pluginName?: string | null, pluginHash?: string) {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return;
    }

    const records = { ...getHealthRecords() };
    records[key] = {
        status: PluginHealthStatus.UserInvalid,
        consecutiveFailures: 0,
        reason: "user-marked-invalid",
        failedAt: Date.now(),
        pluginHash,
    };
    saveHealthRecords(records);
}

/** 用户手动归档插件，例如低版本、重复或暂时不想参与服务的插件。 */
export function markPluginArchived(pluginName?: string | null, pluginHash?: string) {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return;
    }

    const records = { ...getHealthRecords() };
    records[key] = {
        status: PluginHealthStatus.Archived,
        consecutiveFailures: 0,
        reason: "user-archived",
        failedAt: Date.now(),
        pluginHash,
    };
    saveHealthRecords(records);
}

/** 用户手动恢复任何非正常状态。 */
export function restorePlugin(pluginName?: string | null, pluginHash?: string) {
    const key = normalizeHealthKey(pluginName);
    if (!key) {
        return;
    }

    const records = { ...getHealthRecords() };
    records[key] = {
        status: PluginHealthStatus.Available,
        consecutiveFailures: 0,
        lastSuccessAt: Date.now(),
        pluginHash,
    };
    saveHealthRecords(records);
}

const globalNetworkErrorPatterns = [
    "network request failed",
    "unable to resolve host",
    "no address associated with hostname",
    "econnaborted",
    "econnrefused",
    "econnreset",
    "ehostunreach",
    "enetunreach",
    "err_internet_disconnected",
    "err_connection",
    "err_name_not_resolved",
    "err_tls",
    "err_ssl",
    "certificate",
    "timeout",
];

/** 全局网络问题不应计入插件失效；插件自身接口异常仍会计数。 */
export function getPluginFailureCategory(error?: any): PluginHealthErrorCategory {
    if (Network.isOffline) {
        return PluginHealthErrorCategory.GlobalNetwork;
    }

    const message = `${error?.message ?? error?.code ?? error ?? ""}`.toLowerCase();
    if (message && globalNetworkErrorPatterns.some(pattern => message.includes(pattern))) {
        return PluginHealthErrorCategory.GlobalNetwork;
    }

    const statusCode = error?.response?.status ?? error?.status;
    if (typeof statusCode === "number" && statusCode >= 500 && statusCode < 600) {
        return PluginHealthErrorCategory.Plugin;
    }

    return PluginHealthErrorCategory.Plugin;
}

function recordFailureIfPluginLevel(
    pluginName: string | undefined,
    pluginHash: string | undefined,
    error: any,
) {
    const category = getPluginFailureCategory(error);
    if (category !== PluginHealthErrorCategory.GlobalNetwork) {
        recordPluginFailure(
            pluginName,
            pluginHash,
            error?.message ?? String(error ?? "plugin error"),
        );
    }
}

/** 供 PluginMethodsWrapper 内部使用。 */
export function reportPluginMethodSuccess(
    pluginName?: string,
    pluginHash?: string,
) {
    recordPluginSuccess(pluginName, pluginHash);
}

/** 供 PluginMethodsWrapper 内部使用。 */
export function reportPluginMethodError(
    pluginName: string | undefined,
    pluginHash: string | undefined,
    error: any,
) {
    recordFailureIfPluginLevel(pluginName, pluginHash, error);
}
