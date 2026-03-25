import { compat, types as T } from "../deps.ts";

export const migration: T.ExpectedExports.migration = compat.migrations.fromMapping(
  {},
  "2.0.4",
);
