---
name: flowml
description: FlowML CLI and YAML DSL for Salesforce Flow. Use this skill when planning or working on Salesforce flow meta-xml files or flowml files
---

FlowML is a YAML-based DSL that transpiles bidirectionally with Salesforce Flow XML, reducing file size by ~60-75% and making flows readable for humans and efficient for LLMs. Files use the `.flowml` extension.

## CLI Commands Reference

- `flowml init` — Set up `.vscode/settings.json` schema association and `.forceignore` entries for `flowml/`.
- `flowml syntax` — Print the full syntax reference (run this first when authoring flows).
- `flowml best-practices` — Print the full best-practices guide (run this first when reviewing flows).
- `flowml fromxml [file]` — Convert Salesforce Flow XML to `.flowml` YAML. With a file path, bare flow name, or `--flow <name>`, converts one flow; without, converts all flows in the source directory. Writes to `flowml/` by default. Canvas coordinates and metadata ordering are preserved by default; pass `--compact` to strip them and minimize token count (lossy round-trip). A missing explicitly named flow fails with a nonzero exit.
- `flowml toxml [file]` — Convert `.flowml` back to `.flow-meta.xml` for deployment. With a file path, bare flow name, or `--flow <name>`, converts one flow; without, converts all. It skips newline-equivalent unchanged outputs and reports created, updated, and unchanged counts plus updated flow names. Conversion completes before writes begin, so a conversion failure does not leave partial output. Use `--dry-run` to preview changes without writing. Pass `--active` only when the output should be activated. A missing explicitly named flow fails with a nonzero exit.
- `flowml lint [file]` — Validate schema and score against the 110-point best-practices rubric. The target may be a `.flowml` or `.flow-meta.xml` path or a bare flow name. Bare names resolve from the FlowML source directory first, then Salesforce package flow directories; `--source` sets the bare-name search root. Ambiguous matches fail instead of choosing silently. Use `--format json` for structured output, `--threshold <score>` to fail CI, and `--check` to also run a dry-run deploy.
- `flowml check [file]` — Dry-run deploy to validate against a Salesforce org. Requires `[file]` or `--flow <name>`, plus `--target-org <alias>`. Validates at the flow's declared `apiVersion` (not the project's `sourceApiVersion`); override with `--api-version <version>`.
- `flowml roundtrip [file]` — Test XML → FlowML → XML round-trip fidelity with a newline-equivalent structural comparator. Exact matches pass; formatting, element-order, semantic, and conversion-error outcomes fail with a nonzero exit. Pass `--compact` to exercise documented lossy compact mode; structural differences still fail the check.

## Workflow Process

Follow these steps as your process to work with FlowML files:

1. Always run `flowml syntax` and `flowml best-practices` to understand the syntax and best-practices if you haven't yet
2. If you are updating an existing flow run `flowml fromxml <flowName>` to convert the flow meta-xml file to a FlowML file
3. Create or modify the FlowML file to achieve the desired outcome
4. Run `flowml lint <flowName>` to validate that the flow passes linting
5. Run `flowml check <flowName> --target-org <alias>` to confirm it will convert and deploy
6. Run `flowml toxml <flowName>` to regenerate only that Flow XML file. Add `--active` only when activation is intended
7. If the user hasn't specified whether to deploy yet, ask them. Deploy the regenerated `.flow-meta.xml` with the `sf` CLI only when they have asked you to

## Workflow Standards

- **ALWAYS** prefer editing `.flowml` files over `.flow-meta.xml`. Never hand-edit Flow XML when a FlowML equivalent exists.
- **ALWAYS** run `flowml lint <file>` after any edit and address warnings before deployment.
- **ALWAYS** run scoped `flowml toxml <flowName>` after editing one flow and before deploying. Use `--dry-run` when previewing a bulk conversion
- **NEVER** invent syntax — if something isn't in the output of `flowml syntax`, it doesn't exist. If syntax is missing report it to the user
- **NEVER** edit generated `.flow-meta.xml` directly if a `.flowml` source exists; your changes will be overwritten on the next `toxml`.
- **ALWAYS** use the check command when iterating to ensure that your changes are valid
- When converting an existing flow for the first time, run `flowml fromxml <flowName>` then `flowml lint` on the result to surface any best-practice issues in the original.
- **ALWAYS** report any bugs or issues to the user, don't just silently use workarounds. FlowML is under active development, so bugs should be reported to the FlowML repo maintainers to be fixed.

## Known Syntax Gaps

- **Run Asynchronously path (record-triggered flows):** supported by the transpiler but missing from `flowml syntax` as of 2026-09-18. Write it as a `trigger.scheduledPaths` item with `name: ""`, `pathType: AsyncAfterCommit` and `next:` (no `timeSource`/offset keys); the Start element then needs no top-level `next`. Verified by `fromxml` on an existing async flow plus a clean lint, `toxml` and deploy. When `flowml syntax` lacks something, run `fromxml` on an org flow that already uses the feature before concluding it is unsupported.
- **Transform `transformType: map` is broken (2026-09-21):** it emits `<collectionProcessors>` with `MapCollectionProcessor`, which Salesforce rejects ("not a valid value for the enum 'FlowCollectionProcessorType'"). Use a loop plus an assignment (`varCol += Loop.Field`) until the transpiler is fixed; report it to the user if not yet fixed.
- **A lookup with explicit `fields:` has no output variable** unless `outputReference:` (or `outputs:`) is set; a downstream `LookupName isEmpty` check fails at `check` time. Bind the result to a declared SObject collection via `outputReference`.
- **Async and scheduled paths never run in Apex tests** (`Test.stopTest()` does not execute them; confirmed in debug logs 2026-09-21, Salesforce support confirms no workaround). Apex tests can only cover the synchronous part and entry-condition skips of such a flow; verify the async work in the org through the UI instead.
