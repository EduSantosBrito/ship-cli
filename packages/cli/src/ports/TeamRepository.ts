import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { Team, TeamId } from "../domain/Task.js";
import type { LinearApiError, TaskError } from "../domain/Errors.js";

export interface CreateTeamInput {
  readonly name: string;
  readonly key: string;
}

export interface TeamRepository {
  readonly getTeams: () => Effect.Effect<ReadonlyArray<Team>, LinearApiError>;
  readonly getTeam: (id: TeamId) => Effect.Effect<Team, LinearApiError>;
  readonly createTeam: (input: CreateTeamInput) => Effect.Effect<Team, TaskError | LinearApiError>;
}

export const TeamRepository = Context.GenericTag<TeamRepository>("TeamRepository");
