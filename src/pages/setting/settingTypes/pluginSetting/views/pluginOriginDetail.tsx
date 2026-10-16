import React, { useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import PluginManager, { Plugin, usePluginEnabled, usePlugins } from "@/core/pluginManager";
import {
    IPluginOriginGroup,
    PluginOriginType,
    buildPluginOriginGroups,
    usePluginOriginRecords,
} from "@/core/pluginManager/pluginOrigin";
import {
    markPluginArchived,
    restorePlugin,
    PluginHealthStatus,
    usePluginHealth,
    usePluginHealthRecords,
} from "@/core/pluginManager/health";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import rpx from "@/utils/rpx";
import AppBar from "@/components/base/appBar";
import useColors from "@/hooks/useColors";
import Toast from "@/utils/toast";
import { showDialog } from "@/components/dialogs/useDialog";
import { useAppConfig } from "@/core/appConfig";
import { useSubscriptionItems } from "@/core/pluginManager/subscription";
import { useI18N } from "@/core/i18n";

interface IRouteParams {
    groupId: string;
}

interface IPluginOriginRow {
    plugin: Plugin;
}

function GroupPluginRow(props: IPluginOriginRow) {
    const { t } = useI18N();
    const navigator = useNavigation<any>();
    const enabled = usePluginEnabled(props.plugin);
    const health = usePluginHealth(props.plugin.name);
    const status = health?.status ?? PluginHealthStatus.Available;
    const description = [
        props.plugin.instance.version
            ? t("pluginSetting.pluginItem.versionHint", {
                version: props.plugin.instance.version,
            })
            : undefined,
        t(`pluginSetting.pluginItem.health.${status}` as any),
        enabled ? undefined : t("pluginSetting.pluginItem.status.disabled"),
    ].filter(Boolean).join(" · ");

    return (
        <ListItem
            withHorizontalPadding
            onPress={() => navigator.navigate("/pluginsetting/list")}>
            <ListItem.Content
                title={props.plugin.name}
                description={description}
            />
            <ListItem.ListItemIcon icon="skip-right" position="right" />
        </ListItem>
    );
}

export default function PluginOriginDetail() {
    const colors = useColors();
    const route = useRoute<any>();
    const navigator = useNavigation<any>();
    const { groupId } = route.params as IRouteParams;
    const { t } = useI18N();
    const allPlugins = usePlugins();
    const originRecords = usePluginOriginRecords();
    const healthRecords = usePluginHealthRecords();
    const rawSubscriptions = useAppConfig("plugin.subscribeUrl");
    const subscriptions = useSubscriptionItems(rawSubscriptions);

    const groups = useMemo(
        () => buildPluginOriginGroups(allPlugins, originRecords, subscriptions),
        [allPlugins, originRecords, subscriptions],
    );
    const group = groups.find(it => it.key === groupId);

    const applyGroupState = (
        nextGroup: IPluginOriginGroup,
        action: "enable" | "disable" | "archive" | "restore",
    ) => {
        (nextGroup.plugins as Plugin[]).forEach(plugin => {
            if (action === "enable") {
                PluginManager.setPluginEnabled(plugin, true);
            } else if (action === "disable") {
                PluginManager.setPluginEnabled(plugin, false);
            } else if (action === "archive") {
                markPluginArchived(plugin.name, plugin.hash);
            } else {
                restorePlugin(plugin.name, plugin.hash);
            }
        });
    };

    const confirmGroupState = (
        nextGroup: IPluginOriginGroup,
        action: "enable" | "disable" | "archive" | "restore",
    ) => {
        showDialog("SimpleDialog", {
            title: t(`pluginSetting.origin.actions.${action}` as any),
            content: t("pluginSetting.origin.actionContent", {
                count: nextGroup.pluginCount,
            }),
            okText: t("common.confirm"),
            onOk: () => {
                applyGroupState(nextGroup, action);
                Toast.success(t("toast.settingSuccess"));
            },
        });
    };

    if (!group) {
        return (
            <>
                <AppBar>{t("pluginSetting.origin.detail")}</AppBar>
                <HorizontalSafeAreaView style={globalStyle.flex1}>
                    <ThemeText style={styles.empty}>
                        {t("pluginSetting.origin.notFound")}
                    </ThemeText>
                </HorizontalSafeAreaView>
            </>
        );
    }

    const groupTitle = group.originType === PluginOriginType.Subscription
        ? group.originName ?? group.originId
        : t(`pluginSetting.origin.${group.originType}` as any);
    const availableCount = (group.plugins as Plugin[]).filter(
        plugin => (healthRecords[plugin.name]?.status ??
            PluginHealthStatus.Available) === PluginHealthStatus.Available,
    ).length;
    const archivedCount = (group.plugins as Plugin[]).filter(
        plugin => healthRecords[plugin.name]?.status ===
            PluginHealthStatus.Archived,
    ).length;
    const actions: Array<"enable" | "disable" | "archive" | "restore"> = [
        "enable",
        "disable",
        "archive",
        "restore",
    ];

    return (
        <>
            <AppBar>{groupTitle}</AppBar>
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                <FlatList
                    style={styles.list}
                    data={group.plugins as Plugin[]}
                    keyExtractor={plugin => plugin.hash}
                    renderItem={({ item }) => (
                        <GroupPluginRow plugin={item} />
                    )}
                    ListHeaderComponent={(
                        <>
                            <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
                                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                    {t(`pluginSetting.origin.${group.originType}` as any)}
                                </ThemeText>
                                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                    {t("pluginSetting.origin.pluginCount", {
                                        count: group.pluginCount,
                                    })}
                                </ThemeText>
                                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                    {t("pluginSetting.origin.healthCount", {
                                        available: availableCount,
                                        archived: archivedCount,
                                    })}
                                </ThemeText>
                                {group.latestChangedAt ? (
                                    <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                        {t("pluginSetting.subscription.lastUpdated", {
                                            time: new Date(group.latestChangedAt).toLocaleString(),
                                        })}
                                    </ThemeText>
                                ) : null}
                            </View>
                            <View style={[styles.actionCard, { backgroundColor: colors.card }]}>
                                {actions.map(action => (
                                    <ListItem
                                        key={action}
                                        withHorizontalPadding
                                        onPress={() => confirmGroupState(group, action)}>
                                        <ListItem.Content
                                            title={t(`pluginSetting.origin.actions.${action}` as any)}
                                            description={t("pluginSetting.origin.actionTip", {
                                                count: group.pluginCount,
                                            })}
                                        />
                                    </ListItem>
                                ))}
                                {group.originType === PluginOriginType.Subscription ? (
                                    <ListItem
                                        withHorizontalPadding
                                        onPress={() => navigator.navigate(
                                            "/pluginsetting/subscribe/detail",
                                            { subscriptionId: group.originId },
                                        )}>
                                        <ListItem.Content
                                            title={t("pluginSetting.subscription.manage")}
                                            description={t("pluginSetting.subscription.manageTip")}
                                        />
                                        <ListItem.ListItemIcon icon="skip-right" position="right" />
                                    </ListItem>
                                ) : null}
                                <ThemeText
                                    fontWeight="bold"
                                    style={styles.sectionHeader}>
                                    {t("pluginSetting.section.installed")}
                                </ThemeText>
                            </View>
                        </>
                    )}
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
    actionCard: {
        marginHorizontal: rpx(24),
        marginBottom: rpx(16),
        borderRadius: rpx(12),
        overflow: "hidden",
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
