import AppBar from "@/components/base/appBar";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel.ts";
import { SortType } from "@/constants/commonConst.ts";
import { useI18N } from "@/core/i18n";
import Config from "@/core/appConfig";
import pluginManager from "@/core/pluginManager";
import {
    findBatchSourceCandidates,
    getBatchSourceTargetPlugins,
} from "@/core/mediaSourceBatch";
import MusicSheet, { useSheetItem } from "@/core/musicSheet";
import { ROUTE_PATH, useParams } from "@/core/router";
import { default as Toast, default as toast } from "@/utils/toast";
import { useNavigation } from "@react-navigation/native";
import React, { useRef } from "react";

export default function () {
    const navigation = useNavigation<any>();
    const batchFilterAbortRef = useRef(false);
    const { id = "favorite" } = useParams<"local-sheet-detail">();
    const musicSheet = useSheetItem(id);
    const { t } = useI18N();

    return (
        <>
            <AppBar
                menu={[
                    {
                        icon: "pencil-outline",
                        title: t("sheetDetail.editSheetInfo"),
                        onPress() {
                            showPanel("EditMusicSheetInfo", {
                                musicSheet: musicSheet,
                            });
                        },
                    },
                    {
                        icon: "pencil-square",
                        title: t("sheetDetail.batchEditMusic"),
                        onPress() {
                            navigation.navigate(ROUTE_PATH.MUSIC_LIST_EDITOR, {
                                musicList: musicSheet.musicList,
                                musicSheet: musicSheet,
                            });
                        },
                    },
                    {
                        icon: "arrow-path",
                        title: t("sheetDetail.batchChangeSource"),
                        onPress() {
                            batchFilterAbortRef.current = false;
                            if (!musicSheet?.musicList?.length) {
                                Toast.success(t("dialog.batchSource.noAffected"));
                                return;
                            }
                            showDialog("LoadingDialog", {
                                title: t("sheetDetail.batchChangeSource"),
                                loadingText: t("dialog.batchSource.filtering"),
                                async task() {
                                    return findBatchSourceCandidates({
                                        musicItems: musicSheet.musicList,
                                        pluginManagerService: pluginManager,
                                        configService: Config,
                                        shouldAbort: () => batchFilterAbortRef.current,
                                    });
                                },
                                onCancel(hideLoadingDialog) {
                                    batchFilterAbortRef.current = true;
                                    hideLoadingDialog();
                                },
                                onResolve(affectedMusicItems, hideLoadingDialog) {
                                    hideLoadingDialog();
                                    if (!affectedMusicItems.length) {
                                        Toast.success(t("dialog.batchSource.noAffected"));
                                        return;
                                    }
                                    const targetPlugins = getBatchSourceTargetPlugins(pluginManager);
                                    showDialog("RadioDialog", {
                                        title: t("sheetDetail.batchChangeSourceWithCount", {
                                            count: affectedMusicItems.length,
                                        }),
                                        tip: t("dialog.batchSource.affectedCount", {
                                            count: affectedMusicItems.length,
                                        }),
                                        content: [
                                            {
                                                value: "__auto__",
                                                icon: "strategy",
                                                label: t("dialog.batchSource.autoSelect"),
                                            },
                                            ...targetPlugins.map(plugin => ({
                                                value: plugin.name,
                                                label: plugin.name,
                                            })),
                                        ],
                                        defaultSelected: "__auto__",
                                        onOk(value) {
                                            showDialog("BatchSourceDialog", {
                                                title: t("sheetDetail.batchChangeSourceWithCount", {
                                                    count: affectedMusicItems.length,
                                                }),
                                                affectedMusicItems,
                                                sheetId: id,
                                                targetPluginName:
                                                    value === "__auto__" ? undefined : String(value),
                                            });
                                        },
                                    });
                                },
                            });
                        },
                    },
                    {
                        icon: "sort-outline",
                        title: t("sheetDetail.sortMusic"),
                        onPress() {
                            showDialog("RadioDialog", {
                                content: [
                                    {
                                        value: SortType.Title,
                                        label: t("sheetDetail.sortMusicOption.byTitle"),
                                    },
                                    {
                                        value: SortType.Artist,
                                        label: t("sheetDetail.sortMusicOption.byArtist"),
                                    },
                                    {
                                        value: SortType.Album,
                                        label: t("sheetDetail.sortMusicOption.byAlbum"),
                                    },
                                    {
                                        value: SortType.Newest,
                                        label: t("sheetDetail.sortMusicOption.newest"),
                                    },
                                    {
                                        value: SortType.Oldest,
                                        label: t("sheetDetail.sortMusicOption.oldest"),
                                    },
                                ],
                                defaultSelected:
                                    MusicSheet.getSheetMeta(id, "sort") ||
                                    SortType.None,
                                title: t("sheetDetail.sortMusic"),
                                async onOk(value) {
                                    await MusicSheet.setSortType(
                                        id,
                                        value as SortType,
                                    );
                                    toast.success(t("toast.sortHasBeenUpdated"));
                                },
                            });
                        },
                    },
                    {
                        icon: "trash-outline",
                        title: t("sheetDetail.deleteSheet"),
                        show: id !== "favorite",
                        onPress() {
                            showDialog("SimpleDialog", {
                                title: t("sheetDetail.deleteSheet"),
                                content: t("sheetDetail.deleteSheetContent", {
                                    name: musicSheet.title,
                                }),
                                onOk: async () => {
                                    await MusicSheet.removeSheet(id);
                                    Toast.success(t("toast.deleteSuccess"));
                                    navigation.goBack();
                                },
                            });
                        },
                    },
                ]}
                actions={[
                    {
                        icon: "magnifying-glass",
                        onPress() {
                            navigation.navigate(ROUTE_PATH.SEARCH_MUSIC_LIST, {
                                musicList: musicSheet?.musicList,
                                musicSheet: musicSheet,
                            });
                        },
                    },
                ]}>
                {t("common.sheet")}
            </AppBar>
        </>
    );
}
