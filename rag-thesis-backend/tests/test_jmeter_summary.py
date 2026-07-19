import pytest

from evaluation.summarize_jmeter import percentile, require_response_codes, summarize_rows


def test_percentile_interpolates_deterministically():
    assert percentile([100, 200, 300, 400], 50) == 250
    assert percentile([], 95) == 0


def test_summary_reports_latency_errors_throughput_and_concurrency():
    rows = [
        {'label': 'GET /health', 'elapsed': '100', 'success': 'true', 'responseCode': '200', 'timeStamp': '1000', 'allThreads': '2'},
        {'label': 'GET /health', 'elapsed': '300', 'success': 'false', 'responseCode': '500', 'timeStamp': '1200', 'allThreads': '3'},
    ]
    summary = summarize_rows(rows)['overall']
    assert summary['average_ms'] == 200
    assert summary['median_ms'] == 200
    assert summary['error_rate_percent'] == 50
    assert summary['max_concurrent_threads'] == 3
    assert summary['response_codes'] == {'200': 1, '500': 1}


def test_required_response_code_must_be_observed():
    summary = {'overall': {'response_codes': {'200': 30, '429': 2}}}
    require_response_codes(summary, ['429'])
    with pytest.raises(ValueError, match='503'):
        require_response_codes(summary, ['503'])


def test_throughput_excludes_idle_time_between_distinct_runs():
    rows = [
        {'_run': '1', 'label': 'GET /health', 'elapsed': '100', 'success': 'true',
         'responseCode': '200', 'timeStamp': '1000', 'allThreads': '1'},
        {'_run': '1', 'label': 'GET /health', 'elapsed': '100', 'success': 'true',
         'responseCode': '200', 'timeStamp': '1900', 'allThreads': '1'},
        {'_run': '2', 'label': 'GET /health', 'elapsed': '100', 'success': 'true',
         'responseCode': '200', 'timeStamp': '1000000', 'allThreads': '1'},
        {'_run': '2', 'label': 'GET /health', 'elapsed': '100', 'success': 'true',
         'responseCode': '200', 'timeStamp': '1000900', 'allThreads': '1'},
    ]
    summary = summarize_rows(rows)['overall']
    assert summary['throughput_per_second'] == 2.0
    assert summary['measured_run_count'] == 2
