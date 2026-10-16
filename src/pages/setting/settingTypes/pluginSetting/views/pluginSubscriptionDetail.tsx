import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import { useNavigation, useRoute } from "@react-navigation/native";
import rpx from "@/utils/rpx";
import Config, { useAppConfig } from "@/core/appConfig";
import PluginManager, { Plugin, usePlugins } from "@/core/pluginManager";
import {
    ISubscriptionItem,
    useSubscriptionInfos,
    useSubscriptionItems,
    useSubscriptionRecords,
    withSubscriptionId,
} from "@/core/pluginManager/subscription";
import { usePluginHealth, PluginHealthStatus } from "@/core/pluginManager/health";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import Toast from "@/utils/toast";
import Clipboard from "@react-native-clipboard/clipboard";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import { showDialog } from "@/components/dialogs/useDialog";
import AppBar from "@/components/base/appBar";
import { useI18N } from "@/core/i18n";

interface IRouteParams {
    subscriptionId: string;
}

function SubscriptionPluginRow(props: {
    plugin: Plugin;
    missing: boolean;
    onPress: () => void;
}) {
    const health = usePluginHealth(props.plugin.name);
    const { t } = useI18N();
    const status = health?.status ?? PluginHealthStatus.Available;
    const description = [
        props.plugin.instance.version
            ? t("pluginSetting.pluginItem.versionHint", {
                version: props.plugin.instance.version,
            })
            : undefined,
        t(`pluginSetting.pluginItem.health.${status}` as any),
        props.missing ? t("pluginSetting.pluginItem.subscriptionMissing") : undefined,
    ].filter(Boolean).join(" · ");

    return (
        <ListItem withHorizontalPadding onPress={props.onPress}>
            <ListItem.Content
                title={props.plugin.name}
                description={description}
            />
            <ListItem.ListItemIcon icon="skip-right" position="right" />
        </ListItem>
    );
}

export default function PluginSubscriptionDetail() {
    const route = useRoute<any>();
    const navigator = useNavigation<any>();
    const { subscriptionId } = route.params as IRouteParams;
    const rawSubscriptions = useAppConfig("plugin.subscribeUrl") ?? "";
    const subscribes = useSubscriptionItems(rawSubscriptions);
    const subscriptionInfos = useSubscriptionInfos();
    const records = useSubscriptionRecords(subscriptionId);
    const allPlugins = usePlugins();
    const [, setLoading] = useState(false);
    const { t } = useI18N();

    const subscription = subscribes.find(it => it.id === subscriptionId);
    const info = subscriptionInfos[subscriptionId];

    const subscriptionPlugins = useMemo(() => {
        const hashes = new Set(records.map(record => record.pluginHash));
        const missingHashes = new Set(
            records.filter(record => record.missingFromSubscription).map(record => record.pluginHash),
        );
        return allPlugins
            .filter(plugin => hashes.has(plugin.hash))
            .map(plugin => ({
                plugin,
                missing: missingHashes.has(plugin.hash),
            }));
    }, [allPlugins, records]);

    if (!subscription) {
        return (
            <>
                <AppBar>{t("pluginSetting.subscription.detail")}</AppBar>
                <HorizontalSafeAreaView style={globalStyle.flex1}>
                    <ThemeText style={styles.empty}>
                        {t("pluginSetting.subscription.notFound")}
                    </ThemeText>
                </HorizontalSafeAreaView>
            </>
        );
    }

    const missingCount = subscriptionPlugins.filter(it => it.missing).length;

    const saveSubscriptions = (
        nextSubscribes: ISubscriptionItem[],
        hideDialog: () => void,
    ) => {
        Config.setConfig("plugin.subscribeUrl", JSON.stringify(nextSubscribes));
        hideDialog();
    };

    const onSubmit = (
        subscribeItem: ISubscriptionItem,
        hideDialog: () => void,
        editingIndex?: number,
    ) => {
        if (
            !subscribeItem.url.toLowerCase().endsWith(".js") &&
            !subscribeItem.url.toLowerCase().endsWith(".json")
        ) {
            Toast.warn(t("toast.subscriptionHaveToEndWithJs"));
            return;
        }
        const normalized = withSubscriptionId(subscribeItem);
        const duplicated = subscribes.find(
            (it, index) => it.id === normalized.id && index !== editingIndex,
        );
        if (duplicated) {
            Toast.warn(t("toast.subscriptionAlreadyExists"));
            return;
        }
        const nextSubscribes = editingIndex === undefined
            ? [...subscribes, normalized]
            : subscribes.map((it, index) => index === editingIndex ? normalized : it);
        saveSubscriptions(nextSubscribes, hideDialog);
        if (normalized.id !== subscriptionId) {
            navigator.replace("/pluginsetting/subscribe/detail", {
                subscriptionId: normalized.id,
            });
        }
    };

    const onDelete = () => {
        const associatedCount = PluginManager.getSubscriptionAssociatedPlugins(
            subscription.id,
        ).length;
        showDialog("SimpleDialog", {
            title: t("pluginSetting.subscription.deleteTitle"),
            content: associatedCount
                ? t("pluginSetting.subscription.deleteContentWithPlugins", {
                    count: associatedCount,
                })
                : t("pluginSetting.subscription.deleteContent"),
            okText: t("pluginSetting.subscription.deleteWithPlugins"),
            onOk: async () => {
                setLoading(true);
                try {
                    await PluginManager.deleteSubscription(subscription.id);
                    Toast.success(t("toast.deleteSuccess"));
                    navigator.goBack();
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const onUpdate = async () => {
        setLoading(true);
        try {
            const { successResults, failResults } =
                await PluginManager.updateSubscription(subscription.id);
            if (!failResults.length) {
                Toast.success(t("toast.updateSubscriptionSuccess"));
            } else if (!successResults.length) {
                Toast.warn(t("toast.updateSubscriptionFailed"), {
                    type: "warn",
                    actionText: t("common.view"),
                    duration: 6000,
                    onActionClick: () => {
                        showDialog("SimpleDialog", {
                            title: t("pluginSetting.subscription.updateFailedTitle"),
                            content: failResults.map(it =>
                                `${it.pluginUrl ?? ""}\n${
                                    t("pluginSetting.failReason", {
                                        reason: it.message ?? "",
                                    })
                                }`
                            ).join("\n-----\n"),
                        });
                    },
                });
            } else {
                Toast.warn(t("toast.partialSubscriptionUpdateFailed", {
                    count: failResults.length,
                }), {
                    type: "warn",
                    actionText: t("common.view"),
                    duration: 6000,
                    onActionClick: () => {
                        showDialog("SimpleDialog", {
                            title: t("pluginSetting.subscription.updateFailedTitle"),
                            content: failResults.map(it =>
                                `${it.pluginUrl ?? ""}\n${
                                    t("pluginSetting.failReason", {
                                        reason: it.message ?? "",
                                    })
                                }`
                            ).join("\n-----\n"),
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
    };

    return (
        <>
            <AppBar>{subscription.name}</AppBar>
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                <FlatList
                    style={styles.list}
                    data={[
                        { key: "detail" },
                        { key: "plugin-header" },
                        ...subscriptionPlugins.map((it, index) => ({
                            key: it.plugin.hash,
                            plugin: it.plugin,
                            missing: it.missing,
                            index,
                        })),
                    ]}
                    keyExtractor={item => item.key}
                    renderItem={({ item }) => {
                        if (item.key === "detail") {
                            return (
                                <View style={styles.detailCard}>
                                    <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                        ID: {subscription.id}
                                    </ThemeText>
                                    <ThemeText
                                        fontSize="subTitle"
                                        fontColor="textSecondary"
                                        numberOfLines={2}>
                                        {subscription.url}
                                    </ThemeText>
                                    <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                        {info?.lastUpdatedAt
                                            ? t("pluginSetting.subscription.lastUpdated", {
                                                time: new Date(info.lastUpdatedAt).toLocaleString(),
                                            })
                                            : t("pluginSetting.subscription.pluginCountUnknown")}
                                    </ThemeText>
                                    <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                        {t("pluginSetting.subscription.pluginCount", {
                                            count: subscriptionPlugins.length,
                                        })}
                                    </ThemeText>
                                    {missingCount > 0 ? (
                                        <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                            {t("pluginSetting.subscription.missingCount", {
                                                count: missingCount,
                                            })}
                                        </ThemeText>
                                    ) : null}
                                </View>
                            );
                        }
                        if (item.key === "plugin-header") {
                            return (
                                <>
                                    <ListItem
                                        withHorizontalPadding
                                        onPress={() => {
                                            showDialog("SubscribePluginDialog", {
                                                subscribeItem: subscription,
                                                onSubmit,
                                                editingIndex: subscribes.findIndex(
                                                    it => it.id === subscription.id,
                                                ),
                                                onDelete,
                                            });
                                        }}>
                                        <ListItem.Content
                                            title={t("common.edit")}
                                            description={t("pluginSetting.subscription.editTip")}
                                        />
                                        <ListItem.ListItemIcon icon="pencil-square" position="right" />
                                    </ListItem>
                                    <ListItem withHorizontalPadding onPress={onUpdate}>
                                        <ListItem.Content
                                            title={t("pluginSetting.subscription.updateThis")}
                                            description={t("pluginSetting.subscription.updateThisTip")}
                                        />
                                        <ListItem.ListItemIcon icon="arrow-path" position="right" />
                                    </ListItem>
                                    <ListItem withHorizontalPadding onPress={onDelete}>
                                        <ListItem.Content
                                            title={t("common.delete")}
                                            description={t("pluginSetting.subscription.deleteTip")}
                                        />
                                        <ListItem.ListItemIcon icon="trash-outline" position="right" />
                                    </ListItem>
                                    <ListItem
                                        withHorizontalPadding
                                        onPress={() => {
                                            Clipboard.setString(subscription.url);
                                            Toast.success(t("toast.copiedToClipboard"));
                                        }}>
                                        <ListItem.Content
                                            title={t("pluginSetting.subscription.copyUrl")}
                                            description={subscription.url}
                                        />
                                        <ListItem.ListItemIcon icon="share" position="right" />
                                    </ListItem>
                                    <ThemeText
                                        fontWeight="bold"
                                        style={styles.sectionHeader}>
                                        {t("pluginSetting.section.installed")}
                                    </ThemeText>
                                </>
                            );
                        }
                        return (
                            <SubscriptionPluginRow
                                plugin={(item as any).plugin}
                                missing={Boolean((item as any).missing)}
                                onPress={() => navigator.navigate("/pluginsetting/list")}
                            />
                        );
                    }}
                    ListEmptyComponent={null}
                    ListFooterComponent={<View style={styles.footer} />}
                />
            </HorizontalSafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    list: {
        marginTop: rpx(16),
    },
    detailCard: {
        marginHorizontal: rpx(24),
        marginBottom: rpx(16),
        padding: rpx(20),
        borderRadius: rpx(12),
        gap: rpx(8),
    },
    sectionHeader: {
        marginTop: rpx(24),
        marginBottom: rpx(8),
        paddingHorizontal: rpx(24),
    },
    footer: {
        height: rpx(80),
    },
    empty: {
        marginTop: rpx(120),
        textAlign: "center",
    },
});
