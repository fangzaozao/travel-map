# GeoJSON 数据准备指南

这个页面需要两类 GeoJSON 数据：

1. 世界范围的行政区或国家边界（用于全世界视图）
2. 中国县级市或区县级行政区边界（用于中国视图）

建议要求：
- 坐标系为 EPSG:4326（经纬度）
- FeatureCollection
- 每个 Feature 在 properties 中有一个可读名称字段

常见字段示例：
- `name`
- `NAME`
- `NAME_2`
- `adm2_name`

当前中国县级数据使用 DataV.GeoAtlas 的区县级边界，来自 ChinaGeoJson 数据集：
- 数据来源：阿里云 DataV.GeoAtlas
- 包含 `info.json` 的行政层级信息与 `county` 的区县边界数据
- 已转换为 `data/china_adm3.geojson`

注意：数据许可与使用限制请参考数据源说明。

世界城市中文检索数据：
- 可选使用 `data/world_cities_zh.json`，包含中文城市名与国家名
- 生成方式：使用 `scripts/build_world_cities_zh.js`
- 输入文件：
  - `data/geonames_cities15000.txt`
  - `data/geonames_alternateNamesV2.txt`
  - `data/country_zh.json`（可选，用于国家中文名）

脚本会输出 `data/world_cities_zh.json`，页面会优先加载该文件。
注意：GeoNames 数据有使用许可限制，使用前请确认许可条款。
