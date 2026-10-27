# API contracts — Clinical Knowledge

Endpoint: POST /api/clinical-knowledge

Actions:
- searchDrugs { query, extended, actor, organizationId, memberships, billingEnabled, idempotencyKey }
- searchGuidelines { symptoms, diagnosis, ageGroup, comorbidities, actor, organizationId, memberships, billingEnabled, idempotencyKey }
- searchSimilarCases { symptoms, diagnosis, ageGroup, comorbidities, examinations, treatment, actor, organizationId, memberships, billingEnabled, idempotencyKey }
- listQueryHistory { actorId, organizationId }
- getPrices {}

All responses include charge estimate and real_charge_performed:false.
Provider interfaces:
- VidalProvider.searchDrugs({query, extended})
- ClinicalGuidelinesProvider.search({symptoms, diagnosis, ageGroup})
- ClinicalCasesProvider.search(filters)
