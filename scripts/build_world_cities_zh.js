const fs = require('fs');
const path = require('path');
const readline = require('readline');

const citiesPath = path.join('data', 'geonames_cities15000.txt');
const altPath = path.join('data', 'geonames_alternateNamesV2.txt');
const countryZhPath = path.join('data', 'country_zh.json');
const outPath = path.join('data', 'world_cities_zh.json');

if (!fs.existsSync(citiesPath)) {
  console.error('Missing data/geonames_cities15000.txt');
  process.exit(1);
}
if (!fs.existsSync(altPath)) {
  console.error('Missing data/geonames_alternateNamesV2.txt');
  process.exit(1);
}

let countryZh = {};
if (fs.existsSync(countryZhPath)) {
  try {
    countryZh = JSON.parse(fs.readFileSync(countryZhPath, 'utf8'));
  } catch {
    countryZh = {};
  }
}

function toInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function clean(value) {
  if (value === undefined || value === null) return '';
  const text = value.toString().trim();
  if (!text || text.toUpperCase() === 'NA') return '';
  return text;
}

const cities = new Map();
const cityLines = fs.readFileSync(citiesPath, 'utf8').split(/\r?\n/);
for (const line of cityLines) {
  if (!line) continue;
  const parts = line.split('\t');
  if (parts.length < 15) continue;
  const id = parts[0];
  const name = clean(parts[1]);
  const ascii = clean(parts[2]);
  const alternates = clean(parts[3]);
  const lat = Number(parts[4]);
  const lon = Number(parts[5]);
  const country = clean(parts[8]);
  const population = toInt(parts[14]);

  cities.set(id, {
    id,
    name,
    name_en: ascii || name,
    alternates,
    lat,
    lon,
    country,
    population,
    name_zh: '',
    name_zh_alt: new Set(),
  });
}

const zhLangs = new Set([
  'zh',
  'zh-CN',
  'zh-TW',
  'zh-HK',
  'zh-Hans',
  'zh-Hant',
]);

async function loadAlternateNames() {
  const stream = fs.createReadStream(altPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const geonameId = parts[1];
    const lang = parts[2];
    const altName = clean(parts[3]);
    if (!altName) continue;
    if (!zhLangs.has(lang)) continue;
    const city = cities.get(geonameId);
    if (!city) continue;

    const isPreferred = parts[4] === '1';
    if (isPreferred && !city.name_zh) {
      city.name_zh = altName;
    }
    city.name_zh_alt.add(altName);
  }
}

async function main() {
  await loadAlternateNames();

  const features = [];
  for (const city of cities.values()) {
    const nameZh = city.name_zh || (city.name_zh_alt.values().next().value || '');
    const name = nameZh || city.name;
    const countryZhName = countryZh[city.country] || '';

    features.push({
      type: 'Feature',
      properties: {
        id: city.id,
        name,
        name_en: city.name_en,
        name_zh: nameZh,
        alternatenames: city.alternates,
        country: city.country,
        country_zh: countryZhName,
        pop: city.population,
      },
      geometry: {
        type: 'Point',
        coordinates: [city.lon, city.lat],
      },
    });
  }

  const out = { type: 'FeatureCollection', features };
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${features.length} features to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
