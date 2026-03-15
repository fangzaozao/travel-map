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

const DEFAULT_MATCH_KEYS = {
  world: "name",
  china: "shapeName",
};

const BUILTIN_FILES = {
  world: "data/world.geojson",
  china: "data/china_adm3.geojson",
};

const VIEW_KEYS = {
  world: "travel-map-world",
  china: "travel-map-china",
};

let activeView = "world";
let geojsonCache = {
  world: null,
  china: null,
};
let isLoading = {
  world: false,
  china: false,
};
let featureIndex = new Map();
let featureList = [];
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
  statTitle.textContent = view === "world" ? "世界视图" : "中国县级市";
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
  geojsonCache[activeView] = geojson;
  render();
}

function render() {
  const geojson = geojsonCache[activeView];
  clearSvg();
  featureIndex = new Map();
  featureList = [];
  if (!geojson) {
    emptyState.style.display = "grid";
    updateStats(0, 0);
    loadBuiltin(activeView);
    return;
  }

  emptyState.style.display = "none";
  const matchKey = normalizeMatchKey();
  const visited = getVisitedSet();
  const { features, bounds } = normalizeGeoJSON(geojson);
  const viewBox = { width: 1000, height: 600 };
  const scale = computeScale(bounds, viewBox);

  let total = 0;
  for (const feature of features) {
    if (!feature.geometry) continue;
    const name = feature.properties?.[matchKey];
    const pathData = geometryToPath(feature.geometry, bounds, scale, viewBox);
    if (!pathData) continue;

    total += 1;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.classList.add("map-path");
    path.dataset.name = name || `feature-${total}`;
    path.dataset.bbox = JSON.stringify(computeProjectedBounds(feature, bounds, scale, viewBox));
    if (name && visited.has(name)) {
      path.classList.add("visited");
    }

    path.addEventListener("click", () => {
      const id = path.dataset.name;
      const visitedSet = getVisitedSet();
      if (visitedSet.has(id)) {
        visitedSet.delete(id);
      } else {
        visitedSet.add(id);
      }
      setVisitedSet(visitedSet);
      path.classList.toggle("visited");
      updateStats(total, visitedSet.size);
    });

    svg.appendChild(path);
    if (name) {
      featureIndex.set(name, path);
      featureIndex.set(name.toLowerCase(), path);
      featureList.push({ name, path });
    }
  }

  applyViewBox();
  updateStats(total, visited.size);
  renderSearchResults();
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
      alert("文件解析失败，请确认是合法的 GeoJSON。");
    }
  };
  reader.readAsText(file);
}

async function loadBuiltin(view) {
  if (geojsonCache[view] || isLoading[view]) return;
  isLoading[view] = true;
  try {
    const response = await fetch(BUILTIN_FILES[view], { cache: "no-store" });
    if (!response.ok) return;
    const geojson = await response.json();
    geojsonCache[view] = geojson;
    if (activeView === view) render();
  } catch {
    // Ignore fetch errors; user can still import manually.
  } finally {
    isLoading[view] = false;
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

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  const matchKey = normalizeMatchKey();
  let target = featureIndex.get(query) || featureIndex.get(query.toLowerCase());

  if (!target) {
    // Fallback: partial match in properties
    const geojson = geojsonCache[activeView];
    if (geojson?.features) {
      for (const feature of geojson.features) {
        const value = feature.properties?.[matchKey];
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
searchInput.addEventListener("input", renderSearchResults);

setActiveTab("world");
