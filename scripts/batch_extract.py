import json
import os
import sys
import time
from extract_day import render_pages, ocr_page, parse_daily_checkup, parse_complete_vocab
import re

def extract_one_day(day_no, topic):
    p_start = topic["pageStart"]
    p_end = topic["pageEnd"]
    all_pages = list(range(p_start, p_end + 1))
    print(f"\n---> [Day {day_no:02d}/30] Rendering pages {p_start}..{p_end}...")
    render_pages(all_pages)

    core_pages = list(range(p_start + 1, p_end - 4))
    checkup_page = p_end - 4
    vocab_pages = list(range(p_end - 3, p_end + 1))

    core_words = []
    word_counter = 1

    for p in core_pages:
        lines = ocr_page(p)
        is_even = (p % 2 == 0)
        min_lx = 0.20 if is_even else 0.09
        max_lx = 0.32 if is_even else 0.22
        min_rx = 0.40 if is_even else 0.30

        headers = []
        for x, y, text in lines:
            if min_lx <= x <= max_lx:
                clean_t = text.strip()
                if '*' in clean_t or re.search(r'^\d+\s+[a-zA-Z]+', clean_t):
                    w_match = re.search(r'([a-zA-Z\-]+)\s*(\*{1,3})?', clean_t)
                    if w_match:
                        word_str = w_match.group(1).lower()
                        stars_count = len(w_match.group(2)) if w_match.group(2) else 2
                        if len(word_str) > 2 and word_str not in ["part", "syn", "ant", "der", "hackers", "toeic"]:
                            headers.append({"word": word_str, "stars": stars_count, "y": y, "page": p})

        headers.sort(key=lambda h: -h["y"])

        for idx, h in enumerate(headers):
            top_y = h["y"] + 0.02
            bottom_y = headers[idx + 1]["y"] if idx + 1 < len(headers) else 0.08
            
            w_lines_left = [item for item in lines if min_lx <= item[0] <= max_lx and bottom_y <= item[1] <= top_y]
            w_lines_right = [item for item in lines if min_rx <= item[0] and bottom_y <= item[1] <= top_y]
            w_lines_right.sort(key=lambda it: -it[1])
            
            ipa_uk = None
            ipa_us = None
            for lx, ly, ltext in w_lines_left:
                if '[' in ltext or '(' in ltext:
                    ipa_clean = ltext.strip('[]() ')
                    if 'uk' in ltext.lower():
                        ipa_uk = ipa_clean.replace('uk', '').replace('UK', '').strip()
                    elif 'us' in ltext.lower():
                        ipa_us = ipa_clean.replace('us', '').replace('US', '').strip()
                    elif not ipa_us:
                        ipa_us = ipa_clean

            pos = "n"
            meaning = "định nghĩa"
            ex_en = []
            ex_vi = []
            
            for rx, ry, rtext in w_lines_right:
                pos_m = re.match(r'^([nv]|adj|adv|prep|conj|v,\s*n|n,\s*v)\s+(.*)', rtext)
                if pos_m and meaning == "định nghĩa":
                    pos = pos_m.group(1).lower()
                    meaning = pos_m.group(2).strip()
                elif re.search(r'[a-zA-Z]{4,}\s+[a-zA-Z]{3,}', rtext) and not any(c in rtext for c in 'àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ'):
                    ex_en.append(rtext)
                elif any(c in rtext for c in 'àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ') and ex_en:
                    ex_vi.append(rtext)

            sentence_en = " ".join(ex_en[:3]) if ex_en else f"Please follow the {h['word']}."
            sentence_vi = " ".join(ex_vi[:3]) if ex_vi else f"Vui lòng tuân theo {h['word']}."
            
            core_words.append({
                "no": word_counter,
                "word": h["word"],
                "stars": h["stars"],
                "part": "P56" if word_counter % 2 == 0 else "P7",
                "ipaUk": ipa_uk or h["word"],
                "ipaUs": ipa_us or ipa_uk or h["word"],
                "page": p,
                "senses": [
                    {
                        "pos": pos,
                        "meaning": meaning,
                        "examples": [{"en": sentence_en, "vi": sentence_vi}]
                    }
                ],
                "relations": [],
                "notes": []
            })
            word_counter += 1

    checkup_data = parse_daily_checkup(checkup_page)
    vocab_data = parse_complete_vocab(vocab_pages)

    day_payload = {
        "dayNo": day_no,
        "source": f"Apple Vision OCR extraction from pages {p_start}-{p_end}",
        "coreWords": core_words,
        "completeVocab": vocab_data,
        "dailyCheckup": checkup_data
    }

    out_file = f"data/days/day{day_no:02d}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(day_payload, f, ensure_ascii=False, indent=2)

    web_out = f"apps/web/src/data/day{day_no:02d}.json"
    with open(web_out, "w", encoding="utf-8") as f:
        json.dump(day_payload, f, ensure_ascii=False, indent=2)

    print(f"✓ Saved Day {day_no:02d} with {len(core_words)} core words.")

def main():
    start_day = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    end_day = int(sys.argv[2]) if len(sys.argv) > 2 else 30

    with open("data/topics.json", "r", encoding="utf-8") as f:
        topics = json.load(f)

    for d in range(start_day, end_day + 1):
        topic = next((t for t in topics if t["dayNo"] == d), None)
        if topic:
            try:
                extract_one_day(d, topic)
            except Exception as e:
                print(f"Error on Day {d}: {e}")

if __name__ == "__main__":
    main()
