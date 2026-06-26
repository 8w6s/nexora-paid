#!/usr/bin/env bash
# Test admin xpub setup via API (simulates buyer paste xpub flow)

XPUB="Ltub2ZcDkHxiwci7d2HrwbrjZPUn1jqitcgXNFZpXXdPgujnY4CV6tjoJMLCCNUHfetjn2abTFUVZYdrC9XTp6XnrCAQS7MQDHqnyEUMdE7N1gM"

# Login
rm -f /tmp/admin-cookies.txt
curl -sk -c /tmp/admin-cookies.txt -X POST https://localhost/api/auth/login \
  -H "Origin: https://localhost" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nexora.local","password":"change-me"}'
echo ""

# Set xpub
echo "--- Setting xpub ---"
curl -sk -b /tmp/admin-cookies.txt -X PUT https://localhost/api/admin/settings \
  -H "Origin: https://localhost" \
  -H "Content-Type: application/json" \
  -d "{"ltc_xpub": "$XPUB", "currentPassword": "change-me"}"
echo ""

# Verify
echo "--- Verify config ---"
curl -sk -b /tmp/admin-cookies.txt https://localhost/api/admin/settings \
  -H "Origin: https://localhost" | grep -o '"xpub_valid":[^,]*'
echo ""

# Test checkout
echo "--- Test checkout ---"
curl -sk -b /tmp/admin-cookies.txt -X POST https://localhost/api/checkout \
  -H "Origin: https://localhost" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"productId":"prod-1","qty":1}],"email":"buyer@test.com"}'
echo ""