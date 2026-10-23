// Temperature and an icon under the clock at the top left. The place is the chosen city, or (Auto, only when picked in Settings) found from the internet
// connection with ipwho.is (no key); the weather comes from open-meteo.com (no key). Cached 30 minutes per place; any failure just shows nothing.

import {loggedFetch} from './log';

import type {City} from '../config/cities';
import type {WeatherPlace} from './storage';

export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

export interface Weather {
	temp: number;
	label: string;
	place: string;
	kind: WeatherKind;
	/** false between sunset and sunrise at the place: the clear and partly icons show a moon */
	day: boolean;
}

/** weatherCity for "find the place from the internet connection" ('' = no place chosen, no weather) */
export const AUTO_PLACE = '@auto';

/** weatherCity while the place typed in Settings (UserConfig.weatherPlace) is the one in use */
export const POSTCODE_PLACE = '@postcode';

const MAX_AGE_MS = 30 * 60 * 1000;

function kindOf (code: number): WeatherKind {
	if (code === 0) return 'clear';
	if (code <= 2) return 'partly';
	if (code === 45 || code === 48) return 'fog';
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
	if (code >= 95) return 'storm';
	if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
	return 'cloudy';
}

function describe (code: number): string {
	if (code === 0) return 'Clear';
	if (code <= 2) return 'Partly cloudy';
	if (code === 3) return 'Cloudy';
	if (code === 45 || code === 48) return 'Fog';
	if (code >= 51 && code <= 67) return 'Rain';
	if (code >= 71 && code <= 77) return 'Snow';
	if (code >= 80 && code <= 82) return 'Showers';
	if (code >= 95) return 'Storm';
	return '';
}

// by name and position: a postcode's place may share its name with a city on the list
const keyFor = (city: City | null) => 'launcher-weather-v3-' + (city ? `${city.name}@${city.lat.toFixed(3)},${city.lon.toFixed(3)}` : 'auto');

/** The last weather read for this place, however old: drawn on a cold start while readWeather asks again. */
export function peekWeather (city: City | null): Weather | null {
	try {
		const cached = JSON.parse(localStorage.getItem(keyFor(city)) || 'null') as {t: number; w: Weather} | null;
		return cached ? cached.w : null;
	} catch { return null; }
}

export function readWeather (city: City | null): Promise<Weather> {
	const key = keyFor(city);
	try {
		const cached = JSON.parse(localStorage.getItem(key) || 'null') as {t: number; w: Weather} | null;
		if (cached && Date.now() - cached.t < MAX_AGE_MS) return Promise.resolve(cached.w);
	} catch { /* fetch fresh */ }
	const where: Promise<{lat: number; lon: number; place: string}> = city
		? Promise.resolve({lat: city.lat, lon: city.lon, place: city.name})
		: loggedFetch('https://ipwho.is/')
			.then((r) => r.json() as Promise<{success?: boolean; latitude?: number; longitude?: number; city?: string}>)
			.then((p) => {
				if (!p.success || typeof p.latitude !== 'number' || typeof p.longitude !== 'number') throw new Error('no location');
				return {lat: p.latitude, lon: p.longitude, place: p.city || ''};
			});
	return where
		.then((p) => loggedFetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`)
			.then((r) => r.json() as Promise<{current?: {temperature_2m?: number; weather_code?: number; is_day?: number}}>)
			.then((d) => {
				const c = d.current;
				if (!c || typeof c.temperature_2m !== 'number') throw new Error('no weather');
				const code = c.weather_code || 0;
				const w: Weather = {temp: Math.round(c.temperature_2m), label: describe(code), place: p.place, kind: kindOf(code), day: c.is_day !== 0};
				try { localStorage.setItem(key, JSON.stringify({t: Date.now(), w})); } catch { /* ignore */ }
				return w;
			}));
}

// ---------- a place from a postcode or a name (asked once, when it is saved in Settings) ----------

/** a full UK postcode ("CF10 3AT", "sw1a1aa") */
const UK_POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][A-Z]{2})$/;
/** its first half alone ("CF10", "LL55") */
const UK_OUTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;

const first = (v: unknown): string => (Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : '') : typeof v === 'string' ? v : '');
/** "Cardiff, unparished area" is no name */
const named = (v: unknown): string => { const s = first(v); return /unparished/i.test(s) ? '' : s; };

/** JSON from a lookup service; a network failure reads "Could not reach <host>" (a 404 still has a JSON body: postcodes.io's "not found") */
function getJson<T> (url: string): Promise<T> {
	const host = url.split('/')[2];
	return loggedFetch(url).then((r) => r.json() as Promise<T>).catch(() => { throw new Error(`Could not reach ${host}`); });
}

/** UK postcodes from postcodes.io (free, no key, CORS); anything else (a town, another country's postal code) from Open-Meteo's geocoder.
 *  Rejects with a short message to show. */
export function findPlace (typed: string): Promise<WeatherPlace> {
	const query = typed.trim().replace(/\s+/g, ' ');
	if (!query) return Promise.reject(new Error('Type a postcode or a place'));
	const upper = query.toUpperCase();
	const pc = UK_POSTCODE.exec(upper);
	if (pc) {
		const code = `${pc[1]} ${pc[2]}`;
		return getJson<{result?: Record<string, unknown> | null}>(`https://api.postcodes.io/postcodes/${encodeURIComponent(code)}`)
			.then((d) => {
				const r = d.result;
				if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') throw new Error(`Postcode ${code} not found`);
				const district = first(r.admin_district);
				const local = first(r.admin_ward) || named(r.parish) || district;
				return {query: code, name: local, label: `${local}${district && district !== local ? ', ' + district : ''} · ${first(r.postcode) || code}`, lat: r.latitude, lon: r.longitude};
			});
	}
	if (UK_OUTCODE.test(upper)) {
		return getJson<{result?: Record<string, unknown> | null}>(`https://api.postcodes.io/outcodes/${encodeURIComponent(upper)}`)
			.then((d) => {
				const r = d.result;
				if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') throw new Error(`Postcode area ${upper} not found`);
				const district = first(r.admin_district);
				return {query: upper, name: district || upper, label: `${district ? district + ' · ' : ''}${upper}`, lat: r.latitude, lon: r.longitude};
			});
	}
	return getJson<{results?: {name?: string; latitude?: number; longitude?: number; admin1?: string; country?: string}[]}>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&format=json`)
		.then((d) => {
			const r = d.results && d.results[0];
			if (!r || !r.name || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') throw new Error(`No place called "${query}" found`);
			const more = [r.admin1, r.country].filter((x) => !!x && x !== r.name).join(', ');
			return {query, name: r.name, label: more ? `${r.name}, ${more}` : r.name, lat: r.latitude, lon: r.longitude};
		});
}
