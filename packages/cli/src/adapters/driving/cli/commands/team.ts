import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as clack from "@clack/prompts";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";
import { AuthService } from "../../../../ports/AuthService.js";
import { TeamRepository } from "../../../../ports/TeamRepository.js";
import { LinearConfig } from "../../../../domain/Config.js";
import type { Team, TeamId } from "../../../../domain/Task.js";

const CREATE_NEW = "__create_new__" as const;

export const teamCommand = Command.make("team", {}, () =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;
    const auth = yield* AuthService;
    const teamRepo = yield* TeamRepository;

    clack.intro("ship team");

    // Check authentication
    const isAuth = yield* auth.isAuthenticated();
    if (!isAuth) {
      clack.log.error("Not authenticated. Run 'ship login' first.");
      clack.outro("Setup required");
      return;
    }

    // Show current team
    const partial = yield* config.loadPartial();
    if (Option.isSome(partial.linear)) {
      clack.log.info(`Current team: ${partial.linear.value.teamKey}`);
    }

    // Fetch teams
    const spinner = clack.spinner();
    spinner.start("Fetching teams...");
    const teams = yield* teamRepo.getTeams();
    spinner.stop("Teams loaded");

    // Select team or create new
    const currentTeamId = Option.isSome(partial.linear) ? partial.linear.value.teamId : null;
    const teamOptions: Array<{ value: TeamId | typeof CREATE_NEW; label: string; hint?: string }> =
      [
        ...teams.map((t) =>
          currentTeamId === t.id
            ? { value: t.id, label: `${t.key} - ${t.name}`, hint: "current" as const }
            : { value: t.id, label: `${t.key} - ${t.name}` },
        ),
        { value: CREATE_NEW, label: "Create new team..." },
      ];

    const teamChoice = yield* Effect.tryPromise({
      try: () =>
        clack.select({
          message: "Select a team",
          options: teamOptions,
        }),
      catch: () => new Error("Prompt cancelled"),
    });

    if (clack.isCancel(teamChoice)) {
      clack.cancel("Cancelled");
      return;
    }

    let selectedTeam: Team;

    if (teamChoice === CREATE_NEW) {
      // Create new team
      const teamName = yield* Effect.tryPromise({
        try: () =>
          clack.text({
            message: "Team name",
            placeholder: "My Team",
            validate: (v) => (!v ? "Name is required" : undefined),
          }),
        catch: () => new Error("Prompt cancelled"),
      });

      if (clack.isCancel(teamName)) {
        clack.cancel("Cancelled");
        return;
      }

      const teamKey = yield* Effect.tryPromise({
        try: () =>
          clack.text({
            message: "Team key (short identifier, e.g. ENG)",
            placeholder: "ENG",
            validate: (v) => {
              if (!v) return "Key is required";
              if (!/^[A-Z]{2,5}$/.test(v.toUpperCase())) return "Key must be 2-5 uppercase letters";
            },
          }),
        catch: () => new Error("Prompt cancelled"),
      });

      if (clack.isCancel(teamKey)) {
        clack.cancel("Cancelled");
        return;
      }

      const createSpinner = clack.spinner();
      createSpinner.start("Creating team...");

      selectedTeam = yield* teamRepo.createTeam({
        name: teamName as string,
        key: (teamKey as string).toUpperCase(),
      });

      createSpinner.stop(`Created team: ${selectedTeam.key}`);
    } else {
      const found = teams.find((t) => t.id === teamChoice);
      if (!found) {
        clack.log.error("Selected team not found. Please try again.");
        clack.outro("Error");
        return;
      }
      selectedTeam = found;
    }

    // Save new team config (clears project since it's team-specific)
    const linearConfig = new LinearConfig({
      teamId: selectedTeam.id,
      teamKey: selectedTeam.key,
      projectId: Option.none(),
    });

    yield* config.saveLinear(linearConfig);

    clack.log.success(`Switched to team: ${selectedTeam.key} - ${selectedTeam.name}`);
    clack.outro("Run 'ship project' to select a project.");
  }),
);
