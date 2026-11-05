import CheckStorage from "@/components/dialogs/components/checkStorage.tsx";
import DownloadDialog from "./downloadDialog";
import EditSheetDetailDialog from "./editSheetDetail";
import LoadingDialog from "./loadingDialog";
import MarkdownDialog from "./markdownDialog";
import RadioDialog from "./radioDialog";
import SimpleDialog from "./simpleDialog";
import SubscribePluginDialog from "./subscribePluginDialog";
import SubscriptionInstallDialog from "./subscriptionInstallDialog";
import SetScheduleCloseTimeDialog from "./setScheduleCloseTimeDialog";
import BatchSourceDialog from "./batchSourceDialog";
import SourceMigrationDialog from "./sourceMigrationDialog";

const dialogs = {
    SimpleDialog,
    RadioDialog,
    DownloadDialog,
    SubscribePluginDialog,
    SubscriptionInstallDialog,
    LoadingDialog,
    EditSheetDetailDialog,
    CheckStorage,
    MarkdownDialog,
    SetScheduleCloseTimeDialog,
    BatchSourceDialog,
    SourceMigrationDialog,
};

export default dialogs;

export type IDialogType = typeof dialogs;
export type IDialogKey = keyof IDialogType;
