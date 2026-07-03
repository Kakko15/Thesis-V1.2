# ISO/IEC 25010 Internal Quality — Evidence Snapshot

Objective 4 (thesis paper, Sections 3.2.4–3.2.5). Automated-instrument
results for the ISU Centralized AI-Powered Thesis Library backend/frontend.
Re-run the commands below and update this file for each evaluation iteration;
the arithmetic mean across iterations is the reported statistic (Section 3.2.5).

**Snapshot date:** 2026-07-03
**Environment:** Windows 11 Pro · Python 3.14.2 · pinned dependencies (`requirements.txt`)

## Results

| ISO/IEC 25010 criterion | Instrument | Result (this snapshot) | Status |
|---|---|---|---|
| Functional Suitability | PyTest 9.1.1 | **58 / 58 tests passed (100% pass rate)**, 47% line coverage (`coverage.xml`) | ✅ Measured |
| Maintainability (backend) | Pylint 4.0.6 | **10.00 / 10** | ✅ Measured |
| Maintainability (frontend) | ESLint 9.39.x | **0 errors** (1 pre-existing complexity warning in `Admin.jsx`) · production build passes | ✅ Measured |
| Reliability | SonarQube 10.4 | Configured (`sonar-project.properties`, CI workflow) — scan pending a SonarQube server/token | ⏳ Pending run |
| Performance Efficiency | Apache JMeter 5.6.3 | Test plan ready (`jmeter/thesis_load_test.jmx`: 20 concurrent users × 5 loops over `/chat`, `/papers`, `/health`) — pending execution against a running backend | ⏳ Pending run |
| Performance Efficiency (latency tracing) | LangSmith | Wired via `LANGCHAIN_TRACING_V2` — dormant until the env vars are set | ⏳ Pending run |

## Commands (per iteration)

```bash
# Functional Suitability + coverage (from rag-thesis-backend/)
pytest --cov=routers --cov=services --cov=dependencies --cov=main --cov=config --cov=models --cov-report=xml

# Maintainability
pylint --rcfile=.pylintrc routers services dependencies main.py config.py models.py
cd ../rag-thesis-frontend && npx eslint src && npm run build

# Reliability (needs a SonarQube server; see README "Reliability (SonarQube)")
sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.token=<token>   # from repo root

# Performance Efficiency (backend must be running; paste a valid JWT into the plan's TOKEN variable)
jmeter -n -t jmeter/thesis_load_test.jmx -l jmeter/results/summary.csv
```

## Notes

- The JMeter plan drives `/chat`, which calls the live Gemini API — run it
  deliberately (100 chat samples per full run) and record mean response time,
  throughput, and error rate from the Summary Report.
- Objective 2 (baseline vs RAG, Ragas + Shapiro-Wilk → t-test/Wilcoxon) is
  fully implemented in `evaluation/run_comparison.py` and blocked only on the
  50-thesis corpus ingestion + faculty-validated Golden Dataset.
