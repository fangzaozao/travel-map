const fs = require('fs');
const path = require('path');

const root = path.join('data', 'ChinaGeoJson', 'ChinaGeoJson-master');
const infoPath = path.join(root, 'info.json');
const countyDir = path.join(root, 'county');
const outPath = path.join('data', 'china_adm3.geojson');

if (!fs.existsSync(infoPath)) {
  console.error('Missing info.json');
  process.exit(1);
}
if (!fs.existsSync(countyDir)) {
  console.error('Missing county directory');
  process.exit(1);
}

const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));

function getNode(adcode) {
  if (adcode === undefined || adcode === null) return null;
  const key = adcode.toString();
  return info[key] || null;
}

function clean(value) {
  if (value === undefined || value === null) return '';
  const text = value.toString().trim();
  if (!text || text.toUpperCase() === 'NA') return '';
  return text;
}

function guessEngType(name) {
  if (!name) return 'District';
  if (name.endsWith('区')) return 'District';
  if (name.endsWith('县')) return 'County';
  if (name.endsWith('市')) return 'CountyCity';
  if (name.endsWith('旗') || name.endsWith('自治旗')) return 'Banner';
  return 'District';
}

const features = [];
const files = fs.readdirSync(countyDir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const full = path.join(countyDir, file);
  const content = JSON.parse(fs.readFileSync(full, 'utf8'));
  const feature = content.features?.[0];
  if (!feature) continue;

  const props = feature.properties || {};
  const countyAdcode = props.adcode;
  const countyName = clean(props.name);
  const parent = props.parent || {};
  const cityAdcode = parent.adcode;

  const cityNode = getNode(cityAdcode);
  const provinceNode = cityNode ? getNode(cityNode.parent?.adcode) : null;

  const cityName = clean(cityNode?.name);
  const provinceName = clean(provinceNode?.name);

  feature.properties = {
    NAME_1: provinceName,
    NL_NAME_1: provinceName,
    NAME_2: cityName,
    NL_NAME_2: cityName,
    NAME_3: countyName,
    NL_NAME_3: countyName,
    ENGTYPE_3: guessEngType(countyName),
    TYPE_3: clean(props.level) || 'district',
    adcode: countyAdcode,
  };

  features.push(feature);
}

const out = { type: 'FeatureCollection', features };
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${features.length} features to ${outPath}`);
