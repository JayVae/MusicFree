import { getQualityOrder } from "@/utils/qualities";
import { isSameMediaItem, getLocalPath } from "@/utils/mediaUtils";
import { trace } from "@/utils/log";
import { isPluginAvailableForService } from "./pluginManager/health";
import {
    clearPlaylistSourcePreference,
    getPlaylistSourcePreference,
    recordPlaylistSourceSuccess,
} from "./playbackSource";
import {
    IMediaSourceResolverOptions,
    MediaSourceFallbackResolver,
    PLAY_SOURCE_FALLBACK_TIMEOUT_MS,
} from "./mediaSourceResolver";
import type { IAppConfig } from "@/types/core/config";
import type { IPluginManager } from "@/types/core/pluginManager";
import type { Plugin } from "./pluginManager/plugin";

export enum BatchSourceStatus {
    Pending = "pending",
    Success = "success",
    Fail = "fail",
    Skip = "skip",
}

export interface IBatchSourceItemState {
    musicItem: IMusic.IMusicItem;
    status: BatchSourceStatus;
    pluginName?: string;
    reason?: "current" | "invalid-target" | "timeout";
}

function hasValidUrl(source?: { url?: unknown } | null) {
    return typeof source?.url === "string" && source.url.trim().length > 0;
}

function isExpired(deadline: number) {
    return Date.now() >= deadline;
}

async function hasOriginalValidSource(
    musicItem: IMusic.IMusicItem,
    pluginManager: IPluginManager,
    config: IAppConfig,
) {
    if (getLocalPath(musicItem) || hasValidUrl(musicItem)) {
        return true;
    }
    if (musicItem.source && Object.values(musicItem.source).some(hasValidUrl)) {
        return true;
    }

    const plugin = pluginManager.getByName(musicItem.platform);
    if (!plugin?.methods?.getMediaSource || !isPluginAvailableForService(plugin.name)) {
        return false;
    }
    const qualityOrder = getQualityOrder(
        config.getConfig("basic.defaultPlayQuality") ?? "standard",
        config.getConfig("basic.playQualityOrder") ?? "asc",
    );
    const deadline = Date.now() + PLAY_SOURCE_FALLBACK_TIMEOUT_MS;
    for (const quality of qualityOrder) {
        try {
            const source = await plugin.methods.getMediaSource(musicItem, quality);
            if (hasValidUrl(source)) {
                return true;
            }
        } catch {
            // 原插件失败是批量换源要处理的输入，不在这里写入插件健康状态之外的结果。
        }
        if (isExpired(deadline)) {
            return false;
        }
    }
    return false;
}

/** R7 歌单批量换源第一步：筛选预计需要临时换源的歌曲。 */
export async function findBatchSourceCandidates(options: {
    musicItems: IMusic.IMusicItem[];
    pluginManagerService: IPluginManager;
    configService: IAppConfig;
    onProgress?: (affectedCount: number, checkedCount: number) => void;
    shouldAbort?: () => boolean;
}) {
    const {
        musicItems,
        pluginManagerService,
        configService,
        onProgress,
        shouldAbort,
    } = options;
    const affected: IMusic.IMusicItem[] = [];
    for (let index = 0; index < musicItems.length; ++index) {
        if (shouldAbort?.()) {
            break;
        }
        const musicItem = musicItems[index];
        const valid = await hasOriginalValidSource(
            musicItem,
            pluginManagerService,
            configService,
        );
        if (!valid) {
            affected.push(musicItem);
        }
        onProgress?.(affected.length, index + 1);
    }
    trace("歌单批量换源筛选完成", {
        total: musicItems.length,
        affected: affected.length,
    });
    return affected;
}

/** R7 歌单批量换源第二步：串行解析临时音源。 */
export async function resolveBatchSources(options: {
    musicItems: IMusic.IMusicItem[];
    sheetId?: string;
    targetPluginName?: string;
    pluginManagerService: IPluginManager;
    configService: IAppConfig;
    currentMusic?: IMusic.IMusicItem | null;
    onItemUpdate?: (state: IBatchSourceItemState) => void;
    shouldAbort?: () => boolean;
}): Promise<IBatchSourceItemState[]> {
    const {
        musicItems,
        sheetId,
        targetPluginName,
        pluginManagerService,
        configService,
        currentMusic,
        onItemUpdate,
        shouldAbort,
    } = options;
    const states: IBatchSourceItemState[] = musicItems.map(musicItem => ({
        musicItem,
        status: BatchSourceStatus.Pending,
    }));
    const update = (index: number, nextState: Partial<IBatchSourceItemState>) => {
        states[index] = { ...states[index], ...nextState };
        onItemUpdate?.(states[index]);
    };

    for (let index = 0; index < states.length; ++index) {
        if (shouldAbort?.()) {
            update(index, {
                status: BatchSourceStatus.Skip,
                reason: "current",
            });
            continue;
        }
        const { musicItem } = states[index];
        if (currentMusic && isSameMediaItem(musicItem, currentMusic)) {
            update(index, {
                status: BatchSourceStatus.Skip,
                reason: "current",
            });
            continue;
        }

        const preferredPluginName = targetPluginName ||
            getPlaylistSourcePreference(sheetId, musicItem.platform)?.pluginName;
        if (
            preferredPluginName &&
            !pluginManagerService.getByName(preferredPluginName)
        ) {
            clearPlaylistSourcePreference(
                sheetId,
                musicItem.platform,
                preferredPluginName,
            );
            update(index, {
                status: BatchSourceStatus.Fail,
                reason: "invalid-target",
            });
            continue;
        }

        const resolverOptions: IMediaSourceResolverOptions = {
            sheetId,
            preferredPluginName,
            preferredOnly: !!targetPluginName,
            onResolved: resolved =>
                recordPlaylistSourceSuccess(
                    sheetId,
                    musicItem.platform,
                    resolved.resolvedByPluginName,
                ),
            onPreferredPluginFailure: pluginName =>
                clearPlaylistSourcePreference(
                    sheetId,
                    musicItem.platform,
                    pluginName,
                ),
        };
        const resolver = new MediaSourceFallbackResolver(
            musicItem,
            pluginManagerService,
            configService,
            resolverOptions,
        );
        const resolved = await resolver.resolveNext(shouldAbort);
        update(
            index,
            resolved
                ? {
                    status: BatchSourceStatus.Success,
                    pluginName: resolved.resolvedByPluginName,
                }
                : {
                    status: BatchSourceStatus.Fail,
                    reason: resolver.getAttemptSummary().expired
                        ? "timeout"
                        : undefined,
                },
        );
    }

    return states;
}

/** 可作为明确批量目标的插件必须同时具备搜索和取源能力。 */
export function getBatchSourceTargetPlugins(pluginManager: IPluginManager): Plugin[] {
    return pluginManager
        .getSortedSearchablePlugins("music")
        .filter(
            plugin =>
                plugin.methods?.getMediaSource &&
                pluginManager.isPluginEnabled(plugin) &&
                isPluginAvailableForService(plugin.name),
        );
}
