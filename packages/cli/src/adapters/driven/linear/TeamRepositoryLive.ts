import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import { TeamRepository, type CreateTeamInput } from "../../../ports/TeamRepository.js";
import { LinearClientService } from "./LinearClient.js";
import { Team, type TeamId } from "../../../domain/Task.js";
import { LinearApiError, TaskError } from "../../../domain/Errors.js";
import { mapTeam } from "./Mapper.js";

// Retry policy: exponential backoff with max 3 retries
const retryPolicy = Schedule.intersect(
  Schedule.exponential(Duration.millis(100)),
  Schedule.recurs(3),
);

// Timeout for API calls: 30 seconds
const API_TIMEOUT = Duration.seconds(30);

const withRetryAndTimeout = <A, E>(
  effect: Effect.Effect<A, E>,
  operation: string,
): Effect.Effect<A, E | LinearApiError> =>
  effect.pipe(
    Effect.timeoutFail({
      duration: API_TIMEOUT,
      onTimeout: () => new LinearApiError({ message: `${operation} timed out after 30 seconds` }),
    }),
    Effect.retry(retryPolicy),
  );

const make = Effect.gen(function* () {
  const linearClient = yield* LinearClientService;

  const getTeams = (): Effect.Effect<ReadonlyArray<Team>, LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();
        const teams = yield* Effect.tryPromise({
          try: () => client.teams(),
          catch: (e) => new LinearApiError({ message: `Failed to fetch teams: ${e}`, cause: e }),
        });
        return teams.nodes.map(mapTeam);
      }),
      "Fetching teams",
    );

  const getTeam = (id: TeamId): Effect.Effect<Team, LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();
        const team = yield* Effect.tryPromise({
          try: () => client.team(id),
          catch: (e) => new LinearApiError({ message: `Failed to fetch team: ${e}`, cause: e }),
        });
        return mapTeam(team);
      }),
      "Fetching team",
    );

  const createTeam = (input: CreateTeamInput): Effect.Effect<Team, TaskError | LinearApiError> =>
    withRetryAndTimeout(
      Effect.gen(function* () {
        const client = yield* linearClient.client();

        const result = yield* Effect.tryPromise({
          try: () =>
            client.createTeam({
              name: input.name,
              key: input.key,
            }),
          catch: (e) => new LinearApiError({ message: `Failed to create team: ${e}`, cause: e }),
        });

        if (!result.success) {
          return yield* Effect.fail(new TaskError({ message: "Failed to create team" }));
        }

        const team = yield* Effect.tryPromise({
          try: async () => {
            const t = await result.team;
            if (!t) throw new Error("Team not returned");
            return t;
          },
          catch: (e) =>
            new LinearApiError({ message: `Failed to get created team: ${e}`, cause: e }),
        });

        return mapTeam(team);
      }),
      "Creating team",
    );

  return {
    getTeams,
    getTeam,
    createTeam,
  };
});

export const TeamRepositoryLive = Layer.effect(TeamRepository, make);
