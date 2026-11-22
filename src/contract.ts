import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  MAX_CUSTOM_NAME_LENGTH,
  MAX_ID_LENGTH,
  MAX_MODELS,
  MAX_NAME_LENGTH,
  MAX_PROJECTS,
  MAX_PROVIDERS,
  normalizeRule,
  validId,
} from "./profiles";

const idSchema = z.string().min(1).max(MAX_ID_LENGTH).refine(validId, "Invalid ID");
const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const ruleSchema = z
  .object({
    enabled: z.boolean(),
    limit: z.boolean(),
    modelIds: z.array(idSchema).max(MAX_MODELS),
  })
  .strict()
  .refine((rule) => !rule.limit || rule.modelIds.length > 0, "Select at least one model")
  .transform(normalizeRule);
const defaultModelSchema = z
  .object({
    providerId: idSchema,
    model: idSchema,
    reasoningLevel: idSchema.optional(),
  })
  .strict();
const profileSchema = z
  .object({
    id: idSchema,
    name: nameSchema,
    projectIds: z.array(idSchema).max(MAX_PROJECTS),
    providers: z
      .record(
        idSchema,
        z
          .object({
            enabled: z.boolean(),
            limit: z.boolean(),
            modelIds: z.array(idSchema).max(MAX_MODELS),
          })
          .strict(),
      )
      .refine((providers) => Object.keys(providers).length <= MAX_PROVIDERS, "Too many configured providers"),
    defaultModel: defaultModelSchema.optional(),
  })
  .strict();
const hiddenModelsSchema = z.enum(["more", "remove"]);
const snapshotSchema = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    hiddenModels: hiddenModelsSchema,
    profiles: z.array(profileSchema).min(1),
  })
  .strict();
const customModelSchema = z
  .object({
    providerId: idSchema,
    model: idSchema,
    displayName: z.string().optional(),
  })
  .strict();
const customModelsResultSchema = z
  .object({
    models: z.array(customModelSchema),
    warning: z.string().optional(),
  })
  .strict();
export const rpcContract = defineRpcContract({
  getSnapshot: { input: z.null(), output: snapshotSchema },
  setHiddenModels: {
    input: z.object({ mode: hiddenModelsSchema }).strict(),
    output: snapshotSchema,
  },
  createProfile: {
    input: z.object({ name: nameSchema, copyFromId: idSchema }).strict(),
    output: z.object({ snapshot: snapshotSchema, id: idSchema }).strict(),
  },
  renameProfile: {
    input: z.object({ id: idSchema, name: nameSchema }).strict(),
    output: snapshotSchema,
  },
  deleteProfile: {
    input: z.object({ id: idSchema }).strict(),
    output: snapshotSchema,
  },
  setProfileProjects: {
    input: z.object({ id: idSchema, projectIds: z.array(idSchema).max(MAX_PROJECTS) }).strict(),
    output: snapshotSchema,
  },
  setProvider: {
    input: z.object({ profileId: idSchema, providerId: idSchema, rule: ruleSchema }).strict(),
    output: snapshotSchema,
  },
  setDefaultModel: {
    input: z
      .object({
        profileId: idSchema,
        defaultModel: defaultModelSchema.nullable(),
      })
      .strict(),
    output: snapshotSchema,
  },
  reset: { input: z.null(), output: snapshotSchema },
  listCustomModels: {
    input: z.null(),
    output: z.object({ models: z.array(customModelSchema) }).strict(),
  },
  addCustomModel: {
    input: z
      .object({
        providerId: idSchema,
        model: idSchema,
        displayName: z.string().trim().min(1).max(MAX_CUSTOM_NAME_LENGTH).optional(),
      })
      .strict(),
    output: customModelsResultSchema,
  },
  removeCustomModel: {
    input: z.object({ providerId: idSchema, model: idSchema }).strict(),
    output: customModelsResultSchema,
  },
});
