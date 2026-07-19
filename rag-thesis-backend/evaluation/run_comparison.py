"""Objective 2 — Comparative Performance Analysis (thesis paper, Section 3.2.1).

Runs every Golden Dataset query through BOTH computational pathways:

  * Baseline (control): unaugmented Gemini relying on parametric memory only.
  * Proposed (experimental): the RAG + LLM pipeline constrained to the
    CCSICT vector archive.

Both outputs are scored with the Ragas framework (Faithfulness and Context
Precision, per Section 3.2.4), then subjected to the statistical treatment
from Section 3.2.5: Shapiro-Wilk normality test, then a paired-samples
t-test (parametric) or Wilcoxon Signed-Rank test (non-parametric) at
alpha = 0.05.

Usage (from rag-thesis-backend/):
    pip install -r evaluation/requirements-eval.txt
    python -m evaluation.run_comparison [--dataset evaluation/golden_dataset.json]

Outputs CSV + JSON summaries into evaluation/results/.
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from langchain_google_genai import ChatGoogleGenerativeAI

from config import settings
from services.retriever import search_chunks

RESULTS_DIR = Path(__file__).parent / 'results'

baseline_llm = ChatGoogleGenerativeAI(
    model=settings.gemini_chat_model,
    google_api_key=settings.gemini_api_key,
    temperature=0.6,
)

BASELINE_PROMPT = (
    'You are a research assistant for the {department} department of Isabela State University, '
    'Echague. Answer the following question about {department} undergraduate thesis research '
    'using only your own knowledge. Cite specific theses if you can.\n\nQuestion: {question}'
)

RAG_PROMPT = (
    'You are a research assistant for the {department} department of Isabela State University, '
    'Echague. Answer the question strictly and exclusively from the provided context of '
    'archived {department} theses. If the context does not contain the answer, say so.\n\n'
    'Context:\n{context}\n\nQuestion: {question}'
)


def _coerce(result) -> str:
    content = result.content if hasattr(result, 'content') else str(result)
    if isinstance(content, list):
        return ''.join(b.get('text', '') if isinstance(b, dict) else str(b) for b in content)
    return str(content)


def run_pathways(queries: list[dict]) -> list[dict]:
    """Process each Golden Dataset query through both pathways."""
    rows = []
    for q in queries:
        question = q['question']
        print(f"  [{q['id']:>2}] {question[:70]}...")

        # --- Control: baseline LLM, parametric memory only ---
        t0 = time.perf_counter()
        department = settings.thesis_evaluation_department
        baseline_answer = _coerce(baseline_llm.invoke(BASELINE_PROMPT.format(
            question=question, department=department,
        )))
        baseline_latency = time.perf_counter() - t0

        # --- Experimental: RAG + LLM, closed-domain retrieval ---
        t0 = time.perf_counter()
        context, sources, top_similarity = search_chunks(question, department)
        rag_answer = _coerce(baseline_llm.invoke(
            RAG_PROMPT.format(
                context=context or 'No relevant thesis found.',
                question=question,
                department=department,
            )
        ))
        rag_latency = time.perf_counter() - t0

        rows.append({
            'id': q['id'],
            'question': question,
            'ground_truth': q.get('ground_truth', ''),
            'baseline_answer': baseline_answer,
            'baseline_latency_s': round(baseline_latency, 3),
            'rag_answer': rag_answer,
            'rag_context': context,
            'rag_sources': [s.get('title') for s in sources],
            'rag_top_similarity': round(top_similarity, 4),
            'rag_latency_s': round(rag_latency, 3),
        })
    return rows


def score_with_ragas(rows: list[dict]) -> dict:
    """Score both pathways with Ragas (Faithfulness, Context Precision)."""
    from datasets import Dataset
    from ragas import evaluate
    from ragas.metrics import context_precision, faithfulness

    def build(answers_key: str, contexts_from_rag: bool) -> Dataset:
        return Dataset.from_dict({
            'question': [r['question'] for r in rows],
            'answer': [r[answers_key] for r in rows],
            'contexts': [
                [r['rag_context']] if contexts_from_rag and r['rag_context'] else ['']
                for r in rows
            ],
            'ground_truth': [r['ground_truth'] for r in rows],
        })

    print('  Scoring RAG pathway...')
    rag_scores = evaluate(build('rag_answer', True), metrics=[faithfulness, context_precision])
    print('  Scoring baseline pathway...')
    base_scores = evaluate(build('baseline_answer', True), metrics=[faithfulness, context_precision])

    return {
        'baseline': base_scores.to_pandas().to_dict(orient='records'),
        'rag': rag_scores.to_pandas().to_dict(orient='records'),
    }


def statistical_treatment(baseline_scores: list[float], rag_scores: list[float]) -> dict:
    """Section 3.2.5: Shapiro-Wilk, then paired t-test or Wilcoxon (alpha=0.05)."""
    from scipy import stats

    diffs = [r - b for r, b in zip(rag_scores, baseline_scores)]
    if len(set(diffs)) <= 1:
        return {'note': 'All paired differences identical; statistical test not applicable.'}

    shapiro_stat, shapiro_p = stats.shapiro(diffs)
    normal = shapiro_p > 0.05
    if normal:
        test_name = 'paired-samples t-test'
        stat, p = stats.ttest_rel(rag_scores, baseline_scores)
    else:
        test_name = 'Wilcoxon Signed-Rank test'
        stat, p = stats.wilcoxon(rag_scores, baseline_scores)

    return {
        'shapiro_wilk': {'statistic': float(shapiro_stat), 'p_value': float(shapiro_p), 'normal': normal},
        'test': test_name,
        'statistic': float(stat),
        'p_value': float(p),
        'significant_at_0.05': bool(p < 0.05),
    }


def main():
    parser = argparse.ArgumentParser(description='Baseline LLM vs RAG+LLM comparison (Objective 2)')
    parser.add_argument('--dataset', default=str(Path(__file__).parent / 'golden_dataset.json'))
    parser.add_argument('--skip-ragas', action='store_true',
                        help='Only collect answers/latency; skip Ragas scoring')
    args = parser.parse_args()

    dataset = json.loads(Path(args.dataset).read_text(encoding='utf-8'))
    queries = dataset['queries']
    if not dataset.get('validated_by_faculty_panel'):
        print('WARNING: golden_dataset.json is not yet marked as validated by the faculty panel.')

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')

    print(f'Running {len(queries)} queries through both pathways...')
    rows = run_pathways(queries)

    output: dict = {
        'generated_at': stamp,
        'evaluation_department': settings.thesis_evaluation_department,
        'models': {'llm': settings.gemini_chat_model, 'embeddings': settings.gemini_embed_model},
        'rows': rows,
    }

    if not args.skip_ragas:
        print('Evaluating with Ragas (Faithfulness, Context Precision)...')
        ragas_results = score_with_ragas(rows)
        output['ragas'] = ragas_results

        for metric in ('faithfulness', 'context_precision'):
            base = [r.get(metric) for r in ragas_results['baseline'] if r.get(metric) is not None]
            rag = [r.get(metric) for r in ragas_results['rag'] if r.get(metric) is not None]
            if base and rag and len(base) == len(rag):
                output.setdefault('statistics', {})[metric] = statistical_treatment(base, rag)
                output.setdefault('means', {})[metric] = {
                    'baseline': sum(base) / len(base),
                    'rag': sum(rag) / len(rag),
                }

    json_path = RESULTS_DIR / f'comparison_{stamp}.json'
    json_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding='utf-8')

    try:
        import pandas as pd
        pd.DataFrame(rows).to_csv(RESULTS_DIR / f'comparison_{stamp}.csv', index=False)
    except ImportError:
        pass

    print(f'\nDone. Results written to {json_path}')
    if 'means' in output:
        for metric, vals in output['means'].items():
            print(f"  {metric}: baseline={vals['baseline']:.3f}  rag={vals['rag']:.3f}")


if __name__ == '__main__':
    main()
