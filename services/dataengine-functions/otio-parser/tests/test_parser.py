"""Unit tests for OTIO parser (mock opentimelineio library)."""

import unittest
from unittest.mock import MagicMock, patch, PropertyMock


class MockRationalTime:
    def __init__(self, value, rate):
        self.value = value
        self.rate = rate


class MockTimeRange:
    def __init__(self, start_value, duration_value, rate=24.0):
        self.start_time = MockRationalTime(start_value, rate)
        self.duration = MockRationalTime(duration_value, rate)


class MockExternalRef:
    def __init__(self, url):
        self.target_url = url


class MockMissingRef:
    pass


def _make_clip(name, url=None, in_frame=0, duration=100, rate=24.0, metadata=None):
    clip = MagicMock()
    clip.name = name
    clip.metadata = metadata or {}

    if url:
        ref = MockExternalRef(url)
    else:
        ref = MockMissingRef()

    clip.media_reference = ref
    clip.source_range = MockTimeRange(in_frame, duration, rate)
    return clip


def _make_track(name, kind, clips):
    track = MagicMock()
    track.name = name
    track.kind = kind
    track.__iter__ = lambda self: iter(clips)
    return track


def _make_timeline(name, tracks, rate=24.0, duration_value=1000):
    timeline = MagicMock()
    timeline.name = name
    timeline.global_start_time = MockRationalTime(0, rate)
    timeline.duration.return_value = MockRationalTime(duration_value, rate)
    timeline.tracks = tracks
    return timeline


class TestOtioParser(unittest.TestCase):

    @patch("src.parser.otio")
    def test_simple_three_clip_timeline(self, mock_otio):
        mock_otio.schema.Clip = MagicMock
        mock_otio.schema.Timeline = MagicMock
        mock_otio.schema.MissingReference = MockMissingRef

        clips = [
            _make_clip("SH010_comp_v001", "/media/sh010.exr", 1001, 100),
            _make_clip("SH020_comp_v001", "/media/sh020.exr", 1001, 150),
            _make_clip("SH030_comp_v001", "/media/sh030.exr", 1001, 80),
        ]
        track = _make_track("V1", "Video", clips)
        timeline = _make_timeline("Edit_v3", [track], 24.0, 330)

        # Make isinstance checks work
        for c in clips:
            c.__class__ = mock_otio.schema.Clip
        timeline.__class__ = mock_otio.schema.Timeline

        mock_otio.adapters.read_from_file.return_value = timeline

        from src.parser import parse_timeline
        result = parse_timeline("/fake/timeline.otio")

        self.assertEqual(result["timeline_name"], "Edit_v3")
        self.assertEqual(result["frame_rate"], 24.0)
        self.assertEqual(len(result["tracks"]), 1)
        self.assertEqual(len(result["tracks"][0]["clips"]), 3)
        self.assertEqual(result["tracks"][0]["clips"][0]["clip_name"], "SH010_comp_v001")
        self.assertEqual(result["tracks"][0]["clips"][0]["in_frame"], 1001)
        self.assertEqual(result["tracks"][0]["clips"][0]["duration_frames"], 100)

    @patch("src.parser.otio")
    def test_multi_track_timeline(self, mock_otio):
        mock_otio.schema.Clip = MagicMock
        mock_otio.schema.Timeline = MagicMock
        mock_otio.schema.MissingReference = MockMissingRef

        v1_clips = [_make_clip("bg_plate", "/media/bg.exr", 0, 200)]
        v2_clips = [_make_clip("fg_element", "/media/fg.exr", 0, 150)]
        v1 = _make_track("V1", "Video", v1_clips)
        v2 = _make_track("V2", "Video", v2_clips)
        timeline = _make_timeline("MultiTrack", [v1, v2], 24.0, 200)

        for c in v1_clips + v2_clips:
            c.__class__ = mock_otio.schema.Clip
        timeline.__class__ = mock_otio.schema.Timeline

        mock_otio.adapters.read_from_file.return_value = timeline

        from src.parser import parse_timeline
        result = parse_timeline("/fake/multi.otio")

        self.assertEqual(len(result["tracks"]), 2)
        self.assertEqual(result["tracks"][0]["name"], "V1")
        self.assertEqual(result["tracks"][1]["name"], "V2")

    @patch("src.parser.otio")
    def test_offline_clip_no_media(self, mock_otio):
        mock_otio.schema.Clip = MagicMock
        mock_otio.schema.Timeline = MagicMock
        mock_otio.schema.MissingReference = MockMissingRef

        clip = _make_clip("offline_shot", None, 0, 50)
        clip.__class__ = mock_otio.schema.Clip
        track = _make_track("V1", "Video", [clip])
        timeline = _make_timeline("Offline", [track], 24.0, 50)
        timeline.__class__ = mock_otio.schema.Timeline

        mock_otio.adapters.read_from_file.return_value = timeline

        from src.parser import parse_timeline
        result = parse_timeline("/fake/offline.otio")

        self.assertIsNone(result["tracks"][0]["clips"][0]["source_uri"])

    @patch("src.parser.otio")
    def test_shot_name_inference(self, mock_otio):
        mock_otio.schema.Clip = MagicMock
        mock_otio.schema.Timeline = MagicMock
        mock_otio.schema.MissingReference = MockMissingRef

        clip = _make_clip("SH010_comp_v003", "/media/sh010.exr", 0, 100)
        clip.__class__ = mock_otio.schema.Clip
        track = _make_track("V1", "Video", [clip])
        timeline = _make_timeline("Test", [track], 24.0, 100)
        timeline.__class__ = mock_otio.schema.Timeline

        mock_otio.adapters.read_from_file.return_value = timeline

        from src.parser import parse_timeline
        result = parse_timeline("/fake/test.otio")

        self.assertEqual(result["tracks"][0]["clips"][0].get("shot_name"), "SH010")

    @patch("src.parser.otio")
    def test_timeline_name_default(self, mock_otio):
        mock_otio.schema.Clip = MagicMock
        mock_otio.schema.Timeline = MagicMock
        mock_otio.schema.MissingReference = MockMissingRef

        timeline = _make_timeline(None, [], 24.0, 0)
        timeline.name = None
        timeline.__class__ = mock_otio.schema.Timeline

        mock_otio.adapters.read_from_file.return_value = timeline

        from src.parser import parse_timeline
        result = parse_timeline("/fake/unnamed.otio")

        self.assertEqual(result["timeline_name"], "untitled")


if __name__ == "__main__":
    unittest.main()
