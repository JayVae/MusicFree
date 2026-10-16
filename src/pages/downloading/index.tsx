import React from "react";
import StatusBar from "@/components/base/statusBar";
import DownloadingList from "./downloadingList";
import MusicBar from "@/components/musicBar";
import VerticalSafeAreaView from "@/components/base/verticalSafeAreaView";
import globalStyle from "@/constants/globalStyle";
import AppBar from "@/components/base/appBar";
import { clearDownloadHistory } from "@/core/downloadHistory";
import { useI18N } from "@/core/i18n";

export default function Downloading() {
    const { t } = useI18N();

    return (
        <VerticalSafeAreaView style={globalStyle.fwflex1}>
            <StatusBar />
            <AppBar
                menu={[{
                    icon: "trash-outline",
                    title: t("downloading.history.clear"),
                    onPress: clearDownloadHistory,
                }]}>
                {t("downloading.title")}
            </AppBar>
            <DownloadingList />
            <MusicBar />
        </VerticalSafeAreaView>
    );
}
