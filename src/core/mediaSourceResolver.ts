import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { getQualityOrder } from "@/utils/qualities";
import { isPluginAvailableForService } from "./pluginManager/health";
import type { IPluginManager } from "@/types/core/pluginManager";
import type { IAppConfig } from "@/types/core/config";
import type { Plugin } from "./pluginManager/plugin";
import { trace } from "@/utils/log";

/** R1/R2 内置保守值：最多 5 个可用候选插件，总预算 15 秒。 */
export const PLAY_SOURCE_FALLBACK_MAX_CANDIDATES = 5;
export const PLAY_SOURCE_FALLBACK_TIMEOUT_MS = 15_000;
const PLAY_SOURCE_FALLBACK_DURATION_TOLERANCE_MS = 3_000;

export interface IResolvedFallbackSource {
    source: IPlugin.IMediaSourceResult;
    /** 匹配到的候选歌曲；该信息只用于排查，不写入播放队列元数据。 */
    candidateMusicItem: IMusic.IMusicItemBase;
    resolvedByPluginName: string;
    sourceIdentity: {
        platform: string;
        id: string;
    };
    resolvedAt: number;
}

interface IFallbackCacheEntry {
    source: IPlugin.IMediaSourceResult;
    candidateMusicItem: IMusic.IMusicItemBase;
    resolvedByPluginName: string;
    resolvedAt: number;
}

const fallbackCacheStore = getOrCreateMMKV("media-source.fallback");

export function getMediaSourceFallbackCacheKey(musicItem?: IMusic.IMusicItemBase | null) {
    if (!musicItem?.platform || !musicItem?.id) {
        return null;
    }
    return `${musicItem.platform}::${musicItem.id}`;
}

export function getMediaSourceFallbackCache(
    musicItem?: IMusic.IMusicItemBase | null,
): IResolvedFallbackSource | null {
    const key = getMediaSourceFallbackCacheKey(musicItem);
    if (!key) {
        return null;
    }

    const cached = safeParse<IFallbackCacheEntry | null>(
        fallbackCacheStore.getString(key),
    );
    if (!cached?.source?.url || !cached.candidateMusicItem) {
        return null;
    }

    return {
        source: cached.source,
        candidateMusicItem: cached.candidateMusicItem,
        resolvedByPluginName: cached.resolvedByPluginName,
        sourceIdentity: {
            platform: cached.candidateMusicItem.platform,
            id: cached.candidateMusicItem.id,
        },
        resolvedAt: cached.resolvedAt,
    };
}

function setMediaSourceFallbackCache(entry: IResolvedFallbackSource) {
    const key = getMediaSourceFallbackCacheKey(entry.sourceIdentity);
    if (!key) {
        return;
    }
    fallbackCacheStore.set(key, safeStringify({
        source: entry.source,
        candidateMusicItem: entry.candidateMusicItem,
        resolvedByPluginName: entry.resolvedByPluginName,
        resolvedAt: entry.resolvedAt,
    } satisfies IFallbackCacheEntry));
}

function removeMediaSourceFallbackCache(musicItem?: IMusic.IMusicItemBase | null) {
    const key = getMediaSourceFallbackCacheKey(musicItem);
    if (key) {
        fallbackCacheStore.delete(key);
    }
}

export function clearMediaSourceFallbackCache() {
    fallbackCacheStore.clearAll();
}

/** 标题 / 艺人规范化：统一全半角、大小写，并去掉空白与符号。 */
export function normalizeMediaMatchText(value?: string | number | null) {
    return `${value ?? ""}`
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
}

export function isDurationMatch(
    sourceDuration?: string | number | null,
    targetDuration?: string | number | null,
) {
    const source = Number(sourceDuration);
    const target = Number(targetDuration);
    if (!Number.isFinite(source) || !Number.isFinite(target) || source <= 0 || target <= 0) {
        return false;
    }
    return Math.abs(source - target) <= PLAY_SOURCE_FALLBACK_DURATION_TOLERANCE_MS;
}

/**
 * R1/R2 集中换源解析器。
 * 一个实例只服务一首歌；底层播放失败后可以继续取下一个候选。
 */
export class MediaSourceFallbackResolver {
    private readonly musicItem: IMusic.IMusicItemBase;
    private readonly pluginManagerService: IPluginManager;
    private readonly configService: IAppConfig;
    private readonly qualityOrder: IMusic.IQualityKey[];

    private candidatePlugins: Plugin[] | null = null;
    private candidateIndex = 0;
    private attemptedPluginNames = new Set<string>();
    private failedSourceUrls = new Set<string>();
    private deadline: number | null = null;

    private candidatePluginNames: string[] = [];

    constructor(
        musicItem: IMusic.IMusicItemBase,
        pluginManager: IPluginManager,
        config: IAppConfig,
    ) {
        this.musicItem = musicItem;
        this.pluginManagerService = pluginManager;
        this.configService = config;
        this.qualityOrder = getQualityOrder(
            config.getConfig("basic.defaultPlayQuality") ?? "standard",
            config.getConfig("basic.playQualityOrder") ?? "asc",
        );
    }

    /**
     * 底层播放失败或源失效时记录 URL。
     * 返回 false 表示同一 URL 已处理过，避免播放器重复抛出旧错误时浪费候选。
     */
    reportFailedSource(url?: string | null): boolean {
        if (!this.deadline) {
            this.deadline = Date.now() + PLAY_SOURCE_FALLBACK_TIMEOUT_MS;
        }
        if (!url || this.failedSourceUrls.has(url)) {
            return false;
        }
        this.failedSourceUrls.add(url);
        const cache = getMediaSourceFallbackCache(this.musicItem);
        if (cache?.source.url === url) {
            removeMediaSourceFallbackCache(this.musicItem);
        }
        return true;
    }

    /**
     * 按插件顺序获取下一个可用音源。
     * 原插件自身解析不在此处，避免和播放主流程重复。
     */
    async resolveNext(abortFunction?: () => boolean): Promise<IResolvedFallbackSource | null> {
        if (!this.deadline) {
            this.deadline = Date.now() + PLAY_SOURCE_FALLBACK_TIMEOUT_MS;
        }

        if (this.isExpired() || abortFunction?.()) {
            return null;
        }

        const cached = getMediaSourceFallbackCache(this.musicItem);
        if (cached?.source.url && !this.failedSourceUrls.has(cached.source.url)) {
            return cached;
        }

        if (!this.candidatePlugins) {
            this.candidatePlugins = this.getOrderedCandidatePlugins();
            trace("换源候选列表", {
                target: this.musicItem,
                candidates: this.candidatePluginNames,
            });
        }

        while (
            this.candidateIndex < this.candidatePlugins.length &&
            this.attemptedPluginNames.size < PLAY_SOURCE_FALLBACK_MAX_CANDIDATES &&
            !this.isExpired() &&
            !abortFunction?.()
        ) {
            const plugin = this.candidatePlugins[this.candidateIndex++];
            if (!plugin || this.attemptedPluginNames.has(plugin.name)) {
                continue;
            }
            this.attemptedPluginNames.add(plugin.name);
            trace("尝试换源候选", {
                target: this.musicItem,
                plugin: plugin.name,
                attempted: [...this.attemptedPluginNames],
                remainingTimeMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
            });

            try {
                const results = await plugin.methods.search(
                    this.musicItem.alias || this.musicItem.title,
                    1,
                    "music",
                );
                if (this.isExpired() || abortFunction?.()) {
                    return null;
                }

                const matchedItems = (results?.data ?? [])
                    .slice(0, 10)
                    .filter(item => this.isStrictMatch(item));

                trace("换源候选搜索完成", {
                    plugin: plugin.name,
                    resultCount: results?.data?.length ?? 0,
                    matchedCount: matchedItems.length,
                });

                for (const matchedItem of matchedItems) {
                    trace("换源候选匹配成功", {
                        strict: this.configService.getConfig("basic.playSourceFallbackStrictMatch") ?? true,
                        plugin: plugin.name,
                        target: this.musicItem,
                        candidate: matchedItem,
                    });
                    const source = await this.getSourceFromPlugin(plugin, matchedItem);
                    if (!source?.url || this.failedSourceUrls.has(source.url)) {
                        trace("换源候选取源失败", {
                            plugin: plugin.name,
                            candidate: matchedItem,
                            duplicateSource: !!source?.url && this.failedSourceUrls.has(source.url),
                        });
                        continue;
                    }

                    const resolved: IResolvedFallbackSource = {
                        source: {
                            ...source,
                            quality: source.quality ?? this.qualityOrder[0],
                        },
                        candidateMusicItem: matchedItem,
                        resolvedByPluginName: plugin.name,
                        sourceIdentity: {
                            platform: matchedItem.platform,
                            id: matchedItem.id,
                        },
                        resolvedAt: Date.now(),
                    };
                    setMediaSourceFallbackCache(resolved);
                    trace("换源候选取源成功", resolved);
                    return resolved;
                }
            } catch (error) {
                trace("换源候选搜索失败", {
                    plugin: plugin.name,
                    error,
                });
                // 单个插件失败不阻断后续候选；插件健康统计由 PluginMethodsWrapper 记录。
            }
        }

        return null;
    }

    private isExpired() {
        return this.deadline !== null && Date.now() >= this.deadline;
    }

    /**
     * 候选顺序：原插件配置的替代插件优先，其余可用插件按现有全局排序。
     */
    private getOrderedCandidatePlugins(): Plugin[] {
        const originalPlugin = this.pluginManagerService.getByName(
            this.musicItem.platform,
        );
        const alternativePlugin = originalPlugin
            ? this.pluginManagerService.getAlternativePlugin(originalPlugin)
            : null;

        const orderedPlugins = [
            alternativePlugin,
            ...this.pluginManagerService.getSortedSearchablePlugins("music"),
        ];

        const uniquePlugins = new Map<string, Plugin>();
        for (const plugin of orderedPlugins) {
            if (!plugin || uniquePlugins.has(plugin.name)) {
                continue;
            }
            if (plugin.name === this.musicItem.platform) {
                continue;
            }
            if (!this.pluginManagerService.isPluginEnabled(plugin)) {
                continue;
            }
            if (!isPluginAvailableForService(plugin.name)) {
                continue;
            }
            if (!plugin.supportedMethods.has("search")) {
                continue;
            }
            uniquePlugins.set(plugin.name, plugin);
        }
        this.candidatePluginNames = [...uniquePlugins.keys()];
        return [...uniquePlugins.values()];
    }

    getAttemptSummary() {
        return {
            attempted: [...this.attemptedPluginNames],
            failedUrls: [...this.failedSourceUrls],
            expired: this.isExpired(),
            remainingTimeMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
        };
    }

    private isStrictMatch(item?: IMusic.IMusicItemBase | null): boolean {
        if (!item || item.platform === this.musicItem.platform) {
            return false;
        }
        if (!isDurationMatch(item.duration, this.musicItem.duration)) {
            return false;
        }

        // 总开关默认严格；关闭后仍不做编辑距离兜底，仅放宽文本要求。
        if (!(this.configService.getConfig("basic.playSourceFallbackStrictMatch") ?? true)) {
            return true;
        }

        const candidateTitle = normalizeMediaMatchText(item.title);
        const targetTitles = [
            normalizeMediaMatchText(this.musicItem.title),
            normalizeMediaMatchText(this.musicItem.alias),
        ].filter(Boolean);
        const candidateArtist = normalizeMediaMatchText(item.artist);
        const targetArtist = normalizeMediaMatchText(this.musicItem.artist);

        return targetTitles.includes(candidateTitle) &&
            candidateArtist.length > 0 &&
            candidateArtist === targetArtist;
    }

    private async getSourceFromPlugin(
        plugin: Plugin,
        musicItem: IMusic.IMusicItemBase,
    ) {
        for (const quality of this.qualityOrder) {
            if (this.isExpired()) {
                return null;
            }
            const source = await plugin.methods?.getMediaSource?.(
                musicItem,
                quality,
            );
            if (source?.url) {
                return {
                    ...source,
                    quality,
                };
            }
        }
        return null;
    }
}
