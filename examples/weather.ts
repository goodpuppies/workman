// weather.ts — a weather CLI using wttr.in's JSON API (free, no API key).
//
// Usage:
//   deno run --allow-net --allow-read --allow-write weather.ts oulu
//   deno run --allow-net --allow-read --allow-write weather.ts berlin tokyo --f
//   deno run --allow-net --allow-read --allow-write weather.ts oulu --refresh
//
// Flags: --f (Fahrenheit), --refresh (ignore cache)

// ============================================================================
// TYPES — the shapes we *claim* the API returns (the JSON assert points).
// wttr.in quirks, faithfully modeled: every scalar is a string, and names/
// descriptions are arrays of { value } wrappers.
// ============================================================================

interface WttrValue {
  value: string;
}

interface CurrentCondition {
  temp_C: string;
  temp_F: string;
  FeelsLikeC: string;
  FeelsLikeF: string;
  windspeedKmph: string;
  weatherDesc: WttrValue[];
}

interface HourlySlot {
  chanceofrain: string;
}

interface DailyForecast {
  date: string; // "YYYY-MM-DD"
  maxtempC: string;
  maxtempF: string;
  mintempC: string;
  mintempF: string;
  hourly: HourlySlot[];
}

interface NearestArea {
  areaName: WttrValue[];
  region: WttrValue[];
  country: WttrValue[];
}

interface WttrResponse {
  current_condition: CurrentCondition[];
  weather: DailyForecast[];
  nearest_area: NearestArea[];
}

// ============================================================================
// FETCHING
// ============================================================================

// 1. The universal fetch-JSON helper: res.ok branch, res.status in the error,
//    and the single `as T` trust-the-wire cast.
async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return await res.json() as T;
}

// 2. encodeURIComponent for path interpolation (vs URLSearchParams for query).
function getWeather(city: string): Promise<WttrResponse> {
  return fetchJson<WttrResponse>(
    `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
  );
}

// ============================================================================
// CACHE — JSON file persistence with a TTL
// ============================================================================

const CACHE_FILE = ".weather-cache.json";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  fetchedAt: number;
  data: WttrResponse;
}

// 3. Object-as-dictionary with dynamic string keys.
type Cache = Record<string, CacheEntry>;

// 4. Read-or-default: try/catch around readTextFile + JSON.parse, falling
//    back to an empty value. The standard "load state if it exists" idiom.
async function loadCache(): Promise<Cache> {
  try {
    const text = await Deno.readTextFile(CACHE_FILE);
    return JSON.parse(text) as Cache;
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await Deno.writeTextFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// ============================================================================
// RENDERING
// ============================================================================

// 5. Digging scalars out of wttr.in's nested wrappers: array index ->
//    optional field -> ?? default, plus Number() coercion of stringly data.
function firstValue(items: WttrValue[] | undefined, fallback: string): string {
  return items?.[0]?.value ?? fallback;
}

function renderReport(data: WttrResponse, fahrenheit: boolean, unit: string): string {
  const area = data.nearest_area[0];
  // 6. Building a display string from possibly-empty parts: array literal +
  //    filter + join.
  const location = [
    firstValue(area.areaName, "Unknown"),
    firstValue(area.region, ""),
    firstValue(area.country, ""),
  ].filter((part) => part.length > 0).join(", ");

  const cur = data.current_condition[0];
  // 7. Ternary field selection driven by a flag, repeated below.
  const temp = Number(fahrenheit ? cur.temp_F : cur.temp_C);
  const feels = Number(fahrenheit ? cur.FeelsLikeF : cur.FeelsLikeC);
  const desc = firstValue(cur.weatherDesc, "Unknown");

  const lines: string[] = [];
  lines.push(`\n${location}`);
  lines.push(
    `Now: ${temp}${unit} (feels like ${feels}${unit}), ${desc}, ` +
      `wind ${Number(cur.windspeedKmph).toFixed(0)} km/h`,
  );

  // 8. map over the daily array; each item carries its own nested hourly
  //    array, aggregated with reduce.
  const rows = data.weather.map((day) => {
    // 9. Date from "YYYY-MM-DD" + toLocaleDateString with an options object.
    const label = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const hi = Number(fahrenheit ? day.maxtempF : day.maxtempC);
    const lo = Number(fahrenheit ? day.mintempF : day.mintempC);

    // 10. reduce with an accumulator: max rain chance across hourly slots.
    const rain = day.hourly.reduce(
      (max, slot) => Math.max(max, Number(slot.chanceofrain)),
      0,
    );

    // 11. padEnd/padStart column alignment in template literals.
    return `  ${label.padEnd(13)} ${String(hi).padStart(3)}${unit} / ` +
      `${String(lo).padStart(3)}${unit}  rain ${String(rain).padStart(3)}%`;
  });

  return lines.concat(rows).join("\n");
}

// ============================================================================
// MAIN
// ============================================================================

if (import.meta.main) {
  // 12. Flag handling by partitioning Deno.args with filter + includes.
  const flags = Deno.args.filter((a) => a.startsWith("--"));
  const cities = Deno.args.filter((a) => !a.startsWith("--"));
  const fahrenheit = flags.includes("--f");
  const refresh = flags.includes("--refresh");
  const unit = fahrenheit ? "°F" : "°C";

  if (cities.length === 0) {
    cities.push("Oulu")
  }

  const cache = await loadCache();
  const now = Date.now();

  // 13. Promise.all over a map of async closures (capturing cache, flags),
  //     each resolving to a printable string so output order matches input.
  const reports = await Promise.all(cities.map(async (city) => {
    const key = city.toLowerCase();
    const cached = cache[key];

    // 14. TTL check: optional entry + Date.now() arithmetic.
    if (cached && !refresh && now - cached.fetchedAt < CACHE_TTL_MS) {
      return renderReport(cached.data, fahrenheit, unit) + "\n  (cached)";
    }

    // 15. try/catch *inside* the async map callback so one bad city doesn't
    //     reject the whole Promise.all.
    try {
      const data = await getWeather(city);
      cache[key] = { fetchedAt: now, data };
      return renderReport(data, fahrenheit, unit);
    } catch (err) {
      return `\nFailed to get weather for "${city}": ${err}`;
    }
  }));

  for (const report of reports) {
    console.log(report);
  }

  await saveCache(cache);
}
