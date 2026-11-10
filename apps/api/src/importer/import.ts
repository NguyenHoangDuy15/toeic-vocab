import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../config.js';
import { seedDatabase } from '../seed/seed.js';

/**
 * Renders a range of PDF pages to JPEG using macOS native PDFKit (compiles helper on the fly if needed)
 */
export function renderPdfPages(pages: number[], outDir: string): string[] {
  fs.mkdirSync(outDir, { recursive: true });
  const binPath = '/tmp/render_pdf_custom';
  const srcPath = '/tmp/render_pdf_custom.m';

  if (!fs.existsSync(binPath)) {
    const objcCode = `
#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#import <AppKit/AppKit.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        if (argc < 4) return 1;
        NSString *pdfPath = [NSString stringWithUTF8String:argv[1]];
        NSString *outDir = [NSString stringWithUTF8String:argv[2]];
        NSURL *url = [NSURL fileURLWithPath:pdfPath];
        PDFDocument *doc = [[PDFDocument alloc] initWithURL:url];
        if (!doc) return 2;
        for (int i = 3; i < argc; i++) {
            NSInteger p = atoi(argv[i]) - 1;
            if (p >= 0 && p < [doc pageCount]) {
                PDFPage *page = [doc pageAtIndex:p];
                NSRect bounds = [page boundsForBox:kPDFDisplayBoxMediaBox];
                NSSize size = NSMakeSize(bounds.size.width * 1.8, bounds.size.height * 1.8);
                NSImage *image = [page thumbnailOfSize:size forBox:kPDFDisplayBoxMediaBox];
                CGImageRef cgRef = [image CGImageForProposedRect:NULL context:nil hints:nil];
                NSBitmapImageRep *newRep = [[NSBitmapImageRep alloc] initWithCGImage:cgRef];
                NSData *jpgData = [newRep representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor: @0.85}];
                NSString *outPath = [NSString stringWithFormat:@"%@/page_%ld.jpg", outDir, (long)(p+1)];
                [jpgData writeToFile:outPath atomically:YES];
            }
        }
    }
    return 0;
}
`;
    fs.writeFileSync(srcPath, objcCode);
    execFileSync('clang', [
      '-framework',
      'Foundation',
      '-framework',
      'PDFKit',
      '-framework',
      'AppKit',
      srcPath,
      '-o',
      binPath,
    ]);
  }

  execFileSync(binPath, [config.pdfPath, outDir, ...pages.map(String)]);
  return pages.map((p) => path.join(outDir, `page_${p}.jpg`));
}

export async function extractDayWithGemini(dayNo: number): Promise<{
  savedFile: string;
  coreWordsCount: number;
}> {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trong file .env');
  }

  const topicsPath = path.join(config.dataDir, 'topics.json');
  const topics: Array<{ dayNo: number; pageStart: number; pageEnd: number }> = JSON.parse(
    fs.readFileSync(topicsPath, 'utf-8')
  );
  const topic = topics.find((t) => t.dayNo === dayNo);
  if (!topic) {
    throw new Error(`Không tìm thấy cấu hình trang cho Day ${dayNo}`);
  }

  const pages: number[] = [];
  for (let p = topic.pageStart + 1; p <= topic.pageEnd; p++) {
    pages.push(p);
  }

  const pagesDir = path.join(config.dataDir, 'pages');
  const imgPaths = renderPdfPages(pages, pagesDir);

  const inlineParts = imgPaths
    .filter((f) => fs.existsSync(f))
    .map((f) => ({
      inline_data: {
        mime_type: 'image/jpeg',
        data: fs.readFileSync(f).toString('base64'),
      },
    }));

  const prompt = `Bạn là bộ trích xuất dữ liệu chính xác từ sách Hackers TOEIC Vocabulary (Day ${dayNo}).
Hãy đọc tất cả các trang ảnh đính kèm và trả về DUY NHẤT một JSON hợp lệ theo đúng cấu trúc của data/days/day01.json:
{
  "dayNo": ${dayNo},
  "coreWords": [
    {
      "no": 1,
      "word": "...",
      "stars": 3,
      "part": "P56",
      "ipaUk": "...",
      "ipaUs": "...",
      "page": ${topic.pageStart + 1},
      "senses": [{ "pos": "n", "meaning": "...", "examples": [{ "en": "... **word** ...", "vi": "..." }] }],
      "relations": [{ "type": "der|syn|ant", "text": "...", "pos": "...", "meaning": "..." }],
      "notes": [{ "type": "collocation|confusable|grammar|tip", "title": "...", "content": "..." }]
    }
  ],
  "completeVocab": {
    "basic": { "LC": [["word", "pos", "meaning"]], "RC": [] },
    "l800": { "LC": [], "P56": [], "P7": [] },
    "l900": { "LC": [], "P56": [], "P7": [] }
  },
  "dailyCheckup": {
    "page": ${topic.pageEnd - 4},
    "groups": [
      {
        "instruction": "...",
        "options": [{ "key": "a", "text": "..." }],
        "questions": [{ "no": 1, "prompt": "...", "answer": "e" }]
      }
    ]
  }
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...inlineParts] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini API lỗi (${resp.status}): ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = JSON.parse(rawText);

  const outFile = path.join(
    config.dataDir,
    'days',
    `day${String(dayNo).padStart(2, '0')}.json`
  );
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2));

  await seedDatabase();
  return {
    savedFile: outFile,
    coreWordsCount: Array.isArray(parsed.coreWords) ? parsed.coreWords.length : 0,
  };
}

// CLI entrypoint: `npm run import:pdf -w apps/api -- 2`
if (import.meta.url === `file://${process.argv[1]}`) {
  const dayArg = Number(process.argv[2] ?? 2);
  extractDayWithGemini(dayArg)
    .then((res) => {
      console.log(`Extracted Day ${dayArg}:`, res);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

