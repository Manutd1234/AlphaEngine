"""Fetching the issuer's own page, and what it is allowed to conclude from it.

Every case here runs against a fixture rather than the network. The fixtures
are shaped like the real pages — including the two wordings of the voting line
that the Federal Reserve has used since 2019 — because the parser's whole job
is to survive those differences without a DOM.
"""

from __future__ import annotations

import httpx

from modules.coherence.diffusion.text import (
    MIN_STATEMENT_CHARS,
    body_of,
    fetch_statement,
    headline_of,
    release_time_of,
    strip_html,
)
from modules.coherence.diffusion.texts import verify_calendar

BODY = (
    "Recent indicators point to modest growth in spending and production. "
    "Job gains have been robust in recent months, and the unemployment rate has remained low. "
    "Inflation remains elevated, reflecting supply and demand imbalances related to the pandemic. "
    "The Committee seeks to achieve maximum employment and inflation at the rate of 2 percent "
    "over the longer run. In support of these goals, the Committee decided to raise the target "
    "range for the federal funds rate to 3 to 3-1/4 percent."
)


def _page(*, release_line: str = "For release at 2:00 p.m. EDT", body: str = BODY,
          voting: str = "Voting for the monetary policy action were Jerome H. Powell, Chair") -> str:
    return f"""<html><head><style>.x{{color:red}}</style></head><body>
      <nav>Skip to main content</nav>
      <div class="col-xs-12"><p>{release_line}</p></div>
      <p>Share</p>
      <p>{body}</p>
      <p>{voting}; John C. Williams, Vice Chair.</p>
      <p>Implementation Note issued September 21, 2022</p>
    </body></html>"""


def _client(page: str, status: int = 200) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(status, text=page)))


class TestTheStripIsBluntButKeepsTheShape:
    def test_scripts_and_styles_do_not_become_text(self):
        assert "color:red" not in strip_html(_page())

    def test_block_tags_become_line_breaks_rather_than_running_together(self):
        text = strip_html("<p>first</p><p>second</p>")
        assert "first\nsecond" in text

    def test_entities_are_decoded(self):
        assert strip_html("<p>rates &amp; prices</p>").strip() == "rates & prices"


class TestTheBodyIsIsolatedFromThePage:
    def test_the_statement_sits_between_the_release_line_and_the_voting_record(self):
        body, isolated = body_of(strip_html(_page()))
        assert isolated is True
        assert body.startswith("Recent indicators")
        assert "Voting" not in body and "Skip to main content" not in body
        assert "Share" not in body, "the navigation control survived into the body"

    def test_the_2019_wording_of_the_voting_line_is_matched_too(self):
        body, isolated = body_of(strip_html(
            _page(voting="Voting for the FOMC monetary policy action were: Jerome H. Powell, Chairman")))
        assert isolated is True and "Voting" not in body

    def test_an_unmatched_marker_keeps_the_whole_page_and_says_so(self):
        body, isolated = body_of(strip_html(_page(voting="Everyone agreed")))
        assert isolated is False
        assert "Skip to main content" in body, (
            "a silently truncated document would hide that the markers moved"
        )


class TestTheReleaseTimeIsReadOffThePage:
    def test_an_afternoon_statement_becomes_a_twenty_four_hour_stamp(self):
        assert release_time_of(strip_html(_page())) == "14:00 EDT"

    def test_a_morning_emergency_cut_is_not_shifted_by_twelve(self):
        page = _page(release_line="For release at 10:00 a.m. EST")
        assert release_time_of(strip_html(page)) == "10:00 EST"

    def test_a_sunday_evening_announcement_reads_as_the_evening(self):
        page = _page(release_line="For release at 5:00 p.m. EDT")
        assert release_time_of(strip_html(page)) == "17:00 EDT"

    def test_a_page_with_no_release_line_is_none_rather_than_a_default(self):
        assert release_time_of("nothing here") is None


class TestAFetchIsTypedRatherThanEmpty:
    def test_a_good_page_carries_its_digest_and_its_length(self):
        with _client(_page()) as client:
            got = fetch_statement("fed:2022-09-21", "https://example.test/a.htm", client=client)
        assert got.state == "ok" and got.verified is True
        assert got.sha256 and got.characters == len(got.text or "")
        assert got.release_time == "14:00 EDT"

    def test_a_404_says_the_calendar_row_is_wrong(self):
        with _client("<html></html>", status=404) as client:
            got = fetch_statement("fed:1970-01-01", "https://example.test/x.htm", client=client)
        assert got.state == "not_found" and got.verified is False
        assert "calendar row is wrong" in (got.reason or "")

    def test_a_shell_page_is_too_short_rather_than_a_document(self):
        with _client(_page(body="Brief.")) as client:
            got = fetch_statement("fed:2020-01-01", "https://example.test/s.htm", client=client)
        assert got.state == "too_short"
        assert str(MIN_STATEMENT_CHARS) in (got.reason or "")

    def test_the_floor_admits_a_genuine_emergency_statement(self):
        """3 March 2020 is 537 characters of complete statement. A floor that
        rejects it discards the largest surprise in the sample."""
        emergency = (
            "The fundamentals of the U.S. economy remain strong. However, the coronavirus poses "
            "evolving risks to economic activity. In light of these risks and in support of "
            "achieving its maximum employment and price stability goals, the Federal Open Market "
            "Committee decided today to lower the target range for the federal funds rate by 1/2 "
            "percentage point, to 1 to 1-1/4 percent. The Committee is closely monitoring "
            "developments and will use its tools and act as appropriate to support the economy."
        )
        assert len(emergency) < 600, "the fixture must be shorter than the floor that rejected it"
        with _client(_page(body=emergency, release_line="For release at 10:00 a.m. EST")) as client:
            got = fetch_statement("fed:2020-03-03", "https://example.test/e.htm", client=client)
        assert got.state == "ok"
        assert got.release_time == "10:00 EST"

    def test_a_transport_failure_is_unavailable_with_the_reason(self):
        def boom(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route to host")

        with httpx.Client(transport=httpx.MockTransport(boom)) as client:
            got = fetch_statement("fed:2022-09-21", "https://example.test/a.htm", client=client)
        assert got.state == "unavailable" and "no route" in (got.reason or "")


class TestVerificationChecksTheHourAndNotOnlyTheDate:
    def test_agreement_confirms_the_row(self):
        with _client(_page()) as client:
            got = fetch_statement("fed:2022-09-21", "https://example.test/a.htm", client=client)
        agreed, reason = verify_calendar(got, "14:00")
        assert agreed is True and reason is None

    def test_a_wrong_hour_is_caught_even_though_the_date_resolved(self):
        with _client(_page(release_line="For release at 5:00 p.m. EDT")) as client:
            got = fetch_statement("fed:2020-03-15", "https://example.test/a.htm", client=client)
        agreed, reason = verify_calendar(got, "14:00")
        assert agreed is False
        assert "17:00" in (reason or "") and "calendar row is wrong" in (reason or "")

    def test_a_page_with_no_time_leaves_the_hour_unconfirmed(self):
        with _client(_page(release_line="For release soon")) as client:
            got = fetch_statement("fed:2022-09-21", "https://example.test/a.htm", client=client)
        agreed, reason = verify_calendar(got, "14:00")
        assert agreed is False and "unconfirmed" in (reason or "")

    def test_a_failed_fetch_never_verifies(self):
        with _client("<html></html>", status=404) as client:
            got = fetch_statement("fed:1970-01-01", "https://example.test/x.htm", client=client)
        assert verify_calendar(got, "14:00")[0] is False


class TestTheHeadlineIsTheOpeningSentences:
    def test_it_stops_at_a_sentence_boundary(self):
        headline = headline_of(BODY, sentences=1)
        assert headline.endswith("production.")

    def test_two_sentences_is_more_than_one(self):
        assert len(headline_of(BODY, sentences=2)) > len(headline_of(BODY, sentences=1))
