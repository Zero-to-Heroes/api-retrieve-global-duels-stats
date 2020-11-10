import fetch, { RequestInfo } from 'node-fetch';

export const groupByFunction = (keyExtractor: (obj: object | string) => string) => array =>
	array.reduce((objectsByKeyValue, obj) => {
		const value = keyExtractor(obj);
		objectsByKeyValue[value] = (objectsByKeyValue[value] || []).concat(obj);
		return objectsByKeyValue;
	}, {});

export const http = async (request: RequestInfo): Promise<any> => {
	return new Promise(resolve => {
		fetch(request)
			.then(
				response => {
					// console.log('received response, reading text body');
					return response.text();
				},
				error => {
					console.warn('could not retrieve review', error);
				},
			)
			.then(body => {
				// console.log('sending back body', body && body.length);
				resolve(body);
			});
	});
};
