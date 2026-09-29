import { EventEmitter } from 'node:events';
import * as https from 'node:https';

import { describe, expect, it, vi } from 'vitest';

import { createPinnedHttpsTransport, MAX_SOURCE_HEADER_BYTES } from './theme-source-https';

function fakeRequest(
  peer: string,
  responseOptions: { contentLength?: string; chunks?: Buffer[]; complete?: boolean } = {}
) {
  let options: Record<string, unknown> = {};
  const request = vi.fn((_url, requestOptions, callback) => {
    options = requestOptions as Record<string, unknown>;
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      end: () => void;
      destroy: (error: Error) => void;
    };
    req.setTimeout = vi.fn();
    req.destroy = (error) => req.emit('error', error);
    req.end = () =>
      queueMicrotask(() => {
        const socket = new EventEmitter() as EventEmitter & { remoteAddress: string };
        socket.remoteAddress = peer;
        req.emit('socket', socket);
        socket.emit('secureConnect');
        const response = new EventEmitter() as EventEmitter & {
          socket: typeof socket;
          statusCode: number;
          rawHeaders: string[];
          complete: boolean;
          destroy: () => void;
        };
        response.socket = socket;
        response.statusCode = 200;
        response.rawHeaders = ['Content-Type', 'text/plain'];
        if (responseOptions.contentLength)
          response.rawHeaders.push('Content-Length', responseOptions.contentLength);
        response.complete = responseOptions.complete ?? true;
        response.destroy = () => response.emit('close');
        callback(response);
        for (const chunk of responseOptions.chunks ?? [Buffer.from('ok')])
          response.emit('data', chunk);
        response.emit('end');
      });
    return req;
  });
  return { request: request as unknown as typeof https.request, options: () => options };
}

describe('pinned native HTTPS transport', () => {
  const url = new URL('https://en.wikipedia.org/wiki/Trivia');
  const address = { address: '208.80.154.224', family: 4 as const };

  it('pins the address while retaining Host, SNI, TLS verification, and fixed bounds', async () => {
    const fake = fakeRequest(address.address);
    const response = await createPinnedHttpsTransport(fake.request)({
      url,
      address,
      signal: new AbortController().signal,
    });
    expect(response).toMatchObject({
      status: 200,
      headers: { 'content-type': ['text/plain'] },
      body: Buffer.from('ok'),
    });
    expect(fake.options()).toMatchObject({
      agent: false,
      servername: 'en.wikipedia.org',
      rejectUnauthorized: true,
      family: 4,
      autoSelectFamily: false,
      maxHeaderSize: MAX_SOURCE_HEADER_BYTES,
      headers: { Host: 'en.wikipedia.org', 'Accept-Encoding': 'identity', Connection: 'close' },
    });
    const lookup = fake.options().lookup as (
      _host: string,
      options: unknown,
      callback: (error: null, address: string, family: number) => void
    ) => void;
    const callback = vi.fn();
    lookup('en.wikipedia.org', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, address.address, 4);
  });

  it('rejects a different peer, oversized Content-Length, streamed excess, and premature close', async () => {
    await expect(
      createPinnedHttpsTransport(fakeRequest('127.0.0.1').request)({
        url,
        address,
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: 'unreadable_content' });
    await expect(
      createPinnedHttpsTransport(
        fakeRequest(address.address, { contentLength: '2097153' }).request
      )({ url, address, signal: new AbortController().signal })
    ).rejects.toMatchObject({ code: 'response_too_large' });
    await expect(
      createPinnedHttpsTransport(
        fakeRequest(address.address, { chunks: [Buffer.alloc(2 * 1024 * 1024 + 1)] }).request
      )({ url, address, signal: new AbortController().signal })
    ).rejects.toMatchObject({ code: 'response_too_large' });
    await expect(
      createPinnedHttpsTransport(fakeRequest(address.address, { complete: false }).request)({
        url,
        address,
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: 'unreadable_content' });
  });
});
