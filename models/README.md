# MoonSafe experimental detector weights

`moonsafe-yolov8n-lunar-10pct-5ep.pt` is the YOLOv8n checkpoint trained for
five epochs on 10% of the prepared lunar BOULDERING training split. It is wired
into the API for prototype screening and is not a validated operational model.

## Provenance and evaluation

- Dataset: lunar subset of BOULDERING, Zenodo record 14250874 (Prieur et al.).
- Source labels: CC BY 4.0; see `ml/data/README.md` for dataset attribution and
  split details.
- Training subset: 326 tiles sampled from the training split; validation used
  702 tiles. The held-out test set used 700 tiles and 17,845 labeled objects.
- Test precision: 0.3032; recall: 0.2924; mAP50: 0.1915; mAP50-95: 0.0539.
- These low results are exploratory measurements, not evidence of reliable
  boulder detection. MoonSafe output remains screening-only.

The model predicts boulder boxes in image pixels. Metric size and lunar
coordinates remain unavailable whenever image scale or a valid lunar transform
is absent.
