import { useCallback, useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AdvanceRoomResponse,
  AnswerRoomRequest,
  AnswerRoomResponse,
  ContinueRoomResponse,
  EndRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  RoomActionResponse,
  RoomPhase,
  RoomPollResponse,
  RoomSnapshot,
  SkipRoomResponse,
  StartRoomResponse,
} from '@shared/models/rooms';

import { getRoomSession, saveRoomSession } from '@/lib/room-session';

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;
const FAST_POLL_PHASES: readonly RoomPhase[] = ['LOBBY', 'QUESTION', 'REVEAL'];
const DISCONNECT_THRESHOLD = 2;

export function getPollIntervalMs(phase: RoomPhase | undefined): number {
  if (!phase) return FAST_POLL_MS;
  return FAST_POLL_PHASES.includes(phase) ? FAST_POLL_MS : SLOW_POLL_MS;
}

export function buildPollUrl(code: string, sinceVersion?: number): string {
  const base = `/api/rooms/${encodeURIComponent(code)}`;
  return sinceVersion === undefined ? base : `${base}?sinceVersion=${sinceVersion}`;
}

function roomActionUrl(code: string, action: string): string {
  return `/api/rooms/${encodeURIComponent(code)}/${action}`;
}

function authHeaders(code: string): HeadersInit {
  const session = getRoomSession(code);
  return session ? { 'X-Player-Token': session.token } : {};
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      // response had no JSON body; fall back to statusText
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function fetchSnapshot(code: string, sinceVersion: number | undefined): Promise<RoomPollResponse> {
  const res = await fetch(buildPollUrl(code, sinceVersion), {
    credentials: 'include',
    headers: authHeaders(code),
  });
  return parseResponse<RoomPollResponse>(res);
}

async function postRoomAction<TReq, TRes>(code: string, action: string, body: TReq): Promise<TRes> {
  const res = await fetch(roomActionUrl(code, action), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(code),
    },
    body: JSON.stringify(body),
  });
  return parseResponse<TRes>(res);
}

function roomQueryKey(code: string) {
  return ['/api/rooms', code] as const;
}

export interface UseRoomResult {
  snapshot: RoomSnapshot | undefined;
  isLoading: boolean;
  isDisconnected: boolean;
  error: Error | null;
  refetch: UseQueryResult<RoomSnapshot, Error>['refetch'];
  join: UseMutationResult<JoinRoomResponse, Error, JoinRoomRequest>;
  start: UseMutationResult<StartRoomResponse, Error, void>;
  answer: UseMutationResult<AnswerRoomResponse, Error, AnswerRoomRequest>;
  advance: UseMutationResult<AdvanceRoomResponse, Error, void>;
  continueRound: UseMutationResult<ContinueRoomResponse, Error, void>;
  skip: UseMutationResult<SkipRoomResponse, Error, void>;
  end: UseMutationResult<EndRoomResponse, Error, void>;
}

export function useRoom(code: string): UseRoomResult {
  const queryClient = useQueryClient();
  const queryKey = roomQueryKey(code);
  const [failureCount, setFailureCount] = useState(0);

  const query = useQuery<RoomSnapshot>({
    queryKey,
    queryFn: async () => {
      const previous = queryClient.getQueryData<RoomSnapshot>(queryKey);

      try {
        const result = await fetchSnapshot(code, previous?.version);
        setFailureCount(0);

        if ('changed' in result) {
          if (!previous) {
            throw new Error('Room snapshot unavailable');
          }
          return previous;
        }

        return result;
      } catch (err) {
        setFailureCount((count) => count + 1);
        throw err;
      }
    },
    refetchInterval: (fetchQuery) => getPollIntervalMs(fetchQuery.state.data?.phase),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        query.refetch();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [query.refetch]);

  const onActionSuccess = useCallback(
    (response: RoomActionResponse) => {
      queryClient.setQueryData(queryKey, response.snapshot);
    },
    [queryClient, queryKey]
  );

  const join = useMutation({
    mutationFn: (body: JoinRoomRequest) =>
      postRoomAction<JoinRoomRequest, JoinRoomResponse>(code, 'join', body),
    onSuccess: (response) => {
      saveRoomSession({ code, playerId: response.playerId, token: response.token });
      queryClient.setQueryData(queryKey, response.snapshot);
    },
  });

  const start = useMutation({
    mutationFn: () => postRoomAction<Record<string, never>, StartRoomResponse>(code, 'start', {}),
    onSuccess: onActionSuccess,
  });

  const answer = useMutation({
    mutationFn: (body: AnswerRoomRequest) =>
      postRoomAction<AnswerRoomRequest, AnswerRoomResponse>(code, 'answer', body),
    onSuccess: onActionSuccess,
  });

  const advance = useMutation({
    mutationFn: () => postRoomAction<Record<string, never>, AdvanceRoomResponse>(code, 'advance', {}),
    onSuccess: onActionSuccess,
  });

  const continueRound = useMutation({
    mutationFn: () => postRoomAction<Record<string, never>, ContinueRoomResponse>(code, 'continue', {}),
    onSuccess: onActionSuccess,
  });

  const skip = useMutation({
    mutationFn: () => postRoomAction<Record<string, never>, SkipRoomResponse>(code, 'skip', {}),
    onSuccess: onActionSuccess,
  });

  const end = useMutation({
    mutationFn: () => postRoomAction<Record<string, never>, EndRoomResponse>(code, 'end', {}),
    onSuccess: onActionSuccess,
  });

  return {
    snapshot: query.data,
    isLoading: query.isLoading,
    isDisconnected: failureCount >= DISCONNECT_THRESHOLD,
    error: query.error,
    refetch: query.refetch,
    join,
    start,
    answer,
    advance,
    continueRound,
    skip,
    end,
  };
}
