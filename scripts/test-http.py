"""Read-only HTTP checks against a built local server with Supabase test config.

These tests do not sign up users, send email, or connect to production data.
Start the built server on 127.0.0.1:3000 before running this script.
"""
import json
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

BASE = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:3000')
assert urlparse(BASE).hostname == '127.0.0.1', 'Only an isolated local server may be tested'

def request(path, payload=None, headers=None):
    req = urllib.request.Request(BASE + path, data=payload, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, response.geturl(), response.read().decode('utf-8'), response.headers
    except urllib.error.HTTPError as response:
        return response.code, response.geturl(), response.read().decode('utf-8'), response.headers

status, url, html, headers = request('/')
assert status == 200 and url == BASE + '/login', (status, url)
assert 'name="email"' in html and 'name="password"' in html
assert '이메일로 로그인' in html and '회원가입' in html
assert 'no-store' in headers.get('Cache-Control', '')
assert request('/api/inventory')[0] == 401
assert request('/api/products?code=08717648200274')[0] == 401
assert request('/auth/signout')[0] == 405

for forged in [
    {'oai-authenticated-user-id': 'forged-owner', 'oai-authenticated-user-email': 'attacker@example.com'},
    {'Cookie': 'sb-access-token=forged; sb-refresh-token=forged'},
]:
    assert request('/', headers=forged)[1] == BASE + '/login'
    assert request('/api/inventory', headers=forged)[0] == 401
    assert request('/api/products?code=08717648200274', headers=forged)[0] == 401

payload = json.dumps({'action': 'settings', 'warning_days': 14}).encode()
assert request('/api/inventory', payload, {'Content-Type': 'application/json', 'Origin': 'https://untrusted.example'})[0] == 403
assert request('/api/inventory', payload, {'Content-Type': 'application/json', 'Origin': BASE})[0] == 401
assert request('/auth/signout', b'', {'Origin': 'https://untrusted.example'})[0] == 403
assert request('/auth/callback?next=https://untrusted.example')[1] == BASE + '/login?error=invalid-link'
assert request('/auth/confirm?token_hash=invalid&type=admin')[1] == BASE + '/login?error=invalid-link'
assert request('/reset-password')[1] == BASE + '/login?error=invalid-link'
print('PASS: built login page, private cache policy, anonymous/forged identity rejection, POST origin checks, logout method, callback redirect allowlist, password-reset protection')
