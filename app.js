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

const DATA_VERSION = "20260316-8";
const VIEW_KEYS = {
  world: "travel-map-world",
  china: "travel-map-china",
};

const FILES = {
  worldOutline: "data/world.geojson",
  worldCities: "data/world_cities.geojson",
  china: ["data/china_adm3.geojson", "data/taiwan_adm1.geojson", "data/hk_mac_subunits.geojson"],
};

let activeView = "world";
let dataCache = {
  worldOutline: null,
  worldCities: null,
  china: null,
};
let viewBoxState = {
  world: { x: 0, y: 0, w: 1000, h: 600 },
  china: { x: 0, y: 0, w: 1000, h: 600 },
};
let renderToken = 0;
let isPanning = false;
let panStart = null;
let searchDebounceTimer = null;
let worldCityMarkers = new Map();
let chinaPathByName = new Map();
let chinaItems = [];
let worldCityScanToken = 0;

const ALIAS_PAIRS = [
  ["Taipei", "台北"],
  ["Taipei City", "台北"],
  ["Taibei", "台北"],
  ["Taichung", "台中"],
  ["Taichung City", "台中"],
  ["Taizhong", "台中"],
  ["Kaohsiung", "高雄"],
  ["Kaohsiung City", "高雄"],
  ["Gaoxiong", "高雄"],
  ["Hong Kong", "香港"],
  ["Macau", "澳门"],
];

const ALIAS_MAP = new Map();
for (const [a, b] of ALIAS_PAIRS) {
  ALIAS_MAP.set(a, b);
  ALIAS_MAP.set(b, a);
}

function setActiveTab(view) {
  activeView = view;
  tabWorld.classList.toggle("active", view === "world");
  tabChina.classList.toggle("active", view === "china");
  matchKeyInput.value = "name";
  statTitle.textContent = view === "world" ? "世界地区" : "中国县级市";
  render();
}

function setRenderStatus(text, show) {
  if (!renderStatus) return;
  renderStatus.textContent = text;
  renderStatus.style.display = show ? "inline-flex" : "none";
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

function updateWorldStats(visited) {
  countVisited.textContent = visited.toString();
  countTotal.textContent = "∞";
  progressFill.style.width = visited > 0 ? "100%" : "0%";
  progressLabel.textContent = `${visited} 已点亮`;
}

function clearSvg() {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function normalizeMatchKey() {
  return matchKeyInput.value.trim() || "name";
}

async function loadSingle(key) {
  if (dataCache[key]) return;
  const fileDef = FILES[key];
  if (Array.isArray(fileDef)) {
    const collections = [];
    for (const url of fileDef) {
      const response = await fetch(`${url}?v=${DATA_VERSION}`, { cache: "no-store" });
      if (!response.ok) continue;
      collections.push(await response.json());
    }
    if (collections.length > 0) {
      dataCache[key] = mergeCollections(collections);
    }
  } else {
    const response = await fetch(`${fileDef}?v=${DATA_VERSION}`, { cache: "no-store" });
    if (!response.ok) return;
    dataCache[key] = await response.json();
  }
}

function render() {
  renderToken += 1;
  const token = renderToken;
  clearSvg();
  worldCityMarkers = new Map();
  chinaPathByName = new Map();
  chinaItems = [];
  setRenderStatus("", false);

  if (activeView === "world") {
    renderWorld(token);
  } else {
    renderChina(token);
  }
}

function renderWorld(token) {
  if (!dataCache.worldOutline) {
    emptyState.style.display = "grid";
    updateStats(0, 0);
    loadSingle("worldOutline").then(() => {
      if (token === renderToken) render();
    });
    return;
  }

  emptyState.style.display = "none";
  const outline = normalizeGeoJSON(dataCache.worldOutline);
  const bounds = outline.bounds;
  const viewBox = { width: 1000, height: 600 };
  const scale = computeScale(bounds, viewBox);

  for (const feature of outline.features) {
    if (!feature.geometry) continue;
    const pathData = geometryToPath(feature.geometry, bounds, scale, viewBox);
    if (!pathData) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.classList.add("map-outline");
    svg.appendChild(path);
  }

  applyViewBox();
  updateWorldStats(getVisitedSet().size);
  renderSearchResults();
  setRenderStatus("输入城市名进行标注", true);
}

function renderChina(token) {
  if (!dataCache.china) {
    emptyState.style.display = "grid";
    updateStats(0, 0);
    loadSingle("china").then(() => {
      if (token === renderToken) render();
    });
    return;
  }

  emptyState.style.display = "none";
  const geojson = normalizeGeoJSON(dataCache.china);
  const bounds = geojson.bounds;
  const viewBox = { width: 1000, height: 600 };
  const scale = computeScale(bounds, viewBox);
  const features = geojson.features;
  const visited = getVisitedSet();

  let index = 0;
  let total = 0;

  const step = () => {
    if (token !== renderToken) return;
    const fragment = document.createDocumentFragment();
    let added = 0;
    while (index < features.length && added < 200) {
      const feature = features[index];
      index += 1;
      if (!feature.geometry) continue;
      normalizeFeatureName(feature);
      const name = feature.properties?.[normalizeMatchKey()] || feature.properties?.name;
      if (!name) continue;

      total += 1;
      const pathData = geometryToPath(feature.geometry, bounds, scale, viewBox);
      if (!pathData) continue;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.classList.add("map-path");
      if (visited.has(name)) path.classList.add("visited");
      path.dataset.name = name;
      path.dataset.bbox = JSON.stringify(computeProjectedBounds(feature, bounds, scale, viewBox));
      path.addEventListener("click", () => toggleVisited(name, path));
      fragment.appendChild(path);
      chinaPathByName.set(name, path);
      chinaItems.push({ name, aliases: collectAliases(feature, name) });
      added += 1;
    }
    svg.appendChild(fragment);
    updateStats(total, visited.size);
    if (index < features.length) {
      setRenderStatus(`加载中 ${index}/${features.length}`, true);
      requestAnimationFrame(step);
    } else {
      setRenderStatus("", false);
      renderSearchResults();
    }
  };

  setRenderStatus(`加载中 0/${features.length}`, true);
  requestAnimationFrame(step);
  applyViewBox();
}

function toggleVisited(name, path) {
  const visitedSet = getVisitedSet();
  if (visitedSet.has(name)) {
    visitedSet.delete(name);
    path.classList.remove("visited");
  } else {
    visitedSet.add(name);
    path.classList.add("visited");
  }
  setVisitedSet(visitedSet);
  if (activeView === "world") {
    updateWorldStats(visitedSet.size);
  } else {
    updateStats(parseInt(countTotal.textContent, 10), visitedSet.size);
  }
}

function renderSearchResults() {
  const query = searchInput.value.trim();
  searchResults.innerHTML = "";
  if (!query) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "暂无结果";
    searchResults.appendChild(empty);
    return;
  }

  if (activeView === "world" && !dataCache.worldCities) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "搜索世界城市中…";
    searchResults.appendChild(empty);
    return;
  }

  const visitedSet = getVisitedSet();
  const normalized = normalizeKey(query);
  const matches =
    activeView === "china"
      ? chinaItems
          .filter((item) =>
            item.aliases.some((alias) => normalizeKey(alias).includes(normalized))
          )
          .slice(0, 20)
      : [];

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "暂无结果";
    searchResults.appendChild(empty);
    return;
  }

  for (const item of matches) {
    const name = item.name;
    const row = document.createElement("div");
    row.className = "result-item";
    if (visitedSet.has(name)) row.classList.add("active");

    const label = document.createElement("span");
    label.className = "result-name";
    label.textContent = name;

    const tag = document.createElement("span");
    tag.className = "result-tag";
    tag.textContent = visitedSet.has(name) ? "已点亮" : "未点亮";

    row.appendChild(label);
    row.appendChild(tag);
    row.addEventListener("click", () => {
      searchInput.value = name;
      handleSearch();
    });
    searchResults.appendChild(row);
  }
}

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  if (activeView === "china") {
    const normalized = normalizeKey(query);
    const match = chinaItems.find((item) =>
      item.aliases.some((alias) => normalizeKey(alias).includes(normalized))
    );
    if (!match) {
      alert("没有找到匹配的名称，请检查匹配字段。");
      return;
    }
    const path = chinaPathByName.get(match.name);
    if (path) toggleVisited(match, path);
    return;
  }

  if (!dataCache.worldCities) {
    setRenderStatus("加载世界城市中，请稍等...", true);
    loadSingle("worldCities").then(() => {
      setRenderStatus("", false);
      worldCityScan(query);
    });
    return;
  }

  worldCityScan(query);
}

function worldCityScan(query) {
  const normalized = normalizeKey(query);
  const features = normalizeGeoJSON(dataCache.worldCities).features;
  const outline = normalizeGeoJSON(dataCache.worldOutline);
  const bounds = outline.bounds;
  const viewBox = { width: 1000, height: 600 };
  const scale = computeScale(bounds, viewBox);
  const visited = getVisitedSet();
  worldCityScanToken += 1;
  const token = worldCityScanToken;

  setRenderStatus("搜索城市中...", true);
  searchResults.innerHTML = "";

  let index = 0;
  let shown = 0;

  const step = () => {
    if (token !== worldCityScanToken) return;
    let added = 0;
    while (index < features.length && added < 500) {
      const feature = features[index];
      index += 1;
      if (!feature.geometry) continue;
      normalizeFeatureName(feature);
      const name = feature.properties?.name;
      if (!name) continue;
      if (!normalizeKey(name).includes(normalized)) continue;

      shown += 1;
      const pointPath = geometryToPath(feature.geometry, bounds, scale, viewBox);
      if (pointPath) {
        let marker = worldCityMarkers.get(name);
        if (!marker) {
          marker = document.createElementNS("http://www.w3.org/2000/svg", "path");
          marker.setAttribute("d", pointPath);
          marker.classList.add("map-path", "map-city");
          marker.dataset.name = name;
          marker.addEventListener("click", () => toggleVisited(name, marker));
          svg.appendChild(marker);
          worldCityMarkers.set(name, marker);
        }
        if (visited.has(name)) marker.classList.add("visited");
      }

      const row = document.createElement("div");
      row.className = "result-item";
      if (visited.has(name)) row.classList.add("active");
      const label = document.createElement("span");
      label.className = "result-name";
      label.textContent = name;
      const tag = document.createElement("span");
      tag.className = "result-tag";
      tag.textContent = visited.has(name) ? "已点亮" : "未点亮";
      row.appendChild(label);
      row.appendChild(tag);
      row.addEventListener("click", () => toggleVisited(name, worldCityMarkers.get(name)));
      searchResults.appendChild(row);
      if (shown >= 20) break;
      added += 1;
    }

    if (shown >= 20 || index >= features.length) {
      setRenderStatus("", false);
      return;
    }
    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
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

function normalizeKey(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[\\s\\u00A0]+/g, "").replace(/[\\-_.'"]/g, "");
}

function collectAliases(feature, name) {
  const aliases = new Set();
  if (name) aliases.add(name);
  const props = feature.properties || {};
  const keys = [
    "name",
    "shapeName",
    "NAME",
    "NAME_EN",
    "NAME_LONG",
    "NAME_LOCAL",
    "name_en",
    "name_zh",
    "NAME_ZH",
    "NAME_ZH_CN",
    "NAME_ZH_HANS",
    "NAME_ZH_HANT",
    "chinese",
    "CHINESE",
  ];
  for (const key of keys) {
    if (props[key]) aliases.add(props[key]);
  }
  for (const item of [...aliases]) {
    const mapped = ALIAS_MAP.get(item);
    if (mapped) aliases.add(mapped);
  }
  return [...aliases].filter(Boolean);
}

function mergeCollections(collections) {
  const merged = { type: "FeatureCollection", features: [] };
  for (const collection of collections) {
    if (collection?.features?.length) merged.features.push(...collection.features);
  }
  return merged;
}

function normalizeGeoJSON(geojson) {
  if (geojson.type === "FeatureCollection") {
    const features = geojson.features || [];
    return { features, bounds: computeBounds(features) };
  }
  if (geojson.type === "Feature") {
    return { features: [geojson], bounds: computeBounds([geojson]) };
  }
  return {
    features: [{ type: "Feature", properties: {}, geometry: geojson }],
    bounds: computeBounds([{ type: "Feature", properties: {}, geometry: geojson }]),
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
  if (!Number.isFinite(minLon)) return { minLon: -180, maxLon: 180, minLat: -90, maxLat: 90 };
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

function project(lon, lat, bounds, scale) {
  const x = (lon - bounds.minLon) * scale.scale + scale.padding;
  const y = (bounds.maxLat - lat) * scale.scale + scale.padding;
  return [x, y];
}

function geometryToPath(geometry, bounds, scale, viewBox) {
  if (!geometry) return "";
  switch (geometry.type) {
    case "Polygon":
      return polygonToPath(geometry.coordinates, bounds, scale);
    case "MultiPolygon":
      return geometry.coordinates
        .map((poly) => polygonToPath(poly, bounds, scale))
        .filter(Boolean)
        .join(" ");
    case "MultiLineString":
      return geometry.coordinates
        .map((line) => lineToPath(line, bounds, scale))
        .filter(Boolean)
        .join(" ");
    case "LineString":
      return lineToPath(geometry.coordinates, bounds, scale);
    case "MultiPoint":
      return geometry.coordinates
        .map((point) => pointToPath(point, bounds, scale))
        .filter(Boolean)
        .join(" ");
    case "Point":
      return pointToPath(geometry.coordinates, bounds, scale);
    default:
      return "";
  }
}

function polygonToPath(rings, bounds, scale) {
  if (!rings || !rings.length) return "";
  return rings.map((ring) => lineToPath(ring, bounds, scale, true)).join(" ");
}

function lineToPath(line, bounds, scale, closed = false) {
  if (!line || line.length === 0) return "";
  const [startLon, startLat] = line[0];
  const [sx, sy] = project(startLon, startLat, bounds, scale);
  let d = `M ${sx.toFixed(2)} ${sy.toFixed(2)}`;
  for (let i = 1; i < line.length; i += 1) {
    const [lon, lat] = line[i];
    const [x, y] = project(lon, lat, bounds, scale);
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  if (closed) d += " Z";
  return d;
}

function pointToPath(point, bounds, scale) {
  if (!point) return "";
  const [x, y] = project(point[0], point[1], bounds, scale);
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

function computeProjectedBounds(feature, bounds, scale, viewBox) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (!feature.geometry) return { minX, maxX, minY, maxY };
  walkCoordinates(feature.geometry, (lon, lat) => {
    const [x, y] = project(lon, lat, bounds, scale, viewBox);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  return { minX, maxX, minY, maxY };
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

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const geojson = JSON.parse(reader.result);
      if (activeView === "world") dataCache.worldCities = geojson;
      else dataCache[activeView] = geojson;
      resetViewBox();
      render();
    } catch {
      alert("文件解析失败，请确认是合法的 GeoJSON。");
    }
  };
  reader.readAsText(file);
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
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const geojson = JSON.parse(reader.result);
      if (activeView === "world") dataCache.worldCities = geojson;
      else dataCache[activeView] = geojson;
      resetViewBox();
      render();
    } catch {
      alert("文件解析失败，请确认是合法的 GeoJSON。");
    }
  };
  reader.readAsText(file);
});

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
