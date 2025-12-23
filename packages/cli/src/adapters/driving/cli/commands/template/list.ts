import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { TemplateService } from "../../../../../ports/TemplateService.js";

const jsonOption = Options.boolean("json").pipe(
  Options.withDescription("Output as JSON"),
  Options.withDefault(false),
);

export const listCommand = Command.make(
  "list",
  { json: jsonOption },
  ({ json }) =>
    Effect.gen(function* () {
      const templateService = yield* TemplateService;

      const templates = yield* templateService.listTemplates();

      if (json) {
        yield* Console.log(
          JSON.stringify({
            templates: templates.map((t) => ({
              name: t.name,
              title: t.title,
              priority: t.priority,
              type: t.type,
              hasDescription: t.description !== undefined,
            })),
          }),
        );
      } else {
        if (templates.length === 0) {
          yield* Console.log("No templates found.");
          yield* Console.log("");
          yield* Console.log("Create templates in .ship/templates/ as YAML files.");
          yield* Console.log("");
          yield* Console.log("Example .ship/templates/bug.yaml:");
          yield* Console.log("  name: bug");
          yield* Console.log('  title: "fix: {title}"');
          yield* Console.log("  priority: high");
          yield* Console.log("  type: bug");
        } else {
          yield* Console.log("Available templates:\n");
          for (const template of templates) {
            yield* Console.log(`  ${template.name}`);
            if (template.title) {
              yield* Console.log(`    Title pattern: ${template.title}`);
            }
            if (template.priority) {
              yield* Console.log(`    Priority: ${template.priority}`);
            }
            if (template.type) {
              yield* Console.log(`    Type: ${template.type}`);
            }
            if (template.description) {
              yield* Console.log(`    Description: (template defined)`);
            }
            yield* Console.log("");
          }
          yield* Console.log(`Use with: ship create --template <name> "Task title"`);
        }
      }
    }),
);
