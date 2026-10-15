import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import Config, { useAppConfig } from "@/core/appConfig";
import { FlatList } from "react-native-gesture-handler";
import Empty from "@/components/base/empty";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import Toast from "@/utils/toast";
import Clipboard from "@react-native-clipboard/clipboard";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import { showDialog } from "@/components/dialogs/useDialog";
import AppBar from "@/components/base/appBar";
import Fab from "@/components/base/fab";
import {
    ISubscriptionItem,
    useSubscriptionInfos,
    useSubscriptionItems,
    withSubscriptionId,
} from "@/core/pluginManager/subscription";
import PluginManager from "@/core/pluginManager";
import { useI18N } from "@/core/i18n";

const ITEM_HEIGHT = rpx(140);

export default function PluginSubscribe() {
    const rawSubscriptions = useAppConfig("plugin.subscribeUrl") ?? "";
    const subscribes = useSubscriptionItems(rawSubscriptions);
    const subscriptionInfos = useSubscriptionInfos();
    const [, setSaving] = useState(false);
    const { t } = useI18N();

    const saveSubscriptions = (items: ISubscriptionItem[]) => {
        Config.setConfig("plugin.subscribeUrl", JSON.stringify(items));
    };

    const onSubmit = (
        subscribeItem: ISubscriptionItem,
        hideDialog: () => void,
        editingIndex?: number,
    ) => {
        if (
            subscribeItem.url.toLowerCase().endsWith(".js") ||
            subscribeItem.url.toLowerCase().endsWith(".json")
        ) {
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
            saveSubscriptions(nextSubscribes);
            hideDialog();
        } else {
            Toast.warn(t("toast.subscriptionHaveToEndWithJs"));
        }
    };

    const onDelete = (editingIndex: number, hideDialog: () => void) => {
        const subscription = subscribes[editingIndex];
        if (!subscription) {
            hideDialog();
            return;
        }
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
            cancelText: t("pluginSetting.subscription.deleteKeepPlugins"),
            onOk: async () => {
                setSaving(true);
                try {
                    await PluginManager.deleteSubscription(subscription.id, true);
                    Toast.success(t("toast.deleteSuccess"));
                } finally {
                    setSaving(false);
                }
            },
            onCancel: async () => {
                setSaving(true);
                try {
                    await PluginManager.deleteSubscription(subscription.id, false);
                    Toast.success(t("toast.deleteSuccess"));
                } finally {
                    setSaving(false);
                }
            },
        });
        hideDialog();
    };

    return (
        <>
            <AppBar>{t("pluginSetting.menu.subscriptionSetting")}</AppBar>
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                <FlatList
                    style={styles.listWrapper}
                    ListEmptyComponent={Empty}
                    data={subscribes}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => {
                        const info = subscriptionInfos[item.id];
                        return (
                            <ListItem
                                withHorizontalPadding
                                onPress={() => {
                                    showDialog("SubscribePluginDialog", {
                                        subscribeItem: item,
                                        onSubmit,
                                        editingIndex: subscribes.findIndex(
                                            it => it.id === item.id,
                                        ),
                                        onDelete,
                                    });
                                }}>
                                <ListItem.Content
                                    title={item.name}
                                    description={item.url}
                                />
                                <View style={styles.detail}>
                                    <ThemeText fontSize="subTitle" fontColor="textSecondary" numberOfLines={1}>
                                        ID: {item.id.slice(0, 14)}
                                    </ThemeText>
                                    <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                        {info?.pluginCount === undefined
                                            ? t("pluginSetting.subscription.pluginCountUnknown")
                                            : t("pluginSetting.subscription.pluginCount", {
                                                count: info.pluginCount,
                                            })}
                                    </ThemeText>
                                    {info?.lastUpdatedAt ? (
                                        <ThemeText fontSize="subTitle" fontColor="textSecondary">
                                            {t("pluginSetting.subscription.lastUpdated", {
                                                time: new Date(info.lastUpdatedAt).toLocaleString(),
                                            })}
                                        </ThemeText>
                                    ) : null}
                                </View>
                                <ListItem.ListItemIcon
                                    icon="share"
                                    position="right"
                                    onPress={() => {
                                        Clipboard.setString(item.url);
                                        Toast.success(t("toast.copiedToClipboard"));
                                    }}
                                />
                            </ListItem>
                        );
                    }}
                    getItemLayout={(_, index) => ({
                        length: ITEM_HEIGHT,
                        offset: ITEM_HEIGHT * index,
                        index,
                    })}
                />
            </HorizontalSafeAreaView>
            <Fab
                icon="plus"
                onPress={() => {
                    showDialog("SubscribePluginDialog", {
                        onSubmit,
                    });
                }}
            />
        </>
    );
}

const styles = StyleSheet.create({
    listWrapper: {
        marginTop: rpx(24),
    },
    detail: {
        marginTop: rpx(4),
        gap: rpx(2),
    },
});
