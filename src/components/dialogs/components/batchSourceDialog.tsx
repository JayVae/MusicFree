import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { FlatList } from "react-native-gesture-handler";
import Dialog from "./base";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";
import Config from "@/core/appConfig";
import pluginManager from "@/core/pluginManager";
import TrackPlayer from "@/core/trackPlayer";
import {
    BatchSourceStatus,
    IBatchSourceItemState,
    resolveBatchSources,
} from "@/core/mediaSourceBatch";
import { hideDialog } from "../useDialog";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";

interface IBatchSourceDialogProps {
    title: string;
    affectedMusicItems: IMusic.IMusicItem[];
    sheetId?: string;
    targetPluginName?: string;
}

export default function BatchSourceDialog(props: IBatchSourceDialogProps) {
    const {
        title,
        affectedMusicItems,
        sheetId,
        targetPluginName,
    } = props;
    const { t } = useI18N();
    const [states, setStates] = useState<IBatchSourceItemState[]>(
        affectedMusicItems.map(musicItem => ({
            musicItem,
            status: BatchSourceStatus.Pending,
        })),
    );
    const [completed, setCompleted] = useState(false);
    const shouldAbortRef = useRef(false);
    const backgroundedRef = useRef(false);

    useEffect(() => {
        let mounted = true;
        resolveBatchSources({
            musicItems: affectedMusicItems,
            sheetId,
            targetPluginName,
            pluginManagerService: pluginManager,
            configService: Config,
            currentMusic: TrackPlayer.currentMusic,
            shouldAbort: () => shouldAbortRef.current,
            onItemUpdate: state => {
                if (!mounted || shouldAbortRef.current || backgroundedRef.current) {
                    return;
                }
                setStates(previous => previous.map(item =>
                    isSameBatchItem(item.musicItem, state.musicItem)
                        ? state
                        : item,
                ));
            },
        }).then(result => {
            if (shouldAbortRef.current) {
                return;
            }
            if (backgroundedRef.current) {
                const summary = summarizeBatchSourceResult(result);
                Toast.success(t("dialog.batchSource.backgroundCompleted", summary));
                return;
            }
            setStates(result);
            setCompleted(true);
        }).catch(() => {
            if (shouldAbortRef.current) {
                return;
            }
            if (backgroundedRef.current) {
                Toast.warn(t("dialog.batchSource.backgroundFailed"));
                return;
            }
            setCompleted(true);
        });
        return () => {
            mounted = false;
        };
    }, [affectedMusicItems, sheetId, targetPluginName]);

    const summary = useMemo(() => {
        return states.reduce(
            (prev, item) => {
                prev[item.status] += 1;
                return prev;
            },
            {
                [BatchSourceStatus.Success]: 0,
                [BatchSourceStatus.Fail]: 0,
                [BatchSourceStatus.Skip]: 0,
                [BatchSourceStatus.Pending]: 0,
            } as Record<BatchSourceStatus, number>,
        );
    }, [states]);

    const dismiss = () => {
        shouldAbortRef.current = true;
        hideDialog();
    };

    const background = () => {
        backgroundedRef.current = true;
        hideDialog();
    };

    const getDescription = (item: IBatchSourceItemState) => {
        switch (item.status) {
        case BatchSourceStatus.Success:
            return t("dialog.batchSource.status.success", {
                plugin: item.pluginName ?? "-",
            });
        case BatchSourceStatus.Fail:
            return t(
                item.reason === "timeout"
                    ? "dialog.batchSource.status.timeout"
                    : "dialog.batchSource.status.fail",
            );
        case BatchSourceStatus.Skip:
            return t(
                item.reason === "current"
                    ? "dialog.batchSource.status.current"
                    : "dialog.batchSource.status.skipped",
            );
        default:
            return t("dialog.batchSource.status.pending");
        }
    };

    return (
        <Dialog onDismiss={dismiss}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content style={styles.content}>
                <FlatList
                    data={states}
                    keyExtractor={(item, index) => `${item.musicItem.platform}-${item.musicItem.id}-${index}`}
                    getItemLayout={(_, index) => ({
                        length: ListItem.Size.normal,
                        offset: ListItem.Size.normal * index,
                        index,
                    })}
                    renderItem={({ item }) => (
                        <ListItem withHorizontalPadding heightType="normal">
                            <ListItem.Content
                                title={`${item.musicItem.title} - ${item.musicItem.artist}`}
                                description={getDescription(item)}
                            />
                        </ListItem>
                    )}
                />
            </Dialog.Content>
            <View style={styles.summaryContainer}>
                <ThemeText fontSize="description" fontColor="textSecondary">
                    {t("dialog.batchSource.summary", summary)}
                </ThemeText>
            </View>
            <Dialog.Actions
                actions={[
                    ...(completed ? [] : [{
                        title: t("dialog.batchSource.background"),
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

function summarizeBatchSourceResult(states: IBatchSourceItemState[]) {
    return states.reduce(
        (prev, item) => {
            prev[item.status] += 1;
            return prev;
        },
        {
            [BatchSourceStatus.Success]: 0,
            [BatchSourceStatus.Fail]: 0,
            [BatchSourceStatus.Skip]: 0,
            [BatchSourceStatus.Pending]: 0,
        } as Record<BatchSourceStatus, number>,
    );
}

function isSameBatchItem(
    left: IMusic.IMusicItem,
    right: IMusic.IMusicItem,
) {
    return left.platform === right.platform && left.id === right.id;
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
