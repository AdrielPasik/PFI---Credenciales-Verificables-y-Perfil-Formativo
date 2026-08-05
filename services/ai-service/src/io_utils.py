from pathlib import Path
from typing import Optional

from .text_utils import normalize_whitespace


def extract_text_from_pdf(pdf_path: Path) -> str:
    text_parts: list[str] = []

    try:
        import pdfplumber

        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text_parts.append(page_text)
    except Exception:
        text_parts = []

    if not text_parts:
        try:
            from pypdf import PdfReader

            reader = PdfReader(str(pdf_path))
            for page in reader.pages:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text_parts.append(page_text)
        except ModuleNotFoundError as exc:
            raise ModuleNotFoundError(
                "Para procesar PDFs instala dependencias: pip install -r requirements.txt"
            ) from exc

    full_text = "\n\n".join(text_parts)
    return normalize_whitespace(full_text)


def extract_text_from_plain_file(file_path: Path) -> str:
    return normalize_whitespace(file_path.read_text(encoding="utf-8", errors="ignore"))


def get_text_from_input(input_path: Optional[Path] = None, manual_text: Optional[str] = None) -> str:
    if manual_text and manual_text.strip():
        return normalize_whitespace(manual_text)

    if input_path is None:
        raise ValueError("Debe proveerse input_path o manual_text")

    suffix = input_path.suffix.lower()
    if suffix == ".pdf":
        return extract_text_from_pdf(input_path)

    if suffix in {".txt", ".md"}:
        return extract_text_from_plain_file(input_path)

    raise ValueError(f"Formato no soportado: {input_path}")
