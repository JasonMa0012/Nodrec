import runpy
import unittest
from pathlib import Path


query = runpy.run_path(str(Path(__file__).with_name("query-input.py")))


class QueryTests(unittest.TestCase):
    def test_optional_columns_preserve_zero_and_null(self):
        header = {"columns": {"mouse": ["t", "x", "wheel"]}, "defaults": {"wheel": None}}
        self.assertEqual(query["decode"](["mouse", 10, 0], header),
                         {"type": "mouse", "t": 10, "x": 0, "wheel": None})
        self.assertEqual(query["decode"](["mouse", 10, 0, 0], header)["wheel"], 0)

    def test_moves_stop_at_actions_devices_and_state_boundaries(self):
        mouse = dict(type="mouse", button_flags=0, raw_buttons=0, button_data=0, wheel=None,
                     flags=0, device=1, cursor_px=[2, 3], t=1)
        click = dict(mouse, button_flags=1)
        wheel = dict(mouse, button_flags=1024, button_data=120, wheel=120)
        key = {"type": "key", "t": 2}
        state = {"type": "state", "t": 3}
        rows = [mouse, dict(mouse, t=2, cursor_px=[4, 5]), click, wheel, key, mouse,
                dict(mouse, device=2), state]
        summary = list(query["actions"](rows))
        self.assertEqual(summary[0], dict(type="move", device=1, flags=0, start=1, end=2,
                                          from_px=[2, 3], to_px=[4, 5], reports=2))
        self.assertEqual(summary[1:4], [click, wheel, key])
        self.assertEqual([row["device"] for row in summary[4:6]], [1, 2])
        self.assertEqual(summary[6:], [state])


if __name__ == "__main__":
    unittest.main()
