# MoonSafe Boulder Dataset Preparation (`ml/data/`)

This directory contains the curation, evaluation, provenance tracking, leakage-free splitting, and YOLO box conversion scripts for LRO LROC NAC boulder detection. **No model training happens here, and no labels, dataset counts, or model metrics are invented.**

## 1. Data Sources & Scope Policy

### A. BOULDERING Dataset (Prieur et al., Zenodo record `14250874`)
- **Citation:** Prieur, N., Amaro, B., Gonzalez, E., & Lapotre, M. (2024). *Pre-processed (in Detectron2 and YOLO format) planetary images and boulder labels collected during the BOULDERING Marie Skłodowska-Curie Global fellowship.* Zenodo record `14250874`, DOI `10.5281/zenodo.14250874`.
- **License:** `CC-BY-4.0`.
- **Record metadata:** The Zenodo record is public and lists a CC BY 4.0 license and a 4,976-image multi-planet collection. These are record-level facts, not counts from a local lunar-subset audit. MoonSafe only ingests the **verified lunar subset**.
  - Archive: `bouldering_dataset_2024_YOLO_and_detectron2_format.zip`; inspect/download it from the [Zenodo record](https://zenodo.org/records/14250874). The local workflow does not download the archive automatically.
  - **Filename-based observation filtering:** Lunar LRO NAC tiles carry NAC product IDs in filenames (for example `M121118602_00875_image.png` or `M1104988970RE_00478_image.png` -> observation `M1104988970`). The parser accepts camera (`L`/`R`) and EDR/CDR (`E`/`C`) product suffixes, then groups both cameras by the shared MET observation ID. It also accepts IDs explicitly listed in `--allowlist`, while excluding Mars (`ESP_...`, `PSP_...`, `TRA_...`, `B\d{2}_...`) and unverified filenames into `excluded_manifest.jsonl`.
  - **Label geometry:** Upstream YOLO `.txt` files may contain polygons (`<class_id> x1 y1 x2 y2 ...`) or 5-column boxes. `parse_yolo_label_file` converts polygon coordinate extents to axis-aligned YOLO detection boxes (`0 xc yc w h`) and records `source_format` (`yolo_polygon` vs `yolo_box`) in provenance. Only source class ID 0 is accepted; coordinates must be finite and normalized.
  - **Upstream split caution:** Upstream `train` / `validation` / `test` folders must not be trusted blindly without verifying observation separation; MoonSafe re-splits strictly by `site_id` or `source_observation_id`.

### B. Label Studio Annotations (MoonSafe Curated NAC Tiles)
- `ml/data/label_studio.py` converts Label Studio JSON exports (`rectanglelabels`, 0–100% coordinates) on LRO NAC tiles into pixel `CuratedBox` and normalized YOLO detection boxes.
- Rotated rectangles (`rotation != 0`) are rejected rather than silently distorted, because standard YOLO axis-aligned boxes cannot preserve rotated extents without explicit re-annotation.
- Optional tile metadata (`image_id`, `source_observation_id`, `site_id`, `gsd_x_m_per_px`, `gsd_y_m_per_px`, `coordinate_units`, `license`, `task_type`, `reviewed_for_standalone_boulder`) is preserved into `provenance_manifest.jsonl`.
- A missing license is recorded as `not-specified`; supply the applicable license in task data instead of assuming one. Unknown rectangle labels are rejected rather than mapped to boulder.

### C. Bickel Rockfall Labels Policy (Excluded by Default)
- **Different task:** Bickel et al. lunar rockfall / boulder-track datasets annotate rockfall events and displaced boulders along tracks rather than exhaustive standalone boulders across a landing or traverse scene.
- `ml/data/bickel_policy.py` excludes records with `task_type == "rockfall"` or `bickel` / `rockfall` provenance markers (`BICKEL_ROCKFALL_DIFFERENT_TASK`) unless:
  1. The record is explicitly marked `task_type: standalone_boulder` after review and relabeling, and `reviewed_for_standalone_boulder: true`, and
  2. `--include-reviewed-bickel` is explicitly passed on the CLI. Merely marking an original rockfall record reviewed does not change its task type.

---

## 2. Leakage-Free Group Splitting

Neighboring tiles cropped from the same LRO NAC observation (`M121118602`) or lunar site share illumination geometry, terrain morphology, and GSD. `ml/data/split.py` groups all tiles by `site_id` (when provided) or `source_observation_id` before assigning `train` / `val` / `test`, and runs `verify_no_group_leakage` to guarantee zero observation or site overlap across splits.

---

## 3. Output Format & Provenance

`prepare_dataset.py` writes:
- `dataset.yaml` — Ultralytics YOLO detection configuration (`nc: 1`, `names: {0: boulder}`).
- `labels/{train,val,test}/<image_id>.txt` — Normalized `[0, 1]` YOLO detection boxes (`0 xc yc w h`), unit documented as `normalized_xywh`.
- `images/{train,val,test}/` — Populated when `--copy-images` is passed.
- `provenance_manifest.jsonl` — Per-tile `image_id`, `source_observation_id`, `site_id`, `split`, pixel dimensions, GSD (`m/px` or `null`), `coordinate_units`, `label_units`, `source_formats`, `label_source`, `license`, and `reviewed_for_standalone_boulder`.
- `excluded_manifest.jsonl` — Audit log of excluded Mars/Earth/unverified tiles and Bickel rockfall records.
- `split_summary.json` — Measured counts per split, zero-leakage confirmation, and `model_trained: false`.

The converter refuses a non-empty output directory to prevent stale image/label files from being mistaken for current outputs. Missing annotation files are excluded (they are not treated as negative examples); an existing empty annotation file can represent a curated negative tile.

---

## 4. Usage

### Evaluate BOULDERING (Zenodo `14250874`) accessibility or a local archive
```bash
# Check Zenodo record 14250874 accessibility & file metadata via REST API
python -m ml.data.evaluate_bouldering --check-remote

# Evaluate an extracted local BOULDERING archive
python -m ml.data.evaluate_bouldering --dataset-dir /path/to/boulder2024 --output-json eval_report.json
```

### Convert curated sources into a leakage-free YOLO detection dataset
```bash
python -m ml.data.prepare_dataset \
  --bouldering-dir /path/to/boulder2024 \
  --label-studio-json /path/to/label_studio_export.json \
  --label-studio-images-dir /path/to/nac_tiles \
  --output-dir /path/to/moonsafe_yolo_dataset \
  --copy-images
```

### Manifest example

Label Studio task `data` fields should preserve the original tile and curation details. Unknown/missing measurements stay absent; do not infer lunar coordinates from pixel coordinates.

```json
{
  "image_id": "M121118602_00875_image",
  "source_observation_id": "M121118602",
  "site_id": "optional-reviewed-site-id",
  "gsd_x_m_per_px": null,
  "gsd_y_m_per_px": null,
  "coordinate_units": "image_px",
  "license": "license identifier or terms",
  "task_type": "standalone_boulder",
  "reviewed_for_standalone_boulder": false,
  "provenance_notes": "curation batch or reviewer reference"
}
```

### Usage note

The source image and manifest remain provenance references. YOLO labels use normalized image-pixel boxes; GSD is retained only when supplied. `--check-remote` inspects Zenodo metadata without downloading the archive. `--dataset-dir` reports measured lunar-subset counts only from a local extraction. No training or model evaluation is performed here.
