import { atom, getDefaultStore, useAtomValue } from "jotai";
import {
    getPluginHealthStatus,
    markPluginQuarantined,
    PluginHealthStatus,
    reportPluginMethodSuccess,
    restorePlugin,
} from "./pluginManager/health";
import { Plugin, PluginState } from "./pluginManager/plugin";

export const AVAILABILITY_PROBE_TIMEOUT_MS = 5000;
export const DEFAULT_AVAILABILITY_QUERY = "音乐";

export enum PluginAvailabilityStatus {
    Waiting = "waiting",
    Testing = "testing",
    Success = "success",
    Fail = "fail",
    Skipped = "skipped",
}

export interface IPluginAvailabilityTestState {
    pluginName: string;
    pluginHash: string;
    status: PluginAvailabilityStatus;
    searchPassed?: boolean;
    sourcePassed?: boolean;
}

const pluginAvailabilityAtom = atom<
    Record<string, IPluginAvailabilityTestState>
>({});

function setAvailabilityStates(
    states: Record<string, IPluginAvailabilityTestState>,
) {
    getDefaultStore().set(pluginAvailabilityAtom, states);
}

function updateAvailabilityState(state: IPluginAvailabilityTestState) {
    const currentStates = getDefaultStore().get(pluginAvailabilityAtom);
    setAvailabilityStates({
        ...currentStates,
        [state.pluginHash]: state,
    });
}

export function usePluginAvailabilityStates() {
    return useAtomValue(pluginAvailabilityAtom);
}

function withTimeout<T>(
    task: Promise<T>,
    timeoutMs = AVAILABILITY_PROBE_TIMEOUT_MS,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        task,
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error("availability-probe-timeout"));
            }, timeoutMs);
        }),
    ]).finally(() => {
        if (timer) {
            clearTimeout(timer);
        }
    });
}

function hasSearchResult(result?: { data?: unknown } | null) {
    return Array.isArray(result?.data) && result!.data!.length > 0;
}

function hasValidUrl(source?: { url?: unknown } | null) {
    return typeof source?.url === "string" && source.url.trim().length > 0;
}

function isTimeout(error?: unknown) {
    return `${(error as any)?.message ?? error ?? ""}`.includes(
        "availability-probe-timeout",
    );
}

/** 单个插件探测：搜索非空通过；用搜索第一首歌探测取源；任一通过即有效。 */
async function probePlugin(
    plugin: Plugin,
    keyword: string,
): Promise<{
    success: boolean;
    searchPassed: boolean;
    sourcePassed: boolean;
    timedOut: boolean;
}> {
    try {
        await withTimeout(plugin.ensureMounted());
        if (plugin.state !== PluginState.Mounted || !plugin.instance) {
            throw new Error("plugin-not-mounted");
        }

        let searchResult: IPlugin.ISearchResult<"music"> | undefined;
        try {
            if (typeof plugin.instance.search !== "function") {
                throw new Error("search-not-supported");
            }
            searchResult = await withTimeout(
                Promise.resolve(
                    plugin.instance.search(keyword, 1, "music"),
                ),
            );
        } catch (searchError) {
            if (isTimeout(searchError)) {
                throw searchError;
            }
            searchResult = undefined;
        }

        const searchPassed = hasSearchResult(searchResult);
        if (!searchResult?.data?.length) {
            return {
                success: false,
                searchPassed,
                sourcePassed: false,
                timedOut: false,
            };
        }

        if (searchPassed) {
            reportPluginMethodSuccess(plugin.name, plugin.hash);
        }

        const firstResult = {
            ...searchResult.data[0],
            platform: plugin.name,
        } as IMusic.IMusicItem;
        let sourceResult: IPlugin.IMediaSourceResult | null | undefined;
        try {
            if (typeof plugin.instance.getMediaSource !== "function") {
                throw new Error("getMediaSource-not-supported");
            }
            sourceResult = await withTimeout(
                Promise.resolve(
                    plugin.instance.getMediaSource(firstResult, "standard"),
                ),
            );
        } catch (sourceError) {
            if (isTimeout(sourceError)) {
                throw sourceError;
            }
            sourceResult = undefined;
        }

        const sourcePassed = hasValidUrl(sourceResult);
        if (sourcePassed) {
            reportPluginMethodSuccess(plugin.name, plugin.hash);
        }

        return {
            success: searchPassed || sourcePassed,
            searchPassed,
            sourcePassed,
            timedOut: false,
        };
    } catch (error) {
        return {
            success: false,
            searchPassed: false,
            sourcePassed: false,
            timedOut: isTimeout(error),
        };
    }
}

/** R9：串行测试勾选插件；不阻塞页面，可通过 shouldAbort 放弃剩余结果。 */
export async function runPluginAvailabilityTests(options: {
    plugins: Plugin[];
    keyword?: string;
    onItemUpdate?: (state: IPluginAvailabilityTestState) => void;
    shouldAbort?: () => boolean;
}): Promise<IPluginAvailabilityTestState[]> {
    const {
        plugins,
        keyword = DEFAULT_AVAILABILITY_QUERY,
        onItemUpdate,
        shouldAbort,
    } = options;
    const normalizedKeyword = keyword.trim() || DEFAULT_AVAILABILITY_QUERY;
    const initialStates = plugins.map(plugin => ({
        pluginName: plugin.name,
        pluginHash: plugin.hash,
        status: PluginAvailabilityStatus.Waiting,
    }));

    setAvailabilityStates(
        Object.fromEntries(
            initialStates.map(state => [state.pluginHash, state]),
        ),
    );
    initialStates.forEach(state => onItemUpdate?.(state));

    const results: IPluginAvailabilityTestState[] = [...initialStates];

    for (const initialState of initialStates) {
        if (shouldAbort?.()) {
            const skippedState = {
                ...initialState,
                status: PluginAvailabilityStatus.Skipped,
            };
            updateAvailabilityState(skippedState);
            results.splice(
                results.findIndex(it => it.pluginHash === skippedState.pluginHash),
                1,
                skippedState,
            );
            onItemUpdate?.(skippedState);
            continue;
        }

        const plugin = plugins.find(
            it => it.hash === initialState.pluginHash,
        )!;
        const healthStatus = getPluginHealthStatus(plugin.name);
        const testingState = {
            ...initialState,
            status: PluginAvailabilityStatus.Testing,
        };
        updateAvailabilityState(testingState);
        onItemUpdate?.(testingState);

        const probeResult = await probePlugin(plugin, normalizedKeyword);
        const aborted = shouldAbort?.();
        const resultState: IPluginAvailabilityTestState = {
            ...initialState,
            searchPassed: probeResult.searchPassed,
            sourcePassed: probeResult.sourcePassed,
            status: aborted
                ? PluginAvailabilityStatus.Skipped
                : probeResult.success
                    ? PluginAvailabilityStatus.Success
                    : PluginAvailabilityStatus.Fail,
        };

        if (!aborted) {
            if (probeResult.success) {
                // 测试只恢复自动隔离；disabled / userInvalid / archived 在上方已跳过。
                if (
                    getPluginHealthStatus(plugin.name) ===
                        PluginHealthStatus.Quarantined
                ) {
                    restorePlugin(plugin.name, plugin.hash);
                }
            } else if (
                healthStatus !== PluginHealthStatus.UserInvalid &&
                healthStatus !== PluginHealthStatus.Archived
            ) {
                // 手动失效 / 归档是用户状态；测试结果只展示，不自动改写。
                markPluginQuarantined(
                    plugin.name,
                    plugin.hash,
                    probeResult.timedOut
                        ? "availability-test-timeout"
                        : "availability-test-failed",
                );
            }
        }

        updateAvailabilityState(resultState);
        results.splice(
            results.findIndex(it => it.pluginHash === resultState.pluginHash),
            1,
            resultState,
        );
        onItemUpdate?.(resultState);
    }

    return results;
}
