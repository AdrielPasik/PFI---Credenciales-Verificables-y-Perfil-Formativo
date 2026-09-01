from __future__ import annotations
import unittest
from experiments.evidence_reasoning.b23_artifacts import build_b23_objective_analysis
from experiments.evidence_reasoning.b23_policy import b23_final_state
from experiments.evidence_reasoning.b23_runtime import provider_call_plan
from experiments.evidence_reasoning.b23_validation import validate_and_enrich_b23

REQ = {"requirementId": "req_01", "requirementQuote": "diseñar sensores médicos industriales", "normalizedRequirement": "diseñar sensores médicos industriales", "sourceSpan": {"charStart": 0, "charEnd": 37}, "evaluability": {"formativeEvidenceCapable": True}, "materialQualifiers": [{"qualifierId": "q_01"}]}
EUS = [{"evidenceUnitId": "eu_01", "sourceTrace": {"sourceId": "s_01"}}]
FACTS = [{"sourceId": "s_01", "coverageStatus": "FULL"}]
def raw(*, continuity="YES", usefulness="YES", facets=True, refs=True, all_full=True):
    keys = ["f_01"] if facets else []; ref = ["f_01"] if refs and facets else ([] if not refs else ["unknown"])
    return {"requirementId": "req_01", "evaluatedEvidence": [{"evidenceUnitId": "eu_01", "relation": "LIMITED_SCOPE", "supportedQualifierIds": ["q_01"], "missingQualifierIds": [], "evidenceContribution": "x", "rationale": "x"}], "facets": [{"localFacetKey": "f_01", "facetText": "sensores", "requirementBasisPhrases": ["sensores"], "whyNecessary": "x", "essential": True, "coverage": "PARTIAL", "evidenceUnitIds": ["eu_01"], "rationale": "x"}] if facets else [], "compositionAssessment": {"mode": "NONE", "nonRedundantEvidenceUnitIds": [], "jointlySupportsFullRequirement": False, "integrationRequired": False, "integrationDemonstrated": False, "integrationEvidenceIds": [], "missingFacetLocalKeys": ref, "unresolved": False, "rationale": "x"}, "fullClaimAssessment": {"status": "NOT_REACHED", "supportedQualifierIds": ["q_01"], "missingQualifierIds": [], "coveredFacetLocalKeys": ref, "missingFacetLocalKeys": ref, "rationale": "x"}, "jointClaimCeiling": {"text": "diseñar sensores", "supportingEvidenceUnitIds": ["eu_01"]}, "weakerClaimCandidate": {"text": "diseñar sensores", "supportingEvidenceUnitIds": ["eu_01"], "derivedFromJointClaimCeiling": "YES", "droppedQualifierIds": [], "droppedFacetLocalKeys": ref, "materialUsefulness": usefulness, "usefulnessRationale": "x", "continuityAssessment": {"status": continuity, "transformation": "WEAKENING" if continuity == "YES" else "SEMANTIC_SHIFT", "requirementBasis": ["diseñar", "sensores"], "shiftReason": None if continuity == "YES" else "PREREQUISITE_OR_FOUNDATION", "rationale": "x"}}, "observabilityAssessment": {"incompleteSourceAssessments": [] if all_full else [{"sourceId": "s_01", "affectedRequirementElements": ["qualifier"], "missingMaterialRelevance": "RELEVANT", "rationale": "x"}], "independentObservableSupport": "WEAKER_CLAIM", "observabilityStatus": "SUFFICIENT" if all_full else "MATERIAL_GAP", "rationale": "x"}, "semanticUnresolved": False, "unresolvedReason": ""}

class B23Contracts(unittest.TestCase):
    def enrich(self, payload, facts=FACTS): return validate_and_enrich_b23(payload, REQ, EUS, [], facts, [])
    def test_same_target_weakening_can_be_partial(self):
        item, _, hard = self.enrich(raw()); self.assertFalse(hard); self.assertEqual(b23_final_state(REQ, item, hard_factual_failure=False)[0], "PARTIALLY_SUPPORTED")
    def test_prerequisite_or_neighbor_is_not_partial(self):
        item, _, hard = self.enrich(raw(continuity="NO")); self.assertFalse(hard); self.assertEqual(b23_final_state(REQ, item, hard_factual_failure=False)[0], "INSUFFICIENT_EVIDENCE")
    def test_technology_scope_relaxation_is_semantic_not_hard_guard(self):
        payload = raw(); payload["weakerClaimCandidate"]["derivedFromJointClaimCeiling"] = "NO"; _, checks, hard = self.enrich(payload); self.assertFalse(hard); self.assertTrue(any(x["code"] == "WEAKER_DERIVATION_FROM_CEILING" and x["taxonomy"] == "SEMANTIC_CONSISTENCY" for x in checks))
    def test_reduced_depth_and_missing_constitutive_facet_are_supported_structurally(self):
        item, _, hard = self.enrich(raw()); self.assertFalse(hard); self.assertEqual(item["fullClaimAssessment"]["missingFacetIds"], ["req_01_facet_01"])
    def test_empty_facets_require_empty_references(self): self.assertTrue(self.enrich(raw(facets=False, refs=True))[2])
    def test_local_keys_rewrite_to_authoritative_ids(self): self.assertEqual(self.enrich(raw())[0]["fullClaimAssessment"]["coveredFacetIds"], ["req_01_facet_01"])
    def test_observability_material_gap_abstains(self):
        item, _, hard = self.enrich(raw(all_full=False), [{"sourceId": "s_01", "coverageStatus": "PARTIAL"}]); self.assertFalse(hard); self.assertEqual(b23_final_state(REQ, item, hard_factual_failure=False)[0], "ABSTAIN")
    def test_full_source_cannot_claim_missing_material(self):
        payload = raw(); payload["observabilityAssessment"]["observabilityStatus"] = "MATERIAL_GAP"; self.assertTrue(self.enrich(payload)[2])
    def test_objective_has_no_identity_frame_and_context_is_not_qualifier(self):
        proposal = {"decompositionStatus": "RESOLVED", "objectiveContext": "x", "candidateSegments": [{"text": "Programa avanzado", "segmentRole": "OBJECTIVE_CONTEXT", "rationale": "x"}, {"text": "diseñar sensores", "segmentRole": "EVALUABLE_REQUIREMENT", "rationale": "x"}], "ambiguityRationale": "", "requirements": [{"requirementQuote": "diseñar sensores", "normalizedRequirement": "x", "atomicity": "ATOMIC", "evaluability": {"requiredEvidenceType": "FORMATIVE_EVIDENCE", "formativeEvidenceCapable": True, "rationale": "x"}, "qualifiers": []}]}
        analysis, _ = build_b23_objective_analysis(proposal, "Programa avanzado: diseñar sensores"); self.assertNotIn("requirementIdentityFrame", analysis["requirements"][0])
    def test_cost_topology_is_exactly_thirty(self):
        plan = provider_call_plan(); self.assertEqual(plan["combinedExpectedCalls"], 30); self.assertEqual(plan["status"], "PASS")

if __name__ == "__main__": unittest.main()
