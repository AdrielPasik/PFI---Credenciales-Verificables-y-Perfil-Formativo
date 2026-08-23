from __future__ import annotations

import unittest

from experiments.evidence_reasoning.b22_artifacts import build_b22_objective_analysis
from experiments.evidence_reasoning.b22_policy import b22_final_state
from experiments.evidence_reasoning.b22_validation import validate_and_enrich_b22
from experiments.evidence_reasoning.b22_runtime import run_b22_case
from experiments.evidence_reasoning.models import FixtureCase, ProviderResult, SourceInput


def requirement() -> dict:
    return {"requirementId": "req_01", "requirementQuote": "diseñar sistemas térmicos industriales", "normalizedRequirement": "diseñar sistemas térmicos industriales", "sourceSpan": {"charStart": 0, "charEnd": 38, "exactText": "diseñar sistemas térmicos industriales"}, "evaluability": {"formativeEvidenceCapable": True}, "materialQualifiers": [{"qualifierId": "q_01"}], "requirementIdentityFrame": {"identityElements": [{"elementId": "req_01_identity_01"}, {"elementId": "req_01_identity_02"}], "bindings": []}}


def evidence() -> list[dict]:
    return [{"evidenceUnitId": "eu_01", "normalizedProposition": "diseño de sistemas térmicos", "sourceTrace": {"sourceId": "s_01"}}]


def raw(*, local_keys: list[str] | None = None, refs: list[str] | None = None, basis: list[str] | None = None, qualifier: str = "q_01", all_full: bool = True) -> dict:
    local_keys = local_keys if local_keys is not None else ["f_01"]; refs = refs if refs is not None else ["f_01"]; basis = basis if basis is not None else ["sistemas", "industriales"]
    return {"requirementId": "req_01", "evaluatedEvidence": [{"evidenceUnitId": "eu_01", "relation": "DIRECT_SUPPORT", "supportedQualifierIds": [qualifier], "missingQualifierIds": [], "evidenceContribution": "x", "rationale": "x"}], "facets": [{"localFacetKey": key, "facetText": "sistemas térmicos", "requirementBasisPhrases": basis, "whyNecessary": "x", "essential": True, "coverage": "FULL", "evidenceUnitIds": ["eu_01"], "rationale": "x"} for key in local_keys], "compositionAssessment": {"mode": "NONE", "nonRedundantEvidenceUnitIds": [], "jointlySupportsFullRequirement": False, "integrationRequired": False, "integrationDemonstrated": False, "integrationEvidenceIds": [], "missingFacetLocalKeys": refs, "unresolved": False, "rationale": "x"}, "fullClaimAssessment": {"status": "NOT_REACHED", "supportedQualifierIds": [qualifier], "missingQualifierIds": [], "coveredFacetLocalKeys": refs, "missingFacetLocalKeys": refs, "rationale": "x"}, "jointClaimCeiling": {"text": "diseño térmico", "supportingEvidenceUnitIds": ["eu_01"]}, "weakerClaimCandidate": {"text": "diseño térmico", "supportingEvidenceUnitIds": ["eu_01"], "derivedFromJointClaimCeiling": "UNRESOLVED", "preservedIdentityElementIds": ["req_01_identity_01"], "relaxedIdentityElementIds": [], "changedIdentityElementIds": [], "droppedQualifierIds": [], "droppedFacetLocalKeys": refs, "sameRequirementContinuity": "YES", "continuityRationale": "x", "materialUsefulness": "YES", "usefulnessRationale": "x"}, "observabilityAssessment": {"incompleteSourceAssessments": [] if all_full else [{"sourceId": "s_01", "affectedRequirementElementIds": ["req_01_identity_01"], "missingMaterialRelevance": "RELEVANT", "rationale": "x"}], "independentObservableSupport": "WEAKER_CLAIM", "observabilityStatus": "SUFFICIENT" if all_full else "MATERIAL_GAP", "rationale": "x"}, "semanticUnresolved": False, "unresolvedReason": ""}


class B22Contracts(unittest.TestCase):
    def validate(self, payload: dict, *, source_facts: list[dict] | None = None):
        return validate_and_enrich_b22(payload, requirement(), evidence(), [], source_facts or [{"sourceId": "s_01", "coverageStatus": "FULL"}], [])

    def test_repeated_reference_is_valid_and_rewritten(self):
        enriched, validations, hard = self.validate(raw())
        self.assertFalse(hard); self.assertEqual(enriched["fullClaimAssessment"]["coveredFacetIds"], ["req_01_facet_01"]); self.assertNotIn("coveredFacetLocalKeys", enriched["fullClaimAssessment"])
        self.assertTrue(any(item["code"] == "FACET_AUTHORITATIVE_REFERENCES_EXIST" and item["status"] == "PASS" for item in validations))

    def test_duplicate_definition_fails(self):
        _, validations, hard = self.validate(raw(local_keys=["f_01", "f_01"]))
        self.assertTrue(hard); self.assertTrue(any(item["code"] == "FACET_LOCAL_KEY_DEFINITIONS_UNIQUE" and item["status"] == "FAIL" for item in validations))

    def test_unknown_local_reference_fails(self):
        _, _, hard = self.validate(raw(refs=["missing"]))
        self.assertTrue(hard)

    def test_empty_facets_with_refs_fails(self):
        _, _, hard = self.validate(raw(local_keys=[], refs=["f_01"]))
        self.assertTrue(hard)

    def test_multispan_basis_is_valid(self):
        _, _, hard = self.validate(raw(basis=["diseñar", "industriales"]))
        self.assertFalse(hard)

    def test_contextual_id_is_not_semantic_qualifier(self):
        _, _, hard = self.validate(raw(qualifier="context_trace_01"))
        self.assertTrue(hard)

    def test_full_sources_cannot_have_missing_material(self):
        payload = raw(); payload["observabilityAssessment"]["observabilityStatus"] = "MATERIAL_GAP"
        _, _, hard = self.validate(payload)
        self.assertTrue(hard)

    def test_partial_relevant_source_can_be_material_gap(self):
        _, _, hard = self.validate(raw(all_full=False), source_facts=[{"sourceId": "s_01", "coverageStatus": "PARTIAL"}])
        self.assertFalse(hard)

    def test_derived_from_ceiling_is_not_hard_guard(self):
        payload = raw(); payload["weakerClaimCandidate"]["derivedFromJointClaimCeiling"] = "NO"
        _, validations, hard = self.validate(payload)
        self.assertFalse(hard); self.assertTrue(any(item["code"] == "WEAKER_DERIVATION_FROM_CEILING" and item["taxonomy"] == "SEMANTIC_CONSISTENCY" for item in validations))

    def test_policy_partial_and_material_gap(self):
        enriched, _, _ = self.validate(raw()); self.assertEqual(b22_final_state(requirement(), enriched, hard_factual_failure=False)[0], "PARTIALLY_SUPPORTED")
        enriched, _, _ = self.validate(raw(all_full=False), source_facts=[{"sourceId": "s_01", "coverageStatus": "PARTIAL"}]); self.assertEqual(b22_final_state(requirement(), enriched, hard_factual_failure=False)[0], "ABSTAIN")

    def test_objective_ambiguous_does_not_select_requirement(self):
        proposal = {"decompositionStatus": "AMBIGUOUS", "objectiveContext": "x", "candidateSegments": [{"text": "Programa de ingeniería", "segmentRole": "OBJECTIVE_CONTEXT", "rationale": "x"}, {"text": "diseño de procesos", "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "x"}], "ambiguityRationale": "two readings", "requirements": []}
        analysis, _ = build_b22_objective_analysis(proposal, "Programa de ingeniería: diseño de procesos")
        self.assertEqual(analysis["requirements"], []); self.assertEqual(analysis["decompositionStatus"], "AMBIGUOUS")

    def test_scoped_qualifier_alignment_beats_global_ambiguity(self):
        objective = "Contexto industrial. Requisito: microbiología industrial."
        proposal = {"decompositionStatus": "RESOLVED", "objectiveContext": "x", "candidateSegments": [{"text": "Contexto industrial", "segmentRole": "OBJECTIVE_CONTEXT", "rationale": "x"}, {"text": "microbiología industrial", "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "x"}], "ambiguityRationale": "", "requirements": [{"requirementQuote": "microbiología industrial", "normalizedRequirement": "microbiología industrial", "atomicity": "ATOMIC", "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "x"}, "qualifiers": [{"kind": "domain", "value": "industrial", "sourcePhrase": "industrial", "role": "MATERIAL_QUALIFIER", "rationale": "x"}], "identityFrame": {"identityElements": [{"role": "OBJECT", "basisPhrases": ["microbiología"], "normalizedMeaning": "x", "materialQualifierPhrases": ["industrial"]}], "bindings": []}}]}
        analysis, validations = build_b22_objective_analysis(proposal, objective)
        self.assertTrue(analysis["requirements"][0]["materialQualifiers"][0]["traceValid"])
        self.assertFalse(any(item["code"] == "QUALIFIER_SCOPED_TRACE_VALID" and item["status"] == "FAIL" for item in validations))

    def test_identity_binding_outside_range_fails(self):
        objective = "Requisito: diseñar sistemas térmicos industriales."
        proposal = {"decompositionStatus": "RESOLVED", "objectiveContext": "x", "candidateSegments": [{"text": "diseñar sistemas térmicos industriales", "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "x"}], "ambiguityRationale": "", "requirements": [{"requirementQuote": "diseñar sistemas térmicos industriales", "normalizedRequirement": "x", "atomicity": "ATOMIC", "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "x"}, "qualifiers": [], "identityFrame": {"identityElements": [{"role": "ACTION_PREDICATE", "basisPhrases": ["diseñar"], "normalizedMeaning": "x", "materialQualifierPhrases": []}], "bindings": [{"fromElementIndex": 0, "relation": "applies_to", "toElementIndex": 9}]}}]}
        _, validations = build_b22_objective_analysis(proposal, objective)
        self.assertTrue(any(item["code"] == "IDENTITY_BINDING_REFERENCES_EXIST" and item["status"] == "FAIL" for item in validations))

    def test_contextual_and_wrapper_are_preserved_but_not_semantic_qualifiers(self):
        objective = "Programa avanzado. Requisito: diseñar sistemas."
        proposal = {"decompositionStatus": "RESOLVED", "objectiveContext": "x", "candidateSegments": [{"text": "Programa avanzado", "segmentRole": "OBJECTIVE_CONTEXT", "rationale": "x"}, {"text": "diseñar sistemas", "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "x"}], "ambiguityRationale": "", "requirements": [{"requirementQuote": "diseñar sistemas", "normalizedRequirement": "x", "atomicity": "ATOMIC", "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "x"}, "qualifiers": [{"kind": "context", "value": "Programa", "sourcePhrase": "Programa", "role": "CONTEXTUAL", "rationale": "x"}, {"kind": "wrapper", "value": "Requisito", "sourcePhrase": "Requisito", "role": "STRUCTURAL_WRAPPER", "rationale": "x"}], "identityFrame": {"identityElements": [{"role": "ACTION_PREDICATE", "basisPhrases": ["diseñar"], "normalizedMeaning": "x", "materialQualifierPhrases": []}], "bindings": []}}]}
        analysis, _ = build_b22_objective_analysis(proposal, objective)
        req = analysis["requirements"][0]
        self.assertEqual(req["materialQualifiers"], []); self.assertEqual(len(req["contextAnnotations"]), 1); self.assertEqual(len(req["structuralWrappers"]), 1); self.assertTrue(req["structuralWrappers"][0]["traceValid"])

    def test_unbound_identity_qualifier_phrase_is_manual_not_hard_failure(self):
        objective = "Requisito: diseñar sistemas térmicos."
        proposal = {"decompositionStatus": "RESOLVED", "objectiveContext": "x", "candidateSegments": [{"text": "diseñar sistemas térmicos", "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "x"}], "ambiguityRationale": "", "requirements": [{"requirementQuote": "diseñar sistemas térmicos", "normalizedRequirement": "x", "atomicity": "ATOMIC", "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "x"}, "qualifiers": [], "identityFrame": {"identityElements": [{"role": "OBJECT", "basisPhrases": ["sistemas térmicos"], "normalizedMeaning": "x", "materialQualifierPhrases": ["térmicos"]}], "bindings": []}}]}
        analysis, validations = build_b22_objective_analysis(proposal, objective)
        element = analysis["requirements"][0]["requirementIdentityFrame"]["identityElements"][0]
        self.assertEqual(element["materialQualifierIds"], []); self.assertEqual(element["unboundMaterialQualifierPhrases"], ["térmicos"])
        self.assertTrue(any(item["code"] == "IDENTITY_QUALIFIER_BINDING_UNRESOLVED" and item["taxonomy"] == "SEMANTIC_CONSISTENCY" for item in validations))

    def test_runtime_runs_three_stages_with_fake_provider(self):
        case = FixtureCase("synthetic", "dev", "synthetic", "diseñar sistemas térmicos industriales", (SourceInput("s_01", "c_01", "COURSE", "diseñar sistemas térmicos industriales", "FULL", "ISSUER_DECLARED"),))
        class FakeProvider:
            model = "gpt-5.6-terra"; reasoning_effort = "medium"
            def complete(self, *, prompt, schema_name, schema):
                del prompt, schema
                if schema_name == "b22_evidence_unit_catalog": output = {"evidenceUnits": [{"sourceId": "s_01", "segmentId": "seg_001", "quoteText": "diseñar sistemas térmicos industriales", "normalizedProposition": "diseñar sistemas térmicos industriales", "claimType": "ASSESSED_OUTCOME", "semanticQualifiers": []}]}
                elif schema_name == "b22_objective_analysis": output = {"decompositionStatus": "RESOLVED", "objectiveContext": "", "candidateSegments": [{"text": "diseñar sistemas térmicos industriales", "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "x"}], "ambiguityRationale": "", "requirements": [{"requirementQuote": "diseñar sistemas térmicos industriales", "normalizedRequirement": "diseñar sistemas térmicos industriales", "atomicity": "ATOMIC", "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "x"}, "qualifiers": [], "identityFrame": {"identityElements": [{"role": "ACTION_PREDICATE", "basisPhrases": ["diseñar"], "normalizedMeaning": "diseñar", "materialQualifierPhrases": []}, {"role": "OBJECT", "basisPhrases": ["sistemas térmicos industriales"], "normalizedMeaning": "sistemas", "materialQualifierPhrases": []}], "bindings": [{"fromElementIndex": 0, "relation": "applies_to", "toElementIndex": 1}]}}]}
                else: output = {"requirementId": "req_01", "evaluatedEvidence": [{"evidenceUnitId": "eu_01", "relation": "DIRECT_SUPPORT", "supportedQualifierIds": [], "missingQualifierIds": [], "evidenceContribution": "x", "rationale": "x"}], "facets": [], "compositionAssessment": {"mode": "NONE", "nonRedundantEvidenceUnitIds": [], "jointlySupportsFullRequirement": False, "integrationRequired": False, "integrationDemonstrated": False, "integrationEvidenceIds": [], "missingFacetLocalKeys": [], "unresolved": False, "rationale": "x"}, "fullClaimAssessment": {"status": "REACHED", "supportedQualifierIds": [], "missingQualifierIds": [], "coveredFacetLocalKeys": [], "missingFacetLocalKeys": [], "rationale": "x"}, "jointClaimCeiling": {"text": "diseñar sistemas térmicos industriales", "supportingEvidenceUnitIds": ["eu_01"]}, "weakerClaimCandidate": None, "observabilityAssessment": {"incompleteSourceAssessments": [], "independentObservableSupport": "FULL_CLAIM", "observabilityStatus": "SUFFICIENT", "rationale": "x"}, "semanticUnresolved": False, "unresolvedReason": ""}
                return ProviderResult(output, "openai", self.model, self.model, 1, {})
        result = run_b22_case(case, FakeProvider())
        self.assertEqual(result["metadata"]["runStatus"], "RESOLVED"); self.assertEqual(len(result["metadata"]["providerStages"]), 3); self.assertEqual(result["08_final_result"][0]["finalState"], "SUPPORTED")


if __name__ == "__main__": unittest.main()
