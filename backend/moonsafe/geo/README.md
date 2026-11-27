# Geospatial size & coordinate mapping

`moonsafe.geo` consumes `ImageMetadata` and raw pixel detections and emits the
shared `Detection` JSON shape with projected 2D boulder sizes and lunar-local
or pixel-frame coordinates.

## Guarantees

- **Projected 2D size only**: `estimated_size_m` is computed from `bbox_px` and
  ground sample distance (`gsd_x_m_per_px`, `gsd_y_m_per_px`) using an explicit
  method (`max_bbox_extent` by default, or `mean_bbox_extent`,
  `geometric_mean_bbox_extent`, `bbox_diagonal`). True 3D boulder height is never
  inferred from a 2D image.
- **No assumed 1-pixel error**: `model_localization_error_px` defaults to `None`.
  If neither the detection nor `GeoConfig` supplies a localization error,
  `size_uncertainty_m` and `uncertainty_breakdown.model_localization_m` remain
  `null` (`None`).
- **Separate model vs. georeferencing uncertainty**: `position.uncertainty_breakdown`
  tracks `model_localization_px`, `model_localization_m`, and `georeferencing_m`
  separately, and records the `combination_rule`.
- **Conservative coordinate frames**: Pixel centers transform to `lunar_local_m`
  only when supported by a valid, non-singular, metre-unit `affine_2d` transform
  consistent with image metadata. Missing, inconsistent, Earth-CRS (`EPSG:4326`,
  `WGS84`, degrees), or unreliable transforms preserve `image_px` coordinates
  with `uncertain: true` and explicit `reason_codes`.

## Example

```python
from moonsafe.geo import GeoConfig, process_detections

detections = process_detections(
    image_metadata,
    raw_detections,
    config=GeoConfig(size_method="max_bbox_extent"),
)
```
