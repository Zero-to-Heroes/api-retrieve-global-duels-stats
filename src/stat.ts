import { ReferencePlayerClass } from '@firestone-hs/reference-data/lib/models/reference-cards/reference-player-class';

export interface DuelsGlobalStats {
	readonly statsForFullPeriod: DuelsGlobalStatsForPeriod;
	readonly statsSinceLastPatch: DuelsGlobalStatsForPeriod;
	// All of these are deprecated and are there only for backward compatilbity
	/** @deprecated */
	readonly heroStats: readonly HeroStat[];
	/** @deprecated */
	readonly heroPowerStats: readonly HeroPowerStat[];
	/** @deprecated */
	readonly signatureTreasureStats: readonly SignatureTreasureStat[];
	/** @deprecated */
	readonly treasureStats: readonly TreasureStat[];
	/** @deprecated */
	readonly deckStats: readonly DeckStat[];
}

export interface DuelsGlobalStatsForPeriod {
	readonly heroStats: readonly HeroStat[];
	readonly heroPowerStats: readonly HeroPowerStat[];
	readonly signatureTreasureStats: readonly SignatureTreasureStat[];
	readonly treasureStats: readonly TreasureStat[];
	readonly deckStats: readonly DeckStat[];
}

export interface HeroStat {
	readonly creationDate: string;
	readonly periodStart: string;
	readonly heroCardId: string;
	readonly heroClass: ReferencePlayerClass;
	readonly totalMatches: number;
	readonly totalWins: number;
	readonly winDistribution: { [winNumber: string]: number };
}

export interface HeroPowerStat {
	readonly creationDate: string;
	readonly periodStart: string;
	readonly heroPowerCardId: string;
	readonly heroClass: ReferencePlayerClass;
	readonly totalMatches: number;
	readonly totalWins: number;
}

export interface SignatureTreasureStat {
	readonly creationDate: string;
	readonly periodStart: string;
	readonly signatureTreasureCardId: string;
	readonly heroClass: ReferencePlayerClass;
	readonly totalMatches: number;
	readonly totalWins: number;
}

export interface TreasureStat {
	readonly periodStart: string;
	readonly cardId: string;
	readonly playerClass: string;
	readonly totalOffered: number;
	readonly totalPicked: number;
	readonly matchesPlayed: number;
	readonly totalWins: number;
	readonly totalLosses: number;
	readonly totalTies: number;
}

export interface DeckStat {
	readonly id: number;
	readonly periodStart: string;
	readonly decklist: string;
	readonly finalDecklist: string;
	readonly playerClass: string;
	readonly heroCardId: string;
	readonly heroPowerCardId: string;
	readonly signatureTreasureCardId: string;
	readonly treasuresCardIds: readonly string[];
	readonly runId: string;
	readonly wins: number;
	readonly losses: number;
	readonly rating: number;
	readonly runStartDate: string;
}
