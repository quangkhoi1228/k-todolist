# Multi-Agent Debate — Phân tích chat thông minh

## Bài toán

Hiện tại `analyse-suggestions/route.ts` **trộn lẫn** tin nhắn từ tất cả nhóm chat (Khách hàng, Nội bộ, Sale 1:1) vào 1 LLM call duy nhất. Hậu quả:
- AI có thể lẫn lộn ý kiến khách hàng vs trao đổi nội bộ
- Không phát hiện được mâu thuẫn giữa các kênh
- Không có cơ chế kiểm tra hallucination

## Giải pháp: 3-Stage Multi-Agent Debate + Project KB Context

```
📥 Input: messages (có groupType) + project.notes (KB HTML)
                    ↓
┌─ STAGE 1: Per-Group Analysis (song song) ─────────────────┐
│                                                            │
│  [KHÁCH HÀNG | Zalo | "FRT x FCI"]  → LLM Agent 1         │
│  [NỘI BỘ | Teams | "Nội bộ TCSC"]   → LLM Agent 2         │
│  [SALE 1:1 | Teams | "Hùng Sale"]    → LLM Agent 3         │
│                                                            │
│  Mỗi agent nhận: messages riêng nhóm + project KB context  │
│  Output: findings[] per group                              │
│  Promise.allSettled — chạy song song                       │
└─────────────────────────┬──────────────────────────────────┘
                          ▼
┌─ STAGE 2: Cross-Group Synthesis ──────────────────────────┐
│                                                            │
│  Input: tất cả findings từ Stage 1                         │
│  Nhiệm vụ:                                                │
│    - Tìm điểm chung giữa các nhóm                         │
│    - Phát hiện MÂU THUẪN (KH nói A, NB nói B)             │
│    - Sinh draft suggestions + sourceChatName attribution   │
│  Output: draftSuggestions[] + conflicts[]                  │
└─────────────────────────┬──────────────────────────────────┘
                          ▼
┌─ STAGE 3: Critic Verification ────────────────────────────┐
│                                                            │
│  Input: draftSuggestions + original messages                │
│  Nhiệm vụ:                                                │
│    - Kiểm tra: gợi ý này có chứng cứ từ tin nhắn gốc?     │
│    - Loại gợi ý hallucination (không match source)         │
│    - Gán confidence: high / medium / low                   │
│  Output: verifiedSuggestions[] (chỉ còn gợi ý có chứng cứ)│
└────────────────────────────────────────────────────────────┘
```

---

## Proposed Changes

### Analyse Suggestions API

#### [MODIFY] [route.ts](file:///Volumes/home/Project/k-todolist/src/app/api/agents/analyse-suggestions/route.ts)

Rewrite hoàn toàn file này. Giữ nguyên `generateFallbackSuggestions()` ở cuối file.

**Request body mở rộng:**
```typescript
interface AnalyseRequest {
  projectName: string;
  projectId: string;
  messages: ChatMessage[];
  projectContext?: string;  // NEW — HTML content từ project.notes (KB tab)
}

interface ChatMessage {
  sender?: string;
  chatName?: string;
  content?: string;
  timestampMs?: number | string;
  platform?: "teams" | "zalo";  // có sẵn
  groupType?: "customer" | "internal";  // NEW — từ teamsGroups[].type
}
```

**Response mở rộng:**
```typescript
interface AnalyseResponse {
  ok: true;
  suggestions: Suggestion[];
  conflicts?: Conflict[];  // NEW — mâu thuẫn phát hiện được
  debugInfo?: {             // NEW — timing debug
    stage1Ms: number;
    stage2Ms: number;
    stage3Ms: number;
    totalMs: number;
    groupCount: number;
  };
}

interface Suggestion {
  // ... existing fields ...
  type, title, description, sourceSender, sourceChatName,
  sourceMessage, actionLabel, input, reasoning, expectedOutcome
  // NEW:
  confidence: "high" | "medium" | "low";
}

interface Conflict {
  description: string;     // "KH yêu cầu triển khai ngay, NB nói chưa sẵn sàng"
  group1: string;          // "FRT x FCI (KHÁCH HÀNG)"
  group2: string;          // "Nội bộ TCSC (NỘI BỘ)"
  sourceMessages: string[];
}
```

**Helpers cần thêm:**

1. `stripHtml(html: string): string` — loại bỏ HTML tags, decode entities, giữ text thuần
2. `callLLM(systemPrompt, userPrompt, maxTokens, timeoutMs): Promise<string>` — wrapper gọi LLM có timeout
3. `groupMessagesByChat(messages: ChatMessage[]): Map<string, GroupedChat>` — nhóm messages theo chatName, gắn label type
4. `safeJsonParse(content: string): any[]` — trích JSON array từ response LLM (chống markdown wrapper)
5. `inferGroupType(chatName: string): "KHÁCH HÀNG" | "NỘI BỘ" | "CHƯA PHÂN LOẠI"` — đoán loại nhóm từ tên khi không có `groupType`

**Logic inferGroupType:**
```typescript
const INTERNAL_KEYWORDS = ["nội bộ", "internal", "tcsc", "fci", "team ", "dev"];
const CUSTOMER_KEYWORDS = ["khách", "customer", "external", "kh ", "frt", "dự án"];
// Nếu match internal → NỘI BỘ, match customer → KHÁCH HÀNG, không match → CHƯA PHÂN LOẠI
```

**Stage 1 — System Prompt (cho mỗi group):**
```
Bạn là chuyên gia phân tích tin nhắn nhóm [LOẠI NHÓM] ([PLATFORM]).
Bạn CHỈ phân tích tin nhắn từ nhóm "[TÊN NHÓM]" — KHÔNG suy luận từ nhóm khác.

Thông tin dự án (KB):
---
[PROJECT_CONTEXT plain text]
---

Nhiệm vụ: Phân tích tin nhắn và rút ra:
1. Các yêu cầu/action item cần PM xử lý
2. Deadline/mốc thời gian
3. Vấn đề/risk phát sinh
4. Thông tin quan trọng

Output JSON array [...findings]. Mỗi finding có:
{ type, title, description, sourceSender, sourceMessage, urgency: "high"|"medium"|"low" }

Nếu không có gì cần xử lý, trả [].
```
- `max_tokens: 2048`, `timeout: 15000ms`, `temperature: 0.1`

**Stage 2 — System Prompt:**
```
Bạn là AI tổng hợp (Synthesizer). Bạn nhận kết quả phân tích từ NHIỀU nhóm chat
của dự án "[PROJECT_NAME]".

Kết quả phân tích từng nhóm:
---
[STAGE 1 RESULTS formatted per group]
---

Nhiệm vụ:
1. Tìm điểm chung giữa các nhóm (VD: cả KH và NB đều nhắc deadline)
2. Phát hiện MÂU THUẪN: khi nhóm khách hàng nói khác nhóm nội bộ → đây là
   signal quan trọng, PM cần biết ngay
3. Tổng hợp thành danh sách gợi ý hành động cho PM

Output JSON:
{
  "suggestions": [{ type, title, description, sourceSender, sourceChatName,
                     sourceMessage, actionLabel, input, reasoning, expectedOutcome }],
  "conflicts": [{ description, group1, group2, sourceMessages: string[] }]
}

QUAN TRỌNG:
- Mỗi gợi ý PHẢI ghi rõ sourceChatName (từ nhóm nào)
- Nếu phát hiện mâu thuẫn → tạo 1 suggestion type "warning" + 1 entry trong conflicts
- Viết tiếng Việt CÓ DẤU
```
- `max_tokens: 4096`, `timeout: 20000ms`, `temperature: 0.1`

**Stage 3 — System Prompt:**
```
Bạn là AI kiểm duyệt (Critic). Nhiệm vụ: kiểm tra từng gợi ý có ĐỦ CHỨNG CỨ
từ tin nhắn gốc hay không.

Gợi ý sơ bộ cần kiểm tra:
---
[DRAFT SUGGESTIONS from Stage 2]
---

Tin nhắn gốc (để đối chiếu):
---
[ORIGINAL MESSAGES — 50 tin mới nhất, grouped by chatName]
---

Với MỖI gợi ý, hãy:
1. Tìm tin nhắn gốc khớp với sourceMessage — có thật không?
2. Nếu sourceMessage không khớp bất kỳ tin nhắn nào → GỢI Ý NÀY LÀ HALLUCINATION → LOẠI BỎ
3. Nếu có chứng cứ rõ ràng → confidence: "high"
4. Nếu chứng cứ gián tiếp → confidence: "medium"
5. Nếu yếu/mơ hồ → confidence: "low"

Output JSON array: chỉ chứa suggestions ĐÃ VERIFIED (bỏ hallucination).
Mỗi item giữ nguyên fields + thêm "confidence": "high"|"medium"|"low"
```
- `max_tokens: 4096`, `timeout: 20000ms`, `temperature: 0.1`

**Fallback strategy:**
```
Stage 3 fail → trả Stage 2 results (gán confidence = "medium")
Stage 2 fail → gộp Stage 1 findings thành suggestions
Stage 1 fail → generateFallbackSuggestions() (rule-based, giữ nguyên)
Không có LLM key → generateFallbackSuggestions()
```

---

### Caller cần sửa để truyền thêm dữ liệu

Tìm tất cả nơi gọi `POST /api/agents/analyse-suggestions` và bổ sung 2 trường:

1. **`projectContext`**: lấy từ `project.notes` (string HTML từ DB)
2. **`groupType` trên mỗi message**: khi build messages array, lookup `teamsGroups` của project để gắn `groupType` cho mỗi message theo `chatName`

Cần search codebase tìm caller — có thể nằm trong:
- `src/components/board/ProjectDetailPanel.tsx` (nếu có nút "Phân tích")
- `agents/pm/scripts/` (nếu chạy nền)
- `src/app/api/agents/monitor-messages/` hoặc `sync-*` routes

Với mỗi caller, thêm:
```typescript
// Lookup group type từ project.teamsGroups
const groupTypeMap = new Map<string, string>();
for (const g of project.teamsGroups || []) {
  groupTypeMap.set(g.name, g.type); // "customer" | "internal"
}

// Gắn groupType lên mỗi message
const enrichedMessages = messages.map(m => ({
  ...m,
  groupType: groupTypeMap.get(m.chatName) || undefined,
}));

// Gọi API
fetch("/api/agents/analyse-suggestions", {
  method: "POST",
  body: JSON.stringify({
    projectName,
    projectId,
    messages: enrichedMessages,
    projectContext: project.notes || "",  // KB HTML
  }),
});
```

---

## Verification Plan

### Automated Tests
```bash
# Build check
node_modules/.bin/tsc --noEmit

# Test API trực tiếp bằng curl
curl -X POST http://localhost:3000/api/agents/analyse-suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "Test Project",
    "projectId": "1",
    "projectContext": "<h2>Thông tin</h2><p>Dự án migration cloud cho FRT</p>",
    "messages": [
      {"sender":"KH Hùng","chatName":"FRT x FCI","content":"Triển khai phương án 2 nhé, deadline thứ 6","groupType":"customer","platform":"zalo"},
      {"sender":"Anh Tuấn","chatName":"Nội bộ TCSC","content":"Chưa sẵn sàng, cần thêm 1 tuần","groupType":"internal","platform":"teams"},
      {"sender":"Sale Lan","chatName":"Sale Lan","content":"KH đang push mạnh, cần confirm sớm","platform":"teams"}
    ]
  }'
```

**Kết quả mong đợi:**
- `suggestions` có ít nhất 1 item type `"warning"` về mâu thuẫn
- `conflicts` có 1 entry: KH muốn thứ 6, NB cần thêm 1 tuần
- Mỗi suggestion có `confidence` và `sourceChatName`
- `debugInfo` hiện timing < 30s

### Manual Verification
- Mở project có nhiều nhóm chat → tab Gợi ý → kiểm tra suggestions có attribution đúng nhóm
- So sánh kết quả trước/sau: cùng data, old code vs new code
