/* eslint-disable @typescript-eslint/no-use-before-define */
import { CardIds } from '@firestone-hs/reference-data';
import { gzipSync } from 'zlib';
import { getConnection } from './db/rds';
import {
	DeckStat,
	DuelsGlobalStats,
	DuelsGlobalStatsForPeriod,
	HeroPowerStat,
	HeroStat,
	SignatureTreasureStat,
	TreasureStat,
} from './stat';
import { groupByFunction, http } from './utils';

const TREASURES_REMOVED_CARDS = [
	CardIds.NonCollectible.Neutral.RobesOfGaudiness,
	CardIds.NonCollectible.Neutral.HeadmasterKelThuzad_MrBigglesworthToken,
];

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	// const headers = {
	// 	'Access-Control-Allow-Headers':
	// 		'Accept,Accept-Language,Content-Language,Content-Type,Authorization,x-correlation-id,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
	// 	'Access-Control-Allow-Methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
	// 	'Access-Control-Allow-Origin': event?.headers?.Origin || event?.headers?.origin || '*',
	// };
	try {
		const [mysql, lastPatch] = await Promise.all([getConnection(), getLastPatch()]);

		const fullPeriodStartDate = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);
		// Start the day after, the limit the occurences of old versions being included
		const lastPatchStartDate = new Date(new Date(lastPatch.date).getTime() + 24 * 60 * 60 * 1000);

		const statsForFullPeriodDuels: DuelsGlobalStatsForPeriod = await loadStatsForPeriod(
			fullPeriodStartDate,
			mysql,
			'duels',
		);
		const statsSinceLastPatchDuels: DuelsGlobalStatsForPeriod = await loadStatsForPeriod(
			lastPatchStartDate,
			mysql,
			'duels',
		);
		const statsForFullPeriodPaidDuels: DuelsGlobalStatsForPeriod = await loadStatsForPeriod(
			fullPeriodStartDate,
			mysql,
			'paid-duels',
		);
		const statsSinceLastPatchPaidDuels: DuelsGlobalStatsForPeriod = await loadStatsForPeriod(
			lastPatchStartDate,
			mysql,
			'paid-duels',
		);
		// console.log('calling merge', statsForFullPeriodDuels, statsForFullPeriodPaidDuels);
		const statsForFullPeriodBoth: DuelsGlobalStatsForPeriod = merge(
			fullPeriodStartDate,
			...[statsForFullPeriodDuels, statsForFullPeriodPaidDuels],
		);
		const statsSinceLastPatchBoth: DuelsGlobalStatsForPeriod = merge(
			lastPatchStartDate,
			...[statsSinceLastPatchDuels, statsSinceLastPatchPaidDuels],
		);

		const result: DuelsGlobalStats = {
			...statsForFullPeriodDuels,
			statsForFullPeriod: statsForFullPeriodBoth,
			statsSinceLastPatch: statsSinceLastPatchBoth,
			duels: {
				statsForFullPeriod: statsForFullPeriodDuels,
				statsSinceLastPatch: statsSinceLastPatchDuels,
			},
			paidDuels: {
				statsForFullPeriod: statsForFullPeriodPaidDuels,
				statsSinceLastPatch: statsSinceLastPatchPaidDuels,
			},
			both: {
				statsForFullPeriod: statsForFullPeriodBoth,
				statsSinceLastPatch: statsSinceLastPatchBoth,
			},
		};

		const stringResults = JSON.stringify({ result });
		const gzippedResults = gzipSync(stringResults).toString('base64');
		console.log('compressed', stringResults.length, gzippedResults.length);
		const response = {
			statusCode: 200,
			isBase64Encoded: true,
			body: gzippedResults,
			headers: {
				'Content-Type': 'text/html',
				'Content-Encoding': 'gzip',
			},
		};
		console.log('sending back success reponse');
		return response;
	} catch (e) {
		console.error('issue getting runs info', e);
		const response = {
			statusCode: 500,
			isBase64Encoded: false,
			body: null,
		};
		console.log('sending back error reponse', response);
		return response;
	}
};

const merge = (periodStartDate: Date, ...stats: readonly DuelsGlobalStatsForPeriod[]): DuelsGlobalStatsForPeriod => {
	const heroStats = mergeHeroStats(
		periodStartDate,
		stats.map(stat => stat.heroStats).reduce((a, b) => a.concat(b), []),
	);
	const heroPowerStats = mergeHeroPowerStats(
		periodStartDate,
		stats.map(stat => stat.heroPowerStats).reduce((a, b) => a.concat(b), []),
	);
	const signatureTreasureStats = mergeSignatureTreasureStats(
		periodStartDate,
		stats.map(stat => stat.signatureTreasureStats).reduce((a, b) => a.concat(b), []),
	);
	const treasureStats = mergeTreasureStats(
		periodStartDate,
		stats.map(stat => stat.treasureStats).reduce((a, b) => a.concat(b), []),
	);
	const deckStats = stats.map(stat => stat.deckStats).reduce((a, b) => a.concat(b), []);

	return {
		heroStats: heroStats,
		heroPowerStats: heroPowerStats,
		signatureTreasureStats: signatureTreasureStats,
		treasureStats: treasureStats,
		deckStats: deckStats,
	};
};

const mergeTreasureStats = (periodStartDate: Date, stats: readonly TreasureStat[]): readonly TreasureStat[] => {
	const uniqueCardIds = [...new Set(stats.map(stat => stat.cardId))];
	return uniqueCardIds
		.map(treasureCardId => {
			const relevant: readonly TreasureStat[] = stats.filter(stat => stat.cardId === treasureCardId);
			const uniquePlayerClasses: readonly string[] = [...new Set(relevant.map(stat => stat.playerClass))];
			return uniquePlayerClasses.map(playerClass => {
				const relevantForClass: readonly TreasureStat[] = relevant.filter(
					stat => stat.playerClass === playerClass,
				);
				return {
					periodStart: periodStartDate.toISOString(),
					cardId: treasureCardId,
					playerClass: relevantForClass[0].playerClass,
					matchesPlayed: relevantForClass.map(stat => stat.matchesPlayed).reduce((a, b) => a + b, 0),
					totalLosses: relevantForClass.map(stat => stat.totalLosses).reduce((a, b) => a + b, 0),
					totalOffered: relevantForClass.map(stat => stat.totalOffered).reduce((a, b) => a + b, 0),
					totalPicked: relevantForClass.map(stat => stat.totalPicked).reduce((a, b) => a + b, 0),
					totalTies: relevantForClass.map(stat => stat.totalTies).reduce((a, b) => a + b, 0),
					totalWins: relevantForClass.map(stat => stat.totalWins).reduce((a, b) => a + b, 0),
				};
			});
		})
		.reduce((a, b) => a.concat(b), []);
};

const mergeSignatureTreasureStats = (
	periodStartDate: Date,
	stats: readonly SignatureTreasureStat[],
): readonly SignatureTreasureStat[] => {
	const uniqueHeroCardIds = [...new Set(stats.map(stat => stat.signatureTreasureCardId))];
	return uniqueHeroCardIds.map(signatureTreasureCardId => {
		const relevant: readonly SignatureTreasureStat[] = stats.filter(
			stat => stat.signatureTreasureCardId === signatureTreasureCardId,
		);
		const winsDistribution: { [winNumber: string]: number } = {};
		for (let i = 0; i <= 12; i++) {
			winsDistribution[i] = relevant.map(stat => stat.winDistribution[i]).reduce((a, b) => a + b, 0);
		}
		return {
			periodStart: periodStartDate.toISOString(),
			creationDate: periodStartDate.toISOString(),
			signatureTreasureCardId: signatureTreasureCardId,
			heroClass: relevant[0]?.heroClass,
			totalMatches: relevant.map(stat => stat.totalMatches).reduce((a, b) => a + b, 0),
			totalWins: relevant.map(stat => stat.totalWins).reduce((a, b) => a + b, 0),
			winDistribution: winsDistribution,
		};
	});
};

const mergeHeroStats = (periodStartDate: Date, stats: readonly HeroStat[]): readonly HeroStat[] => {
	console.log('merging', stats);
	const uniqueHeroCardIds = [...new Set(stats.map(stat => stat.heroCardId))];
	console.log('uniqueHeroCardIds', uniqueHeroCardIds, stats);
	return uniqueHeroCardIds.map(heroCardId => {
		const relevant: readonly HeroStat[] = stats.filter(stat => stat.heroCardId === heroCardId);
		console.log('relevant', relevant, heroCardId);
		const winsDistribution: { [winNumber: string]: number } = {};
		for (let i = 0; i <= 12; i++) {
			winsDistribution[i] = relevant.map(stat => stat.winDistribution[i]).reduce((a, b) => a + b, 0);
		}
		console.log('win distribution', winsDistribution);
		return {
			periodStart: periodStartDate.toISOString(),
			creationDate: periodStartDate.toISOString(),
			heroCardId: heroCardId,
			heroClass: relevant[0]?.heroClass,
			totalMatches: relevant.map(stat => stat.totalMatches).reduce((a, b) => a + b, 0),
			totalWins: relevant.map(stat => stat.totalWins).reduce((a, b) => a + b, 0),
			winDistribution: winsDistribution,
		};
	});
};

const mergeHeroPowerStats = (periodStartDate: Date, stats: readonly HeroPowerStat[]): readonly HeroPowerStat[] => {
	const uniqueHeroCardIds = [...new Set(stats.map(stat => stat.heroPowerCardId))];
	return uniqueHeroCardIds.map(heroPowerCardId => {
		const relevant: readonly HeroPowerStat[] = stats.filter(stat => stat.heroPowerCardId === heroPowerCardId);
		const winsDistribution: { [winNumber: string]: number } = {};
		for (let i = 0; i <= 12; i++) {
			winsDistribution[i] = relevant.map(stat => stat.winDistribution[i]).reduce((a, b) => a + b, 0);
		}
		return {
			periodStart: periodStartDate.toISOString(),
			creationDate: periodStartDate.toISOString(),
			heroPowerCardId: heroPowerCardId,
			heroClass: relevant[0]?.heroClass,
			totalMatches: relevant.map(stat => stat.totalMatches).reduce((a, b) => a + b, 0),
			totalWins: relevant.map(stat => stat.totalWins).reduce((a, b) => a + b, 0),
			winDistribution: winsDistribution,
		};
	});
};

const loadStatsForPeriod = async (
	startDate: Date,
	mysql,
	gameMode: 'duels' | 'paid-duels',
): Promise<DuelsGlobalStatsForPeriod> => {
	const heroStats: readonly HeroStat[] = await loadHeroStats(startDate, mysql, gameMode);
	const heroPowerStats: readonly HeroPowerStat[] = await loadHeroPowerStats(startDate, mysql, gameMode);
	const signatureTreasureStats: readonly SignatureTreasureStat[] = await loadSignatureTreasureStats(
		startDate,
		mysql,
		gameMode,
	);
	const treasureStats: readonly TreasureStat[] = await loadTreasureStats(startDate, mysql, gameMode);
	const deckStats: readonly DeckStat[] = await loadDeckStats(startDate, mysql, gameMode);
	return {
		deckStats: deckStats,
		heroPowerStats: heroPowerStats,
		heroStats: heroStats,
		signatureTreasureStats: signatureTreasureStats,
		treasureStats: treasureStats,
	};
};

const loadDeckStats = async (
	periodStart: Date,
	mysql,
	gameMode: 'duels' | 'paid-duels',
): Promise<readonly DeckStat[]> => {
	const query = `
		SELECT *
		FROM duels_stats_deck
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		ORDER BY id desc
		LIMIT 100;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	return dbResults.map(
		result =>
			({
				...result,
				// periodStart: periodStart.toISOString(),
				treasuresCardIds: (result.treasuresCardIds || []).split(','),
			} as DeckStat),
	);
};

const loadTreasureStats = async (
	periodStart: Date,
	mysql,
	gameMode: 'duels' | 'paid-duels',
): Promise<readonly TreasureStat[]> => {
	const pickQuery = `
		SELECT '${periodStart.toISOString()}' as periodStart, cardId, playerClass, SUM(totalOffered) as totalOffered, SUM(totalPicked) as totalPicked
		FROM duels_stats_treasure
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY cardId, playerClass;
	`;
	console.log('running query', pickQuery);
	const pickResults: any[] = await mysql.query(pickQuery);
	console.log('pickResults', pickResults);

	const winrateQuery = `
		SELECT '${periodStart.toISOString()}' as periodStart, cardId, playerClass, SUM(matchesPlayed) as matchesPlayed, SUM(totalLosses) as totalLosses, SUM(totalTies) as totalTies, SUM(totalWins) as totalWins
		FROM duels_stats_treasure_winrate
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY cardId, playerClass;
	`;
	console.log('running query', winrateQuery);
	const winrateResults: any[] = await mysql.query(winrateQuery);
	console.log('winrateResults', winrateResults);

	const result = pickResults
		.filter(result => !TREASURES_REMOVED_CARDS.includes(result.cardId)) // Robes of Gaudiness
		.map(result => {
			const winrateResult = winrateResults.find(
				res => res.cardId === result.cardId && res.playerClass === result.playerClass,
			);
			// console.log('mapping', result, winrateResult);
			return {
				...result,
				...winrateResult,
			} as TreasureStat;
		});
	console.log('treasureResults', result);
	return result;
};

const loadHeroStats = async (
	periodStart: Date,
	mysql,
	gameMode: 'duels' | 'paid-duels',
): Promise<readonly HeroStat[]> => {
	const query = `
		SELECT '${periodStart.toISOString()}' as periodStart, heroCardId, heroClass, SUM(totalMatches) as totalMatches, SUM(totalWins) as totalWins
		FROM duels_stats_hero
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY heroCardId, heroClass;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	const positionQuery = `
		SELECT heroCardId, heroClass, totalWins, SUM(totalMatches) as totalMatches
		FROM duels_stats_hero_position
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY heroCardId, heroClass, totalWins
	`;
	console.log('running query', positionQuery);
	const dbPositionResults: any[] = await mysql.query(positionQuery);
	console.log('dbResults', dbPositionResults);

	return dbResults.map(result => {
		const winsForHero = dbPositionResults.filter(res => res.heroCardId === result.heroCardId);
		const groupedByWins: { [winNumber: string]: any[] } = groupByFunction((res: any) => res.totalWins)(winsForHero);
		const winsDistribution: { [winNumber: string]: number } = {};
		for (let i = 0; i <= 12; i++) {
			const totalWins = (groupedByWins[i] || [])
				.map(res => parseInt(res.totalMatches))
				.reduce((a, b) => a + b, 0);
			winsDistribution[i] = totalWins;
		}
		return {
			...result,
			winDistribution: winsDistribution,
		} as HeroStat;
	});
};

const loadHeroPowerStats = async (
	periodStart: Date,
	mysql,
	gameMode: 'duels' | 'paid-duels',
): Promise<readonly HeroPowerStat[]> => {
	const query = `
		SELECT '${periodStart.toISOString()}' as periodStart, heroPowerCardId, heroClass, SUM(totalMatches) as totalMatches, SUM(totalWins) as totalWins
		FROM duels_stats_hero_power
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY heroPowerCardId, heroClass;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	const positionQuery = `
		SELECT heroPowerCardId, heroClass, totalWins, SUM(totalMatches) as totalMatches
		FROM duels_stats_hero_power_position
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY heroPowerCardId, heroClass, totalWins
	`;
	console.log('running query', positionQuery);
	const dbPositionResults: any[] = await mysql.query(positionQuery);
	console.log('dbResults', dbPositionResults);

	return dbResults.map(result => {
		const winsForHero = dbPositionResults.filter(res => res.heroPowerCardId === result.heroPowerCardId);
		const groupedByWins: { [winNumber: string]: any[] } = groupByFunction((res: any) => res.totalWins)(winsForHero);
		const winsDistribution: { [winNumber: string]: number } = {};
		for (let i = 0; i <= 12; i++) {
			const totalWins = (groupedByWins[i] || [])
				.map(res => parseInt(res.totalMatches))
				.reduce((a, b) => a + b, 0);
			winsDistribution[i] = totalWins;
		}
		return {
			...result,
			winDistribution: winsDistribution,
		} as HeroPowerStat;
	});
};

const loadSignatureTreasureStats = async (
	periodStart: Date,
	mysql,
	gameMode: 'duels' | 'paid-duels',
): Promise<readonly SignatureTreasureStat[]> => {
	const query = `
		SELECT '${periodStart.toISOString()}' as periodStart, signatureTreasureCardId, heroClass, SUM(totalMatches) as totalMatches, SUM(totalWins) as totalWins
		FROM duels_stats_signature_treasure
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY signatureTreasureCardId, heroClass;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	const positionQuery = `
		SELECT signatureTreasureCardId, heroClass, totalWins, SUM(totalMatches) as totalMatches
		FROM duels_stats_signature_treasure_position
		WHERE periodStart >= '${periodStart.toISOString()}'
		AND gameMode = '${gameMode}'
		GROUP BY signatureTreasureCardId, heroClass, totalWins
	`;
	console.log('running query', positionQuery);
	const dbPositionResults: any[] = await mysql.query(positionQuery);
	console.log('dbResults', dbPositionResults);

	return dbResults.map(result => {
		const winsForHero = dbPositionResults.filter(
			res => res.signatureTreasureCardId === result.signatureTreasureCardId,
		);
		const groupedByWins: { [winNumber: string]: any[] } = groupByFunction((res: any) => res.totalWins)(winsForHero);
		const winsDistribution: { [winNumber: string]: number } = {};
		for (let i = 0; i <= 12; i++) {
			const totalWins = (groupedByWins[i] || [])
				.map(res => parseInt(res.totalMatches))
				.reduce((a, b) => a + b, 0);
			winsDistribution[i] = totalWins;
		}
		return {
			...result,
			winDistribution: winsDistribution,
		} as SignatureTreasureStat;
	});
};

export const getLastPatch = async (): Promise<any> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json?v=2`);
	const structuredPatch = JSON.parse(patchInfo);
	const patchNumber = structuredPatch.currentDuelsMetaPatch;
	console.log('retrieved patch info', structuredPatch, patchNumber);
	return structuredPatch.patches.find(patch => patch.number === patchNumber);
};
