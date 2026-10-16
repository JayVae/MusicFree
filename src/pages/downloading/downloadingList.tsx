import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Pressable, StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import TextButton from "@/components/base/textButton";
import { exists } from "react-native-fs";
import rpx from "@/utils/rpx";
import { sizeFormatter } from "@/utils/fileUtils";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import useColors from "@/hooks/useColors";
import {
    DownloadFailReason,
    DownloadStatus,
    useDownloadQueue,
    useDownloadTask,
} from "@/core/downloader";
import {
    IDownloadRecord,
    removeDownloadRecord,
    useDownloadHistory,
} from "@/core/downloadHistory";
import { useI18N } from "@/core/i18n";

type DownloadFilter = "all" | "active" | "success" | "failed";

type DownloadListItem =
    | {
        type: "active";
        key: string;
        musicItem: IMusic.IMusicItem;
    }
    | {
        type: "history";
        key: string;
        record: IDownloadRecord;
    };

interface DownloadingListItemProps {
    item: DownloadListItem;
}

function getDownloadFailReasonDescription(
    record: IDownloadRecord,
    t: ReturnType<typeof useI18N>["t"],
) {
    if (record.failReason === DownloadFailReason.NetworkOffline) {
        return t("downloading.downloadFailReason.networkOffline");
    }
    if (record.failReason === DownloadFailReason.NotAllowToDownloadInCellular) {
        return t("downloading.downloadFailReason.notAllowInCellular");
    }
    if (record.failReason === DownloadFailReason.NoWritePermission) {
        return t("downloading.downloadFailReason.noWritePermission");
    }
    if (record.failReason === DownloadFailReason.FailToFetchSource) {
        return t("downloading.downloadFailReason.failToFetchSource");
    }
    if (record.failReason === "interrupted") {
        return t("downloading.downloadFailReason.interrupted");
    }
    if (record.failMessage) {
        return t("downloading.downloadFailReason.unknownWithDetail", {
            message: record.failMessage,
        });
    }
    return t("downloading.downloadFailReason.unknown");
}

function useDownloadFileState(localPath?: string) {
    const [fileExists, setFileExists] = useState<boolean | null>(null);

    useEffect(() => {
        let mounted = true;
        if (!localPath) {
            setFileExists(null);
            return;
        }
        exists(localPath).then(result => {
            if (mounted) {
                setFileExists(result);
            }
        }).catch(() => {
            if (mounted) {
                setFileExists(null);
            }
        });
        return () => {
            mounted = false;
        };
    }, [localPath]);

    return fileExists;
}

function ActiveDownloadItem(props: {
    musicItem: IMusic.IMusicItem;
}) {
    const { musicItem } = props;
    const taskInfo = useDownloadTask(musicItem);
    const { t } = useI18N();
    const status = taskInfo?.status ?? DownloadStatus.Error;
    let description = "";

    if (status === DownloadStatus.Error) {
        if (taskInfo?.errorReason === DownloadFailReason.NoWritePermission) {
            description = t("downloading.downloadFailReason.noWritePermission");
        } else if (taskInfo?.errorReason === DownloadFailReason.FailToFetchSource) {
            description = t("downloading.downloadFailReason.failToFetchSource");
        } else {
            description = t("downloading.downloadFailReason.unknown");
        }
    } else if (status === DownloadStatus.Completed) {
        description = t("downloading.downloadStatus.completed");
    } else if (status === DownloadStatus.Downloading) {
        const progress = taskInfo?.downloadedSize ? sizeFormatter(taskInfo.downloadedSize) : "-";
        const totalSize = taskInfo?.fileSize ? sizeFormatter(taskInfo.fileSize) : "-";
        description = t("downloading.downloadStatus.downloadProgress", {
            progress,
            totalSize,
        });
    } else if (status === DownloadStatus.Pending) {
        description = t("downloading.downloadStatus.pending");
    } else if (status === DownloadStatus.Preparing) {
        description = t("downloading.downloadStatus.preparing");
    }

    return (
        <ListItem withHorizontalPadding>
            <ListItem.Content
                title={musicItem.title}
                description={description}
            />
        </ListItem>
    );
}

function HistoryDownloadItem(props: {
    record: IDownloadRecord;
}) {
    const { record } = props;
    const { t } = useI18N();
    const finishedTime = dayjs(record.finishedAt ?? record.createdAt).format(
        "YYYY-MM-DD HH:mm:ss",
    );
    const fileExists = useDownloadFileState(record.localPath);
    const fileState = record.localPath && fileExists === false
        ? t("downloading.history.fileMissing")
        : undefined;

    const description = record.status === "success" ? (
        <View style={style.descriptionWrapper}>
            <ThemeText
                fontSize="description"
                fontColor="textSecondary">
                {t("downloading.downloadStatus.completed")}
            </ThemeText>
            {record.filename ? (
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    numberOfLines={2}>
                    {record.filename}
                </ThemeText>
            ) : null}
            <ThemeText
                fontSize="description"
                fontColor="textSecondary">
                {[
                    record.fileSize ? sizeFormatter(record.fileSize) : undefined,
                    finishedTime,
                    fileState,
                ].filter((part): part is string => !!part).join(" · ")}
            </ThemeText>
        </View>
    ) : (
        <View style={style.descriptionWrapper}>
            <ThemeText
                fontSize="description"
                fontColor="textSecondary">
                {getDownloadFailReasonDescription(record, t)}
            </ThemeText>
            <ThemeText
                fontSize="description"
                fontColor="textSecondary">
                {finishedTime}
            </ThemeText>
        </View>
    );

    return (
        <ListItem
            withHorizontalPadding
            heightType="none"
            style={style.historyItem}>
            <ListItem.Content
                containerStyle={style.historyContent}
                title={record.musicItem.title}
                description={description}
            />
            <TextButton
                style={style.historyAction}
                fontColor="textSecondary"
                onPress={() => removeDownloadRecord(record.key)}>
                {t("common.delete")}
            </TextButton>
        </ListItem>
    );
}

function DownloadingListItem(props: DownloadingListItemProps) {
    const { item } = props;
    if (item.type === "active") {
        return <ActiveDownloadItem musicItem={item.musicItem} />;
    }
    return <HistoryDownloadItem record={item.record} />;
}

export default function DownloadingList() {
    const downloadQueue = useDownloadQueue();
    const downloadHistory = useDownloadHistory();
    const { t } = useI18N();
    const colors = useColors();
    const [filter, setFilter] = useState<DownloadFilter>("all");

    const activeMediaKeys = useMemo(
        () => new Set(downloadQueue.map(item => getMediaUniqueKey(item))),
        [downloadQueue],
    );

    const listData = useMemo(() => {
        const activeItems: DownloadListItem[] = downloadQueue.map(item => ({
            type: "active",
            key: `active-${getMediaUniqueKey(item)}`,
            musicItem: item,
        }));
        const historyItems: DownloadListItem[] = downloadHistory
            .filter(record => !activeMediaKeys.has(record.mediaKey))
            .map(record => ({
                type: "history" as const,
                key: record.key,
                record,
            }));
        const records = [...activeItems, ...historyItems];

        if (filter === "active") {
            return activeItems;
        }
        if (filter === "success") {
            return historyItems.filter(item =>
                item.type === "history" && item.record.status === "success"
            );
        }
        if (filter === "failed") {
            return historyItems.filter(item =>
                item.type === "history" && item.record.status === "failed"
            );
        }
        return records;
    }, [activeMediaKeys, downloadHistory, downloadQueue, filter]);

    const filters: Array<{
        key: DownloadFilter;
        label: string;
    }> = [
        { key: "all", label: t("downloading.filter.all") },
        { key: "active", label: t("downloading.filter.active") },
        { key: "success", label: t("downloading.filter.success") },
        { key: "failed", label: t("downloading.filter.failed") },
    ];

    return (
        <View style={style.wrapper}>
            <View style={style.filterWrapper}>
                {filters.map(item => {
                    const selected = filter === item.key;
                    return (
                        <Pressable
                            key={item.key}
                            onPress={() => setFilter(item.key)}
                            style={[
                                style.filterItem,
                                {
                                    backgroundColor: selected
                                        ? colors.primary
                                        : colors.placeholder,
                                },
                            ]}>
                            <ThemeText
                                fontSize="subTitle"
                                fontColor={selected ? "appBarText" : "text"}>
                                {item.label}
                            </ThemeText>
                        </Pressable>
                    );
                })}
            </View>
            <FlashList
                style={style.downloading}
                data={listData}
                keyExtractor={item => item.key}
                renderItem={({ item }) => <DownloadingListItem item={item} />}
            />
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        flex: 1,
    },
    filterWrapper: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
        gap: rpx(12),
    },
    filterItem: {
        height: rpx(56),
        paddingHorizontal: rpx(22),
        borderRadius: rpx(28),
        alignItems: "center",
        justifyContent: "center",
    },
    downloading: {
        flexGrow: 0,
    },
    descriptionWrapper: {
        gap: rpx(6),
    },
    historyItem: {
        minHeight: rpx(132),
        alignItems: "center",
        paddingVertical: rpx(16),
    },
    historyContent: {
        height: "auto",
        minHeight: rpx(100),
        justifyContent: "center",
    },
    historyAction: {
        flexShrink: 0,
        marginLeft: rpx(16),
        paddingVertical: rpx(16),
        paddingHorizontal: rpx(12),
    },
});
