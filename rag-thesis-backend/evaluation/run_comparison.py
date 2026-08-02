"""Objective 2 — Comparative Performance Analysis (thesis paper, Section 3.2.1).

Runs every Golden Dataset query through BOTH computational pathways:

  * Baseline (control): unaugmented Gemini relying on parametric memory only.
  * Proposed (experimental): the RAG + LLM pipeline constrained to the
    CCSICT vector archive.

Both outputs are scored against the faculty-validated reference answers with
Ragas Answer Correctness. The RAG pathway is additionally evaluated for
Faithfulness and Context Precision. This distinction is necessary because a
baseline with no retriever has no retrieved context whose precision can be
measured. Paired Answer Correctness scores receive the statistical treatment
from Section 3.2.5: Shapiro-Wilk normality test, then a paired-samples t-test
(parametric) or Wilcoxon Signed-Rank test (non-parametric) at alpha = 0.05.

Usage (from rag-thesis-backend/):
    pip install -r evaluation/requirements-eval.txt
    python -m evaluation.run_comparison [--dataset evaluation/golden_dataset.json]

Outputs CSV + JSON summaries into evaluation/results/.
"""

import argparse
import asyncio
import hashlib
import json
import math
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks
from langchain_google_genai import ChatGoogleGenerativeAI

from config import settings
from models import ChatRequest
from routers.chat import _chat_impl
from scripts.release_fingerprint import build_manifest, sha256_file

RESULTS_DIR = Path(__file__).parent / 'results'

baseline_llm = ChatGoogleGenerativeAI(
    model=settings.gemini_chat_model,
    google_api_key=settings.gemini_api_key,
    timeout=settings.gemini_timeout_seconds,
    max_retries=settings.gemini_max_retries,
    max_output_tokens=settings.gemini_max_output_tokens,
    thinking_level=settings.gemini_thinking_level,
)

BASELINE_PROMPT = (
    'You are a research assistant for the {department} department of Isabela State University, '
    'Echague. Answer the following question about {department} undergraduate thesis research '
    'using only your own knowledge. Cite specific theses if you can.\n\nQuestion: {question}'
)

# Matches only the citation header line; bodies are recovered by slicing
# between consecutive headers. This replaces a lazy dot-all quantifier bounded
# by an anchored alternation inside a lookahead, which was both ambiguous to
# read and able to backtrack super-linearly. `[^\n]*` takes the rest of the
# line in one unambiguous pass (an `\s+` prefix would also match newlines and
# overlap this class), so header scanning and slicing are linear.
_CONTEXT_HEADER = re.compile(r'^\[(\d+)\][^\n]*\n', flags=re.MULTILINE)


def validate_formal_dataset(dataset: dict) -> list[str]:
    """Return every condition that prevents a defensible formal evaluation."""
    issues: list[str] = []
    queries = dataset.get('queries') or []
    if not 30 <= len(queries) <= 50:
        issues.append('the Golden Dataset must contain 30-50 queries')
    ids = [query.get('id') for query in queries]
    if len(ids) != len(set(ids)):
        issues.append('query IDs must be unique')
    for query in queries:
        if not str(query.get('question', '')).strip():
            issues.append(f'query {query.get("id", "?")} has no question')
        for field in ('ground_truth', 'source_thesis'):
            value = str(query.get(field, '')).strip()
            if not value or value.upper().startswith('REPLACE:'):
                issues.append(f'query {query.get("id", "?")} has an unverified {field}')
    if dataset.get('validated_by_faculty_panel') is not True:
        issues.append('validated_by_faculty_panel is not true')
    panel = (dataset.get('validation') or {}).get('panel') or []
    if len(panel) != 3:
        issues.append('exactly three faculty validators are required')
    elif any(
        not all(str(member.get(field, '')).strip() for field in ('name', 'position', 'date_validated'))
        for member in panel
    ):
        issues.append('all three faculty validator records must be complete')
    else:
        names = [str(member['name']).strip().casefold() for member in panel]
        if len(set(names)) != 3:
            issues.append('the three faculty validators must be distinct people')
        for member in panel:
            try:
                date.fromisoformat(str(member['date_validated']).strip())
            except ValueError:
                issues.append('faculty validation dates must use ISO format YYYY-MM-DD')
                break
    return issues


def _ranked_contexts(context: str) -> list[str]:
    """Recover retrieved chunks in similarity order, before prompt reordering.

    ``search_chunks`` labels citations before applying LongContextReorder, so
    sorting the numbered blocks restores the original retrieval ranking that
    Context Precision is defined to assess.
    """
    text = context or ''
    headers = list(_CONTEXT_HEADER.finditer(text))
    blocks = []
    for position, header in enumerate(headers):
        body_end = headers[position + 1].start() if position + 1 < len(headers) else len(text)
        blocks.append((int(header.group(1)), text[header.end():body_end].strip()))
    return [body for _index, body in sorted(blocks)]


def sanitize_evaluation_rows(rows: list[dict]) -> list[dict]:
    """Remove archived manuscript text before results are written or exported."""
    sanitized = []
    for row in rows:
        contexts = row.get('rag_contexts') or []
        public = {
            key: value
            for key, value in row.items()
            if key not in {'rag_context', 'rag_contexts'}
        }
        public['retrieved_context_count'] = len(contexts)
        public['retrieved_context_sha256'] = [
            hashlib.sha256(context.encode('utf-8')).hexdigest()
            for context in contexts
        ]
        sanitized.append(public)
    return sanitized


def _coerce(result) -> str:
    content = result.content if hasattr(result, 'content') else str(result)
    if isinstance(content, list):
        return ''.join(b.get('text', '') if isinstance(b, dict) else str(b) for b in content)
    return str(content)


async def _run_pathways(queries: list[dict]) -> list[dict]:
    """Process queries through the baseline and exact deployed guest RAG path."""
    rows = []
    for q in queries:
        question = q['question']
        print(f"  [{q['id']:>2}] {question[:70]}...")
        department = settings.thesis_evaluation_department

        async def run_baseline():
            started = time.perf_counter()
            result = await baseline_llm.ainvoke(BASELINE_PROMPT.format(
                question=question,
                department=department,
            ))
            return _coerce(result), time.perf_counter() - started

        async def run_rag():
            started = time.perf_counter()
            trace: dict = {}
            response = await _chat_impl(
                ChatRequest(question=question, department_filter=department),
                None,
                BackgroundTasks(),
                None,
                evaluation_trace=trace,
            )
            return response, trace, time.perf_counter() - started

        (baseline_answer, baseline_latency), (rag_response, trace, rag_latency) = (
            await asyncio.gather(run_baseline(), run_rag())
        )
        context = trace.get('context', '')
        sources = trace.get('sources', [])
        top_similarity = trace.get('top_similarity', 0.0)

        rows.append({
            'id': q['id'],
            'question': question,
            'ground_truth': q.get('ground_truth', ''),
            'baseline_answer': baseline_answer,
            'baseline_latency_s': round(baseline_latency, 3),
            'rag_answer': rag_response.answer,
            'rag_context': context,
            'rag_contexts': _ranked_contexts(context),
            'rag_sources': [
                {'citation_id': source.get('citation_id'), 'title': source.get('title')}
                for source in sources
            ],
            'rag_top_similarity': round(top_similarity, 4),
            'rag_end_to_end_latency_s': round(rag_latency, 3),
        })
    return rows


def run_pathways(queries: list[dict]) -> list[dict]:
    return asyncio.run(_run_pathways(queries))


def _metric_value(result) -> float:
    value = result.value if hasattr(result, 'value') else result
    return float(value)


# Gemini's OpenAI-compatible endpoint. Ragas 0.4.3's native google provider
# wraps genai.Client synchronously (instructor.from_genai without use_async),
# which makes every async ascore() call fail, and the ragas source itself
# flags an upstream instructor safety-settings bug on that path with this
# endpoint as the recommended workaround. Verified by the 2026-07-28 smoke.
GEMINI_OPENAI_COMPAT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'


async def _score_with_ragas(rows: list[dict]) -> dict:
    """Use explicit Gemini-backed Ragas metrics with valid pathway semantics."""
    from google import genai
    from openai import AsyncOpenAI
    from ragas.embeddings import GoogleEmbeddings
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerCorrectness, ContextPrecision, Faithfulness

    evaluator_llm = llm_factory(
        settings.gemini_verdict_model,
        provider='openai',
        client=AsyncOpenAI(
            api_key=settings.gemini_api_key,
            base_url=GEMINI_OPENAI_COMPAT_BASE_URL,
        ),
    )
    evaluator_embeddings = GoogleEmbeddings(
        client=genai.Client(api_key=settings.gemini_api_key),
        model=settings.gemini_embed_model.removeprefix('models/'),
    )
    answer_correctness = AnswerCorrectness(
        llm=evaluator_llm,
        embeddings=evaluator_embeddings,
    )
    faithfulness = Faithfulness(llm=evaluator_llm)
    context_precision = ContextPrecision(llm=evaluator_llm)

    baseline_scores: list[dict] = []
    rag_scores: list[dict] = []
    for index, row in enumerate(rows, start=1):
        print(f'  Scoring query {index}/{len(rows)}...')
        common = {'user_input': row['question'], 'reference': row['ground_truth']}
        baseline_correctness = await answer_correctness.ascore(
            **common,
            response=row['baseline_answer'],
        )
        rag_correctness = await answer_correctness.ascore(
            **common,
            response=row['rag_answer'],
        )
        contexts = row.get('rag_contexts') or []
        rag_faithfulness = None
        rag_context_precision = None
        if contexts:
            rag_faithfulness = await faithfulness.ascore(
                user_input=row['question'],
                response=row['rag_answer'],
                retrieved_contexts=contexts,
            )
            rag_context_precision = await context_precision.ascore(
                **common,
                retrieved_contexts=contexts,
            )
        baseline_scores.append({'answer_correctness': _metric_value(baseline_correctness)})
        rag_scores.append({
            'answer_correctness': _metric_value(rag_correctness),
            'faithfulness': (
                _metric_value(rag_faithfulness) if rag_faithfulness is not None else None
            ),
            'context_precision': (
                _metric_value(rag_context_precision) if rag_context_precision is not None else None
            ),
        })
    return {'baseline': baseline_scores, 'rag': rag_scores}


def score_with_ragas(rows: list[dict]) -> dict:
    return asyncio.run(_score_with_ragas(rows))


def statistical_treatment(baseline_scores: list[float], rag_scores: list[float]) -> dict:
    """Section 3.2.5: Shapiro-Wilk, then paired t-test or Wilcoxon (alpha=0.05)."""
    if len(baseline_scores) < 3 or len(rag_scores) < 3:
        return {'note': 'At least three complete score pairs are required for statistical testing.'}
    diffs = [r - b for r, b in zip(rag_scores, baseline_scores)]
    if len(set(diffs)) <= 1:
        return {'note': 'All paired differences identical; statistical test not applicable.'}

    # scipy ships with the evaluation extras (requirements-eval.txt), not the
    # production set — import it only once a real statistical test is needed.
    from scipy import stats

    shapiro_stat, shapiro_p = stats.shapiro(diffs)
    # scipy returns numpy scalars; a raw numpy.bool_ breaks json.dumps later.
    normal = bool(shapiro_p > 0.05)
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
    parser.add_argument(
        '--allow-unvalidated',
        action='store_true',
        help='Development smoke only: run with an unvalidated dataset and mark output non-formal',
    )
    args = parser.parse_args()

    dataset_path = Path(args.dataset).resolve()
    dataset = json.loads(dataset_path.read_text(encoding='utf-8'))
    queries = dataset['queries']
    dataset_issues = validate_formal_dataset(dataset)
    if dataset_issues and not args.allow_unvalidated:
        details = '\n  - '.join(dataset_issues)
        parser.error(
            'formal evaluation is blocked until the dataset is complete:\n  - '
            f'{details}\nUse --allow-unvalidated only for a development smoke run.'
        )
    if dataset_issues:
        print('WARNING: development-only run; the dataset is not valid for formal results.')

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')

    print(f'Running {len(queries)} queries through both pathways...')
    rows = run_pathways(queries)

    sanitized_rows = sanitize_evaluation_rows(rows)
    output: dict = {
        'generated_at': stamp,
        'evaluation_department': settings.thesis_evaluation_department,
        'models': {'llm': settings.gemini_chat_model, 'embeddings': settings.gemini_embed_model},
        'evaluator': {
            'model': settings.gemini_verdict_model,
            'framework': 'ragas==0.4.3',
            'metrics': ['answer_correctness', 'faithfulness', 'context_precision'],
        },
        'reproducibility': {
            'release': build_manifest(),
            'golden_dataset_sha256': sha256_file(dataset_path),
            'evaluation_requirements_sha256': sha256_file(
                Path(__file__).parent / 'requirements-eval.txt'
            ),
            'evaluation_script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
        'formal_result': not dataset_issues,
        'dataset_validation_issues': dataset_issues,
        'rows': sanitized_rows,
    }

    if not args.skip_ragas:
        print('Evaluating with Ragas (Answer Correctness, RAG Faithfulness/Context Precision)...')
        ragas_results = score_with_ragas(rows)
        output['ragas'] = ragas_results

        for metric in ('answer_correctness',):
            pairs = [
                (float(base_row[metric]), float(rag_row[metric]))
                for base_row, rag_row in zip(
                    ragas_results['baseline'], ragas_results['rag'], strict=True,
                )
                if base_row.get(metric) is not None
                and rag_row.get(metric) is not None
                and math.isfinite(float(base_row[metric]))
                and math.isfinite(float(rag_row[metric]))
            ]
            if pairs:
                base, rag = map(list, zip(*pairs, strict=True))
                output.setdefault('statistics', {})[metric] = statistical_treatment(base, rag)
                output.setdefault('means', {})[metric] = {
                    'baseline': sum(base) / len(base),
                    'rag': sum(rag) / len(rag),
                }
        output['rag_diagnostics'] = {}
        for metric in ('faithfulness', 'context_precision'):
            values = [
                float(row[metric])
                for row in ragas_results['rag']
                if row.get(metric) is not None and math.isfinite(float(row[metric]))
            ]
            output['rag_diagnostics'][metric] = {
                'mean': sum(values) / len(values) if values else None,
                'n': len(values),
                'not_applicable': len(ragas_results['rag']) - len(values),
            }

    json_path = RESULTS_DIR / f'comparison_{stamp}.json'
    json_path.write_text(
        json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False),
        encoding='utf-8',
    )

    try:
        import pandas as pd
        pd.DataFrame(sanitized_rows).to_csv(
            RESULTS_DIR / f'comparison_{stamp}.csv',
            index=False,
        )
    except ImportError:
        pass

    print(f'\nDone. Results written to {json_path}')
    if 'means' in output:
        for metric, vals in output['means'].items():
            print(f"  {metric}: baseline={vals['baseline']:.3f}  rag={vals['rag']:.3f}")


if __name__ == '__main__':
    main()
