/**
 * Dự đoán giới tính từ tên người Việt bằng LLM (thay cho pattern hard-code).
 *
 * Dùng chung cho API route `/api/data/detect-gender`.
 * LLM gọi 1 lần cho nhiều tên để tiết kiệm request; fallback "anh/chị" khi LLM lỗi.
 */

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

export type GenderGuess = "anh" | "chị" | "anh/chị";

/** Strip SSE `data: [DONE]` trailer mà một số proxy nối thêm. */
function cleanRawResponse(raw: string): string {
  const idx = raw.lastIndexOf("data: [DONE]");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

/** Parse LLM response — content/reasoning_content/delta/Anthropic/Ollama. */
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

function normalizeGender(v: unknown): GenderGuess {
  const s = String(v ?? "").toLowerCase().trim();
  if (s.includes("nữ") || s === "chị" || s === "female" || s === "woman" || s === "f") return "chị";
  if (s.includes("nam") || s === "anh" || s === "male" || s === "man" || s === "m") return "anh";
  return "anh/chị";
}

/** Parse JSON object từ LLM response (bỏ markdown/code block nếu có). */
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

async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 768, timeoutMs = 30000): Promise<string | null> {
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
      console.error(`[GenderDetect] LLM returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error("[GenderDetect] LLM call error:", err);
    return null;
  }
}

/**
 * Dự đoán giới tính cho danh sách tên bằng LLM.
 * @param names Danh sách tên đầy đủ (vd: "To Thi Cam Tu", "Luan Tran Cao")
 * @returns Map tên → giới tính. Tên không đoán được → "anh/chị".
 */
export async function detectGenderByLLM(names: string[]): Promise<Record<string, GenderGuess>> {
  const result: Record<string, GenderGuess> = {};
  const unique = [...new Set(names.map((n) => String(n ?? "").trim()).filter(Boolean))];
  if (unique.length === 0) return result;

  const systemPrompt =
    "Bạn là trợ lý phân tích tên người Việt Nam. Dựa trên tên đầy đủ (họ + tên đệm + tên), hãy dự đoán giới tính của người đó. " +
    'Trả về JSON object với key là đúng tên gốc, value là "anh" (nam), "chị" (nữ), hoặc "anh/chị" (không chắc chắn). ' +
    "Chỉ trả về JSON, không kèm giải thích.";

  const userPrompt =
    "Dự đoán giới tính cho các tên sau:\n" +
    unique.map((n) => `- ${n}`).join("\n") +
    '\n\nTrả về dạng: {"<tên gốc>": "anh"|"chị"|"anh/chị", ...}';

  const raw = await callLLM(systemPrompt, userPrompt);
  const content = raw ? extractLLMContent(raw) : null;
  const obj = content ? extractJsonObject(content) : null;
  if (obj && typeof obj === "object") {
    for (const n of unique) {
      result[n] = normalizeGender(obj[n]);
    }
  }
  // Tên chưa có kết quả (LLM lỗi / thiếu key) → mặc định "anh/chị"
  for (const n of unique) {
    if (!result[n]) result[n] = "anh/chị";
  }
  return result;
}