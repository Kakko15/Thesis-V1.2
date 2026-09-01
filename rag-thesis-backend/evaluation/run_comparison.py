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

Two properties matter for a result that gets frozen into a paper.

**Runs resume.** Each completed query is checkpointed before the next begins, so
an interruption at query 38 of 40 continues rather than discarding both arms for
the 37 that already succeeded.

**Provider outages are never scored.** On an exhausted quota the chat path
returns a capacity notice rather than raising, and trips a process-wide cooldown
during which every following question returns that notice without being
attempted. Scoring those against the ground truth would report the RAG arm as
wrong for questions it was never asked, and would understate the study's own
finding. They are retried, then excluded and reported. A "no relevant thesis"
answer is NOT an outage - it is the retrieval threshold working, and is the
expected answer for the negative controls - so it is scored, never retried.

Usage (from rag-thesis-backend/):
    pip install -r evaluation/requirements-eval.txt
    python -m evaluation.run_comparison [--dataset evaluation/golden_dataset.json]
    python -m evaluation.run_comparison --fresh      # discard any checkpoint

Set LLM_BASE_URL empty, APP_ENVIRONMENT=development and
GUEST_DAILY_TOKEN_BUDGET=0 for a formal run; see the README.

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

from warning_filters import silence_known_third_party_warnings

# Must run before the first `langchain*` import below.
silence_known_third_party_warnings()

# The filter call above has to precede these imports, so the first-party
# import that provides it cannot sit in its usual place.
# pylint: disable=wrong-import-order
from fastapi import BackgroundTasks
from langchain_google_genai import ChatGoogleGenerativeAI
# pylint: enable=wrong-import-order

from config import settings
from models import ChatRequest
from routers.chat import _chat_impl
from scripts.release_fingerprint import build_manifest, sha256_file
from services import chat_notices, gemini_pool

RESULTS_DIR = Path(__file__).parent / 'results'

# How many times one query may be re-attempted when the provider never actually
# processed it, and how long to wait between attempts.
_UNATTEMPTED_MAX_ATTEMPTS = 4
_UNATTEMPTED_BACKOFF_SECONDS = (20, 45, 90)

# Notices that mean "the provider never processed this question" — an exhausted
# quota or an exhausted guest allowance. These must never be scored.
#
# `NO_RELEVANT_PREFIX` is deliberately NOT in this list, and the distinction is
# the whole point. "No relevant thesis was found" is the retrieval threshold
# doing its job: it is a real, correct system response, and for the three
# negative-control queries it is the *expected* one. Retrying it would corrupt
# the instrument; scoring it is exactly right. Same for the grounded fallback,
# which carries real citations, and for a guard refusal, which is a finding
# worth reporting rather than an outage.
_UNATTEMPTED_NOTICES = (
    chat_notices.CAPACITY_MESSAGE,
    chat_notices.GUEST_BUDGET_MESSAGE,
)


def is_unattempted(answer: str) -> bool:
    """True when the RAG arm returned a notice meaning the query never ran."""
    normalized = re.sub(r'\s+', ' ', answer or '').strip()
    return any(normalized.startswith(notice[:60]) for notice in _UNATTEMPTED_NOTICES)


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


async def _attempt_pathways(question: str, department: str):
    """One attempt at both arms, run concurrently."""

    async def run_baseline():
        started = time.perf_counter()
        # Routed through the key pool for the same reason the RAG arm is: with
        # reserve keys configured the experimental arm could rotate past an
        # exhausted key while the control arm could not, so a rate limit took
        # down only the control. Same model, same prompt - only availability
        # was asymmetric.
        result = await gemini_pool.arun(
            baseline_llm,
            gemini_pool.CHAT,
            lambda client: client.ainvoke(BASELINE_PROMPT.format(
                question=question,
                department=department,
            )),
        )
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

    return await asyncio.gather(run_baseline(), run_rag())


def _build_row(q, baseline, rag, attempts: int, unattempted: bool) -> dict:
    baseline_answer, baseline_latency = baseline
    rag_response, trace, rag_latency = rag
    context = trace.get('context', '')
    sources = trace.get('sources', [])
    return {
        'id': q['id'],
        'question': q['question'],
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
        'rag_top_similarity': round(trace.get('top_similarity', 0.0), 4),
        'rag_end_to_end_latency_s': round(rag_latency, 3),
        'attempts': attempts,
        # True only when the provider never processed the question. Such a row
        # is excluded from the paired statistics rather than scored, because
        # scoring an outage notice against the ground truth would report the
        # RAG arm as wrong for a question it was never given.
        'rag_unattempted': unattempted,
    }


def _unattempted_row(q: dict, detail: str) -> dict:
    """A row for a query the provider never served."""
    return {
        'id': q['id'],
        'question': q['question'],
        'ground_truth': q.get('ground_truth', ''),
        'baseline_answer': '',
        'baseline_latency_s': 0.0,
        'rag_answer': '',
        'rag_context': '',
        'rag_contexts': [],
        'rag_sources': [],
        'rag_top_similarity': 0.0,
        'rag_end_to_end_latency_s': 0.0,
        'attempts': _UNATTEMPTED_MAX_ATTEMPTS,
        'rag_unattempted': True,
        'failure': detail[:300],
    }


async def _run_query(q: dict) -> dict:
    """Run one query, re-attempting only when the provider never processed it."""
    question = q['question']
    department = settings.thesis_evaluation_department
    last = None
    for attempt in range(1, _UNATTEMPTED_MAX_ATTEMPTS + 1):
        # An earlier query may have tripped the process-wide capacity cooldown,
        # and while it holds `_chat_impl` returns the capacity notice without
        # calling the provider at all. Clearing it first is what makes a retry
        # an actual retry rather than an instant replay of the same notice.
        chat_notices.reset_capacity_limit()
        try:
            baseline, rag = await _attempt_pathways(question, department)
        except Exception as error:  # pylint: disable=broad-exception-caught
            if attempt == _UNATTEMPTED_MAX_ATTEMPTS:
                # Exhausted. Record it as unattempted and carry on rather than
                # killing the run: one provider hiccup on query 37 of 40 should
                # not end the evaluation, and an excluded query is already
                # visible -- it is listed in `unattempted_query_ids` and forces
                # `formal_result: false`, so it cannot pass unnoticed.
                query_id = q['id']
                print(
                    f'      query {query_id} failed {_UNATTEMPTED_MAX_ATTEMPTS} times '
                    f'({type(error).__name__}); excluded from the paired test'
                )
                return _unattempted_row(q, str(error))
            delay = _UNATTEMPTED_BACKOFF_SECONDS[
                min(attempt - 1, len(_UNATTEMPTED_BACKOFF_SECONDS) - 1)
            ]
            print(f'      attempt {attempt} raised {type(error).__name__}; retrying in {delay}s')
            await asyncio.sleep(delay)
            continue
        last = (baseline, rag)
        if not is_unattempted(rag[0].answer):
            return _build_row(q, baseline, rag, attempt, unattempted=False)
        if attempt < _UNATTEMPTED_MAX_ATTEMPTS:
            delay = _UNATTEMPTED_BACKOFF_SECONDS[
                min(attempt - 1, len(_UNATTEMPTED_BACKOFF_SECONDS) - 1)
            ]
            print(f'      attempt {attempt} returned a capacity notice; retrying in {delay}s')
            await asyncio.sleep(delay)
    print(f'      query {q["id"]} never reached the provider; excluded from the paired test')
    return _build_row(q, last[0], last[1], _UNATTEMPTED_MAX_ATTEMPTS, unattempted=True)


def _load_checkpoint(path: Path) -> dict:
    """Return already-completed rows, keyed by query id."""
    if not path.exists():
        return {}
    done = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.strip():
            row = json.loads(line)
            done[row['id']] = row
    return done


async def _run_pathways(queries: list[dict], checkpoint: Path | None = None) -> list[dict]:
    """Process queries through the baseline and exact deployed guest RAG path.

    Each completed query is appended to `checkpoint` before the next one starts,
    so a run interrupted at query 38 of 40 resumes instead of discarding both
    arms for all 37 that had already succeeded. A full run is roughly 80 model
    calls before Ragas scoring adds its own; losing all of it to one transient
    failure is not an acceptable property for a result that gets frozen into a
    paper.
    """
    completed = _load_checkpoint(checkpoint) if checkpoint else {}
    if completed:
        print(f'  resuming: {len(completed)} of {len(queries)} queries already recorded')
    rows = []
    for q in queries:
        if q['id'] in completed:
            rows.append(completed[q['id']])
            continue
        print(f"  [{q['id']:>2}] {q['question'][:70]}...")
        row = await _run_query(q)
        rows.append(row)
        if checkpoint:
            with checkpoint.open('a', encoding='utf-8') as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    return rows


def run_pathways(queries: list[dict], checkpoint: Path | None = None) -> list[dict]:
    return asyncio.run(_run_pathways(queries, checkpoint))


def _metric_value(result) -> float:
    value = result.value if hasattr(result, 'value') else result
    return float(value)


# Gemini's OpenAI-compatible endpoint. Ragas 0.4.3's native google provider
# wraps genai.Client synchronously (instructor.from_genai without use_async),
# which makes every async ascore() call fail, and the ragas source itself
# flags an upstream instructor safety-settings bug on that path with this
# endpoint as the recommended workaround. Verified by the 2026-07-28 smoke.
GEMINI_OPENAI_COMPAT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'


async def _score_with_ragas(rows: list[dict], checkpoint: Path | None = None) -> dict:
    """Use explicit Gemini-backed Ragas metrics with valid pathway semantics.

    Scoring is the longer half of a run: three judged metrics per query, each
    its own model call. Every query's scores are checkpointed as they land, and
    a judge call that fails transiently is retried rather than taking the whole
    run with it.

    A row the provider never processed is not scored at all. Its `rag_answer`
    is an outage notice, and scoring that against the ground truth would record
    the RAG arm as wrong for a question it was never asked.
    """
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
    done = _load_checkpoint(checkpoint) if checkpoint else {}
    if done:
        print(f'  resuming: {len(done)} of {len(rows)} queries already scored')

    async def judged(label, call):
        """Await one judge call, retrying transient provider failures."""
        for attempt in range(1, _UNATTEMPTED_MAX_ATTEMPTS + 1):
            try:
                return await call()
            except Exception as error:  # pylint: disable=broad-exception-caught
                if attempt == _UNATTEMPTED_MAX_ATTEMPTS:
                    raise
                delay = _UNATTEMPTED_BACKOFF_SECONDS[
                    min(attempt - 1, len(_UNATTEMPTED_BACKOFF_SECONDS) - 1)
                ]
                print(f'      {label} failed ({type(error).__name__}); retrying in {delay}s')
                await asyncio.sleep(delay)
        raise AssertionError('unreachable')

    for index, row in enumerate(rows, start=1):
        if row['id'] in done:
            entry = done[row['id']]
            baseline_scores.append(entry['baseline'])
            rag_scores.append(entry['rag'])
            continue
        print(f'  Scoring query {index}/{len(rows)}...')
        if row.get('rag_unattempted'):
            print('      skipped: the provider never processed this query')
            baseline_entry = {'answer_correctness': None}
            rag_entry = {
                'answer_correctness': None,
                'faithfulness': None,
                'context_precision': None,
            }
        else:
            common = {'user_input': row['question'], 'reference': row['ground_truth']}
            baseline_correctness = await judged(
                'baseline answer_correctness',
                lambda common=common, row=row: answer_correctness.ascore(
                    **common, response=row['baseline_answer'],
                ),
            )
            rag_correctness = await judged(
                'rag answer_correctness',
                lambda common=common, row=row: answer_correctness.ascore(
                    **common, response=row['rag_answer'],
                ),
            )
            contexts = row.get('rag_contexts') or []
            rag_faithfulness = None
            rag_context_precision = None
            if contexts:
                rag_faithfulness = await judged(
                    'rag faithfulness',
                    lambda row=row, contexts=contexts: faithfulness.ascore(
                        user_input=row['question'],
                        response=row['rag_answer'],
                        retrieved_contexts=contexts,
                    ),
                )
                rag_context_precision = await judged(
                    'rag context_precision',
                    lambda common=common, contexts=contexts: context_precision.ascore(
                        **common, retrieved_contexts=contexts,
                    ),
                )
            baseline_entry = {'answer_correctness': _metric_value(baseline_correctness)}
            rag_entry = {
                'answer_correctness': _metric_value(rag_correctness),
                'faithfulness': (
                    _metric_value(rag_faithfulness) if rag_faithfulness is not None else None
                ),
                'context_precision': (
                    _metric_value(rag_context_precision)
                    if rag_context_precision is not None else None
                ),
            }
        baseline_scores.append(baseline_entry)
        rag_scores.append(rag_entry)
        if checkpoint:
            with checkpoint.open('a', encoding='utf-8') as handle:
                handle.write(json.dumps(
                    {'id': row['id'], 'baseline': baseline_entry, 'rag': rag_entry},
                    ensure_ascii=False,
                ) + chr(10))
    return {'baseline': baseline_scores, 'rag': rag_scores}


def score_with_ragas(rows: list[dict], checkpoint: Path | None = None) -> dict:
    return asyncio.run(_score_with_ragas(rows, checkpoint))


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
    parser.add_argument(
        '--run-id',
        default=None,
        help=(
            'Checkpoint namespace. A run writes each completed query to '
            'results/checkpoints/<run-id>.*.jsonl and resumes from it, so an '
            'interrupted run continues instead of restarting. Defaults to the '
            'dataset SHA-256 prefix, which means a re-run of the same dataset '
            'resumes automatically and a changed dataset starts clean.'
        ),
    )
    parser.add_argument(
        '--fresh',
        action='store_true',
        help='Ignore and overwrite any existing checkpoint for this run id.',
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

    # Keyed on the dataset digest by default so a resumed run can never splice
    # answers collected against one instrument into results reported for
    # another. Change the dataset and the run id changes with it.
    run_id = args.run_id or sha256_file(dataset_path)[:12]
    checkpoint_dir = RESULTS_DIR / 'checkpoints'
    checkpoint_dir.mkdir(exist_ok=True)
    pathways_checkpoint = checkpoint_dir / f'{run_id}.pathways.jsonl'
    scores_checkpoint = checkpoint_dir / f'{run_id}.scores.jsonl'
    if args.fresh:
        for path in (pathways_checkpoint, scores_checkpoint):
            path.unlink(missing_ok=True)

    print(f'Running {len(queries)} queries through both pathways (run id {run_id})...')
    rows = run_pathways(queries, pathways_checkpoint)

    unattempted = [row['id'] for row in rows if row.get('rag_unattempted')]
    if unattempted:
        print(
            f'\nWARNING: {len(unattempted)} of {len(rows)} queries never reached the '
            f'provider and are excluded from the paired test: {unattempted}'
        )

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
        # A run with excluded queries is not a formal result. The paired test
        # would otherwise be reported over a silently smaller n than the
        # instrument declares, which is the same class of error as quoting a
        # /chat load run that returned 100% HTTP 200 while answering nothing.
        'formal_result': not dataset_issues and not unattempted,
        'dataset_validation_issues': dataset_issues,
        'unattempted_query_ids': unattempted,
        'queries_scored': len(rows) - len(unattempted),
        'queries_total': len(rows),
        'rows': sanitized_rows,
    }

    if not args.skip_ragas:
        print('Evaluating with Ragas (Answer Correctness, RAG Faithfulness/Context Precision)...')
        ragas_results = score_with_ragas(rows, scores_checkpoint)
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
                    # The paired n, stated rather than inferred from the query
                    # count: an unattempted or non-finite score drops its pair,
                    # so this can legitimately be smaller than queries_total.
                    'n': len(pairs),
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
