import json
import os
import re
import sys
import subprocess
from extract_day import render_pages, ocr_page, parse_daily_checkup, parse_complete_vocab

ANCHORS = {
    19: 312,
    20: 328,
    21: 346,
    22: 364,
    23: 380,
    24: 394,
    25: 410,
    26: 426,
    27: 440,
    28: 454,
    29: 470,
    30: 484
}

SKIP_WORDS = {
    'part', 'syn', 'ant', 'der', 'hackers', 'toeic', 'daily', 'checkup', 
    'day', 'cao', 'trung', 'bình', 'tỷ', 'xuất', 'hiện', 'bài', 'thi', 'dạng',
    'thức', 'mới', 'tự', 'học', 'mỗi', 'ngày'
}

def extract_day(day_no, checkup_page, topic_meta):
    core_pages = list(range(checkup_page - 10, checkup_page))
    vocab_pages = list(range(checkup_page + 1, checkup_page + 5))
    all_pages = core_pages + [checkup_page] + vocab_pages

    print(f"\n=======================================================")
    print(f"[*] Day {day_no:02d}: Processing pages {core_pages[0]}..{vocab_pages[-1]}...")
    print(f"=======================================================")
    render_pages(all_pages)

    core_words = []
    word_counter = 1

    for p in core_pages:
        lines = ocr_page(p)
        headers = []
        for x, y, text in lines:
            if y > 0.12 and 0.08 <= x <= 0.32:
                clean_t = text.strip()
                if 'tỷ lệ' in clean_t or 'tỷ lộ' in clean_t:
                    continue
                w_match = re.search(r'([a-zA-Z\-]{3,})\s*(\*{1,3})', clean_t)
                if not w_match:
                    w_match = re.search(r'^\d+[\s\.\,\-]+([a-zA-Z\-]{3,})', clean_t)
                if w_match:
                    w = w_match.group(1).lower()
                    stars = len(w_match.group(2)) if len(w_match.groups()) > 1 and w_match.group(2) else 2
                    if w not in SKIP_WORDS and not any(sw in w for sw in ['hackers', 'toeic']):
                        headers.append({'x': x, 'y': y, 'word': w, 'stars': stars, 'page': p})

        headers.sort(key=lambda h: -h['y'])

        for idx, h in enumerate(headers):
            top_y = h['y'] + 0.02
            bottom_y = headers[idx + 1]['y'] if idx + 1 < len(headers) else 0.12

            left_lines = [item for item in lines if item[0] <= h['x'] + 0.10 and bottom_y <= item[1] <= top_y]
            right_lines = [item for item in lines if item[0] > h['x'] + 0.10 and bottom_y <= item[1] <= top_y]
            right_lines.sort(key=lambda it: -it[1])

            ipa_uk = None
            ipa_us = None
            for lx, ly, ltext in left_lines:
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

            for rx, ry, rtext in right_lines:
                pos_m = re.match(r'^([nv]|adj|adv|prep|conj|v,\s*n|n,\s*v)\s+(.*)', rtext)
                if pos_m and meaning == "định nghĩa":
                    pos = pos_m.group(1).lower()
                    meaning = pos_m.group(2).strip()
                elif re.search(r'[a-zA-Z]{4,}\s+[a-zA-Z]{3,}', rtext) and not any(c in rtext for c in 'àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ'):
                    ex_en.append(rtext)
                elif any(c in rtext for c in 'àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ') and ex_en:
                    ex_vi.append(rtext)

            sentence_en = " ".join(ex_en[:3]) if ex_en else f"Please review the {h['word']}."
            sentence_vi = " ".join(ex_vi[:3]) if ex_vi else f"Vui lòng xem xét {h['word']}."

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

    out_file = f"data/days/day{day_no:02d}.json"
    payload = {
        "dayNo": day_no,
        "titleVi": topic_meta.get("titleVi", f"Chủ đề {day_no}"),
        "titleEn": topic_meta.get("titleEn", f"Topic {day_no}"),
        "category": topic_meta.get("category", "General"),
        "coreWords": core_words,
        "dailyCheckup": checkup_data["groups"],
        "completeVocab": {
            "basic": [
                {"word": item[0], "pos": item[1], "meaning": item[2], "section": sec}
                for sec in ["LC", "RC"]
                for item in vocab_data.get("basic", {}).get(sec, [])
            ],
            "score800": [
                {"word": item[0], "pos": item[1], "meaning": item[2], "section": sec}
                for sec in ["LC", "P56", "P7"]
                for item in vocab_data.get("l800", {}).get(sec, [])
            ],
            "score900": [
                {"word": item[0], "pos": item[1], "meaning": item[2], "section": sec}
                for sec in ["LC", "P56", "P7"]
                for item in vocab_data.get("l900", {}).get(sec, [])
            ]
        }
    }

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[SUCCESS] Day {day_no:02d} saved to {out_file} with {len(core_words)} core words, {len(payload['dailyCheckup'])} checkup groups, {len(payload['completeVocab']['basic'])} basic, {len(payload['completeVocab']['score800'])} 800, {len(payload['completeVocab']['score900'])} 900")

def main():
    with open("data/topics.json", "r", encoding="utf-8") as f:
        topics = json.load(f)
    topics_map = {t["dayNo"]: t for t in topics}

    days_to_run = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else sorted(ANCHORS.keys())
    for d in days_to_run:
        if d in ANCHORS:
            extract_day(d, ANCHORS[d], topics_map.get(d, {}))

if __name__ == "__main__":
    main()
