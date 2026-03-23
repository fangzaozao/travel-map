const fs = require('fs');
const path = require('path');

const inPath = path.join('data', 'ne_admin0_countries.geojson');
const outPath = path.join('data', 'country_zh.json');

if (!fs.existsSync(inPath)) {
  console.error('Missing data/ne_admin0_countries.geojson');
  process.exit(1);
}

function clean(value) {
  if (value === undefined || value === null) return '';
  const text = value.toString().trim();
  if (!text || text.toUpperCase() === 'NA') return '';
  return text;
}

const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const map = {};
for (const feature of data.features || []) {
  const props = feature.properties || {};
  const iso = clean(props.ISO_A2) || clean(props.ISO_A2_EH) || clean(props.ADM0_A3);
  const nameZh =
    clean(props.NAME_ZH) ||
    clean(props.NAME_ZHT) ||
    clean(props.NAME_ZH_CN) ||
    clean(props.NAME_ZH_HANS) ||
    clean(props.NAME_ZH_HANT);
  if (iso && nameZh) {
    map[iso] = nameZh;
  }
}

fs.writeFileSync(outPath, JSON.stringify(map, null, 2));
console.log(`Wrote ${Object.keys(map).length} entries to ${outPath}`);
