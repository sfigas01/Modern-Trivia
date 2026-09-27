import * as https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';

import ipaddr from 'ipaddr.js';

import type { SourceAddress } from './theme-source-address';

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_HEADER_BYTES = 16 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class SourceHttpError extends Error {
  constructor(public readonly code: 'timeout' | 'response_too_large' | 'unreadable_content') {
    super(code);
  }
}

export interface SourceHopResponse {
  status: number;
  headers: Record<string, string[]>;
  body: Buffer;
}

export type SourceTransport = (input: {
  url: URL;
  address: SourceAddress;
  signal: AbortSignal;
}) => Promise<SourceHopResponse>;

function headersOf(response: IncomingMessage): Record<string, string[]> {
  const headers: Record<string, string[]> = {};
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index].toLowerCase();
    (headers[name] ??= []).push(response.rawHeaders[index + 1]);
  }
  return headers;
}

function peerMatches(peer: string | undefined, selected: string): boolean {
  try {
    return Boolean(
      peer &&
      Buffer.from(ipaddr.parse(peer).toByteArray()).equals(
        Buffer.from(ipaddr.parse(selected).toByteArray())
      )
    );
  } catch {
    return false;
  }
}

export function createPinnedHttpsTransport(
  request: typeof https.request = https.request
): SourceTransport {
  return ({ url, address, signal }) =>
    new Promise<SourceHopResponse>((resolve, reject) => {
      let settled = false;
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error: SourceHttpError | null, result?: SourceHopResponse) => {
        if (settled) return;
        settled = true;
        if (connectTimer) clearTimeout(connectTimer);
        if (error) reject(error);
        else resolve(result!);
      };
      const req = request(
        url,
        {
          method: 'GET',
          agent: false,
          servername: url.hostname,
          rejectUnauthorized: true,
          family: address.family,
          autoSelectFamily: false,
          maxHeaderSize: MAX_SOURCE_HEADER_BYTES,
          headers: {
            Host: url.host,
            Accept: 'text/html, text/plain',
            'Accept-Encoding': 'identity',
            Connection: 'close',
          },
          lookup: (_host, _options, callback) => callback(null, address.address, address.family),
          signal,
        } as https.RequestOptions & { autoSelectFamily: false },
        (response) => {
          const socket = response.socket as TLSSocket;
          if (!peerMatches(socket.remoteAddress, address.address)) {
            response.destroy();
            finish(new SourceHttpError('unreadable_content'));
            return;
          }
          const headers = headersOf(response);
          const status = response.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status)) {
            response.destroy();
            finish(null, { status, headers, body: Buffer.alloc(0) });
            return;
          }
          const lengths = headers['content-length'] ?? [];
          if (
            lengths.length > 1 ||
            (lengths.length === 1 &&
              (!/^\d+$/.test(lengths[0]) || Number(lengths[0]) > MAX_SOURCE_BYTES))
          ) {
            response.destroy();
            finish(new SourceHttpError('response_too_large'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > MAX_SOURCE_BYTES) {
              response.destroy();
              finish(new SourceHttpError('response_too_large'));
              return;
            }
            chunks.push(bytes);
          });
          response.on('end', () => {
            if (!response.complete) {
              finish(new SourceHttpError('unreadable_content'));
              return;
            }
            finish(null, { status, headers, body: Buffer.concat(chunks, size) });
          });
          response.on('aborted', () => finish(new SourceHttpError('unreadable_content')));
          response.on('error', () => finish(new SourceHttpError('unreadable_content')));
          response.on('close', () => {
            if (!response.complete) finish(new SourceHttpError('unreadable_content'));
          });
        }
      );
      connectTimer = setTimeout(() => req.destroy(new SourceHttpError('timeout')), 3000);
      req.once('socket', (plainSocket) => {
        const socket = plainSocket as TLSSocket;
        socket.once('secureConnect', () => {
          if (connectTimer) clearTimeout(connectTimer);
          if (!peerMatches(socket.remoteAddress, address.address))
            req.destroy(new SourceHttpError('unreadable_content'));
        });
      });
      req.setTimeout(2000, () => req.destroy(new SourceHttpError('timeout')));
      req.once('error', (error) => {
        finish(
          error instanceof SourceHttpError
            ? error
            : new SourceHttpError(signal.aborted ? 'timeout' : 'unreadable_content')
        );
      });
      req.end();
    });
}
