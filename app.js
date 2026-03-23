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
const authEmailInput = document.getElementById("auth-email");
const authSendBtn = document.getElementById("auth-send");
const authSyncBtn = document.getElementById("auth-sync");
const authSignOutBtn = document.getElementById("auth-signout");
const authStatus = document.getElementById("auth-status");

const DATA_VERSION = "20260323-5";
const SUPABASE_URL = "https://gmmvwnrqkwbxdqishreb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3o3hYeHXEbVeji8ZQtOvIg_Z4JJxsY6";
const SUPABASE_REDIRECT_URL = "https://fangzaozao.github.io/travel-map/";
const VIEW_KEYS = {
  world: "travel-map-world",
  china: "travel-map-china",
};

const FILES = {
  worldOutline: "data/world.geojson",
  worldCities: ["data/world_cities_zh.json", "data/world_cities.geojson"],
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
let lastWorldMatches = null;
let supabaseClient = null;
let authUser = null;
let syncTimer = null;
let isApplyingRemote = false;

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

function getVisitedSetForView(view) {
  const raw = localStorage.getItem(VIEW_KEYS[view]);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function setVisitedSetForView(view, set) {
  localStorage.setItem(VIEW_KEYS[view], JSON.stringify([...set]));
  if (!isApplyingRemote) scheduleCloudSync();
}

function getVisitedSet() {
  return getVisitedSetForView(activeView);
}

function setVisitedSet(set) {
  setVisitedSetForView(activeView, set);
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
    if (key === "china") {
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
      for (const url of fileDef) {
        const response = await fetch(`${url}?v=${DATA_VERSION}`, { cache: "no-store" });
        if (!response.ok) continue;
        dataCache[key] = await response.json();
        break;
      }
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
      const props = feature.properties || {};
      const nameKey = cleanName(props.NAME_3) || cleanName(props.shapeName) || props[normalizeMatchKey()] || props.name;
      const displayName = cleanName(props.NL_NAME_3) || cleanName(props.NAME_3) || nameKey;
      if (!nameKey) continue;

      total += 1;
      const pathData = geometryToPath(feature.geometry, bounds, scale, viewBox);
      if (!pathData) continue;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.classList.add("map-path");
      if (visited.has(name)) path.classList.add("visited");
      const cityKey = getChinaCityKey(props);
      const isDistrict = isChinaDistrict(props, displayName);
      path.dataset.name = nameKey;
      path.dataset.cityKey = cityKey || "";
      path.dataset.isDistrict = isDistrict ? "1" : "0";
      path.dataset.bbox = JSON.stringify(computeProjectedBounds(feature, bounds, scale, viewBox));
      path.addEventListener("click", () => {
        if (isDistrict && cityKey) {
          toggleChinaCityDistricts(cityKey);
          renderSearchResults();
        } else {
          toggleVisited(nameKey, path);
          renderSearchResults();
        }
      });
      fragment.appendChild(path);
      chinaPathByName.set(nameKey, path);
      chinaItems.push({
        name: nameKey,
        label: displayName,
        aliases: collectAliases(feature, displayName, nameKey),
        cityKey,
        isDistrict,
        path,
      });
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

function toggleVisited(name, path, options = {}) {
  const visitedSet = getVisitedSet();
  if (activeView === "world") {
    const legacyName = options.legacyName;
    const isVisited = visitedSet.has(name) || (legacyName && visitedSet.has(legacyName));
    if (isVisited) {
      visitedSet.delete(name);
      if (legacyName) visitedSet.delete(legacyName);
      path.classList.remove("visited");
    } else {
      visitedSet.add(name);
      path.classList.add("visited");
    }
    setVisitedSet(visitedSet);
    updateWorldStats(visitedSet.size);
    if (lastWorldMatches && searchInput.value.trim()) {
      renderWorldResults(lastWorldMatches, false);
    }
    return;
  }

  if (visitedSet.has(name)) {
    visitedSet.delete(name);
    path.classList.remove("visited");
  } else {
    visitedSet.add(name);
    path.classList.add("visited");
  }
  setVisitedSet(visitedSet);
  updateStats(parseInt(countTotal.textContent, 10), visitedSet.size);
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
      ? chinaItems.filter((item) =>
          item.aliases.some((alias) => normalizeKey(alias).includes(normalized))
        )
      : [];
  const cityMatches =
    activeView === "china"
      ? buildChinaCityMatches(normalized)
      : [];

  if (matches.length === 0 && cityMatches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "results-empty";
    empty.textContent = "暂无结果";
    searchResults.appendChild(empty);
    return;
  }

  const rows = [];
  for (const city of cityMatches) {
    rows.push({
      type: "city",
      key: city.cityKey,
      name: `${city.cityKey}（地级市）`,
      tag: city.tag,
      active: city.active,
      onClick: () => {
        toggleChinaCityDistricts(city.cityKey);
        renderSearchResults();
      },
    });
  }

  for (const item of matches) {
    const name = item.name;
    rows.push({
      type: "item",
      key: name,
      name: item.label || name,
      tag: visitedSet.has(name) ? "已点亮" : "未点亮",
      active: visitedSet.has(name),
      onClick: () => {
        searchInput.value = item.label || name;
        handleSearch();
      },
    });
  }

  rows.slice(0, 20).forEach((rowData) => {
    const row = document.createElement("div");
    row.className = "result-item";
    if (rowData.active) row.classList.add("active");

    const label = document.createElement("span");
    label.className = "result-name";
    label.textContent = rowData.name;

    const tag = document.createElement("span");
    tag.className = "result-tag";
    tag.textContent = rowData.tag;

    row.appendChild(label);
    row.appendChild(tag);
    row.addEventListener("click", rowData.onClick);
    searchResults.appendChild(row);
  });
}

function buildChinaCityMatches(normalized) {
  const map = new Map();
  for (const item of chinaItems) {
    if (!item.isDistrict || !item.cityKey) continue;
    if (!normalizeKey(item.cityKey).includes(normalized)) continue;
    if (!map.has(item.cityKey)) map.set(item.cityKey, []);
    map.get(item.cityKey).push(item);
  }
  const visitedSet = getVisitedSet();
  const results = [];
  for (const [cityKey, items] of map.entries()) {
    const total = items.length;
    const visitedCount = items.filter((it) => visitedSet.has(it.name)).length;
    let tag = "未点亮";
    let active = false;
    if (visitedCount === total) {
      tag = "已点亮";
      active = true;
    } else if (visitedCount > 0) {
      tag = "部分点亮";
    }
    results.push({ cityKey, tag, active });
  }
  return results.sort((a, b) => a.cityKey.localeCompare(b.cityKey));
}

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  if (activeView === "china") {
    const normalized = normalizeKey(query);
    const cityMatch = chinaItems.find(
      (item) => item.isDistrict && item.cityKey && normalizeKey(item.cityKey).includes(normalized)
    );
    if (cityMatch) {
      toggleChinaCityDistricts(cityMatch.cityKey);
      renderSearchResults();
      return;
    }
    const match = chinaItems.find((item) =>
      item.aliases.some((alias) => normalizeKey(alias).includes(normalized))
    );
    if (!match) {
      alert("没有找到匹配的名称，请检查匹配字段。");
      return;
    }
    if (match.isDistrict && match.cityKey) {
      toggleChinaCityDistricts(match.cityKey);
    } else {
      const path = match.path || chinaPathByName.get(match.name);
      if (path) toggleVisited(match.name, path);
    }
    renderSearchResults();
    return;
  }

  if (!dataCache.worldCities) {
    setRenderStatus("加载世界城市中，请稍等...", true);
    loadSingle("worldCities").then(() => {
      setRenderStatus("", false);
      worldCityScan(query, true);
    });
    return;
  }

  worldCityScan(query, true);
}

function worldCityScan(query, autoMark) {
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
  const matches = [];

  const step = () => {
    if (token !== worldCityScanToken) return;
    let added = 0;
    while (index < features.length && added < 800) {
      const feature = features[index];
      index += 1;
      if (!feature.geometry) continue;
      normalizeFeatureName(feature);
      const props = feature.properties || {};
      const displayName = getWorldDisplayName(props);
      if (!displayName) continue;
      const aliases = collectWorldAliases(props, displayName);
      if (!aliases.some((alias) => normalizeKey(alias).includes(normalized))) continue;

      const coords = feature.geometry?.coordinates || [];
      matches.push({
        id: props.geonameid || props.id || props.GEONAMEID || "",
        name: displayName,
        name_en: cleanName(props.name_en) || cleanName(props.NAME_EN) || cleanName(props.name),
        name_zh: cleanName(props.name_zh) || cleanName(props.NAME_ZH),
        country: cleanName(props.country) || cleanName(props.adm0name),
        country_zh: cleanName(props.country_zh) || cleanName(props.NAME_ZH),
        iso: props.iso_a2 || props.iso || props.countryCode || "",
        pop: Number(props.pop_max || props.pop || props.population) || 0,
        coords,
      });
      added += 1;
    }

    if (index >= features.length) {
      setRenderStatus("", false);
      if (matches.length === 0) {
        const empty = document.createElement("div");
        empty.className = "results-empty";
        empty.textContent = "暂无结果";
        searchResults.appendChild(empty);
        return;
      }

      matches.sort((a, b) => {
        if (b.pop !== a.pop) return b.pop - a.pop;
        return a.name.localeCompare(b.name);
      });

      const top = matches.slice(0, 20);
      lastWorldMatches = top;
      renderWorldResults(top, autoMark);
      return;
    }
    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

function renderWorldResults(items, autoMark) {
  const outline = normalizeGeoJSON(dataCache.worldOutline);
  const bounds = outline.bounds;
  const viewBox = { width: 1000, height: 600 };
  const scale = computeScale(bounds, viewBox);
  const visited = getVisitedSet();
  searchResults.innerHTML = "";
  let firstMatch = null;

  for (const item of items) {
    const key = getWorldCityKey(item);
    const pointPath = geometryToPath(
      { type: "Point", coordinates: item.coords },
      bounds,
      scale,
      viewBox
    );
    if (pointPath) {
      let marker = worldCityMarkers.get(key);
      if (!marker) {
        marker = document.createElementNS("http://www.w3.org/2000/svg", "path");
        marker.setAttribute("d", pointPath);
        marker.classList.add("map-path", "map-city");
        marker.dataset.key = key;
        marker.addEventListener("click", () =>
          toggleVisited(key, marker, { legacyName: item.name })
        );
        svg.appendChild(marker);
        worldCityMarkers.set(key, marker);
      }
      if (isWorldVisited(visited, item.name, key)) marker.classList.add("visited");
      else marker.classList.remove("visited");
      if (!firstMatch) firstMatch = { key, marker, legacyName: item.name };
    }

    const row = document.createElement("div");
    row.className = "result-item";
    const visitedState = isWorldVisited(visited, item.name, key);
    if (visitedState) row.classList.add("active");
    const label = document.createElement("span");
    label.classList.add("result-name");
    label.textContent = formatWorldLabel(item);
    const tag = document.createElement("span");
    tag.className = "result-tag";
    tag.textContent = visitedState ? "已点亮" : "未点亮";
    row.appendChild(label);
    row.appendChild(tag);
    row.addEventListener("click", () => {
      const marker = worldCityMarkers.get(key);
      if (marker) toggleVisited(key, marker, { legacyName: item.name });
    });
    searchResults.appendChild(row);
  }

  if (autoMark && firstMatch?.marker) {
    toggleVisited(firstMatch.key, firstMatch.marker, { legacyName: firstMatch.legacyName });
  }
}

function getWorldCityKey(item) {
  if (item.id) return `id:${item.id}`;
  const lon = Number(item.coords?.[0]);
  const lat = Number(item.coords?.[1]);
  const lonKey = Number.isFinite(lon) ? lon.toFixed(4) : "0";
  const latKey = Number.isFinite(lat) ? lat.toFixed(4) : "0";
  return `${item.name}|${item.iso || ""}|${lonKey}|${latKey}`;
}

function isWorldVisited(visitedSet, legacyName, key) {
  if (visitedSet.has(key)) return true;
  if (legacyName && visitedSet.has(legacyName)) return true;
  return false;
}

function formatWorldLabel(item) {
  const suffix = item.country_zh || item.country || item.iso;
  if (!suffix) return item.name;
  return `${item.name} · ${suffix}`;
}

function initSupabase() {
  if (!authEmailInput || !authSendBtn || !authStatus) return;
  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_URL.startsWith("YOUR_") ||
    SUPABASE_ANON_KEY.startsWith("YOUR_")
  ) {
    setAuthStatus("未配置 Supabase");
    authSendBtn.disabled = true;
    authSyncBtn.disabled = true;
    authSignOutBtn.disabled = true;
    return;
  }
  if (!window.supabase?.createClient) {
    setAuthStatus("Supabase SDK 未加载");
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true },
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    authUser = session?.user ?? null;
    updateAuthUI();
    if (authUser) {
      syncFromCloud();
    }
  });

  updateAuthUI();
}

function setAuthStatus(text) {
  if (authStatus) authStatus.textContent = text;
}

function updateAuthUI() {
  if (!authStatus) return;
  if (authUser) {
    const email = authUser.email || "已登录";
    setAuthStatus(`已登录：${email}`);
    authSendBtn.disabled = true;
    authSyncBtn.disabled = false;
    authSignOutBtn.disabled = false;
  } else {
    setAuthStatus("未登录");
    authSendBtn.disabled = false;
    authSyncBtn.disabled = true;
    authSignOutBtn.disabled = true;
  }
}

function collectLocalPayload() {
  return {
    world: [...getVisitedSetForView("world")],
    china: [...getVisitedSetForView("china")],
    updatedAt: new Date().toISOString(),
  };
}

function applyRemotePayload(payload) {
  if (!payload) return;
  isApplyingRemote = true;
  setVisitedSetForView("world", new Set(payload.world || []));
  setVisitedSetForView("china", new Set(payload.china || []));
  isApplyingRemote = false;
  render();
}

function mergePayload(localPayload, remotePayload) {
  const mergedWorld = new Set([...(localPayload.world || []), ...(remotePayload.world || [])]);
  const mergedChina = new Set([...(localPayload.china || []), ...(remotePayload.china || [])]);
  return {
    world: [...mergedWorld],
    china: [...mergedChina],
    updatedAt: new Date().toISOString(),
  };
}

async function syncFromCloud() {
  if (!supabaseClient || !authUser) return;
  setAuthStatus("同步中...");
  const { data, error } = await supabaseClient
    .from("travel_map_states")
    .select("payload, updated_at")
    .eq("user_id", authUser.id)
    .limit(1);
  if (error) {
    setAuthStatus("同步失败");
    return;
  }
  const remote = data?.[0]?.payload;
  if (remote) {
    const merged = mergePayload(collectLocalPayload(), remote);
    applyRemotePayload(merged);
    await syncToCloud(merged);
  }
  setAuthStatus(`已登录：${authUser.email || "账号"}`);
}

async function syncToCloud(payloadOverride) {
  if (!supabaseClient || !authUser) return;
  const payload = payloadOverride || collectLocalPayload();
  const { error } = await supabaseClient
    .from("travel_map_states")
    .upsert(
      {
        user_id: authUser.id,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) {
    setAuthStatus("同步失败");
    return;
  }
  setAuthStatus(`已登录：${authUser.email || "账号"}`);
}

function scheduleCloudSync() {
  if (!authUser) return;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncToCloud();
  }, 800);
}

function normalizeFeatureName(feature) {
  if (!feature.properties) feature.properties = {};
  if (feature.properties.name) return;
  const fallback =
    cleanName(feature.properties.NL_NAME_3) ||
    cleanName(feature.properties.NAME_3) ||
    cleanName(feature.properties.shapeName) ||
    cleanName(feature.properties.NAME) ||
    cleanName(feature.properties.NAME_EN) ||
    cleanName(feature.properties.name_en) ||
    cleanName(feature.properties.admin) ||
    cleanName(feature.properties.NAME_LONG) ||
    cleanName(feature.properties.NAME_LOCAL);
  if (fallback) feature.properties.name = fallback;
}

function normalizeKey(value) {
  if (!value) return "";
  return value.toString().trim().toLowerCase().replace(/[\\s\\u00A0]+/g, "").replace(/[\\-_.'"]/g, "");
}

function cleanName(value) {
  if (value === undefined || value === null) return "";
  const text = value.toString().trim();
  if (!text || text.toUpperCase() === "NA") return "";
  return text;
}

function getWorldDisplayName(props) {
  return (
    cleanName(props.name_zh) ||
    cleanName(props.NAME_ZH) ||
    cleanName(props.name) ||
    cleanName(props.name_en) ||
    cleanName(props.NAME_EN)
  );
}

function collectWorldAliases(props, displayName) {
  const aliases = new Set();
  const keys = [
    "name_zh",
    "NAME_ZH",
    "name",
    "name_en",
    "NAME_EN",
    "nameascii",
    "NAMEASCII",
    "ascii",
    "alternatenames",
  ];
  if (displayName) aliases.add(displayName);
  for (const key of keys) {
    const value = cleanName(props[key]);
    if (!value) continue;
    if (value.includes(",")) {
      value
        .split(",")
        .map((item) => cleanName(item))
        .filter(Boolean)
        .forEach((item) => aliases.add(item));
    } else {
      aliases.add(value);
    }
  }
  const countryZh = cleanName(props.country_zh) || cleanName(props.NAME_ZH);
  if (countryZh) aliases.add(countryZh);
  return [...aliases];
}

function getChinaCityKey(props) {
  return (
    cleanName(props.NL_NAME_2) ||
    cleanName(props.NAME_2) ||
    cleanName(props.NL_NAME_1) ||
    cleanName(props.NAME_1)
  );
}

function isChinaDistrict(props, name) {
  const typeEn = cleanName(props.ENGTYPE_3).toLowerCase();
  if (typeEn.includes("district")) return true;
  const localName = cleanName(props.NL_NAME_3) || cleanName(props.NAME_3) || name || "";
  return localName.endsWith("区");
}

function toggleChinaCityDistricts(cityKey) {
  const visitedSet = getVisitedSet();
  const targets = chinaItems.filter((item) => item.cityKey === cityKey && item.isDistrict);
  if (!targets.length) return;
  const shouldAdd = targets.some((item) => !visitedSet.has(item.name));
  for (const item of targets) {
    const path = item.path || chinaPathByName.get(item.name);
    if (!path) continue;
    if (shouldAdd) {
      visitedSet.add(item.name);
      path.classList.add("visited");
    } else {
      visitedSet.delete(item.name);
      path.classList.remove("visited");
    }
  }
  setVisitedSet(visitedSet);
  updateStats(parseInt(countTotal.textContent, 10), visitedSet.size);
}

function collectAliases(feature, name, nameKey) {
  const aliases = new Set();
  if (name) aliases.add(name);
  if (nameKey) aliases.add(nameKey);
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
    "NAME_1",
    "NAME_2",
    "NAME_3",
    "NL_NAME_1",
    "NL_NAME_2",
    "NL_NAME_3",
    "VARNAME_3",
  ];
  for (const key of keys) {
    const value = cleanName(props[key]);
    if (value) aliases.add(value);
  }
  for (const item of [...aliases]) {
    const mapped = ALIAS_MAP.get(item);
    if (mapped) aliases.add(mapped);
    const lower = item.toString().toLowerCase();
    if (lower.includes("taichung")) aliases.add("taizhong");
    if (lower.includes("taizhong")) aliases.add("taichung");
    if (lower.includes("taipei")) aliases.add("taibei");
    if (lower.includes("taibei")) aliases.add("taipei");
    if (item === "台中") {
      aliases.add("taichung");
      aliases.add("taizhong");
    }
    if (item === "台北") {
      aliases.add("taipei");
      aliases.add("taibei");
    }
    if (item === "高雄") {
      aliases.add("kaohsiung");
      aliases.add("gaoxiong");
    }
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

if (authSendBtn) {
  authSendBtn.addEventListener("click", async () => {
    if (!supabaseClient) return;
    const email = authEmailInput.value.trim();
    if (!email) {
      setAuthStatus("请输入邮箱");
      return;
    }
    setAuthStatus("发送中...");
    const redirectTo = SUPABASE_REDIRECT_URL || `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setAuthStatus(`发送失败：${error.message || "未知错误"}`);
      return;
    }
    setAuthStatus("已发送登录链接，请查收邮箱");
  });
}

if (authSyncBtn) {
  authSyncBtn.addEventListener("click", () => {
    if (!supabaseClient || !authUser) return;
    syncFromCloud();
  });
}

if (authSignOutBtn) {
  authSignOutBtn.addEventListener("click", async () => {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    authUser = null;
    updateAuthUI();
  });
}

initSupabase();
setActiveTab("world");
