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

加载后在页面右侧输入对应字段名即可点亮。
