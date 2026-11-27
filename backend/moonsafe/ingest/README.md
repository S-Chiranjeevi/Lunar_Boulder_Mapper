# Local image ingestion

`load_image_metadata(image_path, manifest_path=None)` decodes a local image and
returns the shared `ImageMetadata` fields. The loader reads raster dimensions
from the image; GSD, coverage, identifiers, and transforms come only from an
optional JSON manifest or explicit `metadata=` mapping. The default sidecar
name is `<image filename>.json` (for example, `scene.tif.json`).

Install Pillow for PNG, JPEG, and TIFF decoding. Missing scale is returned as
`null`; unknown coverage is `missing`. The loader retains `image_to_lunar` only
when the manifest declares `coordinate_frame: "lunar_local_m"` and supplies a
finite 3×3 `affine_2d` matrix in meters. No longitude/latitude conversion or
georeferencing is inferred. Images without that complete declaration remain in
`image_px` coordinates.

Example:

```python
from moonsafe.ingest import load_image_metadata

metadata = load_image_metadata("scene.tif", "scene_manifest.json")
```

See [example_manifest.json](example_manifest.json) for the minimal sidecar
format. Set `coverage` to `valid` or `partial` only when that state is provided
by the image product or established during a separate coverage assessment.
