import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import Dialog from "./base";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";
import Config from "@/core/appConfig";
import pluginManager from "@/core/pluginManager";
import {
    applySourceMigrationResults,
    ISourceMigrationState,
    migrateMusicItems,
    SourceMigrationScope,
    SourceMigrationStatus,
} from "@/core/sourceMigration";
import { hideDialog } from "../useDialog";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

interface ISourceMigrationDialogProps {
    title: string;
    musicItems: IMusic.IMusicItem[];
    targetPluginName: string;
    scope: SourceMigrationScope;
    onCompleted?: (
        states: ISourceMigrationState[],
        replacedCount: number,
    ) => void;
}

export default function SourceMigrationDialog(
    props: ISourceMigrationDialogProps,
) {
    const {
        title,
        musicItems,
        targetPluginName,
        scope,
        onCompleted,
    } = props;
    const { t } = useI18N();
    const [states, setStates] = useState<ISourceMigrationState[]>(
        musicItems.map(musicItem => ({
            original: musicItem,
            status: SourceMigrationStatus.Pending,
        })),
    );
    const [completed, setCompleted] = useState(false);
    const shouldAbortRef = useRef(false);
    const backgroundedRef = useRef(false);
    const onCompletedRef = useRef(onCompleted);

    useEffect(() => {
        onCompletedRef.current = onCompleted;
    }, [onCompleted]);

    useEffect(() => {
        let mounted = true;
        const targetPlugin = pluginManager.getByName(targetPluginName);
        migrateMusicItems({
            musicItems,
            targetPlugin,
            config: Config,
            shouldAbort: () => shouldAbortRef.current,
            onItemUpdate: state => {
                if (!mounted || shouldAbortRef.current || backgroundedRef.current) {
                    return;
                }
                setStates(previous => previous.map(item =>
                    getMediaKey(item.original) === getMediaKey(state.original)
                        ? state
                        : item,
                ));
            },
        }).then(async result => {
            if (shouldAbortRef.current) {
                return;
            }
            const replacedCount = await applySourceMigrationResults(
                result,
                scope,
            );
            onCompletedRef.current?.(result, replacedCount);
            if (backgroundedRef.current) {
                Toast.success(t(
                    "dialog.sourceMigration.backgroundCompleted",
                    summarizeMigrationResult(result),
                ));
                return;
            }
            if (!mounted) {
                return;
            }
            setStates(result);
            setCompleted(true);
        }).catch(() => {
            if (backgroundedRef.current) {
                Toast.warn(t("dialog.sourceMigration.backgroundFailed"));
            } else if (mounted) {
                setCompleted(true);
            }
        });

        return () => {
            mounted = false;
        };
    }, [musicItems, scope, t, targetPluginName]);

    const summary = useMemo(
        () => summarizeMigrationResult(states),
        [states],
    );

    const dismiss = () => {
        shouldAbortRef.current = true;
        hideDialog();
    };

    const background = () => {
        backgroundedRef.current = true;
        hideDialog();
    };

    const getDescription = (state: ISourceMigrationState) => {
        switch (state.status) {
        case SourceMigrationStatus.Success:
            return t("dialog.sourceMigration.status.success", {
                platform: state.replacement?.platform ?? "-",
            });
        case SourceMigrationStatus.Fail:
            return t("dialog.sourceMigration.status.fail");
        case SourceMigrationStatus.Skip:
            return t(
                state.reason === "canceled"
                    ? "dialog.sourceMigration.status.canceled"
                    : "dialog.sourceMigration.status.targetUnavailable",
            );
        default:
            return t("dialog.sourceMigration.status.pending");
        }
    };

    return (
        <Dialog onDismiss={dismiss}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content style={styles.content}>
                <FlatList
                    data={states}
                    keyExtractor={(item, index) =>
                        `${getMediaKey(item.original)}-${index}`
                    }
                    getItemLayout={(_, index) => ({
                        length: ListItem.Size.normal,
                        offset: ListItem.Size.normal * index,
                        index,
                    })}
                    renderItem={({ item }) => (
                        <ListItem withHorizontalPadding heightType="normal">
                            <ListItem.Content
                                title={`${item.original.title} - ${item.original.artist}`}
                                description={getDescription(item)}
                            />
                        </ListItem>
                    )}
                />
            </Dialog.Content>
            <View style={styles.summaryContainer}>
                <ThemeText fontSize="description" fontColor="textSecondary">
                    {t("dialog.sourceMigration.summary", summary)}
                </ThemeText>
            </View>
            <Dialog.Actions
                actions={[
                    ...(completed ? [] : [{
                        title: t("dialog.sourceMigration.background"),
                        onPress: background,
                    }]),
                    {
                        title: completed ? t("common.close") : t("common.cancel"),
                        type: "primary",
                        onPress: dismiss,
                    },
                ]}
            />
        </Dialog>
    );
}

function getMediaKey(musicItem: IMusic.IMusicItem) {
    return `${musicItem.platform}@${musicItem.id}`;
}

function summarizeMigrationResult(states: ISourceMigrationState[]) {
    return states.reduce(
        (previous, state) => {
            previous[state.status] += 1;
            return previous;
        },
        {
            [SourceMigrationStatus.Pending]: 0,
            [SourceMigrationStatus.Success]: 0,
            [SourceMigrationStatus.Fail]: 0,
            [SourceMigrationStatus.Skip]: 0,
        } as Record<SourceMigrationStatus, number>,
    );
}

const styles = StyleSheet.create({
    content: {
        height: rpx(560),
        paddingHorizontal: 0,
    },
    summaryContainer: {
        paddingHorizontal: rpx(24),
        paddingBottom: rpx(12),
    },
});
