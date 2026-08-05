import json
import importlib.util
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config_loader import load_config
from .io_utils import get_text_from_input
from .models import ExtractionResult
from .parser import build_course_candidate
from .section_detector import build_raw_sections, detect_relevant_sections
from .semantic_builder import build_semantic_output
from .validator import validate_semantic_record


def setup_logging(log_file: Path) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def process_single_input(
    config: Dict[str, Any],
    source_name: str,
    input_path: Optional[Path] = None,
    manual_text: Optional[str] = None,
) -> ExtractionResult:
    text = get_text_from_input(input_path=input_path, manual_text=manual_text)
    if not text.strip():
        raise ValueError("El texto de entrada esta vacio")

    detected_sections = detect_relevant_sections(
        text=text,
        relevant_patterns=config["relevant_section_patterns"],
        irrelevant_patterns=config["irrelevant_section_patterns"],
    )

    raw_sections = build_raw_sections(detected_sections)
    candidate = build_course_candidate(text=text, source_file=source_name, raw_sections=raw_sections)

    raw_output = {
        "course_code": candidate.course_code,
        "name": candidate.name,
        "title_extracted": candidate.title_extracted,
        "title_normalized": candidate.title_normalized,
        "title_quality_status": candidate.title_quality_status,
        "hours_total": candidate.hours_total,
        "raw_sections": candidate.raw_sections,
        "source_file": candidate.source_file,
        "extraction_status": "ok",
    }

    semantic_output = build_semantic_output(
        candidate=candidate,
        max_objectives=config["max_objectives"],
        max_contents=config["max_contents"],
    )

    status, errors = validate_semantic_record(
        semantic_output,
        min_chars=config["min_content_characters_for_ok"],
    )

    raw_output["extraction_status"] = status
    semantic_output["extraction_status"] = status

    return ExtractionResult(
        raw_normalized=raw_output,
        semantic_final=semantic_output,
        validation_errors=errors,
    )


def gather_input_files(input_dir: Path) -> List[Path]:
    if not input_dir.exists():
        return []

    patterns = ["*.pdf", "*.txt", "*.md"]
    all_files: List[Path] = []
    for pattern in patterns:
        all_files.extend(sorted(input_dir.glob(pattern)))
    return all_files


def write_individual_output(output_dir: Path, source_name: str, payload: Dict[str, Any]) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(source_name).stem.replace(" ", "_")
    output_path = output_dir / f"{safe_name}.json"

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return output_path


def save_consolidated_output(consolidated_path: Path, records: List[Dict[str, Any]]) -> None:
    consolidated_path.parent.mkdir(parents=True, exist_ok=True)
    with consolidated_path.open("w", encoding="utf-8") as f:
        json.dump({"courses_semantic": records}, f, ensure_ascii=False, indent=2)


def save_failed_report(failed_report_path: Path, failed_items: List[Dict[str, str]]) -> None:
    failed_report_path.parent.mkdir(parents=True, exist_ok=True)
    with failed_report_path.open("w", encoding="utf-8") as f:
        json.dump({"failed_files": failed_items}, f, ensure_ascii=False, indent=2)


def _has_pdf_dependencies() -> bool:
    return bool(importlib.util.find_spec("pdfplumber") or importlib.util.find_spec("pypdf"))


def process_batch(
    config_path: Path,
    output_dir: Path,
    consolidated_path: Path,
    failed_report_path: Path,
    log_file: Path,
    input_files: List[Tuple[str, Optional[Path], Optional[str]]],
) -> Dict[str, Any]:
    setup_logging(log_file)
    config = load_config(config_path)

    semantic_ok_or_partial: List[Dict[str, Any]] = []
    failed_items: List[Dict[str, str]] = []

    # Avoid noisy per-file tracebacks when PDF inputs exist but no extractor dependency is installed.
    has_pdf_input = any(path is not None and path.suffix.lower() == ".pdf" for _, path, _ in input_files)
    missing_pdf_deps = has_pdf_input and not _has_pdf_dependencies()
    if missing_pdf_deps:
        reason = "Faltan dependencias para PDF. Ejecuta: python -m pip install -r requirements.txt"
        logging.error(reason)

    for source_name, path, manual_text in input_files:
        if missing_pdf_deps and path is not None and path.suffix.lower() == ".pdf":
            failed_items.append({"file": source_name, "reason": reason})
            continue

        try:
            result = process_single_input(
                config=config,
                source_name=source_name,
                input_path=path,
                manual_text=manual_text,
            )

            combined_payload = {
                "raw_normalized": result.raw_normalized,
                "semantic_final": result.semantic_final,
            }
            write_individual_output(output_dir, source_name, combined_payload)

            status = result.semantic_final["extraction_status"]
            if status in {"ok", "partial"}:
                semantic_ok_or_partial.append(result.semantic_final)
            else:
                reason = "; ".join(result.validation_errors) if result.validation_errors else "Error de validacion"
                failed_items.append({"file": source_name, "reason": reason})

            if result.validation_errors:
                logging.warning("%s: %s", source_name, "; ".join(result.validation_errors))
            else:
                logging.info("%s procesado correctamente", source_name)

        except Exception as exc:
            logging.error("Error procesando %s: %s", source_name, exc)
            failed_items.append({"file": source_name, "reason": str(exc)})

    save_consolidated_output(consolidated_path, semantic_ok_or_partial)
    save_failed_report(failed_report_path, failed_items)

    return {
        "processed": len(input_files),
        "successful_or_partial": len(semantic_ok_or_partial),
        "failed": len(failed_items),
        "consolidated_path": str(consolidated_path),
        "failed_report_path": str(failed_report_path),
    }
