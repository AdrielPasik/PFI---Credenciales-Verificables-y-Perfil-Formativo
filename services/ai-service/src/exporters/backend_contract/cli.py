"""
CLI offline para exportar `semantic_analysis_v1` a partir de los JSON ya
existentes en `output_json/` (PDF academico) u `output/online_courses_json/`
(cursos online).

Solo lectura sobre el input. Nunca escribe dentro de `output_json/`,
`output/online_courses_json/`, `embedding_store/` ni `benchmarks/` — el
directorio de salida se valida contra esa lista antes de escribir nada.

Uso:
    python -m src.exporters.backend_contract.cli \\
        --input output_json \\
        --source-type academic_pdf \\
        --output output/backend_artifacts/semantic_analysis_v1 \\
        --limit 5

    python -m src.exporters.backend_contract.cli \\
        --input output/online_courses_json \\
        --source-type online_course_catalog \\
        --output output/backend_artifacts/semantic_analysis_v1 \\
        --limit 5

Tambien acepta un archivo individual en --input.
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Optional

from src.exporters.backend_contract.semantic_analysis_exporter import (
    InvalidRecordShapeError,
    export_semantic_analysis,
)

logger = logging.getLogger(__name__)

# Directorios que este CLI nunca debe usar como salida — son outputs
# existentes del pipeline IA o del benchmark humano congelado.
_PROTECTED_OUTPUT_DIRS = ("output_json", "output/online_courses_json", "embedding_store", "benchmarks")

# Nombre del archivo consolidado que courses_pipeline.py genera junto a los
# JSON individuales — no es un record individual, se ignora por defecto.
_AGGREGATE_FILE_NAME = "all_courses.json"


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Exporta semantic_analysis_v1 a partir de JSON ya existentes del pipeline IA (offline, solo lectura sobre el input).",
    )
    parser.add_argument("--input", type=Path, required=True, help="Archivo JSON individual o directorio con JSON del pipeline IA.")
    parser.add_argument(
        "--source-type",
        type=str,
        required=True,
        choices=["academic_pdf", "online_course_catalog"],
        help="Tipo de fuente de los archivos en --input.",
    )
    parser.add_argument("--output", type=Path, required=True, help="Directorio de salida para los artifacts semantic_analysis_v1.")
    parser.add_argument("--limit", type=int, default=None, help="Cantidad maxima de archivos a procesar (para pruebas puntuales).")
    parser.add_argument(
        "--include-aggregate",
        action="store_true",
        help=f"Incluir '{_AGGREGATE_FILE_NAME}' si aparece en el directorio de entrada (por defecto se ignora).",
    )
    parser.add_argument("--log-level", type=str, default="INFO")
    return parser.parse_args(argv)


def _assert_output_dir_is_safe(output_dir: Path) -> None:
    resolved = output_dir.resolve()
    parts = [p.lower() for p in resolved.parts]
    normalized = "/".join(parts)
    for protected in _PROTECTED_OUTPUT_DIRS:
        protected_norm = protected.lower().replace("\\", "/")
        if f"/{protected_norm}" in f"/{normalized}" or normalized.endswith(protected_norm):
            raise SystemExit(
                f"Directorio de salida rechazado: '{output_dir}' cae dentro de un directorio protegido "
                f"('{protected}'). Este exporter nunca escribe ahi."
            )


def _collect_input_files(input_path: Path, include_aggregate: bool) -> list[Path]:
    if input_path.is_file():
        return [input_path]

    if not input_path.is_dir():
        raise SystemExit(f"--input no existe o no es archivo ni directorio: {input_path}")

    files = sorted(input_path.glob("*.json"))
    if not include_aggregate:
        files = [f for f in files if f.name != _AGGREGATE_FILE_NAME]
    return files


def _output_filename(source_type: str, document_id: str) -> str:
    safe_document_id = document_id.replace("/", "_").replace("\\", "_")
    return f"{source_type}__{safe_document_id}.semantic_analysis_v1.json"


def run(argv: Optional[list[str]] = None) -> dict:
    args = parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO), format="%(levelname)s | %(message)s")

    _assert_output_dir_is_safe(args.output)

    files = _collect_input_files(args.input, args.include_aggregate)
    if args.limit is not None:
        files = files[: args.limit]

    args.output.mkdir(parents=True, exist_ok=True)

    processed: list[str] = []
    errors: list[dict[str, str]] = []

    for file_path in files:
        try:
            record = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            msg = f"No se pudo leer/parsear JSON: {exc}"
            logger.warning("SKIP %s — %s", file_path.name, msg)
            errors.append({"file": str(file_path), "error": msg})
            continue

        try:
            artifact = export_semantic_analysis(
                record=record,
                source_type=args.source_type,
                fallback_document_id=file_path.stem,
                fallback_file_name=file_path.name,
            )
        except InvalidRecordShapeError as exc:
            msg = f"Forma de record invalida: {exc}"
            logger.warning("SKIP %s — %s", file_path.name, msg)
            errors.append({"file": str(file_path), "error": msg})
            continue
        except Exception as exc:  # noqa: BLE001 — no debe tumbar la corrida completa
            msg = f"Error inesperado exportando: {exc!r}"
            logger.warning("SKIP %s — %s", file_path.name, msg)
            errors.append({"file": str(file_path), "error": msg})
            continue

        out_name = _output_filename(args.source_type, artifact.sourceRefs.documentId)
        out_path = args.output / out_name
        out_path.write_text(json.dumps(artifact.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        processed.append(str(out_path))
        logger.info("OK %s -> %s", file_path.name, out_path)

    summary = {
        "input": str(args.input),
        "source_type": args.source_type,
        "output_dir": str(args.output),
        "files_seen": len(files),
        "files_processed": len(processed),
        "files_errored": len(errors),
        "outputs": processed,
        "errors": errors,
    }
    return summary


def main() -> None:
    summary = run()
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
