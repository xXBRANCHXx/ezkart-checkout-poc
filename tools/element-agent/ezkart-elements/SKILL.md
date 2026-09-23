---
name: ezkart-elements
description: Generate varied, native editable Ezkart builder elements and hand them to a second agent for integration and browser verification. Use to expand existing asset categories or run an element collection batch.
---

# Ezkart element agents

Resolve this skill's symlink to find the Ezkart checkout (three parent directories above this folder). Read its `AGENTS.md` and complete `docs/landing-page-template-plan.md`. This workflow expands reusable elements; it does not commission complete storefront templates.

The generator writes a native JSON collection and a design handoff. A second agent merges it into the library, checks every composition at desktop and mobile widths, then checks merchant insertion, editing, history and reopening. Existing designs stay available. The target is a minimum per category, not a hard catalogue limit. Three featured previews and **View more** belong to the library UI, separately from generated recipes.

Use the repository runner at `tools/element-agent/run.py`. Its defaults use the installed Codex configuration without choosing a model. For a user-authorized unattended run:

```bash
python tools/element-agent/run.py start --target 20 --yolo
python tools/element-agent/run.py status
```

`--yolo` explicitly selects Codex's approval/sandbox bypass for both agents; use it only when the user requests that mode. Without it the agents run in noninteractive workspace-write mode. Each run stops after this one batch; it does not continue generating indefinitely. Logs, prompts, native data, reports and status live under `~/.local/share/ezkart-elements/runs/`. `status --run <directory>` inspects a specific run. `stop --run <directory>` terminates that run's process group.

The generator and integrator contracts are in [../generator.md](../generator.md) and [../integrator.md](../integrator.md). Read them before changing this workflow or running either stage manually. Generator output is data, never executable custom HTML/JS or flattened screenshots. Use ordinary native nodes, honest placeholder copy where merchant facts are required, and fonts already available to the builder. Demand real differences in composition and use, rather than counting recolors as more designs.

The runner restricts the agents' requested file ownership to their pack, `builder-asset-packs.js`, the asset adapter and its tests. It leaves commit, push and test deployment to the coordinating agent so shared checkout changes are verified together. No production publishing is part of a batch. Check `status.json` and the validation report before saying a batch has finished; a launched process is only a running batch.
