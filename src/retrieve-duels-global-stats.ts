/* eslint-disable @typescript-eslint/no-use-before-define */
import { gzipSync } from 'zlib';
import { getConnection } from './db/rds';
import { DuelsGlobalStats, HeroPowerStat, HeroStat, SignatureTreasureStat, TreasureStat } from './stat';

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	const headers = {
		'Access-Control-Allow-Headers':
			'Accept,Accept-Language,Content-Language,Content-Type,Authorization,x-correlation-id,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
		'Access-Control-Allow-Methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
		'Access-Control-Allow-Origin': event?.headers?.Origin || event?.headers?.origin || '*',
	};
	try {
		const mysql = await getConnection();

		// const dateToSelect = await getDateToSelect(mysql);
		const heroStats: readonly HeroStat[] = await loadHeroStats(mysql);
		const heroPowerStats: readonly HeroPowerStat[] = await loadHeroPowerStats(mysql);
		const signatureTreasureStats: readonly SignatureTreasureStat[] = await loadSignatureTreasureStats(mysql);
		const treasureStats: readonly TreasureStat[] = await loadTreasureStats(mysql);

		const result: DuelsGlobalStats = {
			heroStats: heroStats,
			heroPowerStats: heroPowerStats,
			signatureTreasureStats: signatureTreasureStats,
			treasureStats: treasureStats,
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
			headers: headers,
		};
		console.log('sending back error reponse', response);
		return response;
	}
};

const loadTreasureStats = async (mysql): Promise<readonly TreasureStat[]> => {
	const periodStart = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);

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

	return pickResults.map(result => {
		const winrateResult = winrateResults.find(
			res => res.cardId === result.cardId && res.playerClass === res.playerClass,
		);
		return {
			...result,
			...winrateResult,
		} as TreasureStat;
	});
};

const loadHeroStats = async (mysql): Promise<readonly HeroStat[]> => {
	const periodStart = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);
	const query = `
		SELECT '${periodStart.toISOString()}' as periodStart, heroCardId, heroClass, SUM(totalMatches) as totalMatches, SUM(totalWins) as totalWins
		FROM duels_stats_hero
		WHERE periodStart >= '${periodStart.toISOString()}'
		GROUP BY heroCardId, heroClass;
	`;
	console.log('running query', query);
	const dbResults: any[] = await mysql.query(query);
	console.log('dbResults', dbResults);

	return dbResults.map(result => ({ ...result } as HeroStat));
};

const loadHeroPowerStats = async (mysql): Promise<readonly HeroPowerStat[]> => {
	const periodStart = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);
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

const loadSignatureTreasureStats = async (mysql): Promise<readonly SignatureTreasureStat[]> => {
	const periodStart = new Date(new Date().getTime() - 100 * 24 * 60 * 60 * 1000);
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

// const getDateToSelect = async (mysql): Promise<string> => {
// 	const query = `
// 		SELECT periodStart FROM duels_stats_hero
// 		ORDER BY periodStart DESC
// 		LIMIT 1;
// 	`;
// 	console.log('running query', query);
// 	const dbResults: any[] = await mysql.query(query);
// 	console.log('dbResults', dbResults);
// 	return toCreationDate(dbResults[0].creationDate);
// };

// const toCreationDate = (today: Date): string => {
// 	return `${today
// 		.toISOString()
// 		.slice(0, 19)
// 		.replace('T', ' ')}.${today.getMilliseconds()}`;
// };

interface MutableTreasureStat {
	periodStart: string;
	cardId: string;
	playerClass: string;
	totalOffered: number;
	totalPicked: number;
}
