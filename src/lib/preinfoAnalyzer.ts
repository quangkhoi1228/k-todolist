/**
 * Phân tích yêu cầu sơ bộ (pre-sale) — core logic dùng chung cho API route
 * `/api/data/preinfo-analyze`.
 *
 * Gồm:
 * - `analyzePreinfo()`: LLM detect scope + next actions + gợi ý tính năng (multi-choice).
 * - Fallback rule-based khi LLM không cấu hình / lỗi — vẫn trả cấu trúc đầy đủ.
 */

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

export interface PreinfoAnalysis {
  scope: string[];
  nextActions: string[];
  featureSuggestions: string[];
}

/** Tránh LLM trả list khổng lồ — cắt an toàn trước khi lưu/hiển thị. */
export function clampAnalysis(a: Partial<PreinfoAnalysis> | null | undefined): PreinfoAnalysis {
  const clean = (arr: unknown, max: number): string[] =>
    Array.isArray(arr)
      ? arr
          .map((x) => (typeof x === "string" ? x.trim() : x?.title ? String((x as any).title).trim() : String(x ?? "").trim()))
          .filter(Boolean)
          .slice(0, max)
      : [];
  return {
    scope: clean(a?.scope, 40),
    nextActions: clean(a?.nextActions, 40),
    featureSuggestions: clean(a?.featureSuggestions, 30),
  };
}

/** Strip SSE `data: [DONE]` trailer mà một số proxy nối thêm. */
function cleanRawResponse(raw: string): string {
  const idx = raw.lastIndexOf("data: [DONE]");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

/** Parse LLM response — content/reasoning_content/delta/Anthropic/Ollama (giống projectSummaryGenerator). */
function extractLLMContent(rawText: string): string | null {
  const cleaned = cleanRawResponse(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (choices?.[0]) {
      const msg = choices[0].message as Record<string, unknown> | undefined;
      if (msg?.content && typeof msg.content === "string" && msg.content.length > 0) return msg.content;
      const reasoning = msg?.reasoning_content as string | undefined;
      if ((!msg?.content || (typeof msg.content === "string" && msg.content.length === 0)) && reasoning && reasoning.length > 0) return reasoning;
      const delta = choices[0].delta as Record<string, unknown> | undefined;
      if (delta?.content && typeof delta.content === "string" && delta.content.length > 0) return delta.content;
      if (choices[0].text && typeof choices[0].text === "string") return choices[0].text;
    }
    const claudeContent = parsed.content as string | Array<Record<string, unknown>> | undefined;
    if (typeof claudeContent === "string" && claudeContent.length > 0) return claudeContent;
    if (Array.isArray(claudeContent)) {
      for (const block of claudeContent) {
        if (block.type === "text" && typeof block.text === "string") return block.text;
      }
    }
    if (parsed.response && typeof parsed.response === "string") return parsed.response;
  } catch {}

  const cm = cleaned.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (cm) return cm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const tm = cleaned.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (tm) return tm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const rm = cleaned.match(/"reasoning_content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (rm) return rm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return null;
}

/** Gọi LLM chat completions, trả raw text (hoặc null khi lỗi). */
async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 2048, timeoutMs = 45000): Promise<string | null> {
  if (!LLM_KEY || !LLM_BASE) return null;
  try {
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[PreinfoAnalyze] LLM returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error("[PreinfoAnalyze] LLM call error:", err);
    return null;
  }
}

/** Parse 1 JSON object từ LLM response (bỏ markdown/code block nếu có). */
function extractJsonObject(raw: string): any | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

// ─── Fallback rule-based ────────────────────────────────────

const SCOPE_KEYWORDS: Array<{ kws: string[]; titles: string[] }> = [
  {
    kws: ["migrat", "chuyển", "di dời", "chuyển đổi", "nâng cấp", "upgrade", "phan tach", "phân tách", "split"],
    titles: [
      "Khảo sát & lập kế hoạch migration (đánh giá hiện trạng, rủi ro, phương án)",
      "Thiết kế kiến trúc đích + giải pháp migration chi tiết",
      "Thực hiện migration dữ liệu & workload lên hạ tầng đích",
      "Kiểm thử, nghiệm thu và bàn giao sau migration",
    ],
  },
  {
    kws: ["firewall", "fortigate", "palo alto", "waf", "tường lửa", "bảo mật", "security", "quota attack", "dịch vụ bảo vệ"],
    titles: [
      "Khảo sát hiện trạng hệ thống bảo mật (firewall/WAF) hiện tại",
      "Thiết kế & cấu hình tường lửa/WAF (policy, rule, quota)",
      "Cấu hình chính sách bảo mật, phòng chống tấn công DDoS",
      "Kiểm thử bảo mật, nghiệm thu & bàn giao",
    ],
  },
  {
    kws: ["cloud", "vm", "vpc", "hạ tầng", "infra", "triển khai hạ tầng", "server", "kubernetes", "k8s", "docker", "ha", "backup", "sao lưu"],
    titles: [
      "Khảo sát & thiết kế topology/hạ tầng cloud (VM, VPC, network)",
      "Dựng hạ tầng theo thiết kế (tạo VM, cấu hình network, security group)",
      "Cài đặt & cấu hình dịch vụ trên hạ tầng (web, DB, middleware)",
      "Cấu hình backup, HA, monitoring cho hệ thống",
      "Kiểm thử, nghiệm thu & bàn giao hạ tầng",
    ],
  },
  {
    kws: ["domain", "dns", "ssl", "tên miền", "chứng chỉ"],
    titles: [
      "Đăng ký/chuyển đổi tên miền + cấu hình DNS",
      "Cấu hình SSL/TLS chứng chỉ cho domain",
      "Kiểm thử truy cập domain & bàn giao",
    ],
  },
  {
    kws: ["web", "website", "portal", "cổng thông tin", "ứng dụng", "application"],
    titles: [
      "Khảo sát & thiết kế giải pháp website/portal",
      "Phát triển & tùy chỉnh theo yêu cầu",
      "Triển khai lên môi trường production",
      "Kiểm thử, nghiệm thu & bàn giao",
    ],
  },
  {
    kws: ["đào tạo", "train", "handover", "bàn giao", "tài liệu", "document", "hướng dẫn"],
    titles: [
      "Soạn tài liệu hướng dẫn sử dụng & vận hành",
      "Đào tạo team vận hành/khách hàng",
      "Bàn giao tài liệu & nghiệm thu",
    ],
  },
];

const NEXT_ACTION_KEYWORDS: Array<{ kws: string[]; titles: string[] }> = [
  {
    kws: ["họp", "meeting", "kickoff", "kick-off", "kick off", "workshop"],
    titles: ["Chốt lịch họp kick-off với KH/Pre-sale", "Tổ chức họp bàn scope & yêu cầu chi tiết"],
  },
  {
    kws: ["tài liệu", "document", "sow", "soạn", "gửi", "email", "trình ký", "chốt", "báo giá", "quote"],
    titles: [
      "Soạn & chốt SOW (scope, hạng mục, timeline)",
      "Gửi tài liệu/SOW cho KH xác nhận",
    ],
  },
  {
    kws: ["khảo sát", "survey", "hiện trạng", "đánh giá", "audit"],
    titles: ["Chạy khảo sát hiện trạng (hạ tầng/hệ thống) theo yêu cầu"],
  },
  {
    kws: ["tài nguyên", "resource", "nhân sự", "team", "pic", "phân công"],
    titles: ["Chốt nhân sự/PIC cho các hạng mục triển khai"],
  },
  {
    kws: ["timeline", "milestone", "mốc", "deadline", "tiến độ", "thời gian", "gấp"],
    titles: ["Chốt timeline & các mốc bàn giao với KH"],
  },
];

function matchKeywordSet(text: string, table: Array<{ kws: string[]; titles: string[] }>): { titles: string[]; matchedKw: string[] } {
  const lower = text.toLowerCase();
  const matchedKw: string[] = [];
  const titles: string[] = [];
  for (const row of table) {
    const hit = row.kws.some((k) => lower.includes(k.toLowerCase()));
    if (hit) {
      matchedKw.push(...row.kws);
      titles.push(...row.titles);
    }
  }
  return { titles, matchedKw };
}

const AUTO_SUGGESTED_FEATURES = [
  "Đồng bộ tin nhắn Teams",
  "Đồng bộ tin nhắn Zalo",
  "Tạo task tracking tự động từ yêu cầu",
  "Tóm tắt dự án tự động",
  "Gợi ý chốt SOW / phase chuyển giai đoạn",
  "Cảnh báo & gợi ý đóng dự án (task xong / KH confirm)",
  "Tìm kiếm & thêm member từ Teams",
];

/** Fallback không cần LLM — detect theo keyword, vẫn trả cấu trúc đầy đủ. */
export function fallbackAnalyzePreinfo(text: string): PreinfoAnalysis {
  const scope = matchKeywordSet(text, SCOPE_KEYWORDS).titles;
  const nextActions = matchKeywordSet(text, NEXT_ACTION_KEYWORDS).titles;
  return clampAnalysis({
    scope,
    nextActions,
    featureSuggestions: AUTO_SUGGESTED_FEATURES.slice(0, 5),
  });
}

// ─── LLM analyze ────────────────────────────────────────────

const SYSTEM_PROMPT = `Bạn là PM Agent của bộ công cụ quản lý dự án K-Todolist (FPT Cloud).

Người dùng dán 1 đoạn "yêu cầu sơ bộ" do Pre-sale gửi (có thể là email, tin nhắn Teams/Zalo, nội dung ticket...) và nhờ bạn giúp:
1. Tách PHẠM VI (scope) — các hạng mục công việc chính cần triển khai/deliver.
2. Tách NEXT ACTIONS — các việc tiếp theo PM cần làm (họp kickoff, chốt SOW, khảo sát hiện trạng, chốt nhân sự, chốt timeline...).
3. Gợi ý CÁC TÍNH NĂNG phù hợp của tool (multi-choice, người dùng sẽ tick tiếp) — chọn từ danh sách cho sẵn, KHÔNG tự bịa tên tính năng mới:
   - Đồng bộ tin nhắn Teams
   - Đồng bộ tin nhắn Zalo
   - Tạo task tracking tự động từ yêu cầu
   - Tóm tắt dự án tự động
   - Gợi ý chốt SOW / phase chuyển giai đoạn
   - Cảnh báo & gợi ý đóng dự án (task xong / KH confirm)
   - Tìm kiếm & thêm member từ Teams
   - Nhắc việc trong ngày qua tin nhắn
   Nếu đoạn text KHÔNG đề cập nền tảng nào → KHÔNG gợi ý mục "Đồng bộ tin nhắn Teams/Zalo".

QUY TẮC:
- Output PHẢI là 1 JSON object duy nhất (không markdown, không code block, không text thừa):
{ "scope": ["..."], "nextActions": ["..."], "featureSuggestions": ["..."] }
- Mỗi mục ngắn gọn 1 câu, tiếng Việt CÓ DẤU đầy đủ.
- Chỉ dùng thông tin CÓ trong text đầu vào, không bịa thêm.
- scope/nextActions mỗi cái tối đa 10 mục.
- Nếu text không có nội dung yêu cầu cụ thể → scope/nextActions là mảng rỗng.
- KHÔNG thêm giải thích ngoài JSON.`;

/**
 * Phân tích yêu cầu sơ bộ:
 * - LLM detect scope/nextActions/featureSuggestions (ưu tiên).
 * - Lỗi/thiếu cấu hình → fallback rule-based.
 */
export async function analyzePreinfo(text: string): Promise<{ analysis: PreinfoAnalysis; source: "llm" | "fallback" }> {
  const trimmed = (text || "").trim();
  if (!trimmed) return { analysis: clampAnalysis({}), source: "fallback" };

  const raw = await callLLM(SYSTEM_PROMPT, `Yêu cầu sơ bộ từ Pre-sale:\n\n${trimmed.slice(0, 8000)}`, 2048, 45000);
  if (!raw) return { analysis: fallbackAnalyzePreinfo(trimmed), source: "fallback" };

  const content = extractLLMContent(raw);
  const parsed = content ? extractJsonObject(content) : null;
  const analysis = clampAnalysis(parsed);
  if (analysis.scope.length === 0 && analysis.nextActions.length === 0 && analysis.featureSuggestions.length === 0) {
    return { analysis: fallbackAnalyzePreinfo(trimmed), source: "fallback" };
  }
  return { analysis, source: "llm" };
}