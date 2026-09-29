import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import ipaddr from 'ipaddr.js';

export const MAX_DNS_ANSWERS = 16;

export type SourceAddress = { address: string; family: 4 | 6 };
export type SourceLookup = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<SourceAddress[]>;

export class SourceAddressError extends Error {
  constructor(public readonly code: 'blocked_address' | 'timeout') {
    super(code);
  }
}

const ipv4Benchmark = ipaddr.IPv4.parseCIDR('198.18.0.0/15');
const ipv6Global = ipaddr.IPv6.parseCIDR('2000::/3');
// Fail closed on IANA special-purpose allocations, including entries marked globally reachable.
// Review this list against https://www.iana.org/assignments/iana-ipv6-special-registry
// whenever the retrieval policy version changes.
const ipv6SpecialPurpose = [
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  '2620:4f:8000::/48',
  '3fff::/20',
].map((cidr) => ipaddr.IPv6.parseCIDR(cidr));

export function isPublicSourceAddress(value: SourceAddress): boolean {
  if (isIP(value.address) !== value.family) return false;
  if (value.family === 4) {
    const parsed = ipaddr.IPv4.parse(value.address);
    return parsed.range() === 'unicast' && !parsed.match(ipv4Benchmark);
  }
  const parsed = ipaddr.IPv6.parse(value.address);
  return (
    !parsed.zoneId &&
    parsed.range() === 'unicast' &&
    parsed.match(ipv6Global) &&
    !ipv6SpecialPurpose.some((range) => parsed.match(range))
  );
}

export async function resolvePublicSourceAddresses(
  hostname: string,
  lookupAll: SourceLookup = lookup as SourceLookup,
  deadlineAt: number,
  now: () => number = Date.now
): Promise<SourceAddress[]> {
  if (isIP(hostname) || now() >= deadlineAt) {
    throw new SourceAddressError(isIP(hostname) ? 'blocked_address' : 'timeout');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answers: SourceAddress[];
  try {
    answers = await Promise.race([
      lookupAll(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SourceAddressError('timeout')), deadlineAt - now());
      }),
    ]);
  } catch (error) {
    if (error instanceof SourceAddressError) throw error;
    throw new SourceAddressError('blocked_address');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (
    !Array.isArray(answers) ||
    answers.length === 0 ||
    answers.length > MAX_DNS_ANSWERS ||
    !answers.every(
      (answer) =>
        answer &&
        (answer.family === 4 || answer.family === 6) &&
        typeof answer.address === 'string' &&
        isPublicSourceAddress(answer)
    )
  )
    throw new SourceAddressError('blocked_address');
  return answers;
}
