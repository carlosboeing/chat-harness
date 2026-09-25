# Evaluations

Chat Harness v0.2 uses three evidence layers:
1. deterministic toolkit tests for machine-enforceable contracts;
2. fixture-based behavioural scenarios with explicit required/forbidden behaviours;
3. capability integration and real-host smoke evidence.

The scenario catalog in `scenarios/v0.2.json` is evaluation data, not a runtime DSL or workflow engine.

Scenarios cover instruction binding, WORKSPACE/Map retrieval, Workstream recovery, federated ownership, Source Policy behavior, closeout persistence, brownfield setup, capability authority, and mutation transparency.

Real-host evidence should record only the minimum pass/fail evidence needed to substantiate a claim; never store private chain-of-thought.
