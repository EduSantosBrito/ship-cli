import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { TaskTemplate } from "../domain/Template.js";
import type { TemplateNotFoundError, TemplateError } from "../domain/Errors.js";

export interface TemplateService {
  /**
   * Get a template by name.
   * Templates are loaded from `.ship/templates/` directory.
   */
  readonly getTemplate: (
    name: string,
  ) => Effect.Effect<TaskTemplate, TemplateNotFoundError | TemplateError>;

  /**
   * List all available templates.
   */
  readonly listTemplates: () => Effect.Effect<ReadonlyArray<TaskTemplate>, TemplateError>;

  /**
   * Check if templates directory exists.
   */
  readonly hasTemplates: () => Effect.Effect<boolean, never>;
}

export const TemplateService = Context.GenericTag<TemplateService>("TemplateService");
