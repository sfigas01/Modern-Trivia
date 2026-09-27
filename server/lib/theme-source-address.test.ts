import { describe, expect, it, vi } from 'vitest';

import {
  isPublicSourceAddress,
  resolvePublicSourceAddresses,
  SourceAddressError,
  type SourceAddress,
} from './theme-source-address';

describe('source address validation', () => {
  it.each([
    ['8.8.8.8', 4, true],
    ['10.0.0.1', 4, false],
    ['127.0.0.1', 4, false],
    ['169.254.1.1', 4, false],
    ['100.64.0.1', 4, false],
    ['198.18.0.1', 4, false],
    ['192.0.2.1', 4, false],
    ['224.0.0.1', 4, false],
    ['0.0.0.0', 4, false],
    ['2606:4700:4700::1111', 6, true],
    ['::1', 6, false],
    ['fe80::1', 6, false],
    ['fc00::1', 6, false],
    ['::ffff:8.8.8.8', 6, false],
    ['2001:db8::1', 6, false],
    ['2001:2::1', 6, false],
    ['2001:20::1', 6, false],
    ['2001:30::1', 6, false],
    ['2002::1', 6, false],
    ['2620:4f:8000::1', 6, false],
    ['3fff::1', 6, false],
  ] as const)('%s public=%s', (address, family, expected) => {
    expect(isPublicSourceAddress({ address, family })).toBe(expected);
  });

  it('rejects any mixed, empty, excessive, or malformed DNS answer set', async () => {
    const invalid: SourceAddress[][] = [
      [],
      [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      [{ address: '8.8.8.8', family: 6 }],
      Array.from({ length: 17 }, () => ({ address: '8.8.8.8', family: 4 })),
    ];
    for (const answers of invalid) {
      await expect(
        resolvePublicSourceAddresses(
          'example.org',
          vi.fn().mockResolvedValue(answers),
          Date.now() + 1000
        )
      ).rejects.toMatchObject({ code: 'blocked_address' });
    }
  });

  it('rejects literal hostnames and enforces the deadline', async () => {
    const resolver = vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    await expect(
      resolvePublicSourceAddresses('127.0.0.1', resolver, Date.now() + 1000)
    ).rejects.toBeInstanceOf(SourceAddressError);
    expect(resolver).not.toHaveBeenCalled();
    await expect(resolvePublicSourceAddresses('example.org', resolver, 0)).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});
