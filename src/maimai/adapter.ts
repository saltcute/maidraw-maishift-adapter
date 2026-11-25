import { Difficulty, Type } from "gcm-database/maimai";
import type { Chart, Database } from "gcm-database-local/maimai";
import {
    BaseScoreAdapter,
    type DataOrError,
    FailedToFetchError,
    UnsupportedMethodError,
} from "maidraw";
import {
    AchievementTypes,
    ComboLamp,
    type MaimaiScoreAdapter,
    type Score,
    SyncLamp,
} from "maidraw/maimai";

/**
 * Data regions of the maishift API. `na` is the international data as North
 * American cabinets see it.
 */
export type MaishiftRegion = "intl" | "jp" | "na";

export interface MaishiftScoreAdapterOptions {
    /**
     * maishift API key (`msk_…`), issued in Settings › Developer on
     * maimai.shiftpsh.com.
     */
    apiKey: string;
    /**
     * Region to read records from. Defaults to each player's home region.
     */
    region?: MaishiftRegion;
}

type ApiDifficulty = "BASIC" | "ADVANCED" | "EXPERT" | "MASTER" | "RE_MASTER";

interface ApiError {
    error: { code: string; message: string };
}

interface ApiProfile {
    handle: string;
    region: MaishiftRegion;
    profile: {
        name: string;
        rating: number;
        iconUrl: string;
        title: { text: string; tier: string };
    };
}

interface ApiRecord {
    chartId: number;
    title: string;
    type: "STANDARD" | "DX";
    difficulty: ApiDifficulty;
    level: string;
    /** Chart constant ×10. */
    internalLevel: number;
    /** Achievement ×10000. */
    achievement: number;
    combo:
        | "PLAYED"
        | "FULL_COMBO"
        | "FULL_COMBO_PLUS"
        | "ALL_PERFECT"
        | "ALL_PERFECT_PLUS";
    sync:
        | "PLAYED"
        | "SYNC_PLAY"
        | "FULL_SYNC"
        | "FULL_SYNC_PLUS"
        | "FULL_SYNC_DX"
        | "FULL_SYNC_DX_PLUS";
    dxScore: number;
    dxScoreMax: number;
    rating: number;
    ratingAccurate: boolean;
}

interface ApiRecords {
    handle: string;
    region: MaishiftRegion;
    version: number;
    syncedAt: string;
    /** Played charts only. */
    records: ApiRecord[];
    /** Chart ids counted in the rating, highest first. */
    best: { new: number[]; old: number[] };
}

const API_DIFFICULTY: Partial<Record<Difficulty, ApiDifficulty>> = {
    [Difficulty.BASIC]: "BASIC",
    [Difficulty.ADVANCED]: "ADVANCED",
    [Difficulty.EXPERT]: "EXPERT",
    [Difficulty.MASTER]: "MASTER",
    [Difficulty.RE_MASTER]: "RE_MASTER",
};

function toDifficulty(difficulty: ApiDifficulty): Difficulty {
    switch (difficulty) {
        case "BASIC":
            return Difficulty.BASIC;
        case "ADVANCED":
            return Difficulty.ADVANCED;
        case "EXPERT":
            return Difficulty.EXPERT;
        case "MASTER":
            return Difficulty.MASTER;
        case "RE_MASTER":
            return Difficulty.RE_MASTER;
    }
}

function toComboLamp(combo: ApiRecord["combo"]): ComboLamp {
    switch (combo) {
        case "FULL_COMBO":
            return ComboLamp.FULL_COMBO;
        case "FULL_COMBO_PLUS":
            return ComboLamp.FULL_COMBO_PLUS;
        case "ALL_PERFECT":
            return ComboLamp.ALL_PERFECT;
        case "ALL_PERFECT_PLUS":
            return ComboLamp.ALL_PERFECT_PLUS;
        default:
            return ComboLamp.NONE;
    }
}

function toSyncLamp(sync: ApiRecord["sync"]): SyncLamp {
    switch (sync) {
        case "SYNC_PLAY":
            return SyncLamp.SYNC_PLAY;
        case "FULL_SYNC":
            return SyncLamp.FULL_SYNC;
        case "FULL_SYNC_PLUS":
            return SyncLamp.FULL_SYNC_PLUS;
        case "FULL_SYNC_DX":
            return SyncLamp.FULL_SYNC_DX;
        case "FULL_SYNC_DX_PLUS":
            return SyncLamp.FULL_SYNC_DX_PLUS;
        default:
            return SyncLamp.NONE;
    }
}

/** Lower bounds of each rank, achievement ×10000, highest first. */
const RANK_THRESHOLDS: [number, AchievementTypes][] = [
    [1005000, AchievementTypes.SSSP],
    [1000000, AchievementTypes.SSS],
    [995000, AchievementTypes.SSP],
    [990000, AchievementTypes.SS],
    [980000, AchievementTypes.SP],
    [970000, AchievementTypes.S],
    [940000, AchievementTypes.AAA],
    [900000, AchievementTypes.AA],
    [800000, AchievementTypes.A],
    [750000, AchievementTypes.BBB],
    [700000, AchievementTypes.BB],
    [600000, AchievementTypes.B],
    [500000, AchievementTypes.C],
];

export class MaishiftScoreAdapter
    extends BaseScoreAdapter
    implements MaimaiScoreAdapter
{
    private readonly apiKey: string;
    private readonly region?: MaishiftRegion;

    constructor(
        private readonly database: Database,
        { apiKey, region }: MaishiftScoreAdapterOptions,
    ) {
        super({
            baseUrl: "https://maimai.shiftpsh.com/api/v1",
            name: "maishift",
        });
        this.apiKey = apiKey;
        this.region = region;
    }

    /**
     * GETs an API endpoint. The key is sent per request rather than as an
     * axios default so that it is never sent to other hosts (e.g. the icon
     * CDN).
     */
    private async apiGet<T extends object>(
        endpoint: string,
        what: string,
        cacheTtl = 1 * 60 * 1000,
    ): Promise<DataOrError<T>> {
        const res = await this.get<T | ApiError>(
            endpoint,
            this.region ? { region: this.region } : undefined,
            cacheTtl,
            { headers: { "X-API-Key": this.apiKey } },
        );
        if (!res || typeof res !== "object" || res instanceof Error) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    what,
                    "An unknown error has occured.",
                ),
            };
        }
        if ("error" in res) {
            const message = (() => {
                switch (res.error.code) {
                    case "not_public":
                        return "The user's profile is private.";
                    case "not_found":
                        return "The user does not exist or has no records in this region.";
                    default:
                        return `${res.error.code}: ${res.error.message}`;
                }
            })();
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    what,
                    message,
                ),
            };
        }
        return { data: res as T };
    }

    private async fetchProfile(username: string) {
        return await this.apiGet<ApiProfile>(
            `/profiles/${encodeURIComponent(username)}`,
            "player profile",
        );
    }

    private async fetchRecords(username: string, what: string) {
        return await this.apiGet<ApiRecords>(
            `/profiles/${encodeURIComponent(username)}/records`,
            what,
        );
    }

    async getPlayerInfo(username: string) {
        const res = await this.fetchProfile(username);
        if (res.err) return res;
        const { name, rating, iconUrl, title } = res.data.profile;
        return {
            data: { name, rating, avatarUrl: iconUrl, title: title.text },
        };
    }

    async getPlayerProfilePicture(
        username: string,
    ): Promise<DataOrError<Buffer>> {
        const res = await this.fetchProfile(username);
        if (res.err) return res;
        const buffer = await this.get<Buffer>(
            res.data.profile.iconUrl,
            undefined,
            2 * 60 * 60 * 1000,
            {
                responseType: "arraybuffer",
                // SEGA's icon host drops connections from axios's default
                // (and browser-like) user agents.
                headers: { "User-Agent": "maidraw-maishift-adapter" },
            },
        );
        if (!(buffer instanceof Buffer)) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "player profile picture",
                    "An unknown error has occured.",
                ),
            };
        }
        return { data: buffer };
    }

    async getPlayerBest50(
        username: string,
    ): Promise<DataOrError<{ new: Score[]; old: Score[] }>> {
        const res = await this.fetchRecords(username, "personal best scores");
        if (res.err) return res;
        const byId = new Map(res.data.records.map((r) => [r.chartId, r]));
        const resolve = async (ids: number[]) => {
            const scores: Score[] = [];
            for (const id of ids) {
                const record = byId.get(id);
                if (!record) continue;
                const chart = await this.findChart(record);
                if (chart) scores.push(this.toMaiDrawScore(record, chart));
            }
            return scores;
        };
        return {
            data: {
                new: await resolve(res.data.best.new),
                old: await resolve(res.data.best.old),
            },
        };
    }

    async getPlayerScore(
        username: string,
        chartIdentifier: string,
    ): Promise<DataOrError<Record<Difficulty, Score | null>>> {
        const result = Object.fromEntries(
            Object.values(Difficulty).map((difficulty) => [difficulty, null]),
        ) as Record<Difficulty, Score | null>;
        const res = await this.fetchRecords(username, "player score");
        if (res.err) return res;
        for (const difficulty of Object.values(Difficulty)) {
            const apiDifficulty = API_DIFFICULTY[difficulty];
            if (!apiDifficulty) continue;
            const { data: chart } = await this.database.getChart(
                chartIdentifier,
                difficulty,
            );
            if (!chart) continue;
            const apiType = chart.type === Type.DELUXE ? "DX" : "STANDARD";
            const record = res.data.records.find(
                (r) =>
                    r.title === chart.title &&
                    r.type === apiType &&
                    r.difficulty === apiDifficulty,
            );
            if (record) result[difficulty] = this.toMaiDrawScore(record, chart);
        }
        return { data: result };
    }

    /**
     * Resolves an API record against the local database by title, type,
     * difficulty and chart constant.
     */
    private async findChart(record: ApiRecord): Promise<Chart | null> {
        const { data } = await this.database.searchChart({
            title: record.title,
            level: record.internalLevel / 10,
            difficulty: toDifficulty(record.difficulty),
            type: record.type === "DX" ? Type.DELUXE : Type.STANDARD,
        });
        let best: { chart: Chart; weight: number } | undefined;
        for (const candidate of data ?? []) {
            const weight = candidate.weight ?? 0;
            if (!best || weight < best.weight) {
                best = { chart: candidate.chart, weight };
            }
        }
        if (!best) {
            this.logger.debug(
                `No chart found for "${record.title}" (${record.type} ${record.difficulty}).`,
            );
            return null;
        }
        return best.chart;
    }

    toMaiDrawScore(record: ApiRecord, chart: Chart): Score {
        return {
            chart: {
                ...chart,
                internalLevel: record.internalLevel / 10,
            },
            combo: toComboLamp(record.combo),
            sync: toSyncLamp(record.sync),
            achievement: record.achievement / 10000,
            achievementRank:
                RANK_THRESHOLDS.find(
                    ([threshold]) => record.achievement >= threshold,
                )?.[1] ?? AchievementTypes.D,
            dxRating: record.rating,
            dxScore: record.dxScore,
        };
    }

    async getPlayerLevel50(
        _username: string,
        _level: number,
        _page: number,
        _options?: { percise: boolean },
    ): Promise<DataOrError<Score[]>> {
        return {
            err: new UnsupportedMethodError(
                "maidraw.maimai.adapter.maishift",
                "getPlayerLevel50",
            ),
        };
    }
}
