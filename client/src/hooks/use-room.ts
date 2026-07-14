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
  CancelDisputeVoteRequest,
  CancelDisputeVoteResponse,
  CastDisputeVoteRequest,
  CastDisputeVoteResponse,
  ContinueRoomResponse,
  EndRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  LeaveRoomResponse,
  RoomActionResponse,
  RoomPhase,
  RoomPollResponse,
  RoomSnapshot,
  SkipRoomResponse,
  StartRoomRequest,
  StartRoomResponse,
  SubmitMultiplayerDisputeRequest,
  SubmitMultiplayerDisputeResponse,
} from '@shared/models/rooms';

import { getRoomSession, saveRoomSession } from '@/lib/room-session';

const FAST_POLL_MS = 2000;
const SLOW_POLL_MS = 5000;
const FAST_POLL_PHASES: readonly RoomPhase[] = ['LOBBY', 'QUESTION', 'REVEAL', 'DISPUTE_VOTE'];
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

export interface RoomActionError extends Error {
  status: number;
}

// Actions racing against the poll (two players answering, advancing a phase
// that already moved on, etc.) land as 409s. Callers should reconcile by
// refetching instead of surfacing an error toast for these.
export function isRoomConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as RoomActionError).status === 409;
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
    const error = new Error(message) as RoomActionError;
    error.status = res.status;
    throw error;
  }
  return res.json() as Promise<T>;
}

async function fetchSnapshot(
  code: string,
  sinceVersion: number | undefined
): Promise<RoomPollResponse> {
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

// Never let a write (poll or mutation response) regress the cache to an
// older version — the two can race, since polls and mutations both hit the
// network concurrently and settle in whatever order the server responds.
export function newerSnapshot(
  candidate: RoomSnapshot,
  current: RoomSnapshot | undefined
): RoomSnapshot {
  return current && current.version >= candidate.version ? current : candidate;
}

export interface UseRoomResult {
  snapshot: RoomSnapshot | undefined;
  isLoading: boolean;
  isDisconnected: boolean;
  error: Error | null;
  refetch: UseQueryResult<RoomSnapshot, Error>['refetch'];
  join: UseMutationResult<JoinRoomResponse, Error, JoinRoomRequest>;
  start: UseMutationResult<StartRoomResponse, Error, StartRoomRequest>;
  answer: UseMutationResult<AnswerRoomResponse, Error, AnswerRoomRequest>;
  advance: UseMutationResult<AdvanceRoomResponse, Error, void>;
  continueRound: UseMutationResult<ContinueRoomResponse, Error, void>;
  skip: UseMutationResult<SkipRoomResponse, Error, void>;
  end: UseMutationResult<EndRoomResponse, Error, void>;
  leave: UseMutationResult<LeaveRoomResponse, Error, void>;
  awardDispute: UseMutationResult<RoomActionResponse, Error, void>;
  submitDispute: UseMutationResult<
    SubmitMultiplayerDisputeResponse,
    Error,
    SubmitMultiplayerDisputeRequest
  >;
  castDisputeVote: UseMutationResult<CastDisputeVoteResponse, Error, CastDisputeVoteRequest>;
  cancelDisputeVote: UseMutationResult<CancelDisputeVoteResponse, Error, void>;
}

export interface UseRoomOptions {
  enabled?: boolean;
}

export function useRoom(code: string, options: UseRoomOptions = {}): UseRoomResult {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const queryKey = roomQueryKey(code);
  const [failureCount, setFailureCount] = useState(0);

  const query = useQuery<RoomSnapshot>({
    queryKey,
    enabled,
    queryFn: async () => {
      const basis = queryClient.getQueryData<RoomSnapshot>(queryKey);

      try {
        const result = await fetchSnapshot(code, basis?.version);
        setFailureCount(0);

        // A mutation (or a faster overlapping poll) may have written a newer
        // snapshot into the cache while this fetch was in flight.
        const current = queryClient.getQueryData<RoomSnapshot>(queryKey);

        if ('changed' in result) {
          if (current) return current;
          throw new Error('Room snapshot unavailable');
        }

        return newerSnapshot(result, current);
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
      queryClient.setQueryData<RoomSnapshot>(queryKey, (current) =>
        newerSnapshot(response.snapshot, current)
      );
    },
    [queryClient, queryKey]
  );

  const join = useMutation({
    mutationFn: (body: JoinRoomRequest) =>
      postRoomAction<JoinRoomRequest, JoinRoomResponse>(code, 'join', body),
    onSuccess: (response) => {
      saveRoomSession({ code, playerId: response.playerId, token: response.token });
      queryClient.setQueryData<RoomSnapshot>(queryKey, (current) =>
        newerSnapshot(response.snapshot, current)
      );
    },
  });

  const start = useMutation({
    mutationFn: (body: StartRoomRequest = {}) =>
      postRoomAction<StartRoomRequest, StartRoomResponse>(code, 'start', body),
    onSuccess: onActionSuccess,
  });

  const answer = useMutation({
    mutationFn: (body: AnswerRoomRequest) =>
      postRoomAction<AnswerRoomRequest, AnswerRoomResponse>(code, 'answer', body),
    onSuccess: onActionSuccess,
  });

  const advance = useMutation({
    mutationFn: () =>
      postRoomAction<Record<string, never>, AdvanceRoomResponse>(code, 'advance', {}),
    onSuccess: onActionSuccess,
  });

  const continueRound = useMutation({
    mutationFn: () =>
      postRoomAction<Record<string, never>, ContinueRoomResponse>(code, 'continue', {}),
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

  const awardDispute = useMutation({
    mutationFn: () =>
      postRoomAction<Record<string, never>, RoomActionResponse>(code, 'award-dispute', {}),
    onSuccess: onActionSuccess,
  });

  const submitDispute = useMutation({
    mutationFn: (body: SubmitMultiplayerDisputeRequest) =>
      postRoomAction<SubmitMultiplayerDisputeRequest, SubmitMultiplayerDisputeResponse>(
        code,
        'disputes',
        body
      ),
    onSuccess: onActionSuccess,
  });

  const castDisputeVote = useMutation({
    mutationFn: (body: CastDisputeVoteRequest) =>
      postRoomAction<CastDisputeVoteRequest, CastDisputeVoteResponse>(code, 'disputes/vote', body),
    onSuccess: onActionSuccess,
  });

  const cancelDisputeVote = useMutation({
    mutationFn: () =>
      postRoomAction<CancelDisputeVoteRequest, CancelDisputeVoteResponse>(
        code,
        'disputes/cancel',
        {}
      ),
    onSuccess: onActionSuccess,
  });

  const leave = useMutation({
    mutationFn: () => postRoomAction<Record<string, never>, LeaveRoomResponse>(code, 'leave', {}),
    onSuccess: (response) => {
      queryClient.setQueryData<RoomSnapshot>(queryKey, (current) =>
        newerSnapshot(response.snapshot, current)
      );
    },
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
    leave,
    awardDispute,
    submitDispute,
    castDisputeVote,
    cancelDisputeVote,
  };
}
