import unittest
from unittest.mock import patch

from core import Meili, anchor, group_hits, metrics, normalize, passage_ranges, phrase_spans, source_text


class Tokenizer:
    def encode(self, text, **_):
        return [0] + text.split() + [1]


class SearchContracts(unittest.TestCase):
    def test_arabic_contract_and_offsets(self):
        text = "قَالَ: إِنَّ الصَّلاةَ لا تُتْرَكُ."
        spans = phrase_spans(text, "إن الصلاة لا تترك")
        self.assertEqual(len(spans), 1)
        self.assertEqual(normalize(text[slice(*spans[0])]), "إن الصلاة لا تترك")
        self.assertFalse(phrase_spans(text, "الصلاة تترك"))
        self.assertEqual(normalize("ا\u0654حمد"), normalize("أحمد"))
        self.assertEqual(normalize("ﻻ ١۲ـ٣"), "لا 123")
        self.assertNotEqual(normalize("رحمة"), normalize("رحمه"))
        self.assertNotEqual(normalize("على"), normalize("علي"))
        self.assertEqual(normalize("إلى رحمة", True), "الي رحمه")

    def test_phrase_is_consecutive_and_crosses_chunk_boundary(self):
        self.assertFalse(phrase_spans("لا تجوز هذه الصلاة", "لا الصلاة"))
        self.assertEqual(phrase_spans("قال الشيخ\nلا يجوز ذلك", "الشيخ لا يجوز"), [(4, 17)])
        self.assertEqual(len(phrase_spans("رحمة ثم رحمة", "رحمة")), 2)

    def test_chunking_preserves_oversized_text_and_source_times(self):
        text = "واحد اثنان ثلاثة أربعة خمسة ستة سبعة ثمانية"
        segments = [{"charStart": 0, "charEnd": len(text), "startMs": 5000,
                     "endMs": 65000, "partOrder": 1}]
        ranges = passage_ranges(text, segments, Tokenizer(), max_tokens=5)
        self.assertEqual("".join(text[left:right] for left, right in ranges), text)
        self.assertTrue(all(len(Tokenizer().encode(text[l:r])) <= 5 for l, r in ranges))
        self.assertEqual(anchor(segments, *ranges[-1])["startMs"], 5000)

    def test_wrong_parent_does_not_count_as_evidence(self):
        gold = [{"sourceId": "a", "sourceHash": "v1", "charStart": 200, "charEnd": 250, "grade": 3}]
        wrong = {"sourceId": "a", "sourceHash": "v1", "charStart": 0, "charEnd": 50}
        good = {**wrong, "charStart": 200, "charEnd": 250}
        displayed = [wrong, wrong, wrong, good]
        score = metrics(displayed, displayed, gold)
        self.assertEqual(score["success3"], 0)
        self.assertEqual(score["success5"], 1)
        self.assertEqual(score["candidateRecall"], 1)
        self.assertEqual(metrics([{**good, "sourceHash": "v2"}], [], gold)["success3"], 0)

    def test_group_after_ranking(self):
        hits = [{"sourceId": "a", "id": 3}, {"sourceId": "b", "id": 2}, {"sourceId": "a", "id": 1}]
        self.assertEqual([h["id"] for h in group_hits(hits)], [3, 2])
        self.assertEqual(group_hits(hits, True), hits)

    def test_failed_async_task_is_not_success(self):
        with patch.object(Meili, "call", side_effect=[{"taskUid": 7}, {"status": "failed", "error": {"code": "invalid_vector"}}]):
            with self.assertRaisesRegex(RuntimeError, "invalid_vector"):
                Meili().task("/indexes/test/documents", [])

    def test_duplicate_hits_cannot_inflate_ranking_quality(self):
        gold = [{"sourceId": "a", "sourceHash": "v1", "charStart": 0, "charEnd": 10, "grade": 3}]
        hit = {"sourceId": "a", "sourceHash": "v1", "charStart": 0, "charEnd": 10}
        self.assertEqual(metrics([hit, hit, hit], [hit], gold)["ndcg10"], 1)
        partial = {**hit, "charStart": 3}
        self.assertEqual(metrics([partial], [partial], gold)["success3"], 0)

    def test_transcript_identity_and_time_units(self):
        source = {"scope": "audio", "sourceId": "a", "assemblyHash": "hash", "durationMs": 90000,
                  "parts": [{"sha256": "first", "order": 0, "offsetMs": 0, "durationMs": 60000},
                            {"sha256": "sha", "order": 1, "offsetMs": 60000, "durationMs": 30000}]}
        artifact = {"lessonId": "a", "assemblyHash": "hash", "parts": source["parts"],
                    "segments": [{"text": "لا يجوز", "partOrder": 1, "sha256": "sha", "startMs": 61000, "endMs": 65000}]}
        text, segments = source_text(source, artifact)
        self.assertEqual(text, "لا يجوز")
        self.assertEqual(anchor(segments, 0, 6)["startMs"], 61000)
        with self.assertRaises(ValueError):
            source_text(source, {**artifact, "assemblyHash": "stale"})


if __name__ == "__main__":
    unittest.main()
