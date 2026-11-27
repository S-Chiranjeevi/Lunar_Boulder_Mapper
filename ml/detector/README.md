# MoonSafe Boulder Detector (`ml.detector`)

PyTorch + Ultralytics YOLO boulder box detection and training scaffolding for
MoonSafe, consuming prepared YOLO datasets and emitting the shared `Detection`
shape with `estimated_size_m`, `size_uncertainty_m`, and `position` left unset
(`null`) for `moonsafe.geo`.

## Status & Honesty

- **No pre-trained weights or benchmark metrics are shipped or fabricated.**
- `check_inference_availability(config)` reports missing weights or missing
  `torch`/`ultralytics` packages clearly, and `BoulderDetector.detect(...)`
  raises `MissingWeightsError` (subclass of `FileNotFoundError`) when trained
  weights are absent.
- `prepare_training_plan(train_config)` and `train_boulder_detector(train_config)`
  validate real prepared YOLO `data.yaml` + `.txt` labels and raise
  `DatasetUnavailableError` if labels are missing.
- `python -m ml.detector.train` trains a configured Ultralytics checkpoint and
  evaluates the resulting best checkpoint on the prepared held-out `test`
  split. It writes the measured Ultralytics metrics and run provenance to
  `evaluation_report.json`; it does not infer physical size or lunar position.

## Reproducible Prototype Run

Install PyTorch for the target compute device and Ultralytics in the active
Python environment, then prepare the lunar BOULDERING subset with
`python -m ml.data.prepare_dataset` (see `ml/data/README.md`). For example:

```powershell
python -m ml.detector.train `
  --dataset D:\data\moonsafe-yolo `
  --project D:\runs\moonsafe `
  --name lunar-boulder-prototype `
  --weights yolov8n.pt `
  --epochs 5 `
  --fraction 0.1 `
  --image-size 640 `
  --batch 8 `
  --device cpu `
  --seed 42
```

The five-epoch, 10% training-split default is an illustrative prototype
experiment for CPU machines, not a tuned or validated training recipe. The
validation and held-out test splits remain complete. Training and held-out evaluation must complete
before reporting any metrics. Review `evaluation_report.json`, per-epoch
training logs, confusion matrix, and plots together. The reported test metrics
are from grouped-out source observations in this dataset only; they do not
establish generalization to other NAC observations, mission safety, geographic
accuracy, or physical boulder-size accuracy. Do not ship weights as validated
product defaults without separate review.

### Recorded local run (2026-11-27)

An exploratory CPU run used Ultralytics 8.4.220, `yolov8n.pt`, 640 px input,
batch size 8, seed 42, five epochs, and 10% of the train split (326 of 3,255
tiles). The source-observation grouped splits had 702 validation and 700 held
out test tiles with zero group leakage. On the test split (17,845 boxes), the
measured metrics were precision 0.3032, recall 0.2924, mAP@0.5 0.1915, and
mAP@0.5:0.95 0.0539. This result is weak and is not evidence of a deployable
detector; the resulting checkpoint is not configured as the application
default. It needs more curated training and independent evaluation before use
for operational screening.

## Large-Image Sliced Inference & SAHI Evaluation

Large LRO NAC strips exceed single-pass YOLO input sizes (`640x640`).
- **Built-in sliding-window slicing (`slicing.py`)**: generates configurable
  overlapping tiles (`tile_size`, `tile_overlap_ratio`), normalizes 8/16/float
  grayscale rasters to 3-channel uint8 RGB, maps tile boxes back to full-image
  pixel coordinates, and merges boundary duplicates via `nms` (IoU + IoS edge
  suppression) or `wbf` (confidence-weighted box fusion).
- **SAHI evaluation**: `slicing_backend="sahi"` (or `"auto"` when `sahi` is
  installed) delegates sliced prediction to SAHI's `AutoDetectionModel` +
  `get_sliced_prediction`. Built-in slicing is kept as the default fallback so
  16-bit NAC normalization, overlap merging, and tests do not require `sahi` to
  be installed.

## Configuration

`DetectorConfig` exposes `model_version`, `weights_path`, `image_size`,
`confidence_threshold`, `iou_threshold`, `tile_size`, `tile_overlap_ratio`,
`merge_iou_threshold`, `merge_ios_threshold`, `merge_strategy`, and
`slicing_backend`.
