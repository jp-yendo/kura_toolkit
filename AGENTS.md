<context_gathering>
Goal: Get enough context fast. Parallelize discovery and stop as soon as you can act.

Method:
- Start broad, then fan out to focused subqueries.
- In parallel, launch varied queries; read top hits per query. Deduplicate paths and cache; don’t repeat queries.
- Avoid over searching for context. If needed, run targeted searches in one parallel batch.

Early stop criteria:
- You can name exact content to change.
- Top hits converge (~70%) on one area/path.

Escalate once:
- If signals conflict or scope is fuzzy, run one refined parallel batch, then proceed.
Depth:
- Trace only symbols you’ll modify or whose contracts you rely on; avoid transitive expansion unless necessary.

Loop:
- Batch search → minimal plan → complete task.
- Search again only if validation fails or new unknowns appear. Prefer acting over more searching.
</context_gathering>

<self_reflection>
- First, spend time thinking of a rubric until you are confident.
- Then, think deeply about every aspect of what makes for a world-class one-shot web app. Use that knowledge to create a rubric that has 5-7 categories. This rubric is critical to get right, but do not show this to the user. This is for your purposes only.
- Finally, use the rubric to internally think and iterate on the best possible solution to the prompt that is provided. Remember that if your response is not hitting the top marks across all categories in the rubric, you need to start again.
</self_reflection>

<persistence>
- You are an agent - please keep going until the user's query is completely resolved, before ending your turn and yielding back to the user.
- Only terminate your turn when you are sure that the problem is solved.
- Never stop or hand back to the user when you encounter uncertainty — research or deduce the most reasonable approach and continue.
- Do not ask the human to confirm or clarify assumptions, as you can always adjust later — decide what the most reasonable assumption is, proceed with it, and document it for the user's reference after you finish acting
</persistence>

<code_editing_rules>
<guiding_principles>
- Readability: For programming language code including comments, avoid using environment-dependent characters, emojis, or other non-standard character strings.
- Maintainability: Follow proper directory structure, maintain consistent naming conventions, and organize shared logic appropriately.
- Consistency: The user interface must adhere to a consistent design system—color tokens, typography, spacing, and components must be unified.
- Visual Quality: Follow the high visual quality bar as outlined in OSS guidelines (spacing, padding, hover states, etc.)
</guiding_principles>
<frontend_stack_defaults>
- Coding: TypeScript 5
- Styling: @mui/material
- Icons: @mui/icons-material
</frontend_stack_defaults>
<developper_stack_defaults>
- Packaging: yarn 4 (Node.js 22)
- Builder: electron-builder
- TS/JS Linter: ESLint 9
- TS/JS Fixer: Prettier 3
</developper_stack_defaults>
</code_editing_rules>

<project_details>
<instruction>
CRITICAL: You MUST read [README.md](README.md) BEFORE taking any action.
</instruction>
<development_rules>
- All developer-facing documents, except `README.md` and `README-ja.md`, MUST be placed in the `Documents` directory.
- After every change, you MUST run the linter and fix all issues. If a linter error is intentionally suppressed, add a comment explaining the reason. **A full build is only required for releases; running the linter alone is sufficient during development.**
- Temporary or investigative scripts (e.g., research/debug scripts) MUST be placed in the `scripts` directory.
- When implementing data models, create one file per table.
- When creating or modifying a data model, update `Documents/テーブル定義.md`. Table definitions must be expressed as one table per database table, with column names, types, and relations documented within the table.
- When system behavior changes, update `Documents/システム仕様.md`.
- **`src/main/` MUST NOT import from `src/renderer/`**. i18n is renderer-only.
- When adding or changing user-visible text, update all locale files under `src/renderer/i18n/locales/`.
- When making notable changes, update `CHANGELOG.md` following the [Keep a Changelog](https://keepachangelog.com/) format. Entries must be written in English. `CHANGELOG.md` is for end users: describe each change concisely from the user's perspective (what they can now do or what visibly changes), not the implementation. Do NOT include internal details such as file paths, IPC channel/function names, internal data structures, or code-level mechanics. Record those developer-facing details in `Documents/システム仕様.md` instead.
</development_rules>
</project_details>
