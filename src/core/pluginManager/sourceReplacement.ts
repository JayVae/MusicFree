import { localPluginPlatform } from "@/constants/commonConst";
import { getDownloadHistory } from "@/core/downloadHistory";
import LocalMusicSheet from "@/core/localMusicSheet";
import musicHistory from "@/core/musicHistory";
import MusicSheet from "@/core/musicSheet";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import PersistStatus from "@/utils/persistStatus";
import { atom, getDefaultStore, useAtomValue } from "jotai";

export interface ISourceReplacementRecord {
    sourcePlatform: string;
    targetPluginName: string;
    updatedAt: number;
}

export interface ISourceReferenceSummary {
    platform: string;
    count: number;
}

type SourceReplacementRecords = Record<string, ISourceReplacementRecord>;

const sourceReplacementStore = getOrCreateMMKV("plugin.sourceReplacement");
const sourceReplacementAtom = atom<SourceReplacementRecords>(
    loadSourceReplacementRecords(),
);

function normalizePlatform(platform?: string | null) {
    return platform?.trim() ?? "";
}

function loadSourceReplacementRecords(): SourceReplacementRecords {
    const records = safeParse<SourceReplacementRecords>(
        sourceReplacementStore.getString("records"),
    ) ?? {};
    const normalizedRecords: SourceReplacementRecords = {};

    Object.values(records).forEach(record => {
        const sourcePlatform = normalizePlatform(record?.sourcePlatform);
        const targetPluginName = record?.targetPluginName?.trim();
        if (
            !sourcePlatform ||
            !targetPluginName ||
            sourcePlatform === localPluginPlatform
        ) {
            return;
        }
        normalizedRecords[sourcePlatform] = {
            sourcePlatform,
            targetPluginName,
            updatedAt: record.updatedAt ?? 0,
        };
    });

    return normalizedRecords;
}

function saveSourceReplacementRecords(records: SourceReplacementRecords) {
    sourceReplacementStore.set("records", safeStringify(records));
    getDefaultStore().set(sourceReplacementAtom, records);
}

export function getSourceReplacementRecords() {
    return getDefaultStore().get(sourceReplacementAtom);
}

export function getSourceReplacementTarget(sourcePlatform?: string | null) {
    const platform = normalizePlatform(sourcePlatform);
    if (!platform) {
        return null;
    }
    return getSourceReplacementRecords()[platform]?.targetPluginName ?? null;
}

export function setSourceReplacement(
    sourcePlatform: string,
    targetPluginName: string,
) {
    const platform = normalizePlatform(sourcePlatform);
    const target = targetPluginName.trim();
    if (!platform || !target || platform === localPluginPlatform) {
        return false;
    }

    const records = getSourceReplacementRecords();
    saveSourceReplacementRecords({
        ...records,
        [platform]: {
            sourcePlatform: platform,
            targetPluginName: target,
            updatedAt: Date.now(),
        },
    });
    return true;
}

export function removeSourceReplacement(sourcePlatform: string) {
    const platform = normalizePlatform(sourcePlatform);
    const records = getSourceReplacementRecords();
    if (!platform || !records[platform]) {
        return false;
    }

    const nextRecords = { ...records };
    delete nextRecords[platform];
    saveSourceReplacementRecords(nextRecords);
    return true;
}

export function useSourceReplacementRecords() {
    return useAtomValue(sourceReplacementAtom);
}

export function summarizeSourceReferences(
    musicItems: Array<IMusic.IMusicItem | null | undefined>,
): ISourceReferenceSummary[] {
    const mediaKeysByPlatform = new Map<string, Set<string>>();

    musicItems.forEach(musicItem => {
        const platform = normalizePlatform(musicItem?.platform);
        if (
            !platform ||
            platform === localPluginPlatform ||
            !musicItem?.id
        ) {
            return;
        }
        const platformKeys = mediaKeysByPlatform.get(platform) ?? new Set();
        platformKeys.add(getMediaUniqueKey(musicItem));
        mediaKeysByPlatform.set(platform, platformKeys);
    });

    return [...mediaKeysByPlatform.entries()]
        .map(([platform, mediaKeys]) => ({
            platform,
            count: mediaKeys.size,
        }))
        .sort((a, b) =>
            b.count - a.count ||
            a.platform.localeCompare(b.platform),
        );
}

export function collectSourceReferences(): ISourceReferenceSummary[] {
    const playlistMusic = MusicSheet.backupSheets()
        .flatMap(sheet => sheet.musicList ?? []);
    const playbackQueue = PersistStatus.get("music.playList") ?? [];
    const currentMusic = PersistStatus.get("music.musicItem");
    const downloadedMusic = getDownloadHistory()
        .map(record => record.musicItem);

    return summarizeSourceReferences([
        ...playlistMusic,
        ...playbackQueue,
        currentMusic,
        ...musicHistory.history,
        ...LocalMusicSheet.getMusicList(),
        ...downloadedMusic,
    ]);
}
