import {
    emptyFunction,
    localPluginHash,
    localPluginPlatform,
} from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import {
    IInstallPluginConfig,
    IInstallPluginResult,
    IPluginManager,
} from "@/types/core/pluginManager";
import { removeAllMediaExtra } from "@/utils/mediaExtra";
import axios from "axios";
import { compare } from "compare-versions";
import EventEmitter from "eventemitter3";
import { readAsStringAsync } from "expo-file-system";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { ToastAndroid } from "react-native";
import { copyFile, readDir, readFile, stat, unlink, writeFile } from "react-native-fs";
import { devLog, errorLog, trace } from "../../utils/log";
import pluginMeta from "./meta";
import {
    clearAllPluginHealth,
    isPluginAvailableForService,
    markPluginArchived,
    preparePluginHealthForLaunch,
    removePluginHealth,
} from "./health";
import {
    getActiveSubscriptionRecords,
    ISubscriptionItem,
    markPluginArchivedAsDuplicate,
    markPluginUninstalled,
    markSubscriptionSnapshot,
    parseSubscriptionConfig,
    recordSubscriptionInstall,
    removeSubscriptionData,
    updateSubscriptionInfo,
} from "./subscription";
import { localFilePlugin, Plugin, PluginState } from "./plugin";
import {
    clearPluginOriginRecords,
    getPluginOrigin,
    markPluginOriginUninstalled,
    PluginOriginType,
    recordPluginOrigin,
} from "./pluginOrigin";
import i18n from "../i18n";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { IInjectable } from "@/types/infra";
import { IAppConfig } from "@/types/core/config";

const pluginsAtom = atom<Plugin[]>([]);
const pluginCacheStore = getOrCreateMMKV("plugin.cache");

const ee = new EventEmitter<{
    "order-updated": () => void;
    "enabled-updated": (pluginName: string, enabled: boolean) => void;
}>();

class PluginManager implements IPluginManager, IInjectable {
    private appConfigService!: IAppConfig;
    private installQueue: Promise<unknown> = Promise.resolve();
    private subscriptionUpdateQueue: Promise<unknown> = Promise.resolve();

    private enqueueInstall<T extends IInstallPluginResult>(
        task: () => Promise<T>,
    ): Promise<T> {
        const queuedTask = this.installQueue.then(task, task);
        this.installQueue = queuedTask.then(
            () => undefined,
            () => undefined,
        );
        return queuedTask;
    }

    private recordSubscriptionInstall(
        plugin: Plugin,
        sourceUrl: string,
        config?: IInstallPluginConfig,
        archivedAsDuplicate?: boolean,
    ) {
        recordSubscriptionInstall({
            subscriptionId: config?.subscriptionId,
            pluginHash: plugin.hash,
            pluginName: plugin.name,
            sourceUrl,
            installedVersion: plugin.instance.version,
            archivedAsDuplicate,
        });
    }

    private recordPluginOrigin(
        plugin: Plugin,
        sourceUrl: string,
        config?: IInstallPluginConfig,
        archivedAsDuplicate?: boolean,
    ) {
        if (config?.subscriptionId) {
            const subscription = parseSubscriptionConfig(
                this.appConfigService.getConfig("plugin.subscribeUrl"),
            ).find(it => it.id === config.subscriptionId);
            recordPluginOrigin({
                pluginHash: plugin.hash,
                pluginName: plugin.name,
                originType: PluginOriginType.Subscription,
                originId: config.subscriptionId,
                originName: subscription?.name,
                sourceUrl,
                archivedAsDuplicate,
            });
            return;
        }

        if (config?.preserveOriginHash) {
            const previousOrigin = getPluginOrigin(config.preserveOriginHash);
            if (previousOrigin) {
                recordPluginOrigin({
                    pluginHash: plugin.hash,
                    pluginName: plugin.name,
                    originType: previousOrigin.originType,
                    originId: previousOrigin.originId,
                    originName: previousOrigin.originName,
                    sourceUrl,
                    archivedAsDuplicate,
                });
                return;
            }
        }

        recordPluginOrigin({
            pluginHash: plugin.hash,
            pluginName: plugin.name,
            originType: PluginOriginType.Network,
            originId: "network",
            sourceUrl,
            archivedAsDuplicate,
        });
    }

    injectDependencies(config: IAppConfig): void {
        this.appConfigService = config;
    }

    /**
     * 获取当前存储的插件列表
     * @returns 插件实例数组
     */
    private getPlugins() {
        return getDefaultStore().get(pluginsAtom);
    }

    /**
     * 更新存储中的插件列表
     * @param plugins - 要设置的插件实例数组
     */
    private setPlugins(plugins: Plugin[]) {
        getDefaultStore().set(pluginsAtom, plugins);

        // 清理缓存中已卸载的插件
        const cachedKeys = pluginCacheStore.getAllKeys();
        cachedKeys.forEach(key => {
            if (!plugins.find(it => it.path === key)) {
                pluginCacheStore.delete(key);
            }
        });

        plugins.forEach(it => {
            this.updatePluginCache(it);
        });
    }

    private updatePluginCache(plugin: Plugin) {
        if (plugin.path && plugin.state === PluginState.Mounted) {
            const entry: Record<string, unknown> = {
                name: plugin.name,
                hash: plugin.hash,
                path: plugin.path,
                instance: JSON.parse(JSON.stringify(plugin.instance)),
                supportedMethods: [...plugin.supportedMethods],
            };
            // R6: 记录文件统计信息用于变更检测
            stat(plugin.path)
                .then(statResult => {
                    entry.fileStats = {
                        mtime: statResult.mtime,
                        size: statResult.size,
                    };
                    pluginCacheStore.set(plugin.path, JSON.stringify(entry));
                })
                .catch(() => {
                    pluginCacheStore.set(plugin.path, JSON.stringify(entry));
                });
        }
    }

    /**
     * 初始化插件管理器
     * R6 元数据先行：启动阶段只恢复插件元数据，不执行插件源码。
     * 首次调用插件方法时再挂载（见 Plugin.ensureMounted）。
     * @throws 如果插件初始化失败则抛出异常
     */
    async setup() {
        const setupStartAt = Date.now();
        try {
            await pluginMeta.migratePluginMeta();
            preparePluginHealthForLaunch();
            // 读取插件目录
            const pluginsFileItems = await readDir(pathConst.pluginPath);
            const allPlugins: Array<Plugin> = [];

            for (let i = 0; i < pluginsFileItems.length; ++i) {
                const pluginFileItem = pluginsFileItems[i];
                trace("初始化插件", pluginFileItem);
                if (
                    pluginFileItem.isFile() &&
                    (pluginFileItem.name?.endsWith?.(".js") ||
                        pluginFileItem.path?.endsWith?.(".js"))
                ) {
                    let plugin: Plugin;
                    let isLazyLoad = false;

                    // R6: 获取文件统计信息，用于检测插件文件变更
                    let fileStats: { mtime: number; size: number } | null = null;
                    try {
                        const statResult = await stat(pluginFileItem.path);
                        fileStats = {
                            mtime: statResult.mtime,
                            size: statResult.size,
                        };
                    } catch {
                        // stat 失败时跳过变更检测
                    }

                    // R6: 元数据缓存有效时，不读取 / eval 插件源码
                    const cachedMeta = safeParse(
                        pluginCacheStore.getString(pluginFileItem.path),
                    );
                    const cacheStats = cachedMeta?.fileStats;
                    const cacheValid =
                        cachedMeta?.name &&
                        cachedMeta?.hash &&
                        (!fileStats ||
                            !cacheStats ||
                            (cacheStats.mtime === fileStats.mtime &&
                                cacheStats.size === fileStats.size));

                    if (cacheValid) {
                        // 元数据先行：仅恢复名称 / hash / supportedMethods 等
                        isLazyLoad = true;
                        cachedMeta.loadFuncCode = async () =>
                            await readFile(pluginFileItem.path, "utf8");
                        plugin = new Plugin(
                            null,
                            pluginFileItem.path,
                            cachedMeta,
                        );
                    } else {
                        // 缓存缺失或文件已变更：完整挂载以提取元数据（仅此一次）
                        const funcCode = await readFile(
                            pluginFileItem.path,
                            "utf8",
                        );
                        plugin = new Plugin(funcCode, pluginFileItem.path);
                    }

                    // R6: 挂载前通过元数据 hash 去重
                    const _pluginIndex = allPlugins.findIndex(
                        p => p.hash === plugin.hash,
                    );
                    if (_pluginIndex !== -1) {
                        // 重复插件，直接忽略
                        continue;
                    }
                    if (plugin.state === PluginState.Mounted || isLazyLoad) {
                        allPlugins.push(plugin);
                    }
                }
            }

            this.setPlugins(allPlugins);

            trace("R6 插件元数据加载完成", {
                count: allPlugins.length,
                elapsed: Date.now() - setupStartAt,
            });
            // R6 (D39): 移除启动阶段延迟预挂载；插件代码在首次服务调用时再挂载
        } catch (e: any) {
            ToastAndroid.show(
                `插件初始化失败:${e?.message ?? e}`,
                ToastAndroid.LONG,
            );
            errorLog("插件初始化失败", e?.message);
            throw e;
        }

        Plugin.injectDependencies(this);
    }

    /**
     * 从本地文件安装插件
     * @param pluginPath - 插件文件路径
     * @param config - 安装配置选项
     * @param config.notCheckVersion - 为true时跳过版本检查
     * @param config.useExpoFs - 为true时使用Expo文件系统代替React Native的文件系统
     * @returns 安装结果，包含成功状态和相关信息
     */
    installPluginFromLocalFile(
        pluginPath: string,
        config?: IInstallPluginConfig & {
            useExpoFs?: boolean;
        },
    ): Promise<IInstallPluginResult> {
        return this.enqueueInstall(() =>
            this.doInstallPluginFromLocalFile(pluginPath, config)
        );
    }

    private async doInstallPluginFromLocalFile(
        pluginPath: string,
        config?: IInstallPluginConfig & {
            useExpoFs?: boolean;
        },
    ): Promise<IInstallPluginResult> {
        let funcCode: string;
        if (config?.useExpoFs) {
            funcCode = await readAsStringAsync(pluginPath);
        } else {
            funcCode = await readFile(pluginPath, "utf8");
        }

        if (funcCode) {
            const plugin = new Plugin(funcCode, pluginPath);
            let allPlugins = [...this.getPlugins()];

            const _pluginIndex = allPlugins.findIndex(
                p => p.hash === plugin.hash,
            );
            if (_pluginIndex !== -1) {
                // 静默忽略
                return {
                    success: true,
                    message: "插件已安装",
                    pluginName: plugin.name,
                    pluginHash: plugin.hash,
                };
            }
            const oldVersionPlugin = allPlugins.find(
                p => p.name === plugin.name,
            );
            if (oldVersionPlugin && !config?.notCheckVersion) {
                if (
                    compare(
                        oldVersionPlugin.instance.version ?? "",
                        plugin.instance.version ?? "",
                        ">",
                    )
                ) {
                    return {
                        success: false,
                        message: "已安装更新版本的插件",
                        pluginName: plugin.name,
                        pluginHash: plugin.hash,
                    };
                }
            }

            if (plugin.state === PluginState.Mounted) {
                const fn = nanoid();
                if (oldVersionPlugin) {
                    allPlugins = allPlugins.filter(
                        _ => _.hash !== oldVersionPlugin.hash,
                    );
                    try {
                        await unlink(oldVersionPlugin.path);
                    } catch {}
                    markPluginOriginUninstalled(oldVersionPlugin.hash);
                }
                const _pluginPath = `${pathConst.pluginPath}${fn}.js`;
                await copyFile(pluginPath, _pluginPath);
                plugin.path = _pluginPath;
                allPlugins = allPlugins.concat(plugin);
                this.setPlugins(allPlugins);
                this.recordPluginOrigin(plugin, "local", config);

                return {
                    success: true,
                    pluginName: plugin.name,
                    pluginHash: plugin.hash,
                };
            }
            return {
                success: false,
                message: "插件无法解析",
            };
        }
        return {
            success: false,
            message: "插件无法识别",
        };
    }

    /**
     * 从URL安装插件
     * @param url - 下载插件的URL
     * @param config - 安装配置选项
     * @param config.notCheckVersion - 为true时跳过版本检查
     * @returns 安装结果，包含成功状态和相关信息
     */
    installPluginFromUrl(
        url: string,
        config?: IInstallPluginConfig,
    ): Promise<IInstallPluginResult> {
        return this.enqueueInstall(() => this.doInstallPluginFromUrl(url, config));
    }

    private async doInstallPluginFromUrl(
        url: string,
        config?: IInstallPluginConfig,
    ): Promise<IInstallPluginResult> {
        try {
            const funcCode = (
                await axios.get(url, {
                    headers: {
                        "Cache-Control": "no-cache",
                        Pragma: "no-cache",
                        Expires: "0",
                    },
                })
            ).data;
            if (funcCode) {
                const plugin = new Plugin(funcCode, "");
                let allPlugins = [...this.getPlugins()];
                const pluginIndex = allPlugins.findIndex(
                    p => p.hash === plugin.hash,
                );
                if (pluginIndex !== -1) {
                    // 内容 hash 相同，唯一保留一份，同时补充订阅来源关系
                    this.recordSubscriptionInstall(plugin, url, config);
                    this.recordPluginOrigin(plugin, url, config);
                    return {
                        success: true,
                        message: "插件已安装",
                        pluginName: plugin.name,
                        pluginHash: plugin.hash,
                        pluginUrl: url,
                    };
                }
                const duplicateSourcePlugin = allPlugins.find(
                    p =>
                        p.hash !== plugin.hash &&
                        p.name !== plugin.name &&
                        !!plugin.instance.srcUrl &&
                        p.instance.srcUrl === plugin.instance.srcUrl,
                );
                if (duplicateSourcePlugin && plugin.hash !== "") {
                    // 改名或换名后的重复音源默认归档，避免同时参与搜索和换源。
                    const fn = nanoid();
                    const archivePath = `${pathConst.pluginPath}${fn}.js`;
                    await writeFile(archivePath, funcCode, "utf8");
                    plugin.path = archivePath;
                    allPlugins = allPlugins.concat(plugin);
                    this.setPlugins(allPlugins);
                    markPluginArchived(plugin.name, plugin.hash);
                    this.recordSubscriptionInstall(plugin, url, config, true);
                    this.recordPluginOrigin(plugin, url, config, true);
                    return {
                        success: true,
                        message: "重复来源插件已归档",
                        pluginName: plugin.name,
                        pluginHash: plugin.hash,
                        pluginUrl: url,
                    };
                }
                const oldVersionPlugin = allPlugins.find(
                    p => p.name === plugin.name,
                );
                const isOlderVersion = !!oldVersionPlugin &&
                    compare(
                        oldVersionPlugin.instance.version ?? "",
                        plugin.instance.version ?? "",
                        ">",
                    );
                if (oldVersionPlugin && isOlderVersion) {
                    // 低版本内容不抢占运行中的同名插件，但保留为归档插件以便用户清理。
                    if (plugin.hash !== "") {
                        markPluginArchivedAsDuplicate({
                            subscriptionId: config?.subscriptionId,
                            pluginHash: plugin.hash,
                            pluginName: plugin.name,
                            sourceUrl: url,
                            installedVersion: plugin.instance.version,
                        });
                        return {
                            success: true,
                            message: "低版本插件已归档",
                            pluginName: plugin.name,
                            pluginHash: plugin.hash,
                            pluginUrl: url,
                        };
                    }
                    return {
                        success: false,
                        message: "已安装更新版本的插件",
                        pluginName: plugin.name,
                        pluginHash: plugin.hash,
                        pluginUrl: url,
                    };
                }

                if (plugin.hash !== "") {
                    const fn = nanoid();
                    const _pluginPath = `${pathConst.pluginPath}${fn}.js`;
                    await writeFile(_pluginPath, funcCode, "utf8");
                    plugin.path = _pluginPath;
                    allPlugins = allPlugins.concat(plugin);
                    if (oldVersionPlugin) {
                        allPlugins = allPlugins.filter(
                            _ => _.hash !== oldVersionPlugin.hash,
                        );
                        try {
                            await unlink(oldVersionPlugin.path);
                        } catch {}
                        markPluginOriginUninstalled(oldVersionPlugin.hash);
                    }
                    this.setPlugins(allPlugins);
                    this.recordSubscriptionInstall(plugin, url, config);
                    this.recordPluginOrigin(plugin, url, config);
                    return {
                        success: true,
                        pluginName: plugin.name,
                        pluginHash: plugin.hash,
                        pluginUrl: url,
                    };
                }
                return {
                    success: false,
                    message: "插件无法解析",
                    pluginUrl: url,
                };
            } else {
                return {
                    success: false,
                    message: "插件无法识别",
                    pluginUrl: url,
                };
            }
        } catch (e: any) {
            devLog("error", "URL安装插件失败", e, e?.message);
            errorLog("URL安装插件失败", e);

            if (e?.response?.statusCode === 404) {
                return {
                    success: false,
                    message: "插件不存在，请联系插件作者",
                    pluginUrl: url,
                };
            } else {
                return {
                    success: false,
                    message: e?.message ?? "",
                    pluginUrl: url,
                };
            }
        }
    }

    /**
     * 通过哈希值卸载插件
     * @param hash - 要卸载的插件哈希值
     */
    async uninstallPlugin(hash: string) {
        let plugins = [...this.getPlugins()];
        const targetIndex = plugins.findIndex(_ => _.hash === hash);
        if (targetIndex !== -1) {
            try {
                const pluginName = plugins[targetIndex].name;
                const pluginHash = plugins[targetIndex].hash;
                await unlink(plugins[targetIndex].path);
                markPluginUninstalled(pluginHash);
                markPluginOriginUninstalled(pluginHash);
                plugins = plugins.filter(_ => _.hash !== hash);
                this.setPlugins(plugins);
                // 防止其他重名
                if (plugins.every(_ => _.name !== pluginName)) {
                    removeAllMediaExtra(pluginName);
                    removePluginHealth(pluginName);
                }
            } catch {}
        }
    }

    /**
     * 卸载系统中的所有插件
     * 同时清理媒体额外数据并删除插件文件
     */
    async uninstallAllPlugins() {
        const allPlugins = [...this.getPlugins()];
        await Promise.all(
            allPlugins.map(async plugin => {
                try {
                    const pluginName = plugin.name;
                    await unlink(plugin.path);
                    removeAllMediaExtra(pluginName);
                } catch (e) {}
            }),
        );
        allPlugins.forEach(plugin => markPluginUninstalled(plugin.hash));
        this.setPlugins([]);
        clearAllPluginHealth();
        clearPluginOriginRecords();

        /** 清除空余文件，异步做就可以了 */
        readDir(pathConst.pluginPath)
            .then(fns => {
                fns.forEach(fn => {
                    unlink(fn.path).catch(emptyFunction);
                });
            })
            .catch(emptyFunction);
    }

    /**
     * 使用插件的源URL更新插件
     * @param plugin - 要更新的插件实例
     * @throws 如果插件没有源URL或更新失败时抛出错误
     */
    async updatePlugin(plugin: Plugin) {
        const updateUrl = plugin.instance.srcUrl;
        if (!updateUrl) {
            throw new Error("没有更新源");
        }
        try {
            await this.installPluginFromUrl(updateUrl, {
                preserveOriginHash: plugin.hash,
            });
        } catch (e: any) {
            if (e.message === "插件已安装") {
                throw new Error(i18n.t("checkUpdate.error.latestVersion"));
            } else {
                throw e;
            }
        }
    }

    private async fetchSubscriptionPluginUrls(url: string): Promise<string[]> {
        if (!url.trim().toLowerCase().endsWith(".json")) {
            return [url];
        }
        const subscriptionJson = (
            await axios.get(url, {
                headers: {
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    Expires: "0",
                },
            })
        ).data;
        const pluginUrls = (subscriptionJson?.plugins ?? [])
            .map((it: any) => it?.url)
            .filter((it: unknown): it is string => typeof it === "string");
        if (!pluginUrls.length) {
            throw new Error("订阅中没有插件");
        }
        return pluginUrls;
    }

    private enqueueSubscriptionUpdate(task: () => Promise<{
        successResults: IInstallPluginResult[];
        failResults: IInstallPluginResult[];
    }>) {
        const updateTask = this.subscriptionUpdateQueue.then(task, task);
        this.subscriptionUpdateQueue = updateTask.then(
            () => undefined,
            () => undefined,
        );
        return updateTask;
    }

    updateAllSubscriptions(): Promise<{
        successResults: IInstallPluginResult[];
        failResults: IInstallPluginResult[];
    }> {
        return this.enqueueSubscriptionUpdate(async () => {
            const subscriptions = parseSubscriptionConfig(
                this.appConfigService.getConfig("plugin.subscribeUrl"),
            );
            return this.doUpdateSubscriptionItems(subscriptions);
        });
    }

    updateSubscription(subscriptionId: string): Promise<{
        successResults: IInstallPluginResult[];
        failResults: IInstallPluginResult[];
    }> {
        return this.enqueueSubscriptionUpdate(async () => {
            const subscriptions = parseSubscriptionConfig(
                this.appConfigService.getConfig("plugin.subscribeUrl"),
            );
            const subscription = subscriptions.find(
                it => it.id === subscriptionId,
            );
            if (!subscription) {
                return {
                    successResults: [],
                    failResults: [{
                        success: false,
                        message: "订阅不存在",
                        pluginUrl: subscriptionId,
                    }],
                };
            }
            return this.doUpdateSubscriptionItems([subscription]);
        });
    }

    private async doUpdateSubscriptionItems(
        subscriptions: ISubscriptionItem[],
    ): Promise<{
        successResults: IInstallPluginResult[];
        failResults: IInstallPluginResult[];
    }> {
        const successResults: IInstallPluginResult[] = [];
        const failResults: IInstallPluginResult[] = [];

        for (const subscription of subscriptions) {
            try {
                const pluginUrls = await this.fetchSubscriptionPluginUrls(
                    subscription.url,
                );
                const expectedHashes = new Set<string>();
                const expectedUrls = new Set<string>(pluginUrls);
                for (const pluginUrl of pluginUrls) {
                    expectedUrls.add(pluginUrl);
                    const result = await this.installPluginFromUrl(pluginUrl, {
                        notCheckVersion: this.appConfigService.getConfig(
                            "basic.notCheckPluginVersion",
                        ),
                        subscriptionId: subscription.id,
                        subscriptionUrl: subscription.url,
                    });
                    if (result.success) {
                        if (result.pluginHash) {
                            expectedHashes.add(result.pluginHash);
                        }
                        successResults.push(result);
                    } else {
                        failResults.push(result);
                    }
                }
                markSubscriptionSnapshot(
                    subscription.id,
                    expectedHashes,
                    expectedUrls,
                );
                updateSubscriptionInfo(subscription.id, {
                    lastUpdatedAt: Date.now(),
                    pluginCount: pluginUrls.length,
                });
            } catch (e: any) {
                failResults.push({
                    success: false,
                    message: e?.message ?? "",
                    pluginUrl: subscription.url,
                });
            }
        }
        return { successResults, failResults };
    }

    getSubscriptionAssociatedPlugins(subscriptionId: string) {
        const records = getActiveSubscriptionRecords(subscriptionId);
        if (!records.length) {
            return [];
        }
        return this.getPlugins().filter(plugin => {
            const pluginRecords = records.filter(record =>
                record.pluginHash === plugin.hash ||
                record.pluginName === plugin.name
            );
            if (!pluginRecords.length) {
                return false;
            }
            const subscriptionIds = new Set(
                getActiveSubscriptionRecords()
                    .filter(record =>
                        record.pluginHash === plugin.hash ||
                        record.pluginName === plugin.name
                    )
                    .map(record => record.subscriptionId),
            );
            return subscriptionIds.size === 1 &&
                subscriptionIds.has(subscriptionId);
        });
    }

    async deleteSubscription(subscriptionId: string) {
        const associatedPlugins = this.getSubscriptionAssociatedPlugins(
            subscriptionId,
        );
        for (const plugin of associatedPlugins) {
            await this.uninstallPlugin(plugin.hash);
        }
        removeSubscriptionData(subscriptionId);
        const nextSubscriptions = parseSubscriptionConfig(
            this.appConfigService.getConfig("plugin.subscribeUrl"),
        ).filter(subscription => subscription.id !== subscriptionId);
        this.appConfigService.setConfig(
            "plugin.subscribeUrl",
            JSON.stringify(nextSubscriptions),
        );
    }

    /**
     * 通过媒体项的平台信息获取对应的插件
     * @param mediaItem - 包含平台信息的媒体项
     * @returns 与媒体平台匹配的插件实例或undefined
     */
    getByMedia(mediaItem: ICommon.IMediaBase) {
        return this.getByName(mediaItem?.platform);
    }

    /**
     * 通过名称获取插件
     * @param name - 要查找的插件名称
     * @returns 匹配名称的插件实例或本地文件插件
     */
    getByName(name: string) {
        return name === localPluginPlatform
            ? localFilePlugin
            : this.getPlugins().find(_ => _.name === name);
    }

    /**
     * 通过哈希值获取插件
     * @param hash - 要查找的插件哈希值
     * @returns 匹配哈希的插件实例或本地文件插件
     */
    getByHash(hash: string) {
        return hash === localPluginHash
            ? localFilePlugin
            : this.getPlugins().find(_ => _.hash === hash);
    }

    /**
     * 获取所有已启用的插件
     * @returns 已启用的插件实例数组
     */
    getEnabledPlugins() {
        return this.getPlugins().filter(it =>
            pluginMeta.isPluginEnabled(it.name),
        );
    }

    /**
     * 获取按顺序排序的所有插件
     * @returns 按定义顺序排序的插件实例数组
     */
    getSortedPlugins() {
        const order = pluginMeta.getPluginOrder();
        return [...this.getPlugins()].sort((a, b) =>
            (order[a.name] ?? Infinity) - (order[b.name] ?? Infinity) < 0
                ? -1
                : 1,
        );
    }

    /**
     * 获取所有支持搜索功能的已启用插件
     * @param supportedSearchType - 可选的搜索媒体类型过滤器
     * @returns 可搜索的插件实例数组
     */
    getSearchablePlugins(supportedSearchType?: ICommon.SupportMediaType) {
        return this.getPlugins().filter(
            it =>
                pluginMeta.isPluginEnabled(it.name) &&
                isPluginAvailableForService(it.name) &&
                it.supportedMethods.has("search") &&
                (supportedSearchType && it.instance.supportedSearchType
                    ? it.instance.supportedSearchType.includes(
                        supportedSearchType,
                    )
                    : true),
        );
    }

    /**
     * 获取所有支持搜索功能的已启用插件，并按顺序排序
     * @param supportedSearchType - 可选的搜索媒体类型过滤器
     * @returns 按顺序排序的可搜索插件实例数组
     */
    getSortedSearchablePlugins(supportedSearchType?: ICommon.SupportMediaType) {
        const order = pluginMeta.getPluginOrder();
        return [...this.getSearchablePlugins(supportedSearchType)].sort(
            (a, b) =>
                (order[a.name] ?? Infinity) - (order[b.name] ?? Infinity) < 0
                    ? -1
                    : 1,
        );
    }

    /**
     * 获取所有实现特定功能的已启用插件
     * @param ability - 要检查的方法/功能名称
     * @returns 具有指定功能的插件实例数组
     */
    getPluginsWithAbility(ability: keyof IPlugin.IPluginInstanceMethods) {
        return this.getPlugins().filter(
            it =>
                pluginMeta.isPluginEnabled(it.name) &&
                isPluginAvailableForService(it.name) &&
                it.supportedMethods.has(ability),
        );
    }

    /**
     * 获取所有实现特定功能的已启用插件，并按顺序排序
     * @param ability - 要检查的方法/功能名称
     * @returns 按顺序排序的具有指定功能的插件实例数组
     */
    getSortedPluginsWithAbility(ability: keyof IPlugin.IPluginInstanceMethods) {
        const order = pluginMeta.getPluginOrder();
        return [...this.getPluginsWithAbility(ability)].sort((a, b) =>
            (order[a.name] ?? Infinity) - (order[b.name] ?? Infinity) < 0
                ? -1
                : 1,
        );
    }

    /**
     * 设置插件的启用状态并发送事件通知
     * @param plugin - 要修改的插件实例
     * @param enabled - 是否启用插件
     */
    setPluginEnabled(plugin: Plugin, enabled: boolean) {
        ee.emit("enabled-updated", plugin.name, enabled);
        pluginMeta.setPluginEnabled(plugin.name, enabled);
    }

    /**
     * 检查插件是否已启用
     * @param plugin - 要检查的插件实例
     * @returns 表示插件是否启用的布尔值
     */
    isPluginEnabled(plugin: Plugin) {
        return pluginMeta.isPluginEnabled(plugin.name);
    }

    /**
     * 设置插件的排序顺序并发送顺序更新事件
     * @param sortedPlugins - 按期望顺序排列的插件实例数组
     */
    setPluginOrder(sortedPlugins: Plugin[]) {
        const orderMap: Record<string, number> = {};
        sortedPlugins.forEach((plugin, index) => {
            orderMap[plugin.name] = index;
        });
        pluginMeta.setPluginOrder(orderMap);
        ee.emit("order-updated");
    }

    setUserVariables(plugin: Plugin, userVariables: Record<string, string>) {
        pluginMeta.setUserVariables(plugin.name, userVariables);
    }

    getUserVariables(plugin: Plugin) {
        return pluginMeta.getUserVariables(plugin.name);
    }

    setAlternativePluginName(plugin: Plugin, alternativePluginName: string) {
        pluginMeta.setAlternativePlugin(plugin.name, alternativePluginName);
    }

    getAlternativePluginName(plugin: Plugin) {
        return pluginMeta.getAlternativePlugin(plugin.name);
    }

    getAlternativePlugin(plugin: Plugin) {
        const alternativePluginName = this.getAlternativePluginName(plugin);
        if (alternativePluginName) {
            return this.getByName(alternativePluginName);
        }
        return null;
    }
}

const pluginManager = new PluginManager();

export const usePlugins = () => useAtomValue(pluginsAtom);

export function useSortedPlugins() {
    const plugins = useAtomValue(pluginsAtom);
    const [sortedPlugins, setSortedPlugins] = useState<Plugin[]>(
        pluginManager.getSortedPlugins(),
    );

    useEffect(() => {
        const callback = () => {
            const order = pluginMeta.getPluginOrder();
            setSortedPlugins(
                [...plugins].sort((a, b) =>
                    (order[a.name] ?? Infinity) - (order[b.name] ?? Infinity) <
                    0
                        ? -1
                        : 1,
                ),
            );
        };

        ee.on("order-updated", callback);
        callback();
        return () => {
            ee.off("order-updated", callback);
        };
    }, [plugins]);

    return sortedPlugins;
}

export function usePluginEnabledStates(plugins: Plugin[]) {
    const buildEnabledStates = useCallback(
        () => Object.fromEntries(plugins.map(plugin => [
            plugin.name,
            pluginMeta.isPluginEnabled(plugin.name),
        ])),
        [plugins],
    );
    const [enabledStates, setEnabledStates] = useState(buildEnabledStates);

    useEffect(() => {
        setEnabledStates(buildEnabledStates());
        const callback = () => setEnabledStates(buildEnabledStates());
        ee.on("enabled-updated", callback);
        return () => {
            ee.off("enabled-updated", callback);
        };
    }, [buildEnabledStates]);

    return enabledStates;
}

export function usePluginEnabled(plugin: Plugin) {
    const [enabled, setEnabled] = useState(
        pluginManager.isPluginEnabled(plugin),
    );

    useEffect(() => {
        const callback = (pluginName: string, _enabled: boolean) => {
            if (pluginName === plugin?.name) {
                setEnabled(_enabled);
            }
        };

        ee.on("enabled-updated", callback);
        return () => {
            ee.off("enabled-updated", callback);
        };
    }, [plugin]);

    return enabled;
}

export default pluginManager;
export { Plugin };
