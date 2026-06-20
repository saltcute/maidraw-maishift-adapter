import * as Cheerio from "cheerio";
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
 * A scraped score row from maimai.shiftpsh.com, before being resolved against
 * the database into a maidraw {@link Score}.
 */
interface ScrapedScore {
    rank: string;
    level: number;
    rating: number;
    name: string;
    rate: number;
    combo: string;
    sync: string;
    isDx: boolean;
}

export class MaishiftScoreAdapter
    extends BaseScoreAdapter
    implements MaimaiScoreAdapter
{
    constructor(private readonly database: Database) {
        super({
            baseUrl: "https://maimai.shiftpsh.com/en",
            name: "maishift",
        });
    }
    private static readonly CURRENT_MINOR = 60;
    private minorToAccumulateVer(minor: number, isDx: boolean = true) {
        if (isDx) {
            if (minor >= 60) return 25;
            if (minor >= 55) return 24;
            if (minor >= 50) return 23;
            if (minor >= 45) return 22;
            if (minor >= 40) return 21;
            if (minor >= 35) return 20;
            if (minor >= 30) return 19;
            if (minor >= 25) return 18;
            if (minor >= 20) return 17;
            if (minor >= 15) return 16;
            if (minor >= 10) return 15;
            if (minor >= 5) return 14;
            return 13;
        } else {
            if (minor >= 97) return 12;
            if (minor >= 95) return 11;
            if (minor >= 90) return 10;
            if (minor >= 85) return 9;
            if (minor >= 80) return 8;
            if (minor >= 70) return 7;
            if (minor >= 60) return 6;
            if (minor >= 50) return 5;
            if (minor >= 40) return 4;
            if (minor >= 30) return 3;
            if (minor >= 20) return 2;
            if (minor >= 10) return 1;
            return 0;
        }
    }
    private async profileScraper(username: string) {
        const Html = await this.get<string>(
            `/profile/${username}/home`,
            undefined,
            1 * 60 * 1000,
        );
        if (!Html) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "player profile",
                    "An unknown error has occured.",
                ),
            };
        }
        if (this.isPagePrivate(Html)) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "player profile",
                    "The user does not have any score or their profile is private.",
                ),
            };
        }
        const $ = Cheerio.load(Html.replace(/<style.*?>.*?<\/style>/g, ""));
        const profileElement = $("> div", $("body > div")[2])[1];
        const name = $($("> div > span", $("> div", profileElement))[0]).text();
        const avatarUrl = $("> img", profileElement).attr("src");
        const title = $($("> div", $("> div", profileElement))[0]).text();
        const rating = parseInt(
            $($("> div > div", $("> div", profileElement))[1]).text(),
            10,
        );
        if (!name || !avatarUrl || Number.isNaN(rating)) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "player profile",
                    "Failed to parse player profile.",
                ),
            };
        }
        return { data: { name, avatarUrl, title, rating } };
    }
    private getScoresFromDom(
        $: Cheerio.CheerioAPI,
        length: number,
    ): ScrapedScore[] {
        const Dom = $("> div > div", $("> div", $("body > div")[4])[2]).slice(
            0,
            length,
        );
        const scores: ScrapedScore[] = [];
        for (const score of Dom) {
            const level = parseFloat(
                $($("> div", score)[0]).text().replace("+", ""),
            );
            const name = $($("> span", $("> div", score)[1])[0]).text();
            const rank = $($("> div", score)[2]).text();
            const combo = $($("> div", score)[3]).text();
            const sync = $($("> div", score)[4]).text();
            const rating = parseInt(
                $($("> span", $("> div", score)[5])[1]).text(),
                10,
            );
            const rate = parseInt(
                $($("> span", $("> div", score)[5])[0])
                    .text()
                    .replace(".", "")
                    .replace("%", ""),
                10,
            );
            const isDx =
                $($("> img", $("> div", $("> div", score)[1])[0])[0]).attr(
                    "alt",
                ) === "DX";
            if (
                name &&
                level &&
                !Number.isNaN(rate) &&
                !Number.isNaN(rating) &&
                rank
            )
                scores.push({
                    rank,
                    level,
                    rating,
                    name,
                    rate,
                    combo,
                    sync,
                    isDx,
                });
        }
        return scores;
    }
    private async best50Scraper(username: string) {
        const scoresHtml = await this.get<string>(
            `/profile/${username}/records?&v=${(() => {
                if (
                    this.minorToAccumulateVer(
                        MaishiftScoreAdapter.CURRENT_MINOR,
                    ) >= 25
                ) {
                    return `${this.minorToAccumulateVer(MaishiftScoreAdapter.CURRENT_MINOR)},${this.minorToAccumulateVer(MaishiftScoreAdapter.CURRENT_MINOR) - 1}`;
                } else {
                    return `${this.minorToAccumulateVer(MaishiftScoreAdapter.CURRENT_MINOR)}`;
                }
            })()}&sort=rating&order=desc`,
            undefined,
            1 * 60 * 1000,
        );
        if (!scoresHtml) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "personal best scores",
                    "An unknown error has occured.",
                ),
            };
        }
        if (this.isPagePrivate(scoresHtml)) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "personal best scores",
                    "The user does not have any score or their profile is private.",
                ),
            };
        }
        const oldScoresHtml = await this.get<string>(
            `/profile/${username}/records?&v=${(() => {
                if (
                    this.minorToAccumulateVer(
                        MaishiftScoreAdapter.CURRENT_MINOR,
                    ) >= 25
                ) {
                    return encodeURI(
                        Array.from(
                            Array(
                                this.minorToAccumulateVer(
                                    MaishiftScoreAdapter.CURRENT_MINOR,
                                ) - 1,
                            ).keys(),
                        ).join(","),
                    );
                } else {
                    return encodeURI(
                        Array.from(
                            Array(
                                this.minorToAccumulateVer(
                                    MaishiftScoreAdapter.CURRENT_MINOR,
                                ),
                            ).keys(),
                        ).join(","),
                    );
                }
            })()}&sort=rating&order=desc`,
            undefined,
            1 * 60 * 1000,
        );
        if (!oldScoresHtml) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "personal best scores",
                    "An unknown error has occured.",
                ),
            };
        }
        if (this.isPagePrivate(oldScoresHtml)) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "personal best scores",
                    "The user does not have any score or their profile is private.",
                ),
            };
        }
        const $new = Cheerio.load(
            scoresHtml.replace(/<style.*?>.*?<\/style>/g, ""),
        );
        const $old = Cheerio.load(
            oldScoresHtml.replace(/<style.*?>.*?<\/style>/g, ""),
        );

        const newScores = this.getScoresFromDom($new, 15);
        const oldScores = this.getScoresFromDom($old, 35);

        return { data: { newScores, oldScores } };
    }
    async getPlayerInfo(username: string) {
        return await this.profileScraper(username);
    }
    async getPlayerProfilePicture(
        username: string,
    ): Promise<DataOrError<Buffer>> {
        const res = await this.profileScraper(username);
        if (res.err) return res;
        const buffer = await this.get<Buffer>(
            res.data.avatarUrl,
            undefined,
            2 * 60 * 60 * 1000,
            {
                responseType: "arraybuffer",
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
        const res = await this.best50Scraper(username);
        if (res.err) return res;
        const newScores: Score[] = [];
        const oldScores: Score[] = [];
        for (const score of res.data.newScores) {
            const chart = await this.findChart(score);
            if (chart) newScores.push(this.toMaiDrawScore(score, chart));
        }
        for (const score of res.data.oldScores) {
            const chart = await this.findChart(score);
            if (chart) oldScores.push(this.toMaiDrawScore(score, chart));
        }
        return { data: { new: newScores, old: oldScores } };
    }
    private isPagePrivate(Html: string) {
        return [
            "No Record Found or Profile is Private",
            "找不到記錄或個人檔案設為私人",
            "기록이 존재하지 않거나 비공개입니다",
        ].some((s) => Html.includes(s));
    }
    /**
     * Resolves a scraped score row against the database. maimai.shiftpsh.com
     * does not expose the chart difficulty in its records listing, so the chart
     * is located by searching every standard difficulty for the closest match
     * on title, type and (internal) level.
     */
    private async findChart(score: ScrapedScore): Promise<Chart | null> {
        const type = score.isDx ? Type.DELUXE : Type.STANDARD;
        let best: { chart: Chart; weight: number } | undefined;
        for (const difficulty of Object.values(Difficulty)) {
            const { data } = await this.database.searchChart({
                title: score.name,
                level: score.level,
                difficulty,
                type,
            });
            for (const candidate of data ?? []) {
                const weight = candidate.weight ?? 0;
                if (!best || weight < best.weight) {
                    best = { chart: candidate.chart, weight };
                }
            }
        }
        if (!best) {
            this.logger.debug(`No chart found for "${score.name}".`);
            return null;
        }
        return best.chart;
    }
    private async scoreScraper(
        username: string,
        chartIdentifier: string,
        difficulty: Difficulty,
    ): Promise<DataOrError<Score | null>> {
        const { data: chart } = await this.database.getChart(
            chartIdentifier,
            difficulty,
        );
        if (!chart) return { data: null };
        const isDx = chart.type === Type.DELUXE;
        const addVersion =
            chart.optionalData.version?.displayVersion.EX ??
            chart.optionalData.version?.displayVersion.DX;
        if (!addVersion) return { data: null };
        const accumulateVer = this.minorToAccumulateVer(
            addVersion.gameVersion.minor,
            isDx,
        );
        const level =
            chart.internalLevel ??
            parseFloat(chart.level) + (chart.level.includes("+") ? 6 : 0);

        const params = new URLSearchParams();
        params.append("version", accumulateVer.toString());
        params.append(
            "level",
            `${Math.trunc(level * 10 - 5)},${Math.trunc(level * 10 + 5)}`,
        );
        params.append("chartType", isDx ? "DX" : "STANDARD");
        params.append(
            "difficulty",
            difficulty === Difficulty.RE_MASTER
                ? "RE_MASTER"
                : difficulty.toUpperCase(),
        );
        params.append("sort", "rating");
        params.append("order", "desc");
        const Html = await this.get<string>(
            `/profile/${username}/records?${params.toString()}`,
            undefined,
            1 * 60 * 1000,
        );
        if (!Html) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "player score",
                    "An unknown error has occured.",
                ),
            };
        }
        if (this.isPagePrivate(Html)) {
            return {
                err: new FailedToFetchError(
                    "maidraw.maimai.adapter.maishift",
                    "player score",
                    "The user does not have any score or their profile is private.",
                ),
            };
        }
        const $ = Cheerio.load(Html.replace(/<style.*?>.*?<\/style>/g, ""));
        const scores = this.getScoresFromDom($, 100);
        const raw =
            scores.find((s) => s.name === chart.title && s.isDx === isDx) ??
            null;
        return { data: raw ? this.toMaiDrawScore(raw, chart) : null };
    }

    async getPlayerScore(
        username: string,
        chartIdentifier: string,
    ): Promise<DataOrError<Record<Difficulty, Score | null>>> {
        const res = Object.fromEntries(
            Object.values(Difficulty).map((difficulty) => [difficulty, null]),
        ) as Record<Difficulty, Score | null>;
        for (const difficulty of Object.values(Difficulty)) {
            const score = await this.scoreScraper(
                username,
                chartIdentifier,
                difficulty,
            );
            if (score.err) {
                return { err: score.err };
            }
            res[difficulty] = score.data;
        }
        return { data: res };
    }
    toMaiDrawScore(score: ScrapedScore, chart: Chart): Score {
        return {
            chart: {
                ...chart,
                internalLevel: score.level,
            },
            combo: (() => {
                switch (score.combo) {
                    case "FC":
                        return ComboLamp.FULL_COMBO;
                    case "FC+":
                        return ComboLamp.FULL_COMBO_PLUS;
                    case "AP":
                        return ComboLamp.ALL_PERFECT;
                    case "AP+":
                        return ComboLamp.ALL_PERFECT_PLUS;
                    default:
                        return ComboLamp.NONE;
                }
            })(),
            sync: (() => {
                switch (score.sync) {
                    case "SYNC":
                        return SyncLamp.SYNC_PLAY;
                    case "FS":
                        return SyncLamp.FULL_SYNC;
                    case "FS+":
                        return SyncLamp.FULL_SYNC_PLUS;
                    case "FDX":
                        return SyncLamp.FULL_SYNC_DX;
                    case "FDX+":
                        return SyncLamp.FULL_SYNC_DX_PLUS;
                    default:
                        return SyncLamp.NONE;
                }
            })(),
            achievement: score.rate / 10000,
            achievementRank: (() => {
                switch (score.rank) {
                    case "SSS+":
                        return AchievementTypes.SSSP;
                    case "SSS":
                        return AchievementTypes.SSS;
                    case "SS+":
                        return AchievementTypes.SSP;
                    case "SS":
                        return AchievementTypes.SS;
                    case "S+":
                        return AchievementTypes.SP;
                    case "S":
                        return AchievementTypes.S;
                    case "AAA":
                        return AchievementTypes.AAA;
                    case "AA":
                        return AchievementTypes.AA;
                    case "A":
                        return AchievementTypes.A;
                    case "BBB":
                        return AchievementTypes.BBB;
                    case "BB":
                        return AchievementTypes.BB;
                    case "B":
                        return AchievementTypes.B;
                    case "C":
                        return AchievementTypes.C;
                    default:
                        return AchievementTypes.D;
                }
            })(),
            dxRating: score.rating,
            dxScore: -1,
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
