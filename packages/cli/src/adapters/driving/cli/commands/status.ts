import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { ConfigRepository } from "../../../../ports/ConfigRepository.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const statusCommand = Command.make("status", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const config = yield* ConfigRepository;

    const exists = yield* config.exists();
    if (!exists) {
      if (json) {
        yield* Console.log(JSON.stringify({ configured: false, reason: "no_config" }));
      } else {
        yield* Console.log("Ship is not configured. Run 'ship init' to set up.");
      }
      return;
    }

    const partial = yield* config.loadPartial();

    const hasAuth = Option.isSome(partial.auth);
    const hasLinear = Option.isSome(partial.linear);

    if (!hasAuth) {
      if (json) {
        yield* Console.log(JSON.stringify({ configured: false, reason: "no_auth" }));
      } else {
        yield* Console.log("Ship is not configured. Run 'ship login' to authenticate.");
      }
      return;
    }

    if (!hasLinear) {
      if (json) {
        yield* Console.log(JSON.stringify({ configured: false, reason: "no_team" }));
      } else {
        yield* Console.log("Ship is not configured. Run 'ship init' to select a team.");
      }
      return;
    }

    const linear = partial.linear.value;
    if (json) {
      yield* Console.log(
        JSON.stringify({
          configured: true,
          teamId: linear.teamId,
          teamKey: linear.teamKey,
          projectId: Option.getOrNull(linear.projectId),
        }),
      );
    } else {
      let output = `Ship is configured.\n\nTeam: ${linear.teamKey}`;
      if (Option.isSome(linear.projectId)) {
        output += `\nProject: ${linear.projectId.value}`;
      }
      yield* Console.log(output);
    }
  }),
);
