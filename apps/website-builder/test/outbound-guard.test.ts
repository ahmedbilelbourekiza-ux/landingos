import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  isPrivateIp,
  refuseOutboundUrl,
  refuseResolvedTarget,
  guardedFetch,
  OutboundRefusedError,
  isAllowlistedPrivateHost,
  type LookupFn,
} from '../src/lib/net/outbound-guard.ts';

/* =============================================================================
 * SEC.7 — the outbound destination guard, pure and stub-server halves.
 *
 * Three gates, each pinned separately:
 *   1. as written  — refuseOutboundUrl (no network, ever);
 *   2. as resolved — refuseResolvedTarget with an INJECTED lookup, so the
 *      rebinding case ("public name, private A record") is asserted without
 *      real DNS in the loop;
 *   3. after redirects — guardedFetch against real local listeners, because
 *      redirect-following is exactly the code that must never be trusted on
 *      inspection alone.
 *
 * The allowlist seam is exercised the way the suites use it: set for the
 * stub-server block (the guard would otherwise refuse 127.0.0.1, which is
 * the point of the guard), and CLEARED to prove the refusal actually fires.
 * ========================================================================== */

const ENV_KEY = 'OUTBOUND_PRIVATE_ALLOWLIST';
const savedEnv = process.env[ENV_KEY];
after(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

// ---------------------------------------------------------------------------
// Gate 0: the address classifier every other gate leans on.
// ---------------------------------------------------------------------------

describe('isPrivateIp', () => {
  test('IPv4 private, special-use and reserved ranges are private', () => {
    for (const ip of [
      '0.0.0.0', '0.1.2.3',
      '10.0.0.1', '10.255.255.255',
      '100.64.0.1', '100.127.255.254', // CGNAT
      '127.0.0.1', '127.99.3.4',
      '169.254.169.254', // cloud metadata
      '172.16.0.1', '172.31.255.254',
      '192.168.1.10',
      '192.0.0.170', '192.0.2.55', // special + TEST-NET
      '198.18.0.1', '198.19.255.255', // benchmarking
      '198.51.100.7', '203.0.113.9', // TEST-NET-2/3
      '224.0.0.251', '239.255.255.250', // multicast
      '240.0.0.1', '255.255.255.255', // reserved + broadcast
    ]) {
      assert.equal(isPrivateIp(ip), true, `${ip} must be private`);
    }
  });

  test('IPv4 public addresses are public', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '100.63.0.1', '100.128.0.1', '172.15.0.1', '172.32.0.1', '9.9.9.9', '223.255.255.255']) {
      assert.equal(isPrivateIp(ip), false, `${ip} must be public`);
    }
  });

  test('IPv6 local, reserved and documentation forms are private', () => {
    for (const ip of [
      '::', '::1',
      'fe80::1', 'fe80::abcd%eth0', // link-local, with a zone id
      'febf::1', // still fe80::/10
      'fec0::1', // site-local (deprecated, still LAN-routable)
      'fc00::1', 'fd12:3456:789a::1', // ULA
      'ff02::1', // multicast
      '2001:db8::1', // documentation
    ]) {
      assert.equal(isPrivateIp(ip), true, `${ip} must be private`);
    }
  });

  test('every IPv6 form that EMBEDS an IPv4 address is judged by the embedded address', () => {
    // mapped
    assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIp('::ffff:10.0.0.1'), true);
    assert.equal(isPrivateIp('::ffff:7f00:1'), true); // the parser-serialised spelling of the loopback
    assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
    // NAT64
    assert.equal(isPrivateIp('64:ff9b::127.0.0.1'), true);
    assert.equal(isPrivateIp('64:ff9b::8.8.8.8'), false);
    // deprecated IPv4-compatible
    assert.equal(isPrivateIp('::127.0.0.1'), true);
    // 6to4 embeds the v4 address in words 1–2
    assert.equal(isPrivateIp('2002:7f00:1::'), true); // 127.0.0.1
    assert.equal(isPrivateIp('2002:808:808::'), false); // 8.8.8.8
  });

  test('ordinary global IPv6 is public', () => {
    assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
    assert.equal(isPrivateIp('2a00:1450:4007:80f::200e'), false);
  });

  test('anything that is not an IP is refused rather than trusted', () => {
    assert.equal(isPrivateIp('banana'), true);
    assert.equal(isPrivateIp(''), true);
  });
});

// ---------------------------------------------------------------------------
// Gate 1: the URL as written.
// ---------------------------------------------------------------------------

describe('refuseOutboundUrl (as written)', () => {
  const HTTPS = { protocols: ['https:'] } as const;
  const BOTH = { protocols: ['https:', 'http:'] } as const;

  before(() => { delete process.env[ENV_KEY]; });

  test('public hosts pass under their protocol policy', () => {
    assert.equal(refuseOutboundUrl('https://api.example.com/v1', HTTPS), null);
    assert.equal(refuseOutboundUrl('http://api.example.com/v1', BOTH), null);
    assert.equal(refuseOutboundUrl('https://8.8.8.8/v1', BOTH), null);
  });

  test('a protocol outside the policy is refused, by name', () => {
    assert.match(refuseOutboundUrl('http://api.example.com/v1', HTTPS)!, /https/);
    assert.notEqual(refuseOutboundUrl('ftp://api.example.com/v1', BOTH), null);
    assert.notEqual(refuseOutboundUrl('file:///etc/passwd', BOTH), null);
  });

  test('junk and embedded credentials are refused', () => {
    assert.notEqual(refuseOutboundUrl('not a url', BOTH), null);
    assert.notEqual(refuseOutboundUrl('https://user:pass@example.com/', BOTH), null);
    assert.notEqual(refuseOutboundUrl('https://api.openai.com@10.0.0.1/', BOTH), null);
  });

  test('private and internal names are refused', () => {
    for (const url of [
      'https://localhost/x',
      'https://app.localhost/x',
      'https://printer.local/x',
      'https://db.internal/x',
      'https://nas.home.arpa/x',
    ]) {
      assert.notEqual(refuseOutboundUrl(url, BOTH), null, `${url} must be refused`);
    }
  });

  test('literal private IPs are refused in every spelling the parser normalises', () => {
    for (const url of [
      'https://127.0.0.1/x',
      'https://10.1.2.3/x',
      'https://169.254.169.254/latest/meta-data',
      'https://2130706433/x', // 127.0.0.1 decimal
      'https://0x7f000001/x', // hex
      'https://0177.0.0.1/x', // octal
      'https://127.1/x', //      shortened
      'https://192.0.0.192/x', // 192.0.0/24 — outside the old pattern list
      'https://224.0.0.251/x', // multicast — likewise
      'https://[::1]/x',
      'https://[fe80::1]/x',
      'https://[fd00::2]/x',
    ]) {
      assert.notEqual(refuseOutboundUrl(url, BOTH), null, `${url} must be refused`);
    }
  });

  test('IPv4-mapped IPv6 is refused wholesale, even with a public address inside', () => {
    assert.notEqual(refuseOutboundUrl('https://[::ffff:127.0.0.1]/x', BOTH), null);
    assert.notEqual(refuseOutboundUrl('https://[::ffff:8.8.8.8]/x', BOTH), null);
  });

  test('the allowlist admits EXACTLY the named hosts, nothing more', () => {
    process.env[ENV_KEY] = '127.0.0.1, localhost';
    try {
      assert.equal(isAllowlistedPrivateHost('127.0.0.1'), true);
      assert.equal(isAllowlistedPrivateHost('LOCALHOST'), true);
      assert.equal(isAllowlistedPrivateHost('127.0.0.2'), false);
      assert.equal(refuseOutboundUrl('http://127.0.0.1:9000/v1', BOTH), null);
      assert.equal(refuseOutboundUrl('https://localhost/x', BOTH), null);
      assert.notEqual(refuseOutboundUrl('http://10.0.0.1/x', BOTH), null, 'only the listed hosts');
    } finally {
      delete process.env[ENV_KEY];
    }
    assert.equal(isAllowlistedPrivateHost('127.0.0.1'), false, 'unset means nothing is allowlisted');
  });
});

// ---------------------------------------------------------------------------
// Gate 2: the name as resolved — with an injected lookup, no real DNS.
// ---------------------------------------------------------------------------

const lookupReturning = (...addresses: string[]): LookupFn =>
  async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('refuseResolvedTarget (as resolved)', () => {
  before(() => { delete process.env[ENV_KEY]; });

  test('a name resolving only to public addresses passes', async () => {
    const reason = await refuseResolvedTarget(new URL('https://api.example.com/'), lookupReturning('93.184.216.34', '2606:2800:220:1::1'));
    assert.equal(reason, null);
  });

  test('THE REBINDING CASE: a public name with a private record is refused', async () => {
    const reason = await refuseResolvedTarget(new URL('https://rebound.example.com/'), lookupReturning('169.254.169.254'));
    assert.match(reason!, /private or internal/);
  });

  test('ONE private address among public ones is enough to refuse', async () => {
    const reason = await refuseResolvedTarget(new URL('https://mixed.example.com/'), lookupReturning('93.184.216.34', '10.0.0.5'));
    assert.notEqual(reason, null);
  });

  test('a private AAAA record is caught the same as an A record', async () => {
    const reason = await refuseResolvedTarget(new URL('https://v6.example.com/'), lookupReturning('fd00::1'));
    assert.notEqual(reason, null);
  });

  test('a name that does not resolve is NOT refused here — the fetch owns that error', async () => {
    const failing: LookupFn = async () => { throw new Error('ENOTFOUND'); };
    assert.equal(await refuseResolvedTarget(new URL('https://typo.example.com/'), failing), null);
  });

  test('a literal IP host is judged directly, no lookup call at all', async () => {
    let called = false;
    const spy: LookupFn = async () => { called = true; return []; };
    assert.notEqual(await refuseResolvedTarget(new URL('https://10.0.0.1/'), spy), null);
    assert.equal(await refuseResolvedTarget(new URL('https://8.8.8.8/'), spy), null);
    assert.equal(called, false);
  });

  test('an allowlisted host skips the resolve gate (the suites\' 127.0.0.1 receivers)', async () => {
    process.env[ENV_KEY] = '127.0.0.1';
    try {
      assert.equal(await refuseResolvedTarget(new URL('http://127.0.0.1:48790/hook'), lookupReturning('127.0.0.1')), null);
    } finally {
      delete process.env[ENV_KEY];
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 3: guardedFetch against real listeners.
// ---------------------------------------------------------------------------

describe('guardedFetch (redirect discipline)', () => {
  let a: Server; let aPort = 0;
  let b: Server; let bPort = 0;
  const hits: { server: string; method: string; path: string; body: string }[] = [];

  const urlA = (path: string) => `http://127.0.0.1:${aPort}${path}`;
  const urlB = (path: string) => `http://127.0.0.1:${bPort}${path}`;
  const BOTH = { protocols: ['https:', 'http:'] } as const;

  before(async () => {
    process.env[ENV_KEY] = '127.0.0.1';
    const handler = (name: string) => (req: any, res: any) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        hits.push({ server: name, method: req.method, path: req.url, body });
        const u = new URL(req.url, 'http://x');
        if (u.pathname === '/hop') {
          res.writeHead(302, { location: '/final' }).end();
        } else if (u.pathname === '/hop307') {
          res.writeHead(307, { location: '/final' }).end();
        } else if (u.pathname === '/loop') {
          res.writeHead(302, { location: '/loop' }).end();
        } else if (u.pathname === '/cross') {
          res.writeHead(302, { location: urlB('/final') }).end();
        } else {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ at: name + u.pathname }));
        }
      });
    };
    a = createServer(handler('a'));
    b = createServer(handler('b'));
    await new Promise<void>((r) => a.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => b.listen(0, '127.0.0.1', r));
    aPort = (a.address() as AddressInfo).port;
    bPort = (b.address() as AddressInfo).port;
  });

  after(async () => {
    delete process.env[ENV_KEY];
    await new Promise((r) => a.close(r));
    await new Promise((r) => b.close(r));
  });

  test('a plain 200 passes through untouched', async () => {
    const res = await guardedFetch(urlA('/final'), { method: 'GET' }, { ...BOTH, maxRedirects: 3 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { at: 'a/final' });
  });

  test('a same-origin 302 on GET is followed, re-checked, and lands', async () => {
    hits.length = 0;
    const res = await guardedFetch(urlA('/hop'), { method: 'GET' }, { ...BOTH, maxRedirects: 3 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { at: 'a/final' });
    assert.deepEqual(hits.map((h) => h.path), ['/hop', '/final']);
  });

  test('with maxRedirects 0 (the webhook rule) the 3xx IS the answer', async () => {
    hits.length = 0;
    const res = await guardedFetch(urlA('/hop'), { method: 'POST', body: '{}' }, { ...BOTH, maxRedirects: 0 });
    assert.equal(res.status, 302);
    assert.equal(hits.length, 1, 'exactly one POST, exactly one address — nothing followed');
  });

  test('a redirect loop is cut off, not followed forever', async () => {
    await assert.rejects(
      guardedFetch(urlA('/loop'), { method: 'GET' }, { ...BOTH, maxRedirects: 3 }),
      (e: Error) => e instanceof OutboundRefusedError && /Too many redirects/.test(e.message),
    );
  });

  test('a CROSS-ORIGIN redirect is refused and the other origin is never contacted', async () => {
    hits.length = 0;
    await assert.rejects(
      guardedFetch(urlA('/cross'), { method: 'GET' }, { ...BOTH, maxRedirects: 3 }),
      (e: Error) => e instanceof OutboundRefusedError && /different origin/.test(e.message),
    );
    assert.equal(hits.filter((h) => h.server === 'b').length, 0, 'server B must never see the request');
  });

  test('a 302 answering a POST is returned as-is — never silently retried as GET', async () => {
    hits.length = 0;
    const res = await guardedFetch(urlA('/hop'), { method: 'POST', body: '{"x":1}' }, { ...BOTH, maxRedirects: 3 });
    assert.equal(res.status, 302);
    assert.deepEqual(hits.map((h) => h.method), ['POST']);
  });

  test('a 307 preserves the POST method AND body across the hop', async () => {
    hits.length = 0;
    const res = await guardedFetch(urlA('/hop307'), { method: 'POST', body: '{"x":1}' }, { ...BOTH, maxRedirects: 3 });
    assert.equal(res.status, 200);
    assert.deepEqual(hits.map((h) => [h.method, h.path]), [['POST', '/hop307'], ['POST', '/final']]);
    assert.equal(hits[1].body, '{"x":1}');
  });

  test('with the allowlist CLEARED the guard refuses 127.0.0.1 before any connection', async () => {
    delete process.env[ENV_KEY];
    hits.length = 0;
    try {
      await assert.rejects(
        guardedFetch(urlA('/final'), { method: 'GET' }, { ...BOTH, maxRedirects: 3 }),
        (e: Error) => e instanceof OutboundRefusedError,
      );
      assert.equal(hits.length, 0, 'refused as written — no socket was opened');
    } finally {
      process.env[ENV_KEY] = '127.0.0.1';
    }
  });

  test('a public name resolving privately is refused before any connection (injected lookup)', async () => {
    await assert.rejects(
      guardedFetch(
        'https://rebound.example.com/v1',
        { method: 'GET' },
        { ...BOTH, maxRedirects: 3, lookupFn: lookupReturning('10.0.0.5') },
      ),
      (e: Error) => e instanceof OutboundRefusedError && /resolves to a private/.test(e.message),
    );
  });
});
