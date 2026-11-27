"""Evaluate Zenodo 14250874 (BOULDERING) accessibility and local lunar subset composition."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .bouldering import (
    BOULDERING_CITATION,
    BOULDERING_LICENSE,
    ZENODO_RECORD_ID,
    check_zenodo_accessibility,
    load_bouldering_lunar_tiles,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate the lunar subset of the BOULDERING dataset (Zenodo 14250874)."
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=None,
        help="Path to extracted BOULDERING directory (containing boulder2024/ or train/validation/test).",
    )
    parser.add_argument(
        "--allowlist",
        type=Path,
        default=None,
        help="Optional newline or JSON list of additional verified lunar observation IDs.",
    )
    parser.add_argument(
        "--check-remote",
        action="store_true",
        help="Query Zenodo REST API for record 14250874 metadata/file availability.",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=None,
        help="Optional output path to write the evaluation report JSON.",
    )
    args = parser.parse_args(argv)

    report: dict[str, Any] = {
        "zenodo_record_id": ZENODO_RECORD_ID,
        "citation": BOULDERING_CITATION,
        "license": BOULDERING_LICENSE,
        "remote_check": None,
        "local_evaluation": None,
    }

    if args.check_remote:
        report["remote_check"] = check_zenodo_accessibility(ZENODO_RECORD_ID)

    if args.dataset_dir is not None:
        _, excluded, local_report = load_bouldering_lunar_tiles(
            args.dataset_dir,
            allowlist_path=args.allowlist,
        )
        local_report["excluded_count"] = len(excluded)
        report["local_evaluation"] = local_report
    elif not args.check_remote:
        report["note"] = (
            "Pass --check-remote to inspect Zenodo record 14250874 metadata or "
            "--dataset-dir <path> to evaluate an extracted BOULDERING archive."
        )

    rendered = json.dumps(report, indent=2)
    if args.output_json is not None:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(rendered + "\n", encoding="utf-8")

    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
