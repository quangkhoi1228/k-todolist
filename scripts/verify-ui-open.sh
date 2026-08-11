#!/usr/bin/env bash
# Mở Chrome CDP bằng profile COPY giữ session Clerk đã đăng nhập — KHÔNG bắt user đăng nhập lại.
#
# Vì sao phải copy (thay vì dùng profile thật): Chrome của user đang chạy giữ SingletonLock
# trên ~/Library/Application Support/Google/Chrome/Default — instance thứ 2 trỏ thẳng vào
# profile đó sẽ bị thoát/từ chối. Copy sang /tmp giữ nguyên Cookies (chứa session Clerk),
# chỉ xoá lock/history/session-restore. Xem .cursor/rules/verify-app-login.mdc.
#
# Cách dùng:
#   scripts/verify-ui-open.sh                        # mở http://localhost:3000/projects trên port 9222
#   scripts/verify-ui-open.sh "<url>" [port]         # URL + port tuỳ chọn
#   scripts/verify-ui-open.sh --stop                 # tắt Chrome CDP + dọn profile copy
#
# Verify session OK: URL tab phải là /projects... (KHÔNG phải /sign-in)

set -u

CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_SRC="$HOME/Library/Application Support/Google/Chrome/Default"
PROFILE_DST="/tmp/kflow-login-profile"
LOG_FILE="/tmp/chrome-verify.log"

if [ "${1:-}" = "--stop" ]; then
  pkill -f "$PROFILE_DST" 2>/dev/null
  sleep 1
  rm -rf "$PROFILE_DST"
  echo "Đã tắt Chrome CDP và dọn $PROFILE_DST"
  exit 0
fi

URL="${1:-http://localhost:3000/projects}"
PORT="${2:-9222}"

# 1. Copy profile đã login (giữ Cookies = giữ session Clerk), xoá lock + session files
rm -rf "$PROFILE_DST"
mkdir -p "$PROFILE_DST"
echo "* Copy profile ($(du -sh "$PROFILE_SRC" 2>/dev/null | cut -f1))..."
cp -R "$PROFILE_SRC" "$PROFILE_DST/Default"
rm -f "$PROFILE_DST/Default/Singleton"*
rm -f "$PROFILE_DST/Default/Preferences" "$PROFILE_DST/Default/Secure Preferences"
rm -f "$PROFILE_DST/Default/History" "$PROFILE_DST/Default/History-journal"
rm -f "$PROFILE_DST/Default/Current Session" "$PROFILE_DST/Default/Current Tabs"
rm -f "$PROFILE_DST/Default/Last Session" "$PROFILE_DST/Default/Last Tabs"
rm -rf "$PROFILE_DST/Default/Sessions"
rm -f "$PROFILE_DST/Default/Login Data" "$PROFILE_DST/Default/Login Data-journal"
rm -f "$PROFILE_DST/Default/Login Data For Account" "$PROFILE_DST/Default/Login Data For Account-journal"
rm -f "$PROFILE_DST/Default/Network Persistent State"
echo "  -> done ($(du -sh "$PROFILE_DST" 2>/dev/null | cut -f1))"

# 2. Nếu đã có instance CDP port này thì tắt trước (tránh xung đột profile)
if curl -s -o /dev/null "http://127.0.0.1:$PORT/json/version"; then
  echo "* Tắt instance cũ trên port $PORT..."
  pkill -f "$PROFILE_DST" 2>/dev/null
  sleep 1
fi

# 3. Mở Chrome CDP bằng profile copy — dùng `open -n` để process tách khỏi shell
# (chạy trực tiếp binary + & sẽ bị kill khi shell/agent kết thúc → Chrome chết)
echo "* Mở Chrome CDP port $PORT với $URL"
open -n -a "Google Chrome" --args \
  --remote-debugging-port="$PORT" --user-data-dir="$PROFILE_DST" \
  --no-first-run --no-default-browser-check --no-sandbox \
  "$URL" >"$LOG_FILE" 2>&1

# 4. Chờ CDP lên rồi in URL tab để confirm session (không phải /sign-in)
for i in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/json/version"; then break; fi
  sleep 1
done
echo "--- URL các tab (nếu là /sign-in nghĩa là profile không có session Clerk):"
curl -s "http://127.0.0.1:$PORT/json/list" | python3 -c "
import sys,json
try:
    tabs=json.load(sys.stdin)
    for t in tabs:
        if t['type']=='page':
            print(t['url'][:120], '|', t['title'][:50])
    if not tabs:
        print('(không có tab nào — Chrome có thể chưa khởi động xong)')
except Exception as e:
    print('Lỗi đọc tab:', e)
"