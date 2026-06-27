import { describe, it, expect } from 'vitest';
import { isPrivateCleartextHost, assertSafeBackendUrl } from './netGuard.js';

describe('isPrivateCleartextHost', () => {
  it('accepts tailnet CGNAT 100.64.0.0/10', () => {
    expect(isPrivateCleartextHost('100.88.196.41')).toBe(true);
    expect(isPrivateCleartextHost('100.64.0.1')).toBe(true);
    expect(isPrivateCleartextHost('100.127.255.254')).toBe(true);
  });
  it('rejects 100.x outside the 64-127 second octet', () => {
    expect(isPrivateCleartextHost('100.63.0.1')).toBe(false); // public
    expect(isPrivateCleartextHost('100.128.0.1')).toBe(false); // public
  });
  it('accepts RFC1918 ranges', () => {
    expect(isPrivateCleartextHost('192.168.1.9')).toBe(true);
    expect(isPrivateCleartextHost('10.0.0.5')).toBe(true);
    expect(isPrivateCleartextHost('172.16.4.4')).toBe(true);
    expect(isPrivateCleartextHost('172.31.255.1')).toBe(true);
  });
  it('rejects 172.x outside 16-31', () => {
    expect(isPrivateCleartextHost('172.15.0.1')).toBe(false);
    expect(isPrivateCleartextHost('172.32.0.1')).toBe(false);
  });
  it('accepts loopback', () => {
    expect(isPrivateCleartextHost('127.0.0.1')).toBe(true);
    expect(isPrivateCleartextHost('::1')).toBe(true);
    expect(isPrivateCleartextHost('localhost')).toBe(true);
  });
  it('accepts single-label hosts (MagicDNS short names)', () => {
    expect(isPrivateCleartextHost('vm-101')).toBe(true);
    expect(isPrivateCleartextHost('jaghelm')).toBe(true);
  });
  it('accepts Tailscale MagicDNS *.ts.net', () => {
    expect(isPrivateCleartextHost('vm-101.tailb0a7.ts.net')).toBe(true);
    expect(isPrivateCleartextHost('host.TS.NET')).toBe(true);
  });
  it('accepts Tailscale IPv6 ULA fd7a:115c:a1e0::/48', () => {
    expect(isPrivateCleartextHost('fd7a:115c:a1e0::1')).toBe(true);
  });
  it('rejects public IPs and public domains', () => {
    expect(isPrivateCleartextHost('8.8.8.8')).toBe(false);
    expect(isPrivateCleartextHost('1.1.1.1')).toBe(false);
    expect(isPrivateCleartextHost('example.com')).toBe(false);
    expect(isPrivateCleartextHost('jaghelm.example.com')).toBe(false);
  });
});

describe('assertSafeBackendUrl', () => {
  it('allows https to any host', () => {
    expect(() => assertSafeBackendUrl('https://jaghelm.example.com')).not.toThrow();
    expect(() => assertSafeBackendUrl('https://8.8.8.8')).not.toThrow();
  });
  it('allows http to private/tailnet hosts (with port)', () => {
    expect(() => assertSafeBackendUrl('http://100.88.196.41:3099')).not.toThrow();
    expect(() => assertSafeBackendUrl('http://192.168.1.9:3099')).not.toThrow();
    expect(() => assertSafeBackendUrl('http://vm-101:3099')).not.toThrow();
    expect(() => assertSafeBackendUrl('http://host.ts.net')).not.toThrow();
  });
  it('throws cleartext-public for http to a public host', () => {
    expect(() => assertSafeBackendUrl('http://example.com:3099')).toThrow(/cleartext-public/);
    expect(() => assertSafeBackendUrl('http://8.8.8.8')).toThrow(/cleartext-public/);
  });
  it('throws invalid-url for unparseable input', () => {
    expect(() => assertSafeBackendUrl('not a url')).toThrow(/invalid-url/);
    expect(() => assertSafeBackendUrl('ftp://vm-101')).toThrow(/invalid-url/);
  });
});
