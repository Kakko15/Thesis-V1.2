"""An extracted metadata field is rendered, so its shape has to be text.

`extract_metadata` pre-fills the upload form from a model's JSON reply. The
prompt asks for strings, but the reply is not bound by the ask, and a
multi-author thesis commonly comes back as an array. The old coercion was
`str(...)`, which turns a list into its Python repr -- so the form was filled
with ['A. Author', 'B. Author'], the uploader accepted it, and the archive card
rendered the brackets and quotes verbatim beside a correctly formatted sibling.

Observed on 2026-09-02 on the re-uploaded corrected manuscript. The local
title-page path has always joined with ', ' (`_extract_title_page_metadata`),
so these tests pin the two routes to the same shape.
"""

import pytest

from routers.upload import _as_text


class TestExtractedFieldsBecomeText:
    def test_a_list_of_authors_is_joined_not_repr_d(self):
        assert _as_text(['Ahron John F. Barlis', 'Carlo Rossi P. Gallardo']) == (
            'Ahron John F. Barlis, Carlo Rossi P. Gallardo'
        )
        assert _as_text(('Solo Author',)) == 'Solo Author'

    def test_a_string_is_returned_stripped(self):
        assert _as_text('  Franklyn Bugauisan, William Respicio  ') == (
            'Franklyn Bugauisan, William Respicio'
        )

    def test_blank_and_empty_shapes_yield_the_fallback(self):
        # The fallback is the locally parsed title-page value, which is the
        # better answer whenever the model returned nothing usable.
        for empty in ('', '   ', None, [], (), [''], ['  ', None]):
            assert _as_text(empty, 'local value') == 'local value'

    def test_a_year_arrives_as_text_whether_quoted_or_numeric(self):
        assert _as_text(2025) == '2025'
        assert _as_text('2025') == '2025'

    def test_a_shape_with_no_sensible_rendering_never_becomes_a_repr(self):
        """A dict or a bool has no reading here. Falling back beats filling the
        form with {'name': 'x'} and storing it as an author."""
        for junk in ({'name': 'A. Author'}, True, False, object()):
            assert _as_text(junk, 'local value') == 'local value'
            assert _as_text(junk) == ''

    def test_blank_members_are_dropped_from_a_list(self):
        assert _as_text(['A. Author', '', None, '  ', 'B. Author']) == 'A. Author, B. Author'

    def test_a_nested_list_still_flattens_to_one_line(self):
        assert _as_text([['A. Author', 'B. Author'], 'C. Author']) == (
            'A. Author, B. Author, C. Author'
        )

    @pytest.mark.parametrize('value', [
        ['A. Author', 'B. Author'], 'A. Author, B. Author', 2025, None, {},
    ])
    def test_the_result_is_always_a_string(self, value):
        assert isinstance(_as_text(value), str)


class TestThePromptAsksForTheShapeTheCodeEnforces:
    def test_the_contract_names_strings_and_the_author_separator(self):
        """Defence in depth, not a substitute: the code normalises whatever
        arrives, and the prompt reduces how often it has to."""
        from services import prompts

        prompt = prompts.metadata_extraction_prompt('body text', '"CCSICT"')
        assert 'must be a JSON string' in prompt
        assert 'never an array' in prompt
        # The framing that test_untrusted_prompt_framing.py pins must survive.
        assert '<untrusted_manuscript>' in prompt
        assert 'never instructions' in prompt
