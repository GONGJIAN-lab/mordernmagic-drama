#!/bin/bash
# API Test Script for v3.0 Phase 2
# Usage: BASE_URL=https://api.drama.mordernmagic.com ./test-api.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
EMAIL=${EMAIL:-"test@example.com"}

echo "=== Testing API at $BASE_URL ==="

# 1. Health check
echo ""
echo "1. GET /health"
curl -s "$BASE_URL/health" | jq .

# 2. Send OTP
echo ""
echo "2. POST /api/auth/send-otp"
curl -s -X POST "$BASE_URL/api/auth/send-otp" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}" | jq .

# 3. Verify OTP (requires manual input)
echo ""
echo "3. POST /api/auth/verify-otp"
read -p "Enter OTP code from email: " OTP_CODE
AUTH_RESP=$(curl -s -X POST "$BASE_URL/api/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$OTP_CODE\"}")
echo "$AUTH_RESP" | jq .
TOKEN=$(echo "$AUTH_RESP" | jq -r '.token')

# 4. List dramas
echo ""
echo "4. GET /api/dramas"
curl -s "$BASE_URL/api/dramas" | jq .

# 5. Drama detail
echo ""
echo "5. GET /api/dramas/chuan-jin-nue-wen"
curl -s "$BASE_URL/api/dramas/chuan-jin-nue-wen" | jq .

# 6. Episodes list
echo ""
echo "6. GET /api/dramas/chuan-jin-nue-wen/episodes"
curl -s "$BASE_URL/api/dramas/chuan-jin-nue-wen/episodes" | jq .

# 7. Create checkout (auth required)
echo ""
echo "7. POST /api/payment/create-checkout"
curl -s -X POST "$BASE_URL/api/payment/create-checkout" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"dramaSlug\":\"chuan-jin-nue-wen\",\"email\":\"$EMAIL\"}" | jq .

# 8. Watch history (auth required)
echo ""
echo "8. GET /api/watch-history"
curl -s "$BASE_URL/api/watch-history" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 9. Update watch history (auth required)
# Get first episode ID
EP_ID=$(curl -s "$BASE_URL/api/dramas/chuan-jin-nue-wen/episodes" | jq -r '.episodes[0].id')
echo ""
echo "9. POST /api/watch-history"
curl -s -X POST "$BASE_URL/api/watch-history" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"dramaSlug\":\"chuan-jin-nue-wen\",\"episodeId\":\"$EP_ID\",\"positionSec\":30}" | jq .

echo ""
echo "=== All tests completed ==="
