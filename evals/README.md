# Evaluations

Chat Harness v0.1 uses three evidence layers:

1. deterministic toolkit tests for machine-enforceable contracts;
2. fixture-based behavioural scenarios with explicit required and forbidden behaviours;
3. capability integration and real-host smoke evidence.

The scenario catalog in `scenarios/v0.1.json` is **evaluation data, not a runtime DSL**. It does not drive the assistant or define a workflow engine.

Each scenario records:

- `id`
- `fixture`
- `objective`
- `prompt`
- `required_behaviours`
- `forbidden_behaviours`
- `evidence_notes`

V0.1 deliberately publishes concrete assertions rather than invented model-quality scores.

## Real-host evidence

Dated host observations belong under `evidence/` and should record only the minimum evidence needed to substantiate the claim: host/surface, date, fixture/scenario, pass/fail observations, and material limitations. Do not store private conversation transcripts or chain-of-thought.
