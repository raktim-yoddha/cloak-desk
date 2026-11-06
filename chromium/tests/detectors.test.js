// Run: npm test (in chromium/)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../extension/src/shared/detectors.js');

const all = D.createMatcher({});
const hidden = (text, m = all) => m.find(text).map(([s, e]) => text.slice(s, e));
const only = (id) => D.createMatcher({ detectors: Object.fromEntries(D.ids.map((k) => [k, k === id])) });

function aadhaar(first11) {
  // append the Verhoeff check digit
  for (let c = 0; c < 10; c++) if (D.verhoeff(first11 + c)) return first11 + c;
  throw new Error('no check digit');
}

test('emails', () => {
  assert.deepEqual(hidden('Mail raktim.yoddha@gmail.com now'), ['raktim.yoddha@gmail.com']);
  assert.deepEqual(hidden('a+b@sub.example.co.in, x_y@corp.io'), ['a+b@sub.example.co.in', 'x_y@corp.io']);
  assert.deepEqual(hidden('@handle and foo@bar and v1.2@3'), []);
});

test('phones', () => {
  const m = only('phone');
  for (const p of ['+91 98765 43210', '(415) 555-0132', '+1 415-555-0132', '020 7946 0958', '9876543210', '+44 20 7946 0958', '0091-98765-43210']) {
    assert.deepEqual(hidden(`call ${p} today`, m), [p], p);
  }
  for (const n of ['2026-11-04', '12/05/2024', '3.14159265', '1.2.3.4', 'run 41812761976', 'ts 1730000000', 'order #123456', '10:24:12', 'v1.20.3', '1 2 3 4 5 6 7 8 9']) {
    assert.deepEqual(hidden(n, m), [], n);
  }
});

test('payment cards need a valid Luhn checksum', () => {
  const m = only('card');
  assert.deepEqual(hidden('card 4111 1111 1111 1111 exp', m), ['4111 1111 1111 1111']);
  assert.deepEqual(hidden('5555-5555-5555-4444', m), ['5555-5555-5555-4444']);
  assert.deepEqual(hidden('amex 378282246310005', m), ['378282246310005']);
  assert.deepEqual(hidden('4111 1111 1111 1112', m), []);
  assert.deepEqual(hidden('0000 0000 0000 0000', m), []);
});

test('IBAN needs a valid mod-97 checksum', () => {
  const m = only('iban');
  assert.deepEqual(hidden('IBAN GB82 WEST 1234 5698 7654 32.', m), ['GB82 WEST 1234 5698 7654 32']);
  assert.deepEqual(hidden('DE89370400440532013000', m), ['DE89370400440532013000']);
  assert.deepEqual(hidden('GB82 WEST 1234 5698 7654 33', m), []);
});

test('government IDs', () => {
  const m = only('govid');
  const a = aadhaar('23456789012');
  assert.deepEqual(hidden(`Aadhaar ${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`, m), [`${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`]);
  const bad = a.slice(0, 11) + ((+a[11] + 1) % 10);
  assert.deepEqual(hidden(`Aadhaar ${bad}`, m), []);
  assert.deepEqual(hidden('PAN ABCPE1234F', m), ['ABCPE1234F']);
  assert.deepEqual(hidden('SSN 123-45-6789', m), ['123-45-6789']);
  assert.deepEqual(hidden('SSN 000-45-6789', m), []);
  assert.deepEqual(hidden('NI AB 12 34 56 C', m), ['AB 12 34 56 C']);
});

test('secrets and tokens', () => {
  const m = only('secrets');
  const keys = [
    'ghp_8fK2xQ9mVt7Lr1ZsP0cWbN4yHd6Ue3Ja5Gk1',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    'AKIAIOSFODNN7EXAMPLE',
    // built at runtime so the repository never contains a Stripe-shaped literal (push protection)
    ['sk', 'live', 'Zz9fakeKeyForTestsOnly00'].join('_'),
    // fake Google API key, built at runtime for the same reason (secret scanning)
    ['AI', 'za', 'FakeKeyForTestsOnly', '0'.repeat(16)].join(''),
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
    'sk-proj-abcdefghijklmnopqrstuvwxyz012345',
    'xoxb-123456789012-123456789012-abcdefghijkl',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ];
  for (const k of keys) assert.deepEqual(hidden(`key: "${k}" end`, m).includes(k) || hidden(` ${k} `, m)[0] === k, true, k);
  assert.deepEqual(hidden('DB_PASSWORD=hunter2!x', m), ['hunter2!x']);
  assert.deepEqual(hidden('password: correct-horse', m), ['correct-horse']);
  assert.deepEqual(hidden('postgres://admin:s3cr3t@db.local/app', m), ['s3cr3t']);
  assert.deepEqual(hidden('Authorization: Bearer abcdefghijklmnop1234', m), ['abcdefghijklmnop1234']);
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAKC\n-----END RSA PRIVATE KEY-----';
  assert.deepEqual(hidden(`x\n${pem}\ny`, m), [pem]);
  assert.deepEqual(hidden('Enter your password to continue', m), []);
});

test('IP addresses', () => {
  const m = only('ip');
  assert.deepEqual(hidden('server 203.0.113.42 up', m), ['203.0.113.42']);
  assert.deepEqual(hidden('home 2001:db8:85a3::8a2e:370:7334 ok', m), ['2001:db8:85a3::8a2e:370:7334']);
  assert.deepEqual(hidden('127.0.0.1 and ::1 and 999.1.1.1 and 10:24:12 and 1.2.3', m), []);
});

test('crypto wallets', () => {
  const m = only('crypto');
  assert.deepEqual(hidden('eth 0x52908400098527886E0F7030069857D2E4169EE7', m), ['0x52908400098527886E0F7030069857D2E4169EE7']);
  assert.deepEqual(hidden('btc bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', m), ['bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']);
  assert.deepEqual(hidden('btc 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', m), ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2']);
});

test('custom words and patterns', () => {
  const m = D.createMatcher({ detectors: {}, customWords: ['Raktim Yoddha', 'Salt Lake'], customPatterns: ['/EMP-\\d{5}/'] });
  assert.deepEqual(hidden('Hi raktim yoddha from salt lake, id EMP-12345', m), ['raktim yoddha', 'salt lake', 'EMP-12345']);
  assert.throws(() => D.parsePattern('/a*/'), /empty/);
  assert.throws(() => D.parsePattern('/(/'));
  assert.throws(() => D.parsePattern('/x/g'), /flags/);
});

test('disabled detectors are skipped and overlaps merge', () => {
  const none = D.createMatcher({ detectors: Object.fromEntries(D.ids.map((k) => [k, false])) });
  assert.equal(none.empty, true);
  assert.deepEqual(hidden('raktim@example.com +91 98765 43210', none), []);
  assert.deepEqual(all.find('a@b.co'), [[0, 6]]);
});

test('scrub replaces matches for titles and notifications', () => {
  assert.equal(D.scrub(all, 'Inbox (3) - raktim.yoddha@gmail.com - Gmail'), 'Inbox (3) - ••••• - Gmail');
});

test('large text stays fast', () => {
  const text = ('lorem ipsum 2026 dolor sit amet, consectetur 12.5% adipiscing ').repeat(5000) + ' a@b.co';
  const t = performance.now();
  assert.equal(all.find(text).length, 1);
  assert.ok(performance.now() - t < 1500, 'scan took too long');
});

test('pathological inputs do not hang the regexes', () => {
  const inputs = [
    'a@' + 'a.'.repeat(5000) + '1',
    'x'.repeat(20000) + '@',
    '1 '.repeat(10000),
    '1-'.repeat(10000) + 'x',
    '+' + '9'.repeat(20000),
    'password=' + 'x'.repeat(20000),
    ':'.repeat(5000) + 'f'.repeat(5000),
    'eyJ' + 'a'.repeat(10000) + '.eyJ' + 'b'.repeat(10000),
  ];
  for (const text of inputs) {
    const t = performance.now();
    all.find(text);
    assert.ok(performance.now() - t < 800, `slow on ${text.slice(0, 20)}…`);
  }
});
