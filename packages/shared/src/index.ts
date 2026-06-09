/**
 * @xeno/shared — the single source of truth for cross-app contracts.
 *
 * Everything here is Zod: each schema is exported as `<Name>Schema` (a runtime value) with
 * its inferred TS type alongside it. These contracts are FROZEN after the skeleton phase;
 * changing them is a cross-track event. No DB, NestJS, or app imports live in this package.
 */
export * from "./enums";
export * from "./segment";
export * from "./dto";
export * from "./ai";
