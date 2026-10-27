# Architecture — Clinical Knowledge

```mermaid
flowchart LR
  UI[ClinicalKnowledge UI] --> API[/api/clinical-knowledge]
  API --> SVC[ClinicalKnowledgeService]
  SVC --> VP[VidalProvider mock]
  SVC --> GP[ClinicalGuidelinesProvider mock]
  SVC --> CP[ClinicalCasesProvider]
  CP --> REPO[Synthetic Case Repository]
  SVC --> AUDIT[Query Log / Audit]
  SVC --> BILL[Usage & Billing Prep]
  BILL --> WALLET[Existing usage_wallets]
```

## Providers
- VidalProvider: mock adapter, real API interface documented.
- ClinicalGuidelinesProvider: mock official guidelines.
- ClinicalCasesProvider: local approved synthetic cases.

## Access
Role + organization membership checks.

## Billing
Prices estimated; real charges disabled via feature flag.
```
