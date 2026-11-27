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
