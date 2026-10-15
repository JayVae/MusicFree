import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { atom, getDefaultStore, useAtomValue } from "jotai";

export type DownloadRecordStatus = "pending" | "success" | "failed";

export interface IDownloadRecord {
    /** 历史记录唯一 key */
    key: string;
    /** 下载媒体唯一 key，便于启动后把未完成任务标记为中断 */
    mediaKey: string;
    musicItem: IMusic.IMusicItem;
    quality?: IMusic.IQualityKey;
    status: DownloadRecordStatus;
    filename?: string;
    localPath?: string;
    fileSize?: number;
    downloadedSize?: number;
    failReason?: string;
    failMessage?: string;
    pluginName?: string;
    createdAt: number;
    finishedAt?: number;
}

const DOWNLOAD_HISTORY_LIMIT = 10;
const downloadHistoryStore = getOrCreateMMKV("download.history");
const downloadHistoryAtom = atom<IDownloadRecord[]>(loadDownloadHistory());

function loadDownloadHistory(): IDownloadRecord[] {
    return safeParse<IDownloadRecord[]>(
        downloadHistoryStore.getString("records"),
    ) ?? [];
}

function saveDownloadHistory(records: IDownloadRecord[]) {
    const nextRecords = records
        .filter(record => !!record?.key && !!record?.mediaKey)
        .slice(0, DOWNLOAD_HISTORY_LIMIT);
    downloadHistoryStore.set("records", safeStringify(nextRecords));
    getDefaultStore().set(downloadHistoryAtom, nextRecords);
}

function getDownloadHistory() {
    return getDefaultStore().get(downloadHistoryAtom);
}

function getRecordKey(mediaKey: string, createdAt: number) {
    return `dl-record-${mediaKey}-${createdAt}`;
}

/**
 * 进程被杀后，pending 记录代表被中断的下载任务；
 * 不能留在历史中假装下载仍在进行或已经成功。
 */
function markInterruptedRecordsAsFailed(records: IDownloadRecord[]) {
    const now = Date.now();
    let changed = false;
    const nextRecords = records.map(record => {
        if (record.status !== "pending") {
            return record;
        }
        changed = true;
        return {
            ...record,
            status: "failed" as const,
            failReason: "interrupted",
            finishedAt: record.finishedAt ?? now,
        };
    });
    return changed ? nextRecords : records;
}

// 模块加载时当前队列必然为空，因此可以安全恢复中断状态。
saveDownloadHistory(markInterruptedRecordsAsFailed(loadDownloadHistory()));

export function recordDownloadStarted(input: {
    mediaKey: string;
    musicItem: IMusic.IMusicItem;
    quality?: IMusic.IQualityKey;
    filename?: string;
    pluginName?: string;
    createdAt: number;
}): string | undefined {
    const recordKey = getRecordKey(input.mediaKey, input.createdAt);
    const records = getDownloadHistory();
    const existingRecord = records.find(record => record.key === recordKey);
    if (existingRecord) {
        return existingRecord.key;
    }
    saveDownloadHistory([{
        key: recordKey,
        mediaKey: input.mediaKey,
        musicItem: input.musicItem,
        quality: input.quality,
        status: "pending",
        filename: input.filename,
        pluginName: input.pluginName,
        createdAt: input.createdAt,
    }, ...records]);
    return recordKey;
}

export function markDownloadCompleted(input: {
    historyKey?: string;
    filename: string;
    localPath: string;
    fileSize?: number;
    downloadedSize?: number;
}) {
    const records = getDownloadHistory();
    const targetIndex = records.findIndex(record => record.key === input.historyKey);
    if (targetIndex === -1) {
        return;
    }
    const nextRecords = [...records];
    nextRecords[targetIndex] = {
        ...nextRecords[targetIndex],
        status: "success",
        filename: input.filename,
        localPath: input.localPath,
        fileSize: input.fileSize,
        downloadedSize: input.downloadedSize,
        finishedAt: Date.now(),
        failReason: undefined,
        failMessage: undefined,
    };
    saveDownloadHistory(nextRecords);
}

export function markDownloadFailed(input: {
    historyKey?: string;
    failReason: string;
    failMessage?: string;
}) {
    const records = getDownloadHistory();
    const targetIndex = records.findIndex(record => record.key === input.historyKey);
    if (targetIndex === -1) {
        return;
    }
    const nextRecords = [...records];
    nextRecords[targetIndex] = {
        ...nextRecords[targetIndex],
        status: "failed",
        failReason: input.failReason,
        failMessage: input.failMessage,
        finishedAt: Date.now(),
    };
    saveDownloadHistory(nextRecords);
}

export function removeDownloadRecord(key: string) {
    saveDownloadHistory(
        getDownloadHistory().filter(record => record.key !== key),
    );
}

export function clearDownloadHistory() {
    saveDownloadHistory([]);
}

export function useDownloadHistory(): IDownloadRecord[] {
    return useAtomValue(downloadHistoryAtom);
}
