---
status: active
created: 2026-09-24
---

# Plan Japan trip

## Objective
Produce a workable Tokyo–Kyoto family itinerary around confirmed flight and hotel dates while keeping live transport and venue information current.

## Current direction
Flights and the first Tokyo hotel are confirmed in `Bookings/`. The itinerary has a three-night Kyoto gap and one unresolved day-trip decision. A previous session stopped after finding that the original museum day conflicts with current closure information.

## Decisions
- Keep confirmed reservations canonical in `Bookings/`.
- Reverify venue opening days and intercity transport before finalizing.
- Do not book or cancel anything without explicit approval.

## Next action
Reverify the Kyoto candidates and museum schedule, then propose a revised day-by-day itinerary without making reservations.

## Relevant sources
- `Bookings/confirmed.md`
- `Itinerary/current.md`
- live official transport/venue sources
