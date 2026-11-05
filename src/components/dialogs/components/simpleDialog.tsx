import React from "react";
import { hideDialog } from "../useDialog";
import Dialog from "./base";
import { useI18N } from "@/core/i18n";

interface ISimpleDialogProps {
    title: string;
    content: string | JSX.Element;
    okText?: string;
    cancelText?: string;
    /** 返回 false 可阻止当前弹窗关闭，用于在 onOk 中打开后续弹窗。 */
    onOk?: () => void | boolean | Promise<void | boolean>;
    onCancel?: () => void;
}
export default function SimpleDialog(props: ISimpleDialogProps) {
    const { title, content, onOk, onCancel, okText, cancelText } = props;

    const { t } = useI18N();

    const actions = onOk
        ? [
            {
                title: cancelText ?? t("common.cancel"),
                type: "normal",
                onPress() {
                    onCancel?.();
                    hideDialog();
                },
            },
            {
                title: okText ?? t("common.confirm"),
                type: "primary",
                onPress() {
                    if (onOk?.() !== false) {
                        hideDialog();
                    }
                },
            },
        ]
        : ([
            {
                title: okText ?? t("dialog.errorLogKnow"),
                type: "primary",
                onPress() {
                    hideDialog();
                },
            },
        ] as any);

    return (
        <Dialog onDismiss={hideDialog}>
            <Dialog.Title withDivider>{title}</Dialog.Title>
            <Dialog.Content needScroll>{content}</Dialog.Content>
            <Dialog.Actions actions={actions} />
        </Dialog>
    );
}
