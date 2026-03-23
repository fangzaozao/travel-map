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

当前中国县级数据使用 GADM v4.1 ADM3（CHN），包含地级市字段：
- `NAME_2`（地级市英文）
- `NL_NAME_2`（地级市中文）
- `NAME_3` / `NL_NAME_3`（县区）
- `ENGTYPE_3` / `TYPE_3`（县区类型：District / County / CountyCity 等）

注意：GADM 数据有使用许可限制，使用前请确认许可条款。

世界城市中文检索数据：
- 可选使用 `data/world_cities_zh.json`，包含中文城市名与国家名
- 生成方式：使用 `scripts/build_world_cities_zh.js`
- 输入文件：
  - `data/geonames_cities15000.txt`
  - `data/geonames_alternateNamesV2.txt`
  - `data/country_zh.json`（可选，用于国家中文名）

脚本会输出 `data/world_cities_zh.json`，页面会优先加载该文件。
注意：GeoNames 数据有使用许可限制，使用前请确认许可条款。
