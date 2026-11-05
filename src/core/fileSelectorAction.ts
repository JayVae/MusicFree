export interface IFileSelectorSelectedItem {
    path: string;
    type: "file" | "folder";
}

type FileSelectorAction = (
    selectedFiles: IFileSelectorSelectedItem[],
) => Promise<boolean>;

let activeAction: FileSelectorAction | null = null;

export function setFileSelectorAction(action: FileSelectorAction) {
    activeAction = action;
}

export function clearFileSelectorAction() {
    activeAction = null;
}

export async function runFileSelectorAction(
    selectedFiles: IFileSelectorSelectedItem[],
) {
    const action = activeAction;
    if (!action) {
        return false;
    }

    const shouldBack = await action(selectedFiles);
    if (shouldBack) {
        activeAction = null;
    }
    return shouldBack;
}
