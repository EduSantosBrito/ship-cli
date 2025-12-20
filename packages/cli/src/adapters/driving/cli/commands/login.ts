import * as Command from "@effect/cli/Command";
import * as Effect from "effect/Effect";
import * as clack from "@clack/prompts";
import { AuthService } from "../../../../ports/AuthService.js";

export const loginCommand = Command.make("login", {}, () =>
  Effect.gen(function* () {
    const auth = yield* AuthService;

    clack.intro("ship login");

    clack.note(
      "Create a personal API key at:\nhttps://linear.app/settings/api",
      "Linear Authentication",
    );

    const apiKey = yield* Effect.tryPromise({
      try: () =>
        clack.text({
          message: "Paste your API key",
          placeholder: "lin_api_...",
          validate: (value) => {
            if (!value) return "API key is required";
            if (!value.startsWith("lin_api_")) return "API key should start with lin_api_";
          },
        }),
      catch: () => new Error("Prompt cancelled"),
    });

    if (clack.isCancel(apiKey)) {
      clack.cancel("Login cancelled");
      return;
    }

    const spinner = clack.spinner();
    spinner.start("Validating API key...");

    yield* auth
      .saveApiKey(apiKey as string)
      .pipe(Effect.tapError(() => Effect.sync(() => spinner.stop("Invalid API key"))));

    spinner.stop("API key validated");

    clack.outro("Run 'ship init' to select your team and project.");
  }),
);
