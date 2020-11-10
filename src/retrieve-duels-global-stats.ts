/* eslint-disable @typescript-eslint/no-use-before-define */
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
		const statsForFullPeriod: DuelsGlobalStatsForPeriod = await loadStatsForPeriod(fullPeriodStartDate, mysql);
		const statsSinceLastPatch: DuelsGlobalStatsForPeriod = await loadStatsForPeriod(lastPatchStartDate, mysql);

		const result: DuelsGlobalStats = {
			...statsForFullPeriod,
			statsForFullPeriod: statsForFullPeriod,
			statsSinceLastPatch: statsSinceLastPatch,
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

const loadStatsForPeriod = async (startDate: Date, mysql): Promise<DuelsGlobalStatsForPeriod> => {
	const heroStats: readonly HeroStat[] = await loadHeroStats(startDate, mysql);
	const heroPowerStats: readonly HeroPowerStat[] = await loadHeroPowerStats(startDate, mysql);
	const signatureTreasureStats: readonly SignatureTreasureStat[] = await loadSignatureTreasureStats(startDate, mysql);
	const treasureStats: readonly TreasureStat[] = await loadTreasureStats(startDate, mysql);
	const deckStats: readonly DeckStat[] = await loadDeckStats(startDate, mysql);
	return {
		deckStats: deckStats,
		heroPowerStats: heroPowerStats,
		heroStats: heroStats,
		signatureTreasureStats: signatureTreasureStats,
		treasureStats: treasureStats,
	};
};

const loadDeckStats = async (periodStart: Date, mysql): Promise<readonly DeckStat[]> => {
	const query = `
		SELECT *
		FROM duels_stats_deck
		WHERE periodStart >= '${periodStart.toISOString()}'
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

const loadTreasureStats = async (periodStart: Date, mysql): Promise<readonly TreasureStat[]> => {
	const pickQuery = `
		SELECT '${periodStart.toISOString()}' as periodStart, cardId, playerClass, SUM(totalOffered) as totalOffered, SUM(totalPicked) as totalPicked
		FROM duels_stats_treasure
		WHERE periodStart >= '${periodStart.toISOString()}'
		GROUP BY cardId, playerClass;
	`;
	console.log('running query', pickQuery);
	const pickResults: any[] = await mysql.query(pickQuery);
	console.log('pickResults', pickResults);

	const winrateQuery = `
		SELECT '${periodStart.toISOString()}' as periodStart, cardId, playerClass, SUM(matchesPlayed) as matchesPlayed, SUM(totalLosses) as totalLosses, SUM(totalTies) as totalTies, SUM(totalWins) as totalWins
		FROM duels_stats_treasure_winrate
		WHERE periodStart >= '${periodStart.toISOString()}'
		GROUP BY cardId, playerClass;
	`;
	console.log('running query', winrateQuery);
	const winrateResults: any[] = await mysql.query(winrateQuery);
	console.log('winrateResults', winrateResults);

	return pickResults
		.filter(result => result.cardId !== 'DALA_735') // Robes of Gaudiness
		.map(result => {
			const winrateResult = winrateResults.find(
				res => res.cardId === result.cardId && res.playerClass === res.playerClass,
			);
			return {
				...result,
				...winrateResult,
			} as TreasureStat;
		});
};

const loadHeroStats = async (periodStart: Date, mysql): Promise<readonly HeroStat[]> => {
	const query = `
		SELECT '${periodStart.toISOString()}' as periodStart, heroCardId, heroClass, SUM(totalMatches) as totalMatches, SUM(totalWins) as totalWins
		FROM duels_stats_hero
		WHERE periodStart >= '${periodStart.toISOString()}'
		GROUP BY heroCardId, heroClass;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	const positionQuery = `
		SELECT heroCardId, heroClass, totalWins, SUM(totalMatches) as totalMatches
		FROM duels_stats_hero_position
		WHERE periodStart >= '${periodStart.toISOString()}'
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

const loadHeroPowerStats = async (periodStart: Date, mysql): Promise<readonly HeroPowerStat[]> => {
	const query = `
		SELECT '${periodStart.toISOString()}' as periodStart, heroPowerCardId, heroClass, SUM(totalMatches) as totalMatches, SUM(totalWins) as totalWins
		FROM duels_stats_hero_power
		WHERE periodStart >= '${periodStart.toISOString()}'
		GROUP BY heroPowerCardId, heroClass;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	return dbResults.map(result => ({ ...result } as HeroPowerStat));
};

const loadSignatureTreasureStats = async (periodStart: Date, mysql): Promise<readonly SignatureTreasureStat[]> => {
	const query = `
		SELECT '${periodStart.toISOString()}' as periodStart, signatureTreasureCardId, heroClass, SUM(totalMatches) as totalMatches, SUM(totalWins) as totalWins
		FROM duels_stats_signature_treasure
		WHERE periodStart >= '${periodStart.toISOString()}'
		GROUP BY signatureTreasureCardId, heroClass;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	return dbResults.map(result => ({ ...result } as SignatureTreasureStat));
};

export const getLastPatch = async (): Promise<any> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json?v=2`);
	const structuredPatch = JSON.parse(patchInfo);
	const patchNumber = structuredPatch.currentDuelsMetaPatch;
	console.log('retrieved patch info', structuredPatch, patchNumber);
	return structuredPatch.patches.find(patch => patch.number === patchNumber);
};
