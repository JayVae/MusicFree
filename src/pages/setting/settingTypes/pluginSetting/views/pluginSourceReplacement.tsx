import React, { useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import AppBar from "@/components/base/appBar";
import Empty from "@/components/base/empty";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import globalStyle from "@/constants/globalStyle";
import { useI18N } from "@/core/i18n";
import {
    Plugin,
    default as pluginManager,
    usePluginEnabledStates,
    useSortedPlugins,
} from "@/core/pluginManager";
import {
    PluginHealthStatus,
    usePluginHealthRecords,
} from "@/core/pluginManager/health";
import {
    collectSourceMusicItems,
    collectSourceReferences,
    ISourceReplacementRecord,
    removeSourceReplacement,
    setSourceReplacement,
    useSourceReplacementRecords,
} from "@/core/pluginManager/sourceReplacement";
import {
    getSourceMigrationTargetPlugins,
} from "@/core/sourceMigration";
import { PluginState } from "@/core/pluginManager/plugin";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

type SourceAvailability =
    | "missing"
    | "disabled"
    | "load-error"
    | "unsupported"
    | "unsupported-search"
    | PluginHealthStatus;

interface ISourceRow {
    platform: string;
    count: number;
    availability: SourceAvailability;
    replacement?: ISourceReplacementRecord;
    targetAvailability?: SourceAvailability;
}

const CLEAR_REPLACEMENT_VALUE = "__clear_source_replacement__";

function getSourceAvailability(
    plugin: Plugin | undefined,
    enabled: boolean,
    healthStatus: PluginHealthStatus,
): SourceAvailability {
    if (!plugin) {
        return "missing";
    }
    if (plugin.state === PluginState.Error) {
        return "load-error";
    }
    if (!enabled) {
        return "disabled";
    }
    if (healthStatus !== PluginHealthStatus.Available) {
        return healthStatus;
    }
    if (!plugin.supportedMethods.has("getMediaSource")) {
        return "unsupported";
    }
    return PluginHealthStatus.Available;
}

function getAvailabilityText(
    availability: SourceAvailability,
    t: ReturnType<typeof useI18N>["t"],
) {
    if (
        availability === PluginHealthStatus.Quarantined ||
        availability === PluginHealthStatus.UserInvalid ||
        availability === PluginHealthStatus.Archived
    ) {
        return t(`pluginSetting.pluginItem.health.${availability}` as any);
    }
    return t(`pluginSetting.sourceReplacement.status.${availability}` as any);
}

function getMigrationTargetAvailability(
    plugin: Plugin | undefined,
    enabled: boolean,
    healthStatus: PluginHealthStatus,
): SourceAvailability {
    const availability = getSourceAvailability(
        plugin,
        enabled,
        healthStatus,
    );
    if (
        availability === PluginHealthStatus.Available ||
        availability === PluginHealthStatus.Quarantined
    ) {
        return plugin?.supportedMethods.has("search")
            ? availability
            : "unsupported-search";
    }
    return availability;
}

export default function PluginSourceReplacement() {
    const { t } = useI18N();
    const colors = useColors();
    const plugins = useSortedPlugins();
    const enabledStates = usePluginEnabledStates(plugins);
    const healthRecords = usePluginHealthRecords();
    const replacementRecords = useSourceReplacementRecords();
    const [, setMigrationVersion] = useState(0);
    const sourceReferences = collectSourceReferences();
    const sourceRows = (() => {
        const referenceCountMap = new Map(
            sourceReferences.map(item => [item.platform, item.count]),
        );
        const pluginMap = new Map(plugins.map(plugin => [plugin.name, plugin]));
        const platforms = new Set([
            ...sourceReferences.map(item => item.platform),
            ...Object.keys(replacementRecords),
        ]);

        return [...platforms]
            .map((platform): ISourceRow => {
                const plugin = pluginMap.get(platform);
                const availability = getSourceAvailability(
                    plugin,
                    plugin ? enabledStates[plugin.name] !== false : false,
                    healthRecords[platform]?.status ?? PluginHealthStatus.Available,
                );
                const replacement = replacementRecords[platform];
                const targetPlugin = replacement
                    ? pluginMap.get(replacement.targetPluginName)
                    : undefined;
                const targetAvailability = replacement
                    ? getMigrationTargetAvailability(
                        targetPlugin,
                        targetPlugin
                            ? enabledStates[targetPlugin.name] !== false
                            : false,
                        healthRecords[replacement.targetPluginName]?.status ??
                            PluginHealthStatus.Available,
                    )
                    : undefined;

                return {
                    platform,
                    count: referenceCountMap.get(platform) ?? 0,
                    availability,
                    replacement,
                    targetAvailability,
                };
            })
            .filter(row =>
                row.count > 0 || !!row.replacement
            )
            .sort((a, b) =>
                Number(!!b.replacement) - Number(!!a.replacement) ||
                Number(a.availability === PluginHealthStatus.Available) -
                    Number(b.availability === PluginHealthStatus.Available) ||
                b.count - a.count ||
                a.platform.localeCompare(b.platform),
            );
    })();

    const chooseReplacement = (row: ISourceRow) => {
        const targets = getSourceMigrationTargetPlugins(
            pluginManager,
        );

        if (!targets.length && !row.replacement) {
            Toast.warn(t("pluginSetting.sourceReplacement.noTargets"));
            return;
        }

        showDialog("RadioDialog", {
            title: t("pluginSetting.sourceReplacement.selectTitle", {
                name: row.platform,
            }),
            tip: t("pluginSetting.sourceReplacement.selectTip"),
            content: [
                ...(row.replacement ? [{
                    value: CLEAR_REPLACEMENT_VALUE,
                    label: t("pluginSetting.sourceReplacement.clear"),
                    icon: "trash-outline" as const,
                }] : []),
                ...targets.map(plugin => ({
                    value: plugin.name,
                    label: plugin.name,
                })),
            ],
            defaultSelected:
                row.replacement?.targetPluginName ??
                targets[0]?.name,
            onOk(value) {
                if (value === CLEAR_REPLACEMENT_VALUE) {
                    removeSourceReplacement(row.platform);
                    setMigrationVersion(version => version + 1);
                    Toast.success(t("pluginSetting.sourceReplacement.cleared"));
                    return;
                }
                const targetPluginName = String(value);
                const sourceMusicItems = collectSourceMusicItems(row.platform);
                showDialog("SimpleDialog", {
                    title: t("pluginSetting.sourceReplacement.confirmTitle"),
                    content: t(
                        "pluginSetting.sourceReplacement.confirmContent",
                        {
                            count: sourceMusicItems.length,
                            source: row.platform,
                            target: targetPluginName,
                        },
                    ),
                    onOk() {
                        if (row.platform === targetPluginName) {
                            removeSourceReplacement(row.platform);
                        } else {
                            setSourceReplacement(
                                row.platform,
                                targetPluginName,
                            );
                        }
                        if (!sourceMusicItems.length) {
                            Toast.success(t(
                                "pluginSetting.sourceReplacement.setSuccess",
                            ));
                            setMigrationVersion(version => version + 1);
                            return;
                        }
                        showDialog("SourceMigrationDialog", {
                            title: t(
                                "pluginSetting.sourceReplacement.migrationTitle",
                                { target: targetPluginName },
                            ),
                            musicItems: sourceMusicItems,
                            targetPluginName,
                            scope: { type: "all" },
                            onCompleted(states, replacedCount) {
                                setMigrationVersion(version => version + 1);
                                Toast.success(t(
                                    "dialog.sourceMigration.completed",
                                    {
                                        replaced: replacedCount,
                                        total: states.length,
                                    },
                                ));
                            },
                        });
                        return false;
                    },
                });
            },
        });
    };

    return (
        <>
            <AppBar>{t("pluginSetting.sourceReplacement.title")}</AppBar>
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                <FlatList
                    data={sourceRows}
                    keyExtractor={item => item.platform}
                    ListHeaderComponent={(
                        <View style={[styles.intro, { backgroundColor: colors.card }]}>
                            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                {t("pluginSetting.sourceReplacement.intro")}
                            </ThemeText>
                        </View>
                    )}
                    renderItem={({ item }) => {
                        const description = [
                            getAvailabilityText(item.availability, t),
                            t("pluginSetting.sourceReplacement.referenceCount", {
                                count: item.count,
                            }),
                            item.replacement
                                ? t("pluginSetting.sourceReplacement.target", {
                                    name: item.replacement.targetPluginName,
                                })
                                : t("pluginSetting.sourceReplacement.notConfigured"),
                            item.targetAvailability &&
                                item.targetAvailability !== PluginHealthStatus.Available &&
                                item.targetAvailability !== PluginHealthStatus.Quarantined
                                ? t("pluginSetting.sourceReplacement.targetUnavailable", {
                                    reason: getAvailabilityText(
                                        item.targetAvailability,
                                        t,
                                    ),
                                })
                                : undefined,
                        ].filter(Boolean).join(" · ");

                        return (
                            <ListItem
                                withHorizontalPadding
                                onPress={() => chooseReplacement(item)}>
                                <ListItem.Content
                                    title={item.platform}
                                    description={description}
                                />
                                <ListItem.ListItemIcon
                                    icon="arrows-left-right"
                                    position="right"
                                />
                            </ListItem>
                        );
                    }}
                    ListEmptyComponent={(
                        <Empty
                            content={t("pluginSetting.sourceReplacement.empty")}
                        />
                    )}
                    ListFooterComponent={<View style={styles.footer} />}
                />
            </HorizontalSafeAreaView>
        </>
    );
}

const styles = StyleSheet.create({
    intro: {
        marginHorizontal: rpx(24),
        marginTop: rpx(16),
        marginBottom: rpx(12),
        padding: rpx(20),
        borderRadius: rpx(12),
    },
    footer: {
        height: rpx(80),
    },
});
