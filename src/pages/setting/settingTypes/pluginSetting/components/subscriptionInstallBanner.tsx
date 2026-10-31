import React from "react";
import rpx from "@/utils/rpx";
import { StyleSheet, View } from "react-native";
import ThemeText from "@/components/base/themeText";
import TextButton from "@/components/base/textButton";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import PluginManager from "@/core/pluginManager";
import { useSubscriptionInstallProgress } from "@/core/pluginManager/subscriptionInstall";

/**
 * 订阅后台安装进度横幅；仅在存在进行中的订阅安装时展示。
 */
export default function SubscriptionInstallBanner() {
    const progress = useSubscriptionInstallProgress();
    const colors = useColors();
    const { t } = useI18N();

    if (!progress?.running) {
        return null;
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.card }]}>
            <View style={styles.content}>
                <ThemeText>
                    {t("pluginSetting.subscriptionInstall.progress", {
                        completed: progress.completed,
                        total: progress.total,
                        success: progress.success,
                        failed: progress.failed,
                    })}
                </ThemeText>
            </View>
            <TextButton
                fontColor="textSecondary"
                onPress={() =>
                    PluginManager.cancelSubscriptionInstall(
                        progress.subscriptionId,
                    )
                }>
                {t("pluginSetting.subscriptionInstall.cancel")}
            </TextButton>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: rpx(16),
        paddingHorizontal: rpx(24),
    },
    content: {
        flex: 1,
        marginRight: rpx(16),
    },
});
