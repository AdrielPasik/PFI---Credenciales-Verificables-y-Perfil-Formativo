from __future__ import annotations

# Conservative alias map: normalized_input_label → canonical_skill_id
#
# Rules for inclusion:
#   - Only merge when the variant is purely grammatical/cosmetic ("Python Programming" = Python)
#   - Never merge skills with meaningful semantic distinctions
#   - When in doubt, leave them separate (high precision, lower recall)
#   - C, C++, C# must remain distinct — do NOT add "c programming" → "c" because
#     "c++" canonicalizes to "cpp" first, so collision risk is real.
#   - GitHub ≠ Git: different products, keep separate.
#   - "Data Analysis" ≠ "Data Science": different scope, keep separate.
#
# Format: "normalized lowercase string" → "canonical_skill_id"
# These are checked BEFORE the general canonicalization in course_adapter.py.

SKILL_ALIAS_MAP: dict[str, str] = {
    # Python variants
    "python programming":           "python",
    "programming in python":        "python",
    "python language":              "python",
    "python 3":                     "python",
    "python3":                      "python",

    # Java variants
    "java programming":             "java",
    "programming in java":          "java",
    "java language":                "java",

    # JavaScript variants
    "javascript programming":       "javascript",
    "programming in javascript":    "javascript",
    "javascript es6":               "javascript",
    "react js":                     "react",
    "reactjs":                      "react",

    # R language (avoid matching "R&D" etc — normalized input must be exactly these)
    "r programming":                "r",
    "r language":                   "r",
    "programming in r":             "r",

    # Go language
    "golang":                       "go",
    "go programming":               "go",
    "go language":                  "go",

    # Ruby, PHP, Kotlin, Swift, Rust, Scala
    "ruby programming":             "ruby",
    "php programming":              "php",
    "kotlin programming":           "kotlin",
    "swift programming":            "swift",
    "rust programming":             "rust",
    "scala programming":            "scala",

    # TypeScript
    "typescript programming":       "typescript",

    # SQL variants — "sql server" intentionally excluded (it is a specific RDBMS, not just SQL)
    "sql programming":              "sql",
    "structured query language":    "sql",

    # TensorFlow versions
    "tensorflow 2":                 "tensorflow",
    "tensorflow2":                  "tensorflow",
    "tensorflow 2 0":               "tensorflow",

    # Scikit-learn variants
    "sklearn":                      "scikit_learn",
    "scikit learn":                 "scikit_learn",

    # PyTorch (already canonical, but handle spacing)
    "py torch":                     "pytorch",

    # Jupyter variants
    "jupyter notebook":             "jupyter_notebooks",
    "jupyter":                      "jupyter_notebooks",
}

# Preferred display label for canonical IDs produced by aliases.
# If a canonical_id appears here, its label is forced to this value in the profile,
# regardless of which source was processed first.
CANONICAL_LABELS: dict[str, str] = {
    "python":           "Python",
    "java":             "Java",
    "javascript":       "JavaScript",
    "typescript":       "TypeScript",
    "react":            "React",
    "sql":              "SQL",
    "r":                "R",
    "go":               "Go",
    "ruby":             "Ruby",
    "php":              "PHP",
    "kotlin":           "Kotlin",
    "swift":            "Swift",
    "rust":             "Rust",
    "scala":            "Scala",
    "golang":           "Go",
    "tensorflow":       "TensorFlow",
    "pytorch":          "PyTorch",
    "scikit_learn":     "Scikit-learn",
    "jupyter_notebooks": "Jupyter Notebooks",
    "cpp":              "C++",
    "csharp":           "C#",
    "c":                "C",
    "dotnet":           ".NET",
    "nodejs":           "Node.js",
    "nextjs":           "Next.js",
    "vuejs":            "Vue.js",
    "docker":           "Docker",
    "kubernetes":       "Kubernetes",
    "git":              "Git",
    "aws":              "AWS",
    "matlab":           "MATLAB",
    "assembler":        "Assembler",
    "unity":            "Unity",
}


def resolve_skill_alias(normalized_label: str) -> str | None:
    """
    Return the canonical_skill_id if normalized_label matches a known alias,
    or None if no alias applies.
    """
    return SKILL_ALIAS_MAP.get(normalized_label.strip().lower())


def preferred_label(canonical_id: str) -> str | None:
    """Return the preferred display label for a canonical skill ID, or None."""
    return CANONICAL_LABELS.get(canonical_id)
