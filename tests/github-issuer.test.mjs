import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAuthResponse, skipStateCheck } from 'oauth4webapi';
import { githubProvider } from '../src/server/auth/github.ts';

// Auth.js uses this same fallback and validator before exchanging the code.
const provider = { ...githubProvider, ...githubProvider.options };
const server = { issuer: provider.issuer ?? 'https://authjs.dev' };
const client = { client_id: 'test-client' };
test('accepts the issuer now returned in real GitHub OAuth callbacks', () => {
  const response = validateAuthResponse(server, client, new URLSearchParams({code:'test-code', iss:'https://github.com/login/oauth'}), skipStateCheck);
  assert.equal(response.get('code'), 'test-code');
});
test('continues rejecting a different OAuth issuer', () => {
  assert.throws(() => validateAuthResponse(server, client, new URLSearchParams({code:'test-code',iss:'https://attacker.example'}), skipStateCheck), /issuer/);
});
