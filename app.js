const svg = document.getElementById("map-svg");
const emptyState = document.getElementById("map-empty");
const fileInput = document.getElementById("file-input");
const matchKeyInput = document.getElementById("match-key");
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const searchResults = document.getElementById("search-results");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomResetBtn = document.getElementById("zoom-reset");
const tabWorld = document.getElementById("tab-world");
const tabChina = document.getElementById("tab-china");
const countVisited = document.getElementById("count-visited");
const countTotal = document.getElementById("count-total");
const statTitle = document.getElementById("stat-title");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const exportBtn = document.getElementById("export-btn");
const clearBtn = document.getElementById("clear-btn");
const dropZone = document.getElementById("drop-zone");
const mapWrap = document.querySelector(".map-wrap");
const renderStatus = document.getElementById("render-status");

const DEFAULT_MATCH_KEYS = {
  world: "name",
  china: "name",
};

const BUILTIN_FILES = {
  worldOutline: "data/world.geojson",
  worldCities: "data/world_cities.geojson",
  china: [
    "data/china_adm3.geojson",
    "data/taiwan_adm1.geojson",
    "data/hk_mac_subunits.geojson",
  ],
};

const VIEW_KEYS = {
  world: "travel-map-world",
  china: "travel-map-china",
};

const ALIAS_PAIRS = [
  ["Hong Kong", "\u9999\u6e2f"],
  ["Macau", "\u6fb3\u95e8"],
  ["Taipei", "\u53f0\u5317"],
  ["Taipei City", "\u53f0\u5317"],
  ["Taibei", "\u53f0\u5317"],
  ["Taichung", "\u53f0\u4e2d"],
  ["Taichung City", "\u53f0\u4e2d"],
  ["Taizhong", "\u53f0\u4e2d"],
  ["Kaohsiung", "\u9ad8\u96c4"],
  ["Kaohsiung City", "\u9ad8\u96c4"],
  ["Gaoxiong", "\u9ad8\u96c4"],
  ["Pattaya", "\u82ad\u63d0\u96c5"],
  ["Bangkok", "\u66fc\u8c37"],
  ["Beijing", "\u5317\u4eac"],
  ["Shanghai", "\u4e0a\u6d77"],
  ["Guangzhou", "\u5e7f\u5dde"],
  ["Shenzhen", "\u6df1\u5733"],
  ["Chongqing", "\u91cd\u5e86"],
  ["Tianjin", "\u5929\u6d25"],
];

const ALIAS_MAP = new Map();
for (const [a, b] of ALIAS_PAIRS) {
  ALIAS_MAP.set(a, b);
  ALIAS_MAP.set(b, a);
}

const DATA_VERSION = "20260316-5";

const ZH_KEYS = [
  "name_zh",
  "name_zhcn",
  "name_zho",
  "name_zhhans",
  "name_zhhant",
  "name_zh-cn",
  "name_zh-hans",
  "name_zh-hant",
  "NAME_ZH",
  "NAME_ZH_CN",
  "NAME_ZH_HANS",
  "NAME_ZH_HANT",
  "NAME_ZH_HANS_CN",
  "NAME_ZH_HANT_TW",
  "chinese",
  "CHINESE",
];

let activeView = "world";
let geojsonCache = {
  worldOutline: null,
  worldCities: null,
  china: null,
};
let isLoading = {
  worldOutline: false,
  worldCities: false,
  china: false,
};
let featureIndex = new Map();
let searchIndex = new Map();
let featureList = [];
let featurePathMap = new Map();
let featureMetaMap = new Map();
let renderState = {
  world: null,
  china: null,
};
let renderToken = 0;
let searchDebounceTimer = null;
let worldIndexReady = false;
let worldIndexTask = null;
let viewBoxState = {
  world: { x: 0, y: 0, w: 1000, h: 600 },
  china: { x: 0, y: 0, w: 1000, h: 600 },
};
let isPanning = false;
let panStart = null;

function setActiveTab(view) {
  activeView = view;
  tabWorld.classList.toggle("active", view === "world");
  tabChina.classList.toggle("active", view === "china");
  matchKeyInput.value = DEFAULT_MATCH_KEYS[view];
  const titleMap = {
    world: "\u4e16\u754c\u5730\u533a",
    china: "\u4e2d\u56fd\u53bf\u7ea7\u5e02",
  };
  statTitle.textContent = titleMap[view] || "";
  loadBuiltin(view);
  render();
}

function getVisitedSet() {
  const raw = localStorage.getItem(VIEW_KEYS[activeView]);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function setVisitedSet(set) {
  localStorage.setItem(VIEW_KEYS[activeView], JSON.stringify([...set]));
}

function updateStats(total, visited) {
  countTotal.textContent = total.toString();
  countVisited.textContent = visited.toString();
  const percent = total > 0 ? Math.round((visited / total) * 100) : 0;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = `${percent}%`;
}

function clearSvg() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function normalizeMatchKey() {
  return matchKeyInput.value.trim() || "name";
}

function loadGeoJSONForActiveView(geojson) {
  if (activeView === "world") {
    geojsonCache.worldCities = geojson;
  } else {
    geojsonCache[activeView] = geojson;
  }
  render();
}

function render() {
  renderToken += 1;
  const token = renderToken;
  clearSvg();
  featureIndex = new Map();
  searchIndex = new Map();
  featureList = [];
  featurePathMap = new Map();
  featureMetaMap = new Map();
  worldIndexReady = false;
  worldIndexTask = null;
  setRenderStatus("", false);
  if (activeView === "world") {
    if (!geojsonCache.worldOutline || !geojsonCache.worldCities) {
      emptyState.style.display = "grid";
      updateStats(0, 0);
      loadBuiltin(activeView);
      return;
    }
  } else if (!geojsonCache[activeView]) {
    emptyState.style.display = "grid";
    updateStats(0, 0);
    loadBuiltin(activeView);
    return;
  }

  emptyState.style.display = "none";
  const matchKey = normalizeMatchKey();
  const visited = getVisitedSet();
  const viewBox = { width: 1000, height: 600 };
  let bounds;
  let scale;

  if (activeView === "world") {
    const outline = normalizeGeoJSON(geojsonCache.worldOutline);
    bounds = outline.bounds;
    scale = computeScale(bounds, viewBox);
    renderState.world = { bounds, scale, viewBox };
    for (const feature of outline.features) {
      if (!feature.geometry) continue;
      const pathData = geometryToPath(feature.geometry, bounds, scale, viewBox);
      if (!pathData) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.classList.add("map-outline");
      svg.appendChild(path);
    }
  } else {
    const normalized = normalizeGeoJSON(geojsonCache[activeView]);
    bounds = normalized.bounds;
    scale = computeScale(bounds, viewBox);
    renderState[activeView] = { bounds, scale, viewBox };
  }

  let total = 0;
  const activeFeatures =
    activeView === "world"
      ? normalizeGeoJSON(geojsonCache.worldCities).features
      : normalizeGeoJSON(geojsonCache[activeView]).features;

  if (activeView !== "world") {
    const totalFeatures = activeFeatures.length;
    let index = 0;

    const step = () => {
      if (token !== renderToken) return;
      const fragment = document.createDocumentFragment();
      let added = 0;
      while (index < totalFeatures && added < 250) {
        const feature = activeFeatures[index];
        index += 1;
        if (!feature.geometry) continue;
        normalizeFeatureName(feature);
        const name = feature.properties?.[matchKey] || feature.properties?.name;
        if (!name) continue;

        total += 1;
        const aliases = collectAliases(feature, name);
        const meta = buildFeatureMeta(feature, name, bounds, scale, viewBox);
        featureMetaMap.set(name, meta);
        featureList.push({ name, aliases });

        for (const alias of aliases) {
          const key = normalizeKey(alias);
          if (key) searchIndex.set(key, name);
        }

        const path = createFeaturePath(meta, { isCity: false });
        featurePathMap.set(name, path);
        if (visited.has(name)) path.classList.add("visited");
        fragment.appendChild(path);
        added += 1;
      }
      svg.appendChild(fragment);
      updateStats(total, visited.size);
      if (index < totalFeatures) {
        setRenderStatus(`加载中 ${index}/${totalFeatures}`, true);
        requestAnimationFrame(step);
      } else {
        setRenderStatus("", false);
        renderSearchResults();
      }
    };

    setRenderStatus(`加载中 0/${totalFeatures}`, true);
    requestAnimationFrame(step);
  } else {
    const totalFeatures = activeFeatures.length;
    let index = 0;
    worldIndexTask = () => {
      if (token !== renderToken) return;
      let added = 0;
      while (index < totalFeatures && added < 400) {
        const feature = activeFeatures[index];
        index += 1;
        if (!feature.geometry) continue;
        normalizeFeatureName(feature);
        const name = feature.properties?.[matchKey] || feature.properties?.name;
        if (!name) continue;

        total += 1;
        const aliases = collectAliases(feature, name);
        const meta = { name, feature, pathData: null, bbox: null };
        featureMetaMap.set(name, meta);
        featureList.push({ name, aliases });

        for (const alias of aliases) {
          const key = normalizeKey(alias);
          if (key) searchIndex.set(key, name);
        }
        added += 1;
      }

      updateStats(total, visited.size);
      if (index < totalFeatures) {
        setRenderStatus(`索引中 ${index}/${totalFeatures}`, true);
        requestAnimationFrame(worldIndexTask);
      } else {
        worldIndexReady = true;
        setRenderStatus("", false);
        renderSearchResults();
      }
    };

    setRenderStatus(`索引中 0/${totalFeatures}`, true);
    requestAnimationFrame(worldIndexTask);
  }

  if (activeView === "world") {
    for (const name of visited) {
      const meta = featureMetaMap.get(name);
      if (meta) {
        const path = createFeaturePath(meta, { isCity: true });
        featurePathMap.set(name, path);
        path.classList.add("visited");
        svg.appendChild(path);
      }
    }
  }

  applyViewBox();
  updateStats(total, visited.size);
  if (activeView === "world" && worldIndexReady) {
    renderSearchResults();
  }
}

function normalizeGeoJSON(geojson) {
  if (geojson.type === "FeatureCollection") {
    const features = geojson.features || [];
    return {
      features,
      bounds: computeBounds(features),
    };
  }

  if (geojson.type === "Feature") {
    return {
      features: [geojson],
      bounds: computeBounds([geojson]),
    };
  }

  return {
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: geojson,
      },
    ],
    bounds: computeBounds([
      {
        type: "Feature",
        properties: {},
        geometry: geojson,
      },
    ]),
  };
}

function computeBounds(features) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    if (!feature.geometry) continue;
    walkCoordinates(feature.geometry, (lon, lat) => {
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    });
  }

  if (!Number.isFinite(minLon)) {
    return { minLon: -180, maxLon: 180, minLat: -90, maxLat: 90 };
  }

  return { minLon, maxLon, minLat, maxLat };
}

function computeScale(bounds, viewBox) {
  const lonSpan = bounds.maxLon - bounds.minLon || 1;
  const latSpan = bounds.maxLat - bounds.minLat || 1;
  const padding = 40;
  const width = viewBox.width - padding * 2;
  const height = viewBox.height - padding * 2;
  const scale = Math.min(width / lonSpan, height / latSpan);
  return { scale, padding, width, height };
}

function project(lon, lat, bounds, scale, viewBox) {
  const x = (lon - bounds.minLon) * scale.scale + scale.padding;
  const y = (bounds.maxLat - lat) * scale.scale + scale.padding;
  return [x, y];
}

function geometryToPath(geometry, bounds, scale, viewBox) {
  if (!geometry) return "";
  switch (geometry.type) {
    case "Polygon":
      return polygonToPath(geometry.coordinates, bounds, scale, viewBox);
    case "MultiPolygon":
      return geometry.coordinates
        .map((poly) => polygonToPath(poly, bounds, scale, viewBox))
        .filter(Boolean)
        .join(" ");
    case "MultiLineString":
      return geometry.coordinates
        .map((line) => lineToPath(line, bounds, scale, viewBox))
        .filter(Boolean)
        .join(" ");
    case "LineString":
      return lineToPath(geometry.coordinates, bounds, scale, viewBox);
    case "MultiPoint":
      return geometry.coordinates
        .map((point) => pointToPath(point, bounds, scale, viewBox))
        .filter(Boolean)
        .join(" ");
    case "Point":
      return pointToPath(geometry.coordinates, bounds, scale, viewBox);
    default:
      return "";
  }
}

function polygonToPath(rings, bounds, scale, viewBox) {
  if (!rings || !rings.length) return "";
  return rings.map((ring) => lineToPath(ring, bounds, scale, viewBox, true)).join(" ");
}

function lineToPath(line, bounds, scale, viewBox, closed = false) {
  if (!line || line.length === 0) return "";
  const [startLon, startLat] = line[0];
  const [sx, sy] = project(startLon, startLat, bounds, scale, viewBox);
  let d = `M ${sx.toFixed(2)} ${sy.toFixed(2)}`;
  for (let i = 1; i < line.length; i += 1) {
    const [lon, lat] = line[i];
    const [x, y] = project(lon, lat, bounds, scale, viewBox);
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  if (closed) d += " Z";
  return d;
}

function pointToPath(point, bounds, scale, viewBox) {
  if (!point) return "";
  const [x, y] = project(point[0], point[1], bounds, scale, viewBox);
  const r = 2;
  return `M ${x} ${y} m -${r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 -${r * 2},0`;
}

function walkCoordinates(geometry, visitor) {
  if (!geometry) return;
  const { type, coordinates } = geometry;
  if (type === "Point") {
    visitor(coordinates[0], coordinates[1]);
  } else if (type === "MultiPoint" || type === "LineString") {
    coordinates.forEach((coord) => visitor(coord[0], coord[1]));
  } else if (type === "MultiLineString" || type === "Polygon") {
    coordinates.forEach((line) => line.forEach((coord) => visitor(coord[0], coord[1])));
  } else if (type === "MultiPolygon") {
    coordinates.forEach((poly) =>
      poly.forEach((ring) => ring.forEach((coord) => visitor(coord[0], coord[1])))
    );
  }
}

function exportVisited() {
  const visited = [...getVisitedSet()];
  const blob = new Blob([visited.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${activeView}-visited.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function clearVisited() {
  setVisitedSet(new Set());
  render();
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const geojson = JSON.parse(reader.result);
      loadGeoJSONForActiveView(geojson);
      resetViewBox();
    } catch {
      alert("\u6587\u4ef6\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4\u662f\u5408\u6cd5\u7684 GeoJSON\u3002");
    }
  };
  reader.readAsText(file);
}

async function loadBuiltin(view) {
  if (view === "world") {
    await Promise.all([loadSingle("worldOutline"), loadSingle("worldCities")]);
    if (activeView === "world") render();
    return;
  }
  await loadSingle(view);
  if (activeView === view) render();
}

async function loadSingle(key) {
  if (geojsonCache[key] || isLoading[key]) return;
  isLoading[key] = true;
  try {
    const fileDef = BUILTIN_FILES[key];
    if (Array.isArray(fileDef)) {
      const collections = [];
      for (const url of fileDef) {
        const response = await fetch(`${url}?v=${DATA_VERSION}`, { cache: "no-store" });
        if (!response.ok) continue;
        collections.push(await response.json());
      }
      if (collections.length > 0) {
        geojsonCache[key] = mergeCollections(collections);
      }
    } else {
      const response = await fetch(`${fileDef}?v=${DATA_VERSION}`, { cache: "no-store" });
      if (!response.ok) return;
      const geojson = await response.json();
      geojsonCache[key] = geojson;
    }
  } catch {
    // Ignore fetch errors; user can still import manually.
  } finally {
    isLoading[key] = false;
  }
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  handleFile(file);
});

tabWorld.addEventListener("click", () => setActiveTab("world"));
tabChina.addEventListener("click", () => setActiveTab("china"));
exportBtn.addEventListener("click", exportVisited);
clearBtn.addEventListener("click", clearVisited);
matchKeyInput.addEventListener("change", render);

window.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("active");
});

window.addEventListener("dragleave", () => {
  dropZone.classList.remove("active");
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("active");
  const file = event.dataTransfer?.files?.[0];
  handleFile(file);
});

function applyViewBox() {
  const viewBox = viewBoxState[activeView];
  svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function resetViewBox() {
  viewBoxState[activeView] = { x: 0, y: 0, w: 1000, h: 600 };
  applyViewBox();
}

function zoom(factor, originX, originY) {
  const vb = viewBoxState[activeView];
  const minW = 120;
  const maxW = 1000;
  const nextW = Math.min(maxW, Math.max(minW, vb.w / factor));
  const nextH = (nextW / vb.w) * vb.h;
  const dx = (originX - vb.x) / vb.w;
  const dy = (originY - vb.y) / vb.h;
  const nextX = originX - dx * nextW;
  const nextY = originY - dy * nextH;
  viewBoxState[activeView] = { x: nextX, y: nextY, w: nextW, h: nextH };
  applyViewBox();
}

function handleSearchLegacy() {
  const query = searchInput.value.trim();
  if (!query) return;
  const matchKey = normalizeMatchKey();
  let target = featureIndex.get(query) || featureIndex.get(query.toLowerCase());

  if (!target) {
    // Fallback: partial match in properties
    const geojson = geojsonCache[activeView];
    if (geojson?.features) {
      for (const feature of geojson.features) {
        normalizeFeatureName(feature);
        const value = feature.properties?.[matchKey] || feature.properties?.name;
        if (value && value.toString().includes(query)) {
          target = featureIndex.get(value) || featureIndex.get(value.toLowerCase());
          if (target) break;
        }
      }
    }
  }

  if (!target) {
    alert("没有找到匹配的名称，请检查匹配字段。");
    return;
  }

  const id = target.dataset.name;
  const visitedSet = getVisitedSet();
  if (visitedSet.has(id)) {
    visitedSet.delete(id);
    target.classList.remove("visited");
  } else {
    visitedSet.add(id);
    target.classList.add("visited");
  }
  setVisitedSet(visitedSet);
  updateStats(parseInt(countTotal.textContent, 10), visitedSet.size);

  const bbox = JSON.parse(target.dataset.bbox || "{}");
  if (bbox && Number.isFinite(bbox.minX)) {
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    zoom(1.6, centerX, centerY);
  }

  target.classList.add("flash");
  setTimeout(() => target.classList.remove("flash"), 900);
}

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  if (activeView === "world" && !worldIndexReady) {
    setRenderStatus("\u4e16\u754c\u57ce\u5e02\u7d22\u5f15\u4e2d\uff0c\u8bf7\u7a0d\u7b49\u2026\u2026", true);
    return;
  }
  const normalized = normalizeKey(query);
  let name = searchIndex.get(normalized);
  if (!name) {
    const match = featureList.find((item) =>
      item.aliases.some((alias) => normalizeKey(alias).includes(normalized))
    );
    name = match?.name;
  }

  if (!name) {
    alert("\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u540d\u79f0\uff0c\u8bf7\u68c0\u67e5\u5339\u914d\u5b57\u6bb5\u3002");
    return;
  }

  const target = ensureFeaturePath(name, activeView === "world");
  if (!target) {
    alert("\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u540d\u79f0\uff0c\u8bf7\u68c0\u67e5\u5339\u914d\u5b57\u6bb5\u3002");
    return;
  }

  const id = name;
  const visitedSet = getVisitedSet();
  if (visitedSet.has(id)) {
    visitedSet.delete(id);
    target.classList.remove("visited");
  } else {
    visitedSet.add(id);
    target.classList.add("visited");
  }
  setVisitedSet(visitedSet);
  updateStats(parseInt(countTotal.textContent, 10), visitedSet.size);

  const bbox = JSON.parse(target.dataset.bbox || "{}");
  if (bbox && Number.isFinite(bbox.minX)) {
    const centerX = (bbox.minX + bbox.maxX) / 2;
    const centerY = (bbox.minY + bbox.maxY) / 2;
    zoom(1.6, centerX, centerY);
  }

  target.classList.add("flash");
  setTimeout(() => target.classList.remove("flash"), 900);
}

function renderSearchResultsLegacy() {
  const query = searchInput.value.trim();
  searchResults.innerHTML = "";
  if (!query) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "暂无结果";
    searchResults.appendChild(empty);
    return;
  }

  const visitedSet = getVisitedSet();
  const normalized = query.toLowerCase();
  const matches = featureList
    .filter((item) => item.name.toLowerCase().includes(normalized))
    .slice(0, 20);

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "暂无结果";
    searchResults.appendChild(empty);
    return;
  }

  for (const item of matches) {
    const row = document.createElement("div");
    row.className = "result-item";
    if (visitedSet.has(item.name)) row.classList.add("active");

    const label = document.createElement("span");
    label.className = "result-name";
    label.textContent = item.name;

    const tag = document.createElement("span");
    tag.className = "result-tag";
    tag.textContent = visitedSet.has(item.name) ? "已点亮" : "未点亮";

    row.appendChild(label);
    row.appendChild(tag);

    row.addEventListener("click", () => {
      searchInput.value = item.name;
      handleSearch();
      renderSearchResults();
    });

    searchResults.appendChild(row);
  }
}

function renderSearchResults() {
  if (activeView === "world" && !worldIndexReady) {
    searchResults.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "\u6b63\u5728\u7d22\u5f15\u4e16\u754c\u57ce\u5e02\u2026\u2026";
    searchResults.appendChild(empty);
    return;
  }
  const query = searchInput.value.trim();
  searchResults.innerHTML = "";
  if (!query) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "\u6682\u65e0\u7ed3\u679c";
    searchResults.appendChild(empty);
    return;
  }

  const visitedSet = getVisitedSet();
  const normalized = normalizeKey(query);
  const matches = featureList
    .filter((item) => item.aliases.some((alias) => normalizeKey(alias).includes(normalized)))
    .slice(0, 20);

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "\u6682\u65e0\u7ed3\u679c";
    searchResults.appendChild(empty);
    return;
  }

  for (const item of matches) {
    const row = document.createElement("div");
    row.className = "result-item";
    if (visitedSet.has(item.name)) row.classList.add("active");

    const label = document.createElement("span");
    label.className = "result-name";
    const matchedAlias = item.aliases.find((alias) =>
      normalizeKey(alias).includes(normalized)
    );
    label.textContent =
      matchedAlias && matchedAlias !== item.name ? `${item.name} - ${matchedAlias}` : item.name;

    const tag = document.createElement("span");
    tag.className = "result-tag";
    tag.textContent = visitedSet.has(item.name)
      ? "\u5df2\u70b9\u4eae"
      : "\u672a\u70b9\u4eae";

    row.appendChild(label);
    row.appendChild(tag);

    row.addEventListener("click", () => {
      searchInput.value = item.name;
      handleSearch();
      renderSearchResults();
    });

    searchResults.appendChild(row);
  }
}

function normalizeFeatureName(feature) {
  if (!feature.properties) feature.properties = {};
  if (feature.properties.name) return;
  const fallback =
    feature.properties.shapeName ||
    feature.properties.NAME ||
    feature.properties.NAME_EN ||
    feature.properties.name_en ||
    feature.properties.admin ||
    feature.properties.NAME_LONG ||
    feature.properties.NAME_LOCAL;
  if (fallback) feature.properties.name = fallback;
}

function mergeCollections(collections) {
  const merged = {
    type: "FeatureCollection",
    features: [],
  };
  for (const collection of collections) {
    if (collection?.features?.length) {
      merged.features.push(...collection.features);
    } else if (collection?.type === "Feature") {
      merged.features.push(collection);
    }
  }
  return merged;
}

function buildFeatureMeta(feature, name, bounds, scale, viewBox) {
  const pathData = geometryToPath(feature.geometry, bounds, scale, viewBox);
  const bbox = computeProjectedBounds(feature, bounds, scale, viewBox);
  return {
    name,
    feature,
    pathData,
    bbox,
  };
}

function createFeaturePath(meta, { isCity }) {
  const hydrated = hydrateMeta(meta, isCity ? "world" : activeView);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", hydrated.pathData);
  path.classList.add("map-path");
  if (isCity) path.classList.add("map-city");
  path.dataset.name = hydrated.name;
  path.dataset.bbox = JSON.stringify(hydrated.bbox);

  path.addEventListener("click", () => {
    const id = hydrated.name;
    const visitedSet = getVisitedSet();
    if (visitedSet.has(id)) {
      visitedSet.delete(id);
      path.classList.remove("visited");
    } else {
      visitedSet.add(id);
      path.classList.add("visited");
    }
    setVisitedSet(visitedSet);
    updateStats(parseInt(countTotal.textContent, 10), visitedSet.size);
  });

  return path;
}

function ensureFeaturePath(name, isCity) {
  let path = featurePathMap.get(name);
  if (path) return path;
  const meta = featureMetaMap.get(name);
  if (!meta) return null;
  path = createFeaturePath(meta, { isCity });
  featurePathMap.set(name, path);
  svg.appendChild(path);
  return path;
}

function hydrateMeta(meta, viewKey) {
  if (meta.pathData && meta.bbox) return meta;
  const state = renderState[viewKey];
  if (!state) return meta;
  const pathData = geometryToPath(meta.feature.geometry, state.bounds, state.scale, state.viewBox);
  const bbox = computeProjectedBounds(
    meta.feature,
    state.bounds,
    state.scale,
    state.viewBox
  );
  meta.pathData = pathData;
  meta.bbox = bbox;
  return meta;
}

function setRenderStatus(text, show) {
  if (!renderStatus) return;
  renderStatus.textContent = text;
  renderStatus.style.display = show ? "inline-flex" : "none";
}

function normalizeKey(value) {
  if (!value) return "";
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\\s\\u00A0]+/g, "")
    .replace(/[\\-_.'"]/g, "");
}

function collectAliases(feature, name) {
  const aliases = new Set();
  if (name) aliases.add(name);
  const props = feature.properties || {};
  const maybeKeys = [
    "name",
    "nameascii",
    "name_alt",
    "namealt",
    "name_en",
    "NAME",
    "NAME_EN",
    "NAME_LONG",
    "NAME_LOCAL",
    "shapeName",
  ];
  for (const key of maybeKeys) {
    if (props[key]) aliases.add(props[key]);
  }
  for (const key of ZH_KEYS) {
    if (props[key]) aliases.add(props[key]);
  }
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string" && /zh|chinese/i.test(k)) {
      aliases.add(v);
    }
  }
  for (const item of [...aliases]) {
    const mapped = ALIAS_MAP.get(item);
    if (mapped) aliases.add(mapped);
    const lower = item.toString().toLowerCase();
    if (lower.includes("taipei")) aliases.add("Taibei");
    if (lower.includes("taichung")) aliases.add("Taizhong");
    if (lower.includes("kaohsiung")) aliases.add("Gaoxiong");
  }
  return [...aliases].filter(Boolean);
}

function computeProjectedBounds(feature, bounds, scale, viewBox) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (!feature.geometry) {
    return { minX, maxX, minY, maxY };
  }
  walkCoordinates(feature.geometry, (lon, lat) => {
    const [x, y] = project(lon, lat, bounds, scale, viewBox);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  return { minX, maxX, minY, maxY };
}

svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = svg.getBoundingClientRect();
  const vb = viewBoxState[activeView];
  const px = ((event.clientX - rect.left) / rect.width) * vb.w + vb.x;
  const py = ((event.clientY - rect.top) / rect.height) * vb.h + vb.y;
  const factor = event.deltaY < 0 ? 1.2 : 0.8;
  zoom(factor, px, py);
});

svg.addEventListener("pointerdown", (event) => {
  isPanning = true;
  mapWrap.classList.add("grabbing");
  const rect = svg.getBoundingClientRect();
  const vb = viewBoxState[activeView];
  panStart = {
    x: event.clientX,
    y: event.clientY,
    vbX: vb.x,
    vbY: vb.y,
    vbW: vb.w,
    vbH: vb.h,
    rectW: rect.width,
    rectH: rect.height,
  };
});

window.addEventListener("pointermove", (event) => {
  if (!isPanning || !panStart) return;
  const dx = ((event.clientX - panStart.x) / panStart.rectW) * panStart.vbW;
  const dy = ((event.clientY - panStart.y) / panStart.rectH) * panStart.vbH;
  viewBoxState[activeView] = {
    x: panStart.vbX - dx,
    y: panStart.vbY - dy,
    w: panStart.vbW,
    h: panStart.vbH,
  };
  applyViewBox();
});

window.addEventListener("pointerup", () => {
  isPanning = false;
  panStart = null;
  mapWrap.classList.remove("grabbing");
});

zoomInBtn.addEventListener("click", () => {
  const vb = viewBoxState[activeView];
  zoom(1.2, vb.x + vb.w / 2, vb.y + vb.h / 2);
});
zoomOutBtn.addEventListener("click", () => {
  const vb = viewBoxState[activeView];
  zoom(0.8, vb.x + vb.w / 2, vb.y + vb.h / 2);
});
zoomResetBtn.addEventListener("click", resetViewBox);
searchBtn.addEventListener("click", handleSearch);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleSearch();
});
searchInput.addEventListener("input", () => {
  if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    renderSearchResults();
  }, 150);
});

setActiveTab("world");
