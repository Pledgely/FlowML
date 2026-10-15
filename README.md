# FlowML

FlowML is a YAML DSL for Salesforce Flow. It converts `.flow-meta.xml` files to `.flowml` YAML and back, cutting file size by roughly 60-75% and listing steps in execution order so flows are readable for people and cheap for LLMs to work with. It also includes a best-practices linter and a round-trip fidelity checker.

## Repository layout

- `packages/core` — the `flowml` library: XML reader, YAML reader/emitter, XML writer, JSON Schema, linter
- `packages/cli` — the `flowml` command-line tool
- `skills/flowml` — a Claude Code skill that teaches an agent the FlowML workflow
- `scripts/corpus-diff.mjs` — round-trips a folder of Flow XML files and reports any differences

## Setup

Requires Node 20.11 or later.

```sh
git clone https://github.com/Pledgely/FlowML.git
cd FlowML
npm install
npm run build
npm install -g ./packages/cli   # puts `flowml` on your PATH, linked to this checkout
```

The global install links to this checkout, so after `git pull` you only need to run `npm run build` again.

## CLI

Run commands from the root of a Salesforce DX project. FlowML files go to `flowml/` by default.

| Command | Purpose |
| --- | --- |
| `flowml init` | Add the `.flowml` schema association to `.vscode/settings.json` and `flowml/` to `.forceignore` |
| `flowml syntax` | Print the full FlowML syntax reference |
| `flowml best-practices` | Print the best-practices guide the linter scores against |
| `flowml fromxml [flow]` | Convert Flow XML to `.flowml` (one flow by name/path, or all flows) |
| `flowml toxml [flow]` | Convert `.flowml` back to `.flow-meta.xml` (`--dry-run` to preview, `--active` to activate) |
| `flowml lint [flow]` | Validate the schema and score the flow on a 110-point best-practices rubric |
| `flowml check [flow] --target-org <alias>` | Dry-run deploy the converted flow to an org |
| `flowml roundtrip [flow]` | Check that XML → FlowML → XML reproduces the original |

Run `flowml <command> --help` for all options.

A typical edit loop is `fromxml` → edit the `.flowml` → `lint` → `check` → `toxml` → deploy the regenerated XML with `sf project deploy start`.

## Claude Code skill

`skills/flowml/SKILL.md` tells Claude Code how to use the CLI: run `syntax` before authoring, edit `.flowml` rather than XML, lint and check before converting back, plus known syntax gaps. To install it, copy or link the folder into your skills directory:

```powershell
# Windows (directory junction, stays in sync with git pull)
New-Item -ItemType Junction -Path "$HOME\.claude\skills\flowml" -Target "$PWD\skills\flowml"
```

```sh
# macOS / Linux
ln -s "$PWD/skills/flowml" ~/.claude/skills/flowml
```

## Library

```js
import { readFlowXml, emitYaml, readYaml, writeXml } from 'flowml';

const doc = readFlowXml(xmlString);
const yaml = emitYaml(doc);
const xml = writeXml(readYaml(yaml));
```

## Development

```sh
npm run build   # build core, then cli
npm test        # vitest suite in packages/core
```

`packages/core/tests/private/` is gitignored. Put local-only tests and fixtures there and vitest picks them up automatically.

## Credits

The best-practices linter and guide are adapted from the `sf-flow` skill in [sf-skills](https://github.com/Jaganpro/sf-skills) by Jag Valaiyapathy (MIT). See [NOTICE.md](NOTICE.md).

## License

MIT
