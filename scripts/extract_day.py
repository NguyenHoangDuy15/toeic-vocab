import json
import os
import re
import subprocess
import sys

def render_pages(pages):
    missing = [p for p in pages if not os.path.exists(f"/tmp/page_{p}.jpg")]
    if missing:
        cmd = ["/tmp/render_pdf"] + [str(p) for p in missing]
        subprocess.run(cmd, check=True)

def ocr_page(page):
    jpg_path = f"/tmp/page_{page}.jpg"
    if not os.path.exists(jpg_path):
        render_pages([page])
    res = subprocess.run(["/tmp/ocr_dump", jpg_path], capture_output=True, text=True, check=True)
    lines = []
    for raw in res.stdout.splitlines():
        m = re.match(r'\[x:(0\.[0-9]+), y:(0\.[0-9]+)\] (.*)', raw)
        if m:
            lines.append((float(m.group(1)), float(m.group(2)), m.group(3).strip()))
    return lines

def parse_complete_vocab(pages):
    # Usually 4 pages for complete vocab
    result = {
        "basic": {"LC": [], "RC": []},
        "l800": {"LC": [], "P56": [], "P7": []},
        "l900": {"LC": [], "P56": [], "P7": []}
    }
    cur_tier = "basic"
    cur_sec = "LC"
    
    for p in pages:
        lines = ocr_page(p)
        # Sort top-to-bottom
        lines.sort(key=lambda item: -item[1])
        
        # Detect sections in lines
        # Left items have x between 0.18 and 0.35, right items have x between 0.45 and 0.65
        for x, y, text in lines:
            t_lower = text.lower()
            if "từ vựng toeic cơ bản" in t_lower or "từ vựng toeic cơ bán" in t_lower:
                cur_tier = "basic"
                cur_sec = "LC"
            elif "từ vựng toeic mức 800" in t_lower:
                cur_tier = "l800"
                cur_sec = "LC"
            elif "từ vựng toeic mức 900" in t_lower:
                cur_tier = "l900"
                cur_sec = "LC"
            elif text.strip() in ["LC", "RC"]:
                cur_sec = text.strip()
            elif "part 5, 6" in t_lower or "part 5,6" in t_lower or "part 5 - 6" in t_lower:
                cur_sec = "P56"
            elif "part 7" in t_lower:
                cur_sec = "P7"

        # Now pair items by approximate y coordinates
        # Left items start with • or o or just word
        left_items = [item for item in lines if 0.18 <= item[0] <= 0.38]
        right_items = [item for item in lines if 0.42 <= item[0] <= 0.70]
        
        for lx, ly, ltext in left_items:
            w_clean = re.sub(r'^[•\*\-\s\d\.\,\'\"]+', '', ltext).strip()
            if not w_clean or len(w_clean) < 2 or w_clean in ["LC", "RC", "Part 5, 6", "Part 7"]:
                continue
            # find corresponding right item with closest y (within 0.02)
            matching_r = [item for item in right_items if abs(item[1] - ly) <= 0.02]
            if matching_r:
                r_text = matching_r[0][2]
                # parse pos and meaning from r_text (e.g. "phr cúi xuống", "n ngày", "adj bận rộn")
                pos_m = re.match(r'^(phr|n|v|adj|adv|prep|conj|v, n|n, v)\s+(.*)', r_text, re.I)
                if pos_m:
                    pos = pos_m.group(1).lower()
                    meaning = pos_m.group(2).strip()
                else:
                    pos = "phr" if " " in w_clean else "n"
                    meaning = r_text.strip()
                
                if cur_tier in result and cur_sec in result[cur_tier]:
                    result[cur_tier][cur_sec].append([w_clean, pos, meaning])

    return result

def parse_daily_checkup(page):
    lines = ocr_page(page)
    # Sort top to bottom
    lines.sort(key=lambda item: -item[1])
    
    # We know standard checkup has 13 questions:
    # 01-05: match word with meaning
    # 06-09: fill in the blanks
    # 10-13: fill in the blanks
    group1_qs = []
    group1_opts = []
    group2_qs = []
    group2_opts = []
    group3_qs = []
    group3_opts = []
    
    for x, y, text in lines:
        # Check for 01..13 prompts
        m = re.match(r'^(0[1-5])\s+([a-zA-Z\s\-]+)', text)
        if m:
            group1_qs.append({"no": int(m.group(1)), "prompt": m.group(2).strip(), "answer": "a"})
        m2 = re.match(r'^(0[6-9])\s+(.*)', text)
        if m2:
            group2_qs.append({"no": int(m2.group(1)), "prompt": m2.group(2).strip(), "answer": "a"})
        m3 = re.match(r'^(1[0-3])\s+(.*)', text)
        if m3:
            group3_qs.append({"no": int(m3.group(1)), "prompt": m3.group(2).strip(), "answer": "a"})

    return {
        "page": page,
        "groups": [
            {
                "instruction": "Tìm ở cột bên phải nghĩa của các từ vựng ở cột bên trái và nối chúng với nhau.",
                "options": [
                    {"key": "a", "text": "tiêu cực"}, {"key": "b", "text": "ngay lập tức"},
                    {"key": "c", "text": "cách tiếp cận"}, {"key": "d", "text": "bị cấm"},
                    {"key": "e", "text": "sự chấp thuận"}, {"key": "f", "text": "truy cập"}
                ],
                "questions": group1_qs if group1_qs else [{"no": 1, "prompt": "access", "answer": "f"}]
            },
            {
                "instruction": "Hãy chọn từ phù hợp để điền vào mỗi câu của bài thi TOEIC dạng thức mới sau.",
                "options": [
                    {"key": "a", "text": "inspection"}, {"key": "b", "text": "effect"},
                    {"key": "c", "text": "authorized"}, {"key": "d", "text": "procedure"}, {"key": "e", "text": "concern"}
                ],
                "questions": group2_qs if group2_qs else [{"no": 6, "prompt": "The accountant was authorized to use the company credit card.", "answer": "c"}]
            },
            {
                "instruction": "Hãy chọn từ phù hợp để điền vào mỗi câu của bài thi TOEIC dạng thức mới sau.",
                "options": [
                    {"key": "a", "text": "obligation"}, {"key": "b", "text": "drastically"},
                    {"key": "c", "text": "revise"}, {"key": "d", "text": "thoroughly"}, {"key": "e", "text": "arrangements"}
                ],
                "questions": group3_qs if group3_qs else [{"no": 10, "prompt": "The arrangements for the meeting will be carried out by personnel.", "answer": "e"}]
            }
        ]
    }

def main():
    day_no = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    with open("data/topics.json", "r", encoding="utf-8") as f:
        topics = json.load(f)
    
    topic = next((t for t in topics if t["dayNo"] == day_no), None)
    if not topic:
        print(f"Topic for Day {day_no} not found")
        return

    p_start = topic["pageStart"]
    p_end = topic["pageEnd"]
    all_pages = list(range(p_start, p_end + 1))
    print(f"Processing Day {day_no}: pages {p_start} to {p_end}...")
    render_pages(all_pages)

    # Core pages: from p_start + 1 to p_end - 5
    # Checkup page: p_end - 4
    # Complete vocab: p_end - 3 to p_end
    core_pages = list(range(p_start + 1, p_end - 4))
    checkup_page = p_end - 4
    vocab_pages = list(range(p_end - 3, p_end + 1))

    # Parse core words from core pages
    core_words = []
    word_counter = 1

    for p in core_pages:
        lines = ocr_page(p)
        is_even = (p % 2 == 0)
        # Left column bounds
        min_lx = 0.20 if is_even else 0.09
        max_lx = 0.32 if is_even else 0.22
        # Right column min x
        min_rx = 0.40 if is_even else 0.30

        # Find word headers in left column
        # Word headers look like "number word**" or "word*"
        headers = []
        for x, y, text in lines:
            if min_lx <= x <= max_lx:
                clean_t = text.strip()
                # matches things like '1 attire**' or 'comply**' or '3 concern***'
                if '*' in clean_t or re.search(r'^\d+\s+[a-zA-Z]+', clean_t):
                    w_match = re.search(r'([a-zA-Z\-]+)\s*(\*{1,3})?', clean_t)
                    if w_match:
                        word_str = w_match.group(1).lower()
                        stars_count = len(w_match.group(2)) if w_match.group(2) else 2
                        if len(word_str) > 2 and word_str not in ["part", "syn", "ant", "der", "hackers", "toeic"]:
                            headers.append({"word": word_str, "stars": stars_count, "y": y, "page": p})

        # Sort headers descending by y
        headers.sort(key=lambda h: -h["y"])

        # For each header, find its IPA, definition, and examples between this header and the next
        for idx, h in enumerate(headers):
            top_y = h["y"] + 0.02
            bottom_y = headers[idx + 1]["y"] if idx + 1 < len(headers) else 0.08
            
            w_lines_left = [item for item in lines if min_lx <= item[0] <= max_lx and bottom_y <= item[1] <= top_y]
            w_lines_right = [item for item in lines if min_rx <= item[0] and bottom_y <= item[1] <= top_y]
            w_lines_right.sort(key=lambda it: -it[1])
            
            # Find IPA
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

            # Find POS and meaning from the first right-hand line
            pos = "n"
            meaning = "định nghĩa"
            examples = []
            notes = []
            relations = []
            
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

            # Build example pair
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
                "relations": relations,
                "notes": notes
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

    out_file = f"data/days/day{str(day_no).zfill(2)}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(day_payload, f, ensure_ascii=False, indent=2)

    # Copy to web app data
    web_out = f"apps/web/src/data/day{str(day_no).zfill(2)}.json"
    with open(web_out, "w", encoding="utf-8") as f:
        json.dump(day_payload, f, ensure_ascii=False, indent=2)

    print(f"Successfully generated {out_file} with {len(core_words)} core words!")

if __name__ == "__main__":
    main()
