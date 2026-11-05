import {
    internalSerializeKey,
    SortType,
} from "@/constants/commonConst";
import { getQualityOrder } from "@/utils/qualities";
import {
    getMediaUniqueKey,
    getLocalPath,
} from "@/utils/mediaUtils";
import {
    getMediaExtraProperty,
    patchMediaExtra,
} from "@/utils/mediaExtra";
import PersistStatus from "@/utils/persistStatus";
import MusicSheet from "@/core/musicSheet";
import musicHistory from "@/core/musicHistory";
import LocalMusicSheet from "@/core/localMusicSheet";
import { replaceDownloadHistoryMusicItems } from "@/core/downloadHistory";
import { PluginState } from "@/core/pluginManager/plugin";
import {
    isStrictMusicMatch,
    normalizeDurationSeconds,
} from "@/core/mediaSourceResolver";
import {
    getPluginHealthStatus,
    PluginHealthStatus,
} from "@/core/pluginManager/health";
import type { IPluginManager } from "@/types/core/pluginManager";
import type { Plugin } from "@/core/pluginManager/plugin";
import type { IAppConfig } from "@/types/core/config";

export enum SourceMigrationStatus {
    Pending = "pending",
    Success = "success",
    Fail = "fail",
    Skip = "skip",
}

export interface ISourceMigrationState {
    original: IMusic.IMusicItem;
    replacement?: IMusic.IMusicItem;
    status: SourceMigrationStatus;
    reason?: "no-match" | "no-source" | "target-unavailable" | "canceled";
}

export type SourceMigrationScope =
    | { type: "sheet"; sheetId: string }
    | { type: "all" };

function canMigrateWithPlugin(plugin?: Plugin | null): plugin is Plugin {
    if (!plugin || plugin.state === PluginState.Error) {
        return false;
    }
    const healthStatus = getPluginHealthStatus(plugin.name);
    return (
        healthStatus === PluginHealthStatus.Available ||
        healthStatus === PluginHealthStatus.Quarantined
    ) &&
        plugin.supportedMethods.has("search") &&
        plugin.supportedMethods.has("getMediaSource");
}

/**
 * 显式迁移目标必须支持搜索和取源。
 * quarantined 插件允许作为目标，成功搜索/取源后会由健康状态机恢复。
 */
export function getSourceMigrationTargetPlugins(
    pluginManager: IPluginManager,
) {
    return pluginManager.getSortedPlugins().filter(plugin =>
        pluginManager.isPluginEnabled(plugin) &&
        canMigrateWithPlugin(plugin)
    );
}

function getDurationDistance(
    candidate: IMusic.IMusicItem,
    target: IMusic.IMusicItem,
) {
    const candidateDuration = normalizeDurationSeconds(candidate.duration);
    const targetDuration = normalizeDurationSeconds(target.duration);
    if (!candidateDuration || !targetDuration) {
        return Number.MAX_SAFE_INTEGER;
    }
    return Math.abs(candidateDuration - targetDuration);
}

function mergeMigratedMusicItem(
    original: IMusic.IMusicItemBase,
    candidate: IMusic.IMusicItem,
) {
    const localPath = getLocalPath(original);
    const migrated = {
        ...candidate,
        alias: candidate.alias || original.alias,
        album: candidate.album || original.album,
        artwork: candidate.artwork || original.artwork,
        lyric: candidate.lyric ?? original.lyric,
        lrc: candidate.lrc ?? original.lrc,
        rawLrc: candidate.rawLrc ?? original.rawLrc,
        $timestamp: original.$timestamp,
        $sortIndex: original.$sortIndex,
    } as IMusic.IMusicItem;

    if (localPath) {
        migrated[internalSerializeKey] = {
            ...(original[internalSerializeKey] ?? {}),
            localPath,
        };
    }

    patchMediaExtra(migrated, {
        ...(localPath ? {
            downloaded: true,
            localPath,
        } : {}),
        associatedLrc: getMediaExtraProperty(original, "associatedLrc") ?? undefined,
        lyricOffset: getMediaExtraProperty(original, "lyricOffset") ?? undefined,
    });

    return migrated;
}

export async function resolveReplacementMusicItem(options: {
    musicItem: IMusic.IMusicItem;
    plugin?: Plugin | null;
    config: IAppConfig;
}) {
    const { musicItem, plugin, config } = options;
    if (!canMigrateWithPlugin(plugin)) {
        return null;
    }
    let searchResult: IPlugin.ISearchResult<"music">;
    try {
        searchResult = await plugin.methods.search(
            musicItem.alias || musicItem.title,
            1,
            "music",
        );
    } catch {
        return null;
    }

    const candidates = ((searchResult?.data ?? []) as IMusic.IMusicItem[])
        .slice(0, 10)
        .filter(candidate => isStrictMusicMatch(candidate, musicItem, true))
        .sort((a, b) =>
            getDurationDistance(a, musicItem) -
            getDurationDistance(b, musicItem),
        );
    const qualityOrder = getQualityOrder(
        config.getConfig("basic.defaultPlayQuality") ?? "standard",
        config.getConfig("basic.playQualityOrder") ?? "asc",
    );

    for (const candidate of candidates) {
        for (const quality of qualityOrder) {
            try {
                const source = await plugin.methods.getMediaSource(
                    candidate,
                    quality,
                );
                if (source?.url) {
                    return {
                        musicItem: mergeMigratedMusicItem(musicItem, candidate),
                        source,
                        quality,
                        pluginName: plugin.name,
                    };
                }
            } catch {
                // 单个候选失败不影响后续严格匹配候选。
            }
        }
    }

    return null;
}

export async function migrateMusicItems(options: {
    musicItems: IMusic.IMusicItem[];
    targetPlugin?: Plugin;
    config: IAppConfig;
    shouldAbort?: () => boolean;
    onItemUpdate?: (state: ISourceMigrationState) => void;
}) {
    const {
        musicItems,
        targetPlugin,
        config,
        shouldAbort,
        onItemUpdate,
    } = options;
    const states: ISourceMigrationState[] = musicItems.map(musicItem => ({
        original: musicItem,
        status: SourceMigrationStatus.Pending,
    }));
    const update = (index: number, state: Partial<ISourceMigrationState>) => {
        states[index] = { ...states[index], ...state };
        onItemUpdate?.(states[index]);
    };

    if (!canMigrateWithPlugin(targetPlugin)) {
        states.forEach((_, index) =>
            update(index, {
                status: SourceMigrationStatus.Skip,
                reason: "target-unavailable",
            }),
        );
        return states;
    }

    for (let index = 0; index < states.length; index++) {
        if (shouldAbort?.()) {
            update(index, {
                status: SourceMigrationStatus.Skip,
                reason: "canceled",
            });
            continue;
        }

        const resolution = await resolveReplacementMusicItem({
            musicItem: states[index].original,
            plugin: targetPlugin,
            config,
        });
        update(
            index,
            resolution
                ? {
                    replacement: resolution.musicItem,
                    status: SourceMigrationStatus.Success,
                }
                : {
                    status: SourceMigrationStatus.Fail,
                    reason: "no-match",
                },
        );
    }

    return states;
}

function replacePersistedPlaybackMusic(
    replacements: Map<string, IMusic.IMusicItem>,
) {
    const playList = PersistStatus.get("music.playList");
    if (playList?.length) {
        const nextPlayList = playList
            .map(item => replacements.get(getMediaUniqueKey(item)) ?? item)
            .filter((item, index, items) =>
                items.findIndex(candidate =>
                    getMediaUniqueKey(candidate) === getMediaUniqueKey(item)
                ) === index
            );
        PersistStatus.set("music.playList", nextPlayList);
    }

    const currentMusic = PersistStatus.get("music.musicItem");
    if (currentMusic) {
        PersistStatus.set(
            "music.musicItem",
            replacements.get(getMediaUniqueKey(currentMusic)) ?? currentMusic,
        );
    }
}

function replaceMusicItemsInList(
    musicItems: IMusic.IMusicItem[],
    replacements: Map<string, IMusic.IMusicItem>,
) {
    const nextMusicItems: IMusic.IMusicItem[] = [];
    const existingKeys = new Set<string>();
    let changedCount = 0;

    musicItems.forEach(musicItem => {
        const replacement = replacements.get(getMediaUniqueKey(musicItem));
        const nextMusicItem = replacement
            ? {
                ...replacement,
                $timestamp: replacement.$timestamp ?? musicItem.$timestamp,
                $sortIndex: replacement.$sortIndex ?? musicItem.$sortIndex,
            }
            : musicItem;
        const nextKey = getMediaUniqueKey(nextMusicItem);
        if (existingKeys.has(nextKey)) {
            changedCount++;
            return;
        }
        existingKeys.add(nextKey);
        nextMusicItems.push(nextMusicItem);
        if (replacement) {
            changedCount++;
        }
    });

    return {
        changedCount,
        musicItems: nextMusicItems,
    };
}

async function replacePlaylistMusicItems(
    replacements: Map<string, IMusic.IMusicItem>,
    sheetId?: string,
) {
    const targetSheets = MusicSheet.backupSheets().filter(sheet =>
        !sheetId || sheet.id === sheetId
    );
    let changedCount = 0;

    for (const sheet of targetSheets) {
        const replacedItems = (sheet.musicList ?? []).filter(musicItem =>
            replacements.has(getMediaUniqueKey(musicItem))
        );
        const result = replaceMusicItemsInList(
            sheet.musicList ?? [],
            replacements,
        );
        if (!result.changedCount) {
            continue;
        }
        const sortType = MusicSheet.getSheetMeta(sheet.id, "sort");
        await MusicSheet.removeMusic(sheet.id, replacedItems);
        await MusicSheet.addMusic(
            sheet.id,
            replacedItems.map(musicItem =>
                replacements.get(getMediaUniqueKey(musicItem))!
            ),
        );
        await MusicSheet.manualSort(sheet.id, result.musicItems);
        if (sortType) {
            await MusicSheet.setSortType(sheet.id, sortType as SortType);
        }
        changedCount += result.changedCount;
    }

    return changedCount;
}

export async function replaceMusicMetadataEverywhere(
    replacements: Map<string, IMusic.IMusicItem>,
) {
    if (!replacements.size) {
        return 0;
    }

    const playlistCount = await replacePlaylistMusicItems(replacements);
    const historyResult = replaceMusicItemsInList(
        musicHistory.history,
        replacements,
    );
    if (historyResult.changedCount) {
        await musicHistory.setHistory(historyResult.musicItems);
    }
    const localResult = replaceMusicItemsInList(
        LocalMusicSheet.getMusicList(),
        replacements,
    );
    if (localResult.changedCount) {
        await LocalMusicSheet.updateMusicList(localResult.musicItems);
    }
    const downloadCount = replaceDownloadHistoryMusicItems(replacements);
    replacePersistedPlaybackMusic(replacements);

    return playlistCount +
        historyResult.changedCount +
        localResult.changedCount +
        downloadCount;
}

export async function persistResolvedMusicReplacement(
    original: IMusic.IMusicItemBase,
    candidate: IMusic.IMusicItem,
) {
    return replaceMusicMetadataEverywhere(new Map([[
        getMediaUniqueKey(original),
        mergeMigratedMusicItem(original, candidate),
    ]]));
}

export async function applySourceMigrationResults(
    states: ISourceMigrationState[],
    scope: SourceMigrationScope,
) {
    const replacements = new Map<string, IMusic.IMusicItem>();
    states.forEach(state => {
        if (
            state.status === SourceMigrationStatus.Success &&
            state.replacement
        ) {
            replacements.set(
                getMediaUniqueKey(state.original),
                state.replacement,
            );
        }
    });
    if (!replacements.size) {
        return 0;
    }

    if (scope.type === "sheet") {
        return replacePlaylistMusicItems(replacements, scope.sheetId);
    }
    return replaceMusicMetadataEverywhere(replacements);
}
