import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { atom, getDefaultStore, useAtomValue } from "jotai";

/** R7：会话内展示的临时来源，不写入任何媒体项或歌单元数据。 */
const temporarySourcePluginNameAtom = atom<string | null>(null);

interface IPlaylistSourcePreferenceRecord {
    pluginName: string;
    updatedAt: number;
}

const playlistSourcePreferenceStore = getOrCreateMMKV(
    "playlist-source.preference",
);

function getPlaylistSourcePreferenceKey(sheetId?: string | null, platform?: string | null) {
    if (!sheetId || !platform) {
        return null;
    }
    return `${sheetId}::${platform}`;
}

function getPreferences(): Record<string, IPlaylistSourcePreferenceRecord> {
    return safeParse<Record<string, IPlaylistSourcePreferenceRecord>>(
        playlistSourcePreferenceStore.getString("preferences"),
    ) ?? {};
}

export function getPlaylistSourcePreference(
    sheetId?: string | null,
    platform?: string | null,
): IPlaylistSourcePreferenceRecord | null {
    const key = getPlaylistSourcePreferenceKey(sheetId, platform);
    if (!key) {
        return null;
    }
    return getPreferences()[key] ?? null;
}

export function recordPlaylistSourceSuccess(
    sheetId: string | undefined | null,
    platform: string | undefined | null,
    pluginName: string,
) {
    const key = getPlaylistSourcePreferenceKey(sheetId, platform);
    if (!key) {
        return;
    }
    const preferences = getPreferences();
    preferences[key] = {
        pluginName,
        updatedAt: Date.now(),
    };
    playlistSourcePreferenceStore.set("preferences", safeStringify(preferences));
}

export function clearPlaylistSourcePreference(
    sheetId: string | undefined | null,
    platform: string | undefined | null,
    expectedPluginName?: string,
) {
    const key = getPlaylistSourcePreferenceKey(sheetId, platform);
    if (!key) {
        return;
    }
    const preferences = getPreferences();
    if (expectedPluginName && preferences[key]?.pluginName !== expectedPluginName) {
        return;
    }
    delete preferences[key];
    playlistSourcePreferenceStore.set("preferences", safeStringify(preferences));
}

export function setTemporarySourcePluginName(pluginName?: string | null) {
    getDefaultStore().set(temporarySourcePluginNameAtom, pluginName || null);
}

export function useTemporarySourcePluginName() {
    return useAtomValue(temporarySourcePluginNameAtom);
}

/**
 * R7：搜索连续为空的插件只在换源候选中临时抑制。
 * 内存态在应用启动时自然恢复；非空搜索结果立即恢复。
 */
const EMPTY_SEARCH_SUPPRESSION_THRESHOLD = 2;
const emptySearchCounts = new Map<string, number>();

export function isPluginSuppressedByEmptySearch(pluginName: string) {
    return (emptySearchCounts.get(pluginName) ?? 0) >=
        EMPTY_SEARCH_SUPPRESSION_THRESHOLD;
}

export function recordEmptySearchResult(pluginName: string) {
    emptySearchCounts.set(pluginName, (emptySearchCounts.get(pluginName) ?? 0) + 1);
}

export function recordNonEmptySearchResult(pluginName: string) {
    emptySearchCounts.delete(pluginName);
}
