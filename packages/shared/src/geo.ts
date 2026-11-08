/**
 * Static reference data for parsing decisions. Currency assignments are
 * stable facts (ISO 4217); no prices, salaries or exchange rates are bundled.
 */
export interface Country {
  name: string;
  currency: string;
  aliases: string[];
  cities: string[];
}

export const COUNTRIES: Country[] = [
  { name: 'Algeria', currency: 'DZD', aliases: ['algerie', 'algérie'], cities: ['Algiers', 'Oran', 'Constantine', 'Annaba'] },
  { name: 'Argentina', currency: 'ARS', aliases: [], cities: ['Buenos Aires', 'Córdoba'] },
  { name: 'Australia', currency: 'AUD', aliases: [], cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'] },
  { name: 'Austria', currency: 'EUR', aliases: [], cities: ['Vienna', 'Graz', 'Salzburg'] },
  { name: 'Belgium', currency: 'EUR', aliases: [], cities: ['Brussels', 'Antwerp', 'Ghent'] },
  { name: 'Brazil', currency: 'BRL', aliases: [], cities: ['São Paulo', 'Sao Paulo', 'Rio de Janeiro'] },
  { name: 'Bulgaria', currency: 'EUR', aliases: [], cities: ['Sofia'] },
  { name: 'Canada', currency: 'CAD', aliases: [], cities: ['Toronto', 'Montreal', 'Montréal', 'Vancouver', 'Calgary', 'Ottawa'] },
  { name: 'Chile', currency: 'CLP', aliases: [], cities: ['Santiago'] },
  { name: 'China', currency: 'CNY', aliases: [], cities: ['Beijing', 'Shanghai', 'Shenzhen'] },
  { name: 'Colombia', currency: 'COP', aliases: [], cities: ['Bogotá', 'Bogota', 'Medellín', 'Medellin'] },
  { name: 'Croatia', currency: 'EUR', aliases: [], cities: ['Zagreb', 'Split'] },
  { name: 'Czech Republic', currency: 'CZK', aliases: ['czechia'], cities: ['Prague', 'Brno'] },
  { name: 'Denmark', currency: 'DKK', aliases: [], cities: ['Copenhagen', 'Aarhus'] },
  { name: 'Egypt', currency: 'EGP', aliases: [], cities: ['Cairo', 'Alexandria'] },
  { name: 'Estonia', currency: 'EUR', aliases: [], cities: ['Tallinn'] },
  { name: 'Finland', currency: 'EUR', aliases: [], cities: ['Helsinki'] },
  { name: 'France', currency: 'EUR', aliases: [], cities: ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Bordeaux', 'Lille', 'Nantes'] },
  { name: 'Germany', currency: 'EUR', aliases: ['deutschland'], cities: ['Berlin', 'Munich', 'München', 'Hamburg', 'Frankfurt', 'Cologne', 'Stuttgart', 'Düsseldorf', 'Dusseldorf'] },
  { name: 'Greece', currency: 'EUR', aliases: [], cities: ['Athens', 'Thessaloniki'] },
  { name: 'Hungary', currency: 'HUF', aliases: [], cities: ['Budapest'] },
  { name: 'India', currency: 'INR', aliases: [], cities: ['Bangalore', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai'] },
  { name: 'Indonesia', currency: 'IDR', aliases: [], cities: ['Jakarta', 'Bali'] },
  { name: 'Ireland', currency: 'EUR', aliases: [], cities: ['Dublin', 'Cork'] },
  { name: 'Israel', currency: 'ILS', aliases: [], cities: ['Tel Aviv'] },
  { name: 'Italy', currency: 'EUR', aliases: [], cities: ['Rome', 'Milan', 'Turin', 'Florence', 'Bologna'] },
  { name: 'Japan', currency: 'JPY', aliases: [], cities: ['Tokyo', 'Osaka', 'Kyoto'] },
  { name: 'Jordan', currency: 'JOD', aliases: [], cities: ['Amman'] },
  { name: 'Kenya', currency: 'KES', aliases: [], cities: ['Nairobi'] },
  { name: 'Lebanon', currency: 'LBP', aliases: [], cities: ['Beirut'] },
  { name: 'Luxembourg', currency: 'EUR', aliases: [], cities: [] },
  { name: 'Malaysia', currency: 'MYR', aliases: [], cities: ['Kuala Lumpur'] },
  { name: 'Mexico', currency: 'MXN', aliases: [], cities: ['Mexico City', 'Guadalajara', 'Monterrey'] },
  { name: 'Morocco', currency: 'MAD', aliases: ['maroc'], cities: ['Casablanca', 'Rabat', 'Marrakesh', 'Marrakech', 'Tangier'] },
  { name: 'Netherlands', currency: 'EUR', aliases: ['holland', 'the netherlands'], cities: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'] },
  { name: 'New Zealand', currency: 'NZD', aliases: [], cities: ['Auckland', 'Wellington'] },
  { name: 'Nigeria', currency: 'NGN', aliases: [], cities: ['Lagos', 'Abuja'] },
  { name: 'Norway', currency: 'NOK', aliases: [], cities: ['Oslo', 'Bergen'] },
  { name: 'Pakistan', currency: 'PKR', aliases: [], cities: ['Karachi', 'Lahore', 'Islamabad'] },
  { name: 'Philippines', currency: 'PHP', aliases: [], cities: ['Manila'] },
  { name: 'Poland', currency: 'PLN', aliases: [], cities: ['Warsaw', 'Kraków', 'Krakow', 'Wrocław', 'Wroclaw', 'Gdańsk'] },
  { name: 'Portugal', currency: 'EUR', aliases: [], cities: ['Lisbon', 'Porto'] },
  { name: 'Qatar', currency: 'QAR', aliases: [], cities: ['Doha'] },
  { name: 'Romania', currency: 'RON', aliases: [], cities: ['Bucharest', 'Cluj'] },
  { name: 'Saudi Arabia', currency: 'SAR', aliases: ['ksa'], cities: ['Riyadh', 'Jeddah'] },
  { name: 'Singapore', currency: 'SGD', aliases: [], cities: [] },
  { name: 'South Africa', currency: 'ZAR', aliases: [], cities: ['Cape Town', 'Johannesburg'] },
  { name: 'South Korea', currency: 'KRW', aliases: ['korea'], cities: ['Seoul', 'Busan'] },
  { name: 'Spain', currency: 'EUR', aliases: ['españa'], cities: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Málaga', 'Malaga'] },
  { name: 'Sweden', currency: 'SEK', aliases: [], cities: ['Stockholm', 'Gothenburg', 'Malmö'] },
  { name: 'Switzerland', currency: 'CHF', aliases: [], cities: ['Zurich', 'Zürich', 'Geneva', 'Basel', 'Lausanne', 'Bern'] },
  { name: 'Thailand', currency: 'THB', aliases: [], cities: ['Bangkok', 'Chiang Mai'] },
  { name: 'Tunisia', currency: 'TND', aliases: ['tunisie'], cities: ['Tunis'] },
  { name: 'Turkey', currency: 'TRY', aliases: ['türkiye', 'turkiye'], cities: ['Istanbul', 'Ankara', 'Izmir'] },
  { name: 'United Arab Emirates', currency: 'AED', aliases: ['uae', 'emirates'], cities: ['Dubai', 'Abu Dhabi'] },
  { name: 'United Kingdom', currency: 'GBP', aliases: ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales'], cities: ['London', 'Manchester', 'Edinburgh', 'Bristol', 'Birmingham', 'Glasgow', 'Cambridge', 'Oxford'] },
  { name: 'United States', currency: 'USD', aliases: ['usa', 'us', 'america', 'the states', 'united states of america'], cities: ['New York', 'San Francisco', 'Los Angeles', 'Seattle', 'Boston', 'Chicago', 'Austin', 'Miami', 'Denver', 'Washington'] },
  { name: 'Vietnam', currency: 'VND', aliases: ['viet nam'], cities: ['Hanoi', 'Ho Chi Minh City'] },
];

export const CURRENCIES = [
  'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'INR', 'SGD', 'AED', 'SAR', 'QAR',
  'DZD', 'MAD', 'TND', 'EGP', 'TRY', 'ZAR', 'NGN', 'KES', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF',
  'RON', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'KRW', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'PKR', 'ILS',
  'JOD', 'LBP',
] as const;

export interface PlaceMatch {
  /** Display name as the user wrote it, normalised (e.g. "Berlin" or "Germany"). */
  label: string;
  country: string;
  currency: string;
  kind: 'country' | 'city';
  index: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds countries and well-known cities mentioned in free text, in order of appearance. */
export function findPlaces(text: string): PlaceMatch[] {
  const found: PlaceMatch[] = [];
  const lower = text.toLowerCase();
  for (const c of COUNTRIES) {
    const names = [c.name, ...c.aliases];
    for (const n of names) {
      // Short aliases such as "us" or "uk" must be standalone words and are matched case-sensitively in the original.
      const short = n.length <= 3;
      const re = short ? new RegExp(`(?<![\\w'])${escapeRe(n.toUpperCase())}(?![\\w'])`) : new RegExp(`(?<![\\p{L}])${escapeRe(n.toLowerCase())}(?![\\p{L}])`, 'u');
      const m = short ? re.exec(text) : re.exec(lower);
      if (m) found.push({ label: c.name, country: c.name, currency: c.currency, kind: 'country', index: m.index });
    }
    for (const city of c.cities) {
      const re = new RegExp(`(?<![\\p{L}])${escapeRe(city.toLowerCase())}(?![\\p{L}])`, 'u');
      const m = re.exec(lower);
      if (m) found.push({ label: city, country: c.name, currency: c.currency, kind: 'city', index: m.index });
    }
  }
  found.sort((a, b) => a.index - b.index);
  // Deduplicate: a city implies its country; keep the first mention of each label.
  const out: PlaceMatch[] = [];
  for (const p of found) {
    if (out.some((o) => o.label === p.label)) continue;
    if (p.kind === 'country' && out.some((o) => o.kind === 'city' && o.country === p.country && Math.abs(o.index - p.index) < 30)) continue;
    out.push(p);
  }
  return out;
}

export function currencyForCountry(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const c = COUNTRIES.find((x) => x.name.toLowerCase() === n || x.aliases.includes(n));
  return c?.currency ?? null;
}
