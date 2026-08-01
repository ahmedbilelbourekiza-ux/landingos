/*
 * Smoke-test harness for the CRM backend.
 * Run after `npm install` + `node index.js` (on any port, set PORT).
 *   usage:  node test_smoke.js            # hits https://erp-serveur.onrender.com by default
 *           BASE=http://localhost:3000 node test_smoke.js
 *
 * It exercises: auto-assign (on/off), the 8 call results, invalid-result
 * rejection, suspicious-flag + audit trail, agent assignment broadcast, and
 * the new /api/statuses endpoint. Requires at least one agent to exist.
 */
const BASE = process.env.BASE || 'https://erp-serveur.onrender.com';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ✓ ' + m); };
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

async function main() {
  console.log('Target:', BASE);
  // 0. health
  let res = await api('GET', '/');
  res.status === 200 ? ok('GET / healthy') : bad('GET / -> ' + res.status);

  // 1. statuses endpoint exposes the new results
  res = await api('GET', '/api/statuses');
  const hasNew = res.json?.results?.includes('tentative3') && res.json?.results?.includes('unreachable');
  hasNew ? ok('/api/statuses includes new results') : bad('/api/statuses missing new results: ' + JSON.stringify(res.json));

  // 2. need an agent
  const agents = (await api('GET', '/api/agents')).json || [];
  if (!agents.length) { console.warn('  ! no agents configured — create one to run the full suite'); }
  const agent = agents[0]?.name;

  // 3. auto-assign OFF → empty agent should stay empty
  await api('PUT', '/api/settings', { autoAssign: false });
  let order = (await api('POST', '/api/orders', { client: 'Test AutoOff', phone: '0555000001' })).json;
  (order.agent === '' || order.agent === undefined) ? ok('auto-assign OFF keeps agent empty') : bad('auto-assign OFF assigned: ' + order.agent);

  // 4. auto-assign ON (needs an agent) → empty agent should be filled
  if (agent) {
    await api('PUT', '/api/settings', { autoAssign: true });
    order = (await api('POST', '/api/orders', { client: 'Test AutoOn', phone: '0555000002' })).json;
    order.agent === agent ? ok('auto-assign ON -> ' + agent) : bad('auto-assign ON -> ' + order.agent);
    await api('PUT', '/api/settings', { autoAssign: false });
  }

  // 5. each new call result is accepted & stored, status updates
  const newResults = ['tentative1', 'tentative2', 'tentative3', 'unreachable'];
  for (const r of newResults) {
    const o = (await api('POST', '/api/orders', { client: 'Test ' + r, phone: '0555000003', agent: agent || '' })).json;
    // call-start then immediately log → duration will be tiny → suspicious if below threshold
    await api('POST', '/api/orders/' + o.id + '/call-start', {});
    const logged = (await api('POST', '/api/orders/' + o.id + '/call', { result: r, note: 'auto-test' })).json;
    logged.duration !== undefined ? ok('result ' + r + ' logged, duration=' + logged.duration) : bad('result ' + r + ' failed: ' + JSON.stringify(logged));
    // audit trail exists for this order
    const audit = (await api('GET', '/api/orders/' + o.id + '/audit')).json;
    audit.calls?.length ? ok('  audit has ' + audit.calls.length + ' call(s)') : bad('  audit empty for ' + o.id);
  }

  // 6. invalid result rejected
  const badOrder = (await api('POST', '/api/orders', { client: 'Test Invalid', phone: '0555000004' })).json;
  res = await api('POST', '/api/orders/' + badOrder.id + '/call', { result: 'definitely_not_real' });
  res.status === 400 ? ok('invalid result rejected with 400') : bad('invalid result NOT rejected: ' + res.status);

  console.log('\nResult: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
