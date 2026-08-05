from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from src.profile_builder.profile_builder import build_profile, profile_to_dict


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a user skills profile from processed course JSON files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # All academic PDFs
  python -m src.profile_builder.main --user-id alice --courses-dir output_json/

  # Mixed academic + specific online courses
  python -m src.profile_builder.main --user-id alice \\
      --courses-dir output_json/ \\
      --courses-files output/online_courses_json/course_01.json

  # Online courses only
  python -m src.profile_builder.main --user-id alice \\
      --courses-dir output/online_courses_json/ \\
      --pipeline-type online
""",
    )
    parser.add_argument("--user-id", required=True, help="User identifier")
    parser.add_argument(
        "--courses-dir",
        type=Path,
        help="Directory containing processed course JSON files (scans *.json at depth 1)",
    )
    parser.add_argument(
        "--courses-files",
        nargs="+",
        type=Path,
        metavar="FILE",
        help="One or more specific course JSON files",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("profiles"),
        help="Output directory (created if missing; default: profiles/)",
    )
    parser.add_argument(
        "--pipeline-type",
        choices=["auto", "academic", "online"],
        default="auto",
        help="Filter input by pipeline type (default: auto = accept both)",
    )
    parser.add_argument("--log-level", default="INFO", help="Logging level (default: INFO)")
    return parser.parse_args()


def _collect_paths(args: argparse.Namespace) -> list[Path]:
    paths: list[Path] = []

    if args.courses_dir:
        if not args.courses_dir.exists():
            logging.error("Directory not found: %s", args.courses_dir)
            sys.exit(1)
        if not args.courses_dir.is_dir():
            logging.error("Not a directory: %s", args.courses_dir)
            sys.exit(1)
        found = sorted(args.courses_dir.glob("*.json"))
        logging.info("Found %d JSON files in %s", len(found), args.courses_dir)
        paths.extend(found)

    if args.courses_files:
        for p in args.courses_files:
            if not p.exists():
                logging.warning("File not found, skipping: %s", p)
                continue
            paths.append(p)

    return paths


def _pipeline_type_filter(choice: str) -> str | None:
    return {"academic": "academic_pdf", "online": "online_csv"}.get(choice)


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(message)s",
    )

    if not args.courses_dir and not args.courses_files:
        logging.error("Provide at least --courses-dir or --courses-files.")
        sys.exit(1)

    paths = _collect_paths(args)
    if not paths:
        logging.error(
            "No JSON files found. Check --courses-dir and --courses-files arguments."
        )
        sys.exit(1)

    logging.info(
        "Building profile for user '%s' from %d candidate files ...", args.user_id, len(paths)
    )

    profile = build_profile(
        user_id=args.user_id,
        course_json_paths=paths,
        pipeline_type_filter=_pipeline_type_filter(args.pipeline_type),
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / f"user_profile_{args.user_id}.json"
    output_path.write_text(
        json.dumps(profile_to_dict(profile), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    s = profile.summary
    logging.info(
        "courses=%d  learning_hours=%.1f  skill_hours=%.1f  skills=%d  areas=%d  completeness=%.3f",
        s.total_courses,
        s.total_learning_hours_estimated,
        s.total_skill_hours_estimated,
        len(profile.skills),
        len(profile.areas),
        s.profile_completeness_score,
    )
    logging.info("Profile saved: %s", output_path.resolve())

    # Print summary to stdout for quick review
    d = profile_to_dict(profile)
    print(json.dumps(d["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
