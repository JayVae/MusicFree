import React, { useCallback, useMemo, useState } from "react";
import { SectionList, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import * as DocumentPicker from "expo-document-picker";
import Loading from "@/components/base/loading";

import PluginManager, { Plugin, useSortedPlugins } from "@/core/pluginManager";
import {
    ISubscriptionItem,
    useSubscriptionItems,
    useSubscriptionRecords,
    withSubscriptionId,
} from "@/core/pluginManager/subscription";
import { PluginHealthStatus, getPluginHealthStatus } from "@/core/pluginManager/health";
import {
    buildPluginOriginGroups,
    IPluginOriginGroup,
    PluginOriginType,
    usePluginOriginRecords,
} from "@/core/pluginManager/pluginOrigin";
import useColors from "@/hooks/useColors";
import { trace } from "@/utils/log";

import Toast from "@/utils/toast";
import axios from "axios";
import { useNavigation } from "@react-navigation/native";
import Config, { useAppConfig } from "@/core/appConfig";
import Empty from "@/components/base/empty";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import AppBar from "@/components/base/appBar";
import ThemeText from "@/components/base/themeText";
import ListItem from "@/components/base/listItem";
import PluginItem from "../components/pluginItem";
import { IIconName } from "@/components/base/icon.tsx";
import { IInstallPluginResult } from "@/types/core/pluginManager";
import { useI18N } from "@/core/i18n";

interface PluginGroup {
    name: string;
    plugins: Plugin[];
}

interface IAddSubscriptionAction {
    kind: "add-subscription";
}

type SubscriptionSectionItem = ISubscriptionItem | IAddSubscriptionAction | IPluginOriginGroup;

const ADD_SUBSCRIPTION_ACTION: IAddSubscriptionAction = {
    kind: "add-subscription",
};

function reportInstallResults(
    results: IInstallPluginResult[],
    t: (key: any, options?: any) => string,
) {
    const successResults = results.filter(it => it.success);
    const failResults = results.filter(it => !it.success);
    if (!failResults.length) {
        Toast.success(t("toast.installPluginSuccess"));
        return;
    }
    Toast.warn(successResults.length
        ? t("toast.partialPluginInstallFailed")
        : t("toast.allPluginInstallFailed"), {
        type: "warn",
        actionText: t("common.view"),
        onActionClick: () => {
            showDialog("SimpleDialog", {
                title: t("pluginSetting.menu.pluginInstallFailedDialogTitle"),
                content: t("pluginSetting.pluginInstallFailedDialogContent", {
                    detail: failResults.map(it =>
                        `${it.pluginUrl ?? ""}\n${
                            t("pluginSetting.failReason", {
                                reason: it.message ?? "",
                            })
                        }`
                    ).join("\n-----\n"),
                }),
            });
        },
    });
}

function ManageSubscriptionRow(props: {
    icon: IIconName;
    title: string;
    description: string;
    onPress: () => void;
}) {
    return (
        <ListItem withHorizontalPadding onPress={props.onPress}>
            <ListItem.Content title={props.title} description={props.description} />
            <ListItem.ListItemIcon icon={props.icon} position="right" />
        </ListItem>
    );
}

export default function PluginList() {
    const plugins = useSortedPlugins();
    const colors = useColors();
    const { t } = useI18N();
    const [loading, setLoading] = useState(false);
    const [maintenanceExpanded, setMaintenanceExpanded] = useState(false);
    const navigator = useNavigation<any>();
    const rawSubscriptions = useAppConfig("plugin.subscribeUrl");
    const subscriptions = useSubscriptionItems(rawSubscriptions);
    const subscriptionRecords = useSubscriptionRecords();
    const originRecords = usePluginOriginRecords();

    const pluginGroups = useMemo(() => {
        const groupMap = new Map<string, Plugin[]>();
        plugins.forEach(plugin => {
            const group = groupMap.get(plugin.name) ?? [];
            group.push(plugin);
            groupMap.set(plugin.name, group);
        });
        return [...groupMap.entries()].map(([name, groupPlugins]) => ({
            name,
            plugins: groupPlugins,
        }));
    }, [plugins]);

    const duplicateSourceNames = useMemo(() => {
        const sourceMap = new Map<string, Set<string>>();
        plugins.forEach(plugin => {
            const sourceUrl = plugin.instance.srcUrl?.trim();
            if (!sourceUrl) {
                return;
            }
            const names = sourceMap.get(sourceUrl) ?? new Set<string>();
            names.add(plugin.name);
            sourceMap.set(sourceUrl, names);
        });
        return new Set(
            [...sourceMap.values()]
                .filter(names => names.size > 1)
                .flatMap(names => [...names]),
        );
    }, [plugins]);

    const installedHashes = useMemo(
        () => new Set(plugins.map(plugin => plugin.hash)),
        [plugins],
    );
    const missingCount = useMemo(
        () => new Set(
            subscriptionRecords
                .filter(record =>
                    record.missingFromSubscription &&
                    installedHashes.has(record.pluginHash)
                )
                .map(record => record.pluginHash),
        ).size,
        [subscriptionRecords, installedHashes],
    );
    const originGroups = useMemo(
        () => buildPluginOriginGroups(plugins, originRecords, subscriptions),
        [plugins, originRecords, subscriptions],
    );
    const archivedCount = plugins.filter(plugin =>
        getPluginHealthStatus(plugin.name) === PluginHealthStatus.Archived
    ).length;
    const availableCount = plugins.filter(plugin =>
        getPluginHealthStatus(plugin.name) === PluginHealthStatus.Available
    ).length;
    const invalidCount = plugins.filter(plugin =>
        getPluginHealthStatus(plugin.name) === PluginHealthStatus.UserInvalid
    ).length;

    const navigate = useCallback((path: string) => {
        navigator.navigate(path);
    }, [navigator]);

    async function onInstallFromLocalClick() {
        try {
            const results = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                multiple: true,
                type: ["application/javascript", "text/javascript"],
            });
            if (results.canceled) {
                return;
            }
            setLoading(true);
            const installResults: IInstallPluginResult[] = [];
            for (const asset of results.assets) {
                installResults.push(await PluginManager.installPluginFromLocalFile(asset.uri, {
                    notCheckVersion: Config.getConfig("basic.notCheckPluginVersion"),
                    useExpoFs: true,
                }));
            }
            reportInstallResults(installResults, t);
        } catch (e: any) {
            trace("插件安装失败", e?.message);
            Toast.warn(t("toast.installPluginFail", {
                reason: e?.message ?? "",
            }));
        }
        setLoading(false);
    }

    async function onInstallFromNetworkClick() {
        showPanel("SimpleInput", {
            title: t("pluginSetting.menu.installPlugin"),
            placeholder: t("pluginSetting.menu.installPluginDialogPlaceholder"),
            maxLength: 200,
            async onOk(text, closePanel) {
                setLoading(true);
                closePanel();
                const results = await installPluginFromUrl(text.trim());
                reportInstallResults(results, t);
                setLoading(false);
            },
        });
    }

    async function onUpdateAllClick() {
        setLoading(true);
        try {
            const results: IInstallPluginResult[] = [];
            const enabledPlugins = PluginManager.getEnabledPlugins();
            for (const plugin of enabledPlugins) {
                if (!plugin.instance.srcUrl) {
                    continue;
                }
                results.push(...await installPluginFromUrl(
                    plugin.instance.srcUrl,
                    plugin.hash,
                ));
            }
            const successResults = results.filter(it => it.success);
            const failResults = results.filter(it => !it.success);
            if (!failResults.length) {
                Toast.success(t("toast.updatePluginSuccess"));
            } else {
                Toast.warn(successResults.length
                    ? t("toast.partialPluginUpdateFailed")
                    : t("toast.allPluginUpdateFailed"), {
                    type: "warn",
                    actionText: t("common.view"),
                    onActionClick: () => {
                        showDialog("SimpleDialog", {
                            title: t("pluginSetting.menu.pluginUpdateFailedDialogTitle"),
                            content: t("pluginSetting.pluginUpdateFailedDialogContent", {
                                detail: failResults.map(it =>
                                    `${it.pluginUrl ?? ""}\n${
                                        t("pluginSetting.failReason", {
                                            reason: it.message ?? "",
                                        })
                                    }`
                                ).join("\n-----\n"),
                            }),
                        });
                    },
                });
            }
        } catch (e: any) {
            Toast.warn(t("toast.unknownError", {
                reason: e?.message ?? e,
            }));
        }
        setLoading(false);
    }

    async function onUpdateSubscriptionClick() {
        setLoading(true);
        try {
            const { successResults, failResults } =
                await PluginManager.updateAllSubscriptions();
            if (!failResults.length) {
                Toast.success(t("toast.updateSubscriptionSuccess"));
            } else if (!successResults.length) {
                Toast.warn(t("toast.updateSubscriptionFailed"));
            } else {
                Toast.warn(t("toast.partialSubscriptionUpdateFailed", {
                    count: failResults.length,
                }));
            }
        } catch (e: any) {
            Toast.warn(t("toast.unknownError", {
                reason: e?.message ?? e,
            }));
        }
        setLoading(false);
    }

    const onAddSubscriptionSubmit = (
        subscribeItem: ISubscriptionItem,
        hideDialog: () => void,
    ) => {
        if (
            !subscribeItem.url.toLowerCase().endsWith(".js") &&
            !subscribeItem.url.toLowerCase().endsWith(".json")
        ) {
            Toast.warn(t("toast.subscriptionHaveToEndWithJs"));
            return;
        }
        const normalized = withSubscriptionId(subscribeItem);
        if (subscriptions.some(it => it.id === normalized.id)) {
            Toast.warn(t("toast.subscriptionAlreadyExists"));
            return;
        }
        Config.setConfig(
            "plugin.subscribeUrl",
            JSON.stringify([...subscriptions, normalized]),
        );
        hideDialog();
    };

    const sections = [
        {
            key: "overview",
            title: t("pluginSetting.section.overview"),
            data: [1],
            renderItem: () => (
                <View style={[styles.overview, { backgroundColor: colors.card }]}>
                    <View style={styles.statRow}>
                        <View style={styles.stat}>
                            <ThemeText fontSize="title">{plugins.length}</ThemeText>
                            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                {t("pluginSetting.stat.installed")}
                            </ThemeText>
                        </View>
                        <View style={styles.stat}>
                            <ThemeText fontSize="title">{subscriptions.length}</ThemeText>
                            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                {t("pluginSetting.stat.subscriptions")}
                            </ThemeText>
                        </View>
                        <View style={styles.stat}>
                            <ThemeText fontSize="title">{archivedCount}</ThemeText>
                            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                {t("pluginSetting.stat.archived")}
                            </ThemeText>
                        </View>
                    </View>
                    {missingCount > 0 ? (
                        <ThemeText fontColor="textSecondary" style={styles.warning}>
                            {t("pluginSetting.subscription.missingCount", {
                                count: missingCount,
                            })}
                        </ThemeText>
                    ) : null}
                    <View style={styles.statRow}>
                        <View style={styles.stat}>
                            <ThemeText fontSize="title">{availableCount}</ThemeText>
                            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                {t("pluginSetting.stat.available")}
                            </ThemeText>
                        </View>
                        <View style={styles.stat}>
                            <ThemeText fontSize="title">{invalidCount}</ThemeText>
                            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                {t("pluginSetting.stat.invalid")}
                            </ThemeText>
                        </View>
                    </View>
                </View>
            ),
        },
        {
            key: "subscriptions",
            title: t("pluginSetting.section.sourceGroups"),
            data: [
                ADD_SUBSCRIPTION_ACTION,
                ...[...originGroups].sort((a, b) => {
                    const order: Record<PluginOriginType, number> = {
                        [PluginOriginType.Local]: 0,
                        [PluginOriginType.Network]: 1,
                        [PluginOriginType.Builtin]: 2,
                        [PluginOriginType.Subscription]: 3,
                    };
                    return order[a.originType] - order[b.originType] ||
                        (a.originName ?? "").localeCompare(b.originName ?? "");
                }),
            ],
            renderItem: ({ item }: { item: SubscriptionSectionItem }) => {
                if ("kind" in item) {
                    return (
                        <ManageSubscriptionRow
                            icon="plus"
                            title={t("pluginSetting.subscription.add")}
                            description={t("pluginSetting.subscription.addTip")}
                            onPress={() => {
                                showDialog("SubscribePluginDialog", {
                                    onSubmit: onAddSubscriptionSubmit,
                                });
                            }}
                        />
                    );
                }
                const group = item as IPluginOriginGroup;
                const groupTitle = group.originType === PluginOriginType.Subscription
                    ? group.originName ?? group.originId
                    : t(`pluginSetting.origin.${group.originType}` as any);
                const description = [
                    t(`pluginSetting.origin.${group.originType}` as any),
                    t("pluginSetting.origin.pluginCount", {
                        count: group.pluginCount,
                    }),
                    group.latestChangedAt
                        ? t("pluginSetting.subscription.lastUpdated", {
                            time: new Date(group.latestChangedAt).toLocaleString(),
                        })
                        : undefined,
                ].filter(Boolean).join(" · ");
                return (
                    <ListItem
                        withHorizontalPadding
                        onPress={() => navigator.navigate(
                            "/pluginsetting/origin/detail",
                            { groupId: group.key },
                        )}>
                        <ListItem.Content
                            title={groupTitle}
                            description={description}
                        />
                        <ListItem.ListItemIcon icon="skip-right" position="right" />
                    </ListItem>
                );
            },
        },
        {
            key: "maintenance",
            title: t("pluginSetting.section.maintenance"),
            data: [1],
            renderItem: () => (
                <View style={[styles.maintenance, { backgroundColor: colors.card }]}>
                    <ListItem
                        withHorizontalPadding
                        onPress={() => setMaintenanceExpanded(value => !value)}>
                        <ListItem.Content
                            title={maintenanceExpanded
                                ? t("pluginSetting.maintenance.collapse")
                                : t("pluginSetting.maintenance.expand")}
                            description={t("pluginSetting.maintenance.toggleTip")}
                        />
                        <ListItem.ListItemIcon
                            icon={maintenanceExpanded ? "minus" : "plus"}
                            position="right"
                        />
                    </ListItem>
                    {maintenanceExpanded ? (
                        <View style={styles.maintenanceActions}>
                            <IconAction
                                icon="plus"
                                title={t("pluginSetting.fabOptions.installFromLocal")}
                                onPress={onInstallFromLocalClick}
                            />
                            <IconAction
                                icon="plus"
                                title={t("pluginSetting.fabOptions.installFromNetwork")}
                                onPress={onInstallFromNetworkClick}
                            />
                            <IconAction
                                icon="arrow-path"
                                title={t("pluginSetting.fabOptions.updateAllPlugins")}
                                onPress={onUpdateAllClick}
                            />
                            <IconAction
                                icon="arrow-path"
                                title={t("pluginSetting.fabOptions.updateSubscription")}
                                onPress={onUpdateSubscriptionClick}
                            />
                            <IconAction
                                icon="trash-outline"
                                title={t("pluginSetting.menu.uninstallAll")}
                                onPress={() => {
                                    showDialog("SimpleDialog", {
                                        title: t("pluginSetting.menu.uninstallAll"),
                                        content: t("pluginSetting.menu.uninstallAllContent"),
                                        async onOk() {
                                            setLoading(true);
                                            await PluginManager.uninstallAllPlugins();
                                            setLoading(false);
                                        },
                                    });
                                }}
                            />
                        </View>
                    ) : null}
                </View>
            ),
        },
        {
            key: "installed",
            title: t("pluginSetting.section.installed"),
            data: pluginGroups,
            renderItem: ({ item }: { item: PluginGroup }) => (
                <View>
                    {item.plugins.map((plugin, index) => (
                        <PluginItem
                            key={plugin.hash}
                            plugin={plugin}
                            duplicateCount={item.plugins.length}
                            duplicateIndex={index + 1}
                            duplicateSourceGroup={duplicateSourceNames.has(
                                plugin.name,
                            )}
                        />
                    ))}
                </View>
            ),
        },
        {
            key: "sort",
            title: t("pluginSetting.section.sort"),
            data: [1],
            renderItem: () => (
                <ListItem
                    withHorizontalPadding
                    onPress={() => navigate("/pluginsetting/sort")}>
                    <ListItem.Content
                        title={t("pluginSetting.sort.manage")}
                        description={t("pluginSetting.sort.manageTip")}
                    />
                    <ListItem.ListItemIcon icon="skip-right" position="right" />
                </ListItem>
            ),
        },
    ];

    return (
        <>
            <AppBar>{t("sidebar.pluginManagement")}</AppBar>
            <HorizontalSafeAreaView style={style.wrapper}>
                {loading ? (
                    <Loading />
                ) : (
                    <SectionList
                        sections={sections as any}
                        keyExtractor={(item, index) => `${index}`}
                        renderSectionHeader={({ section }) => (
                            <ThemeText
                                fontWeight="bold"
                                style={styles.sectionHeader}>
                                {section.title}
                            </ThemeText>
                        )}
                        renderItem={({ section, item, index }) =>
                            (section as any).renderItem({ item, index })
                        }
                        ListEmptyComponent={Empty}
                        contentContainerStyle={styles.listContent}
                        ListFooterComponent={<View style={styles.footer} />}
                    />
                )}
            </HorizontalSafeAreaView>
        </>
    );
}

function IconAction(props: {
    icon: IIconName;
    title: string;
    onPress?: () => void;
}) {
    return (
        <ListItem
            withHorizontalPadding
            style={styles.iconAction}
            onPress={props.onPress}>
            <ListItem.ListItemIcon icon={props.icon} />
            <ListItem.Content title={props.title} />
        </ListItem>
    );
}

async function installPluginFromUrl(
    text: string,
    preserveOriginHash?: string,
): Promise<IInstallPluginResult[]> {
    try {
        const inputUrl = text.trim();
        if (!inputUrl.toLowerCase().endsWith(".json")) {
            return [await PluginManager.installPluginFromUrl(inputUrl, {
                notCheckVersion: Config.getConfig("basic.notCheckPluginVersion"),
                preserveOriginHash,
            })];
        }
        const jsonFile = (
            await axios.get(inputUrl, {
                headers: {
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    Expires: "0",
                },
            })
        ).data;
        const urls = (jsonFile?.plugins ?? [])
            .map((it: any) => it?.url)
            .filter((url: unknown): url is string => typeof url === "string");
        const results: IInstallPluginResult[] = [];
        for (const url of urls) {
            results.push(await PluginManager.installPluginFromUrl(url, {
                notCheckVersion: Config.getConfig("basic.notCheckPluginVersion"),
                preserveOriginHash,
            }));
        }
        return results;
    } catch (e: any) {
        return [{ success: false, message: e?.message, pluginUrl: text }];
    }
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
});

const styles = StyleSheet.create({
    listContent: {
        paddingBottom: rpx(120),
    },
    sectionHeader: {
        marginTop: rpx(32),
        marginBottom: rpx(12),
        paddingHorizontal: rpx(24),
    },
    footer: {
        height: rpx(80),
    },
    overview: {
        marginHorizontal: rpx(24),
        padding: rpx(20),
        borderRadius: rpx(12),
    },
    statRow: {
        flexDirection: "row",
    },
    stat: {
        flex: 1,
        alignItems: "center",
        gap: rpx(4),
    },
    warning: {
        marginTop: rpx(16),
    },
    iconAction: {
        flex: 1,
        borderRadius: rpx(10),
    },
    maintenance: {
        marginHorizontal: rpx(24),
        borderRadius: rpx(12),
        overflow: "hidden",
    },
    maintenanceActions: {
        gap: rpx(12),
        paddingBottom: rpx(12),
    },
});
