/**
 * RuleTester unit tests for eslint-rules/no-cross-table-orderby.
 *
 * Covers the bug class introduced in commit c6f8f5a (api/teams 500):
 *   db.query.teamMembers.findMany({ orderBy: desc(teams.updatedAt) })
 *
 * Valid cases:
 *   - orderBy on root-table column (single value)
 *   - orderBy on root-table column (array form)
 *   - orderBy as fields-callback
 *   - findFirst with safe orderBy
 *   - completely unrelated call expressions (not db.query.*.findMany)
 *
 * Invalid cases:
 *   - orderBy: desc(<otherTable>.col)
 *   - orderBy: [asc(<otherTable>.col), desc(<rootTable>.col)] — only otherTable flagged
 *   - orderBy: <otherTable>.col directly (no wrapping desc/asc call)
 *   - findFirst with cross-table orderBy
 */

import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule from '../../../eslint-rules/no-cross-table-orderby.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

ruleTester.run('no-cross-table-orderby', rule, {
  valid: [
    // root-table column is fine
    {
      code: `
        const userTeams = await db.query.teamMembers.findMany({
          where: eq(teamMembers.userId, id),
          orderBy: desc(teamMembers.createdAt),
        });
      `,
    },
    // array form, all root-table columns
    {
      code: `
        const rows = await db.query.policies.findMany({
          orderBy: [asc(policies.name), desc(policies.updatedAt)],
        });
      `,
    },
    // fields-callback form is safe by construction
    {
      code: `
        const rows = await db.query.policies.findMany({
          orderBy: (fields, ops) => ops.desc(fields.updatedAt),
        });
      `,
    },
    // findFirst on the right table — even with desc wrapper
    {
      code: `
        const row = await db.query.teams.findFirst({
          where: eq(teams.slug, slug),
          orderBy: desc(teams.updatedAt),
        });
      `,
    },
    // unrelated call expressions — not db.query.*.findMany
    {
      code: `
        const result = db.select().from(teamMembers).orderBy(desc(teams.updatedAt));
      `,
    },
    // opaque identifier — rule skips because it can't know the shape
    {
      code: `
        const ordering = desc(teams.updatedAt);
        const rows = await db.query.teamMembers.findMany({
          orderBy: ordering,
        });
      `,
    },
    // upper-case identifier on the left of MemberExpression — skipped to
    // avoid false-positives on sql tags, enum values, helper namespaces.
    {
      code: `
        const rows = await db.query.teamMembers.findMany({
          orderBy: desc(Helpers.someConst),
        });
      `,
    },
    // No arguments → rule skips
    {
      code: `
        const rows = await db.query.teamMembers.findMany();
      `,
    },
  ],

  invalid: [
    // The exact bug from c6f8f5a
    {
      code: `
        const userTeams = await db.query.teamMembers.findMany({
          where: eq(teamMembers.userId, id),
          with: { team: { with: { members: {} } } },
          orderBy: desc(teams.updatedAt),
        });
      `,
      errors: [
        {
          messageId: 'crossTableOrderBy',
          data: { table: 'teams', column: 'updatedAt', root: 'teamMembers' },
        },
      ],
    },
    // Array form, mixed — only the offender is reported
    {
      code: `
        const rows = await db.query.teamMembers.findMany({
          orderBy: [asc(teams.name), desc(teamMembers.createdAt)],
        });
      `,
      errors: [
        {
          messageId: 'crossTableOrderBy',
          data: { table: 'teams', column: 'name', root: 'teamMembers' },
        },
      ],
    },
    // Direct MemberExpression with no desc/asc wrapper
    {
      code: `
        const rows = await db.query.teamMembers.findMany({
          orderBy: teams.updatedAt,
        });
      `,
      errors: [
        {
          messageId: 'crossTableOrderBy',
          data: { table: 'teams', column: 'updatedAt', root: 'teamMembers' },
        },
      ],
    },
    // findFirst variant
    {
      code: `
        const row = await db.query.policies.findFirst({
          where: eq(policies.id, id),
          orderBy: desc(versions.createdAt),
        });
      `,
      errors: [
        {
          messageId: 'crossTableOrderBy',
          data: { table: 'versions', column: 'createdAt', root: 'policies' },
        },
      ],
    },
    // tx.query.* should be caught too (any LHS is fine)
    {
      code: `
        await tx.query.teamMembers.findMany({
          orderBy: desc(teams.updatedAt),
        });
      `,
      errors: [{ messageId: 'crossTableOrderBy' }],
    },
    // Multiple offenders inside an array — both flagged
    {
      code: `
        const rows = await db.query.teamMembers.findMany({
          orderBy: [asc(teams.name), desc(users.createdAt)],
        });
      `,
      errors: [
        { messageId: 'crossTableOrderBy', data: { table: 'teams', column: 'name', root: 'teamMembers' } },
        { messageId: 'crossTableOrderBy', data: { table: 'users', column: 'createdAt', root: 'teamMembers' } },
      ],
    },
  ],
});
