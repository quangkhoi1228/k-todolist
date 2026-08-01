/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_pm from "../agents_pm.js";
import type * as emails from "../emails.js";
import type * as groups from "../groups.js";
import type * as knownRecipients from "../knownRecipients.js";
import type * as notes from "../notes.js";
import type * as projectChats from "../projectChats.js";
import type * as projectIsdData from "../projectIsdData.js";
import type * as projectMembers from "../projectMembers.js";
import type * as projectRoles from "../projectRoles.js";
import type * as projectSuggestions from "../projectSuggestions.js";
import type * as projects from "../projects.js";
import type * as storage from "../storage.js";
import type * as syncLogs from "../syncLogs.js";
import type * as tasks from "../tasks.js";
import type * as testChats from "../testChats.js";
import type * as userPreferences from "../userPreferences.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents_pm: typeof agents_pm;
  emails: typeof emails;
  groups: typeof groups;
  knownRecipients: typeof knownRecipients;
  notes: typeof notes;
  projectChats: typeof projectChats;
  projectIsdData: typeof projectIsdData;
  projectMembers: typeof projectMembers;
  projectRoles: typeof projectRoles;
  projectSuggestions: typeof projectSuggestions;
  projects: typeof projects;
  storage: typeof storage;
  syncLogs: typeof syncLogs;
  tasks: typeof tasks;
  testChats: typeof testChats;
  userPreferences: typeof userPreferences;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
