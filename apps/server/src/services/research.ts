/**
 * Optional external data. Each provider returns a cited value with its source,
 * retrieval date and coverage. Values are stored as evidence; they never
 * overwrite assumptions unless the person chooses to use them.
 *
 * Requests contain only a currency pair or a country code — never personal data.
 */
import { AppError } from '../lib/errors';

export interface ResearchResult {
  label: string;
  value: number;
  unit: string;
  sourceName: string;
  sourceUrl: string;
  retrievedOn: string;
  coverage: string;
  uncertainty: string;
  origin: string;
}

export type Fetch = typeof fetch;

const ISO3: Record<string, string> = {
  Algeria: 'DZA', Argentina: 'ARG', Australia: 'AUS', Austria: 'AUT', Belgium: 'BEL', Brazil: 'BRA', Bulgaria: 'BGR', Canada: 'CAN', Chile: 'CHL',
  China: 'CHN', Colombia: 'COL', Croatia: 'HRV', 'Czech Republic': 'CZE', Denmark: 'DNK', Egypt: 'EGY', Estonia: 'EST', Finland: 'FIN', France: 'FRA',
  Germany: 'DEU', Greece: 'GRC', Hungary: 'HUN', India: 'IND', Indonesia: 'IDN', Ireland: 'IRL', Israel: 'ISR', Italy: 'ITA', Japan: 'JPN', Jordan: 'JOR',
  Kenya: 'KEN', Lebanon: 'LBN', Luxembourg: 'LUX', Malaysia: 'MYS', Mexico: 'MEX', Morocco: 'MAR', Netherlands: 'NLD', 'New Zealand': 'NZL', Nigeria: 'NGA',
  Norway: 'NOR', Pakistan: 'PAK', Philippines: 'PHL', Poland: 'POL', Portugal: 'PRT', Qatar: 'QAT', Romania: 'ROU', 'Saudi Arabia': 'SAU', Singapore: 'SGP',
  'South Africa': 'ZAF', 'South Korea': 'KOR', Spain: 'ESP', Sweden: 'SWE', Switzerland: 'CHE', Thailand: 'THA', Tunisia: 'TUN', Turkey: 'TUR',
  'United Arab Emirates': 'ARE', 'United Kingdom': 'GBR', 'United States': 'USA', Vietnam: 'VNM',
};

export const RESEARCH_COUNTRIES = Object.keys(ISO3);

async function getJson(fetchImpl: Fetch, url: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'what-if-self-hosted' } });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    throw new AppError(502, 'research_unavailable', `The data source could not be reached (${(err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message}). External lookups need internet access from the server.`);
  } finally {
    clearTimeout(timer);
  }
}

/** ECB reference rates via the Frankfurter API. */
export async function exchangeRate(fetchImpl: Fetch, from: string, to: string, timeoutMs = 8000): Promise<ResearchResult> {
  if (from === to) throw new AppError(400, 'bad_request', 'Choose two different currencies.');
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const { status, body } = await getJson(fetchImpl, url, timeoutMs);
  const b = body as { rates?: Record<string, number>; date?: string } | null;
  const rate = b?.rates?.[to];
  if (status !== 200 || typeof rate !== 'number') {
    throw new AppError(404, 'research_not_covered', `The European Central Bank does not publish a reference rate for ${from}/${to}. Enter the rate from your bank instead.`);
  }
  return {
    label: `Exchange rate: 1 ${from} in ${to}`,
    value: rate,
    unit: `${to} per ${from}`,
    sourceName: 'European Central Bank reference rate (via Frankfurter)',
    sourceUrl: url,
    retrievedOn: new Date().toISOString().slice(0, 10),
    coverage: `Reference rate published ${b?.date ?? 'recently'}; ${from}/${to}`,
    uncertainty: 'Daily reference rate; banks and transfer services charge a spread, and rates move over time.',
    origin: 'ecb',
  };
}

/** Latest annual consumer-price inflation from the World Bank (indicator FP.CPI.TOTL.ZG). */
export async function inflation(fetchImpl: Fetch, country: string, timeoutMs = 8000): Promise<ResearchResult> {
  const iso = ISO3[country];
  if (!iso) throw new AppError(400, 'research_not_covered', `No country code is known for “${country}”.`);
  const url = `https://api.worldbank.org/v2/country/${iso}/indicator/FP.CPI.TOTL.ZG?format=json&mrnev=1`;
  const { status, body } = await getJson(fetchImpl, url, timeoutMs);
  const rows = Array.isArray(body) ? (body[1] as { date?: string; value?: number | null }[] | null) : null;
  const row = rows?.find((r) => typeof r.value === 'number');
  if (status !== 200 || !row || typeof row.value !== 'number') {
    throw new AppError(404, 'research_not_covered', `The World Bank has no recent inflation figure for ${country}.`);
  }
  return {
    label: `Inflation in ${country} (${row.date})`,
    value: Math.round(row.value * 100) / 100,
    unit: '% per year',
    sourceName: 'World Bank, consumer price inflation (FP.CPI.TOTL.ZG)',
    sourceUrl: `https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG?locations=${iso}`,
    retrievedOn: new Date().toISOString().slice(0, 10),
    coverage: `${country}, national average, calendar year ${row.date}`,
    uncertainty: 'A past annual figure; future inflation can differ substantially, and personal inflation depends on what you buy.',
    origin: 'worldbank',
  };
}
