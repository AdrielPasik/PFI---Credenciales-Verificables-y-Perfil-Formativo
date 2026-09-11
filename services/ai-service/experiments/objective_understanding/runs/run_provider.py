# -*- coding: utf-8 -*-
"""P2.1 - ONE_CALL_PER_OBJECTIVE contra el proveedor estructurado.

Nunca imprime, registra ni persiste la API key. Solo se registra el id de modelo.
"""
from __future__ import annotations
import io, os, sys, json, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import prompts_v1  # noqa: E402
import prompts_v2  # noqa: E402
import prompts_v3  # noqa: E402

PROMPTS = {"OU_A0": prompts_v1, "OU_A1": prompts_v2, "OU_A2": prompts_v3}
import trusted_builder as TB  # noqa: E402

AI_SERVICE = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENV_PATH = os.path.join(AI_SERVICE, ".env")


def load_env():
    if not os.path.exists(ENV_PATH):
        return
    for line in io.open(ENV_PATH, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


class ProviderConfigurationMissing(RuntimeError):
    pass


def provider_config():
    load_env()
    key = os.environ.get("ER_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("ER_OPENAI_MODEL")
    if not key or not model:
        raise ProviderConfigurationMissing("P2_1_PROVIDER_CONFIGURATION_MISSING")
    return {
        "key": key,
        "model": model,
        "base_url": os.environ.get("ER_OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        "effort": os.environ.get("ER_OPENAI_REASONING_EFFORT", "medium"),
        "timeout": int(os.environ.get("ER_PROVIDER_TIMEOUT_SECONDS", "300")),
    }


def call(prompt: str, cfg: dict, mod) -> dict:
    payload = {
        "model": cfg["model"],
        "input": prompt,
        "store": False,
        "reasoning": {"effort": cfg["effort"]},
        "text": {"format": {"type": "json_schema", "name": mod.SCHEMA_NAME,
                            "strict": True, "schema": mod.SCHEMA}},
    }
    req = urllib.request.Request(
        cfg["base_url"] + "/responses",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json", "authorization": "Bearer " + cfg["key"]},
        method="POST")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout"]) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1500]
        raise RuntimeError("provider_http_%d:%s" % (exc.code, detail)) from exc
    latency = round((time.perf_counter() - started) * 1000)
    texts = []
    for item in body.get("output", []):
        if item.get("type") != "message":
            continue
        for c in item.get("content", []):
            if c.get("type") == "output_text" and isinstance(c.get("text"), str):
                texts.append(c["text"])
    if not texts:
        raise RuntimeError("provider_response_missing_output_text")
    try:
        output = json.loads("".join(texts))
        schema_valid = True
    except json.JSONDecodeError:
        output, schema_valid = None, False
    return {"output": output, "schemaValid": schema_valid, "latencyMs": latency,
            "effectiveModel": str(body.get("model") or cfg["model"]),
            "usage": body.get("usage") or {}, "responseId": body.get("id")}


def run_one(oid: str, objective_type: str, title: str, raw: str, cfg: dict, candidate_version: str) -> dict:
    mod = PROMPTS[candidate_version]
    prompt = mod.build_prompt(objective_type, title, raw)
    res = call(prompt, cfg, mod)
    proposals = (res["output"] or {}).get("proposedRequirements", []) if res["schemaValid"] else []
    built = TB.build(raw, proposals, prefix="cand")
    return {
        "objectiveId": oid,
        "candidateVersion": candidate_version,
        "promptVersion": mod.VERSION,
        "schemaName": mod.SCHEMA_NAME,
        "requestedModel": cfg["model"],
        "effectiveModel": res["effectiveModel"],
        "reasoningEffort": cfg["effort"],
        "schemaValid": res["schemaValid"],
        "latencyMs": res["latencyMs"],
        "usage": res["usage"],
        "providerOutput": res["output"],
        "unresolvedPassages": (res["output"] or {}).get("unresolvedPassages", []),
        "trusted": built,
    }
