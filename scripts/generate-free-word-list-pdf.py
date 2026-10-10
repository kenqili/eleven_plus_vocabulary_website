#!/usr/bin/env python3
"""Render data/free-word-list.json to public/free-11-plus-vocabulary-words.pdf.

Run locally whenever the starter list changes (it is a committed artifact,
not a build product — link-preview crawlers and parents download the file
as-is). Requires fpdf2 (`pip install fpdf2`).
"""
import json
import os

from fpdf import FPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVEL_NAMES = {
    0: "Level 0 · everyday words",
    1: "Level 1 · common words",
    2: "Level 2 · less common",
    3: "Level 3 · uncommon",
    4: "Level 4 · literary",
    5: "Level 5 · rare",
}


class WordList(FPDF):
    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-15)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(130, 130, 130)
        self.cell(
            0,
            10,
            f"MineWords · 11pluswords.com · page {self.page_no()}",
            align="C",
        )


def main():
    with open(os.path.join(ROOT, "data", "free-word-list.json")) as handle:
        data = json.load(handle)

    pdf = WordList(format="A4")
    pdf.set_compression(False)
    pdf.set_title("MineWords — 100 free 11+ vocabulary words")
    pdf.set_author("MineWords")
    pdf.set_subject("Free 11+ vocabulary starter list with meanings")
    pdf.set_auto_page_break(True, margin=20)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 24)
    pdf.set_text_color(21, 52, 102)
    pdf.cell(0, 12, "100 11+ words to start with", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 12)
    pdf.set_text_color(60, 60, 60)
    pdf.multi_cell(
        0,
        7,
        "A starter sample from MineWords with plain meanings. "
        "Print it, tick words off together, then practise them free for "
        "7 days at 11pluswords.com.",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    for group in data["groups"]:
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(21, 52, 102)
        pdf.cell(
            0,
            10,
            f"{LEVEL_NAMES[group['band']]} ({len(group['words'])} words)",
            new_x="LMARGIN",
            new_y="NEXT",
        )
        for entry in group["words"]:
            pdf.set_font("Helvetica", "", 11)
            pdf.set_text_color(20, 20, 20)
            pdf.multi_cell(
                0,
                6,
                f"**{entry['word']}**  {entry['definition']}",
                markdown=True,
                new_x="LMARGIN",
                new_y="NEXT",
            )
        pdf.ln(3)

    out = os.path.join(ROOT, "public", "free-11-plus-vocabulary-words.pdf")
    pdf.output(out)
    print(f"{data['count']} words -> public/free-11-plus-vocabulary-words.pdf")


if __name__ == "__main__":
    main()
