import React, { useMemo, useState } from "react";
import { FlatList, TouchableOpacity } from "react-native-gesture-handler";
import { StyleSheet, View } from "react-native";
import ThemeText from "@/components/base/themeText";
import Checkbox from "@/components/base/checkbox";
import TextButton from "@/components/base/textButton";
import useColors from "@/hooks/useColors";
import useOrientation from "@/hooks/useOrientation";
import { hideDialog } from "../useDialog";
import Dialog from "./base";
import { useI18N } from "@/core/i18n";
import Toast from "@/utils/toast";
import { ISubscriptionItem } from "@/core/pluginManager/subscription";
import type { ISubscriptionPluginCandidate } from "@/types/core/pluginManager";
import rpx, { vmax, vmin } from "@/utils/rpx";

interface ISubscriptionInstallDialogProps {
    subscription: ISubscriptionItem;
    candidates: ISubscriptionPluginCandidate[];
    defaultSelectedUrls?: string[];
    onConfirm: (selectedUrls: string[]) => void;
}

export default function SubscriptionInstallDialog(
    props: ISubscriptionInstallDialogProps,
) {
    const { subscription, candidates, defaultSelectedUrls, onConfirm } = props;
    const { t } = useI18N();
    const colors = useColors();
    const orientation = useOrientation();
    const [selectedUrls, setSelectedUrls] = useState<Set<string>>(
        () => {
            const candidateUrls = new Set(candidates.map(it => it.url));
            return new Set(
                (defaultSelectedUrls ?? candidates.map(it => it.url))
                    .filter(url => candidateUrls.has(url)),
            );
        },
    );

    const toggleUrl = (url: string) => {
        setSelectedUrls(prev => {
            const next = new Set(prev);
            if (next.has(url)) {
                next.delete(url);
            } else {
                next.add(url);
            }
            return next;
        });
    };

    const setAll = (checked: boolean) => {
        setSelectedUrls(
            checked ? new Set(candidates.map(it => it.url)) : new Set(),
        );
    };

    const allSelected = useMemo(
        () => selectedUrls.size === candidates.length,
        [selectedUrls, candidates.length],
    );

    return (
        <Dialog onDismiss={hideDialog}>
            <Dialog.Title>{t("dialog.subscriptionInstall.title")}</Dialog.Title>
            <Dialog.Content>
                <ThemeText
                    fontSize="subTitle"
                    fontColor="textSecondary"
                    style={styles.subtitle}>
                    {t("dialog.subscriptionInstall.subtitle", {
                        name: subscription.name,
                        count: candidates.length,
                    })}
                </ThemeText>
                <View style={styles.batchActions}>
                    <TextButton
                        fontColor="primary"
                        onPress={() => setAll(!allSelected)}>
                        {allSelected
                            ? t("dialog.subscriptionInstall.selectNone")
                            : t("dialog.subscriptionInstall.selectAll")}
                    </TextButton>
                    <ThemeText fontColor="textSecondary">
                        {t("dialog.subscriptionInstall.selectedCount", {
                            count: selectedUrls.size,
                            total: candidates.length,
                        })}
                    </ThemeText>
                </View>
                <FlatList
                    style={{
                        maxHeight:
                            orientation === "horizontal" ? vmin(50) : vmax(50),
                    }}
                    data={candidates}
                    keyExtractor={(it, index) => `${it.url}-${index}`}
                    renderItem={({ item }) => {
                        const checked = selectedUrls.has(item.url);
                        const description = [
                            item.version
                                ? t("dialog.subscriptionInstall.version", {
                                    version: item.version,
                                })
                                : undefined,
                            item.url,
                        ].filter(Boolean).join(" · ");
                        return (
                            <TouchableOpacity
                                onPress={() => toggleUrl(item.url)}
                                style={[
                                    styles.row,
                                    { borderBottomColor: colors.divider },
                                ]}>
                                <Checkbox checked={checked} />
                                <View style={styles.rowContent}>
                                    <ThemeText numberOfLines={1}>
                                        {item.name || item.url}
                                    </ThemeText>
                                    <ThemeText
                                        fontSize="subTitle"
                                        fontColor="textSecondary"
                                        numberOfLines={1}>
                                        {description}
                                    </ThemeText>
                                </View>
                            </TouchableOpacity>
                        );
                    }}
                />
            </Dialog.Content>
            <Dialog.Actions
                actions={[
                    {
                        type: "normal",
                        title: t("common.cancel"),
                        onPress() {
                            hideDialog();
                        },
                    },
                    {
                        type: "primary",
                        title: t("dialog.subscriptionInstall.confirm"),
                        onPress() {
                            if (selectedUrls.size === 0) {
                                Toast.warn(
                                    t("dialog.subscriptionInstall.nothingSelected"),
                                );
                                return;
                            }
                            hideDialog();
                            onConfirm([...selectedUrls]);
                        },
                    },
                ]}
            />
        </Dialog>
    );
}

const styles = StyleSheet.create({
    subtitle: {
        marginBottom: rpx(12),
    },
    batchActions: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: rpx(8),
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: rpx(16),
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: rpx(16),
    },
    rowContent: {
        flex: 1,
    },
});
