import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as clack from "@clack/prompts";
import { AuthService } from "../../../../ports/AuthService.js";
import { Prompts } from "../../../../ports/Prompts.js";

export const loginCommand = Command.make("login", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService;
    const prompts = yield* Prompts;

    clack.intro("ship login");

    clack.note(
      "Create a personal API key at:\nhttps://linear.app/settings/api",
      "Linear Authentication",
    );

    const apiKey = yield* prompts.text({
      message: "Paste your API key",
      placeholder: "lin_api_...",
      validate: (value) => {
        if (!value) return "API key is required";
        if (!value.startsWith("lin_api_")) return "API key should start with lin_api_";
        return undefined;
      },
    });

    const spinner = clack.spinner();
    spinner.start("Validating API key...");

    yield* auth.saveApiKey(apiKey).pipe(
      Effect.tap(() => Effect.sync(() => spinner.stop("API key validated"))),
      Effect.tapError(() => Effect.sync(() => spinner.stop("Invalid API key"))),
    );

    clack.outro("Run 'ship init' to select your team and project.");
  }),
);
