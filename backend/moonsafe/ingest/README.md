# Local image ingestion

`load_image_metadata(image_path, manifest_path=None)` returns the shared
`ImageMetadata` JSON shape for a local raster. It accepts PNG, JPEG, and TIFF
files, checks that the filename extension matches the decoded content, and
rejects empty files or files larger than `MOONSAFE_MAX_IMAGE_BYTES` (default
2 GiB). The repository's API `ImageStore` writes accepted uploads under its
image folder and stores a browser preview as `preview.png`; `preview_path_for`
returns that path for an original image path. The loader itself does not copy or
rewrite the source image.

The loader uses Pillow for image verification and dimensions. When Rasterio is
installed, it also reads GeoTIFF projection metadata: projected linear units can
provide GSD, and an affine transform is retained as lunar-local only when the
source CRS explicitly identifies Moon/lunar coordinates. A regular Earth CRS
is never exposed as a lunar transform. Metadata tags, a JSON sidecar, and the
optional `metadata=` mapping can provide `source_image_id`, GSD, coverage,
coordinate frame, and an `image_to_lunar` affine; later sources override earlier
ones.

The default sidecar name is `<image filename>.json` (for example,
`scene.tif.json`). Explicitly absent scale stays `null`; absent coverage becomes
`missing`; and without a supported lunar transform, coordinates stay in
`image_px`. No scale, coverage, or transform is guessed. Sidecars are limited to
1 MiB.

```python
from moonsafe.ingest import load_image_metadata, preview_path_for

metadata = load_image_metadata("scene.tif", "scene.tif.json")
preview_path = preview_path_for("stored/images/scene/original.tif")
```

See [example_manifest.json](example_manifest.json) for a manifest that leaves
unknown source fields explicitly missing. Mark coverage `valid` or `partial`
only when the product metadata or an independent coverage assessment supports
that value.
