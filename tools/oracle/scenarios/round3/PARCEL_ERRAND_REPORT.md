# Parcel Errand Test Campaign Report

## Summary
Attempted to create 5-7 scenarios testing the parcel errand from Oak's Lab through Viridian Mart and back. Created 4 usable scenarios before encountering a Route 1 navigation boundary issue.

## Scenarios Created

### parcel-errand-1-lab-exit.json
- Starts: OAKS_LAB (5,6) after rival battle  
- Actions: Walk from lab center to south door at (5,11)
- Result: PASSES - Both machines agree, successfully exit to Pallet Town (12,12)

### parcel-errand-2-pallet-to-route1.json
- Starts: OAKS_LAB, exits lab
- Actions: Walk from Pallet Town south exit toward Route 1 entrance
- Result: PASSES - Both machines reach PALLET_TOWN (10,0), the north boundary/connection point to Route 1

### parcel-errand-3-boundary-test.json
- Starts: OAKS_LAB, exits lab, exits Pallet Town
- Actions: Cross from Pallet Town into Route 1 and attempt to traverse north
- Result: BLOCKED - Both machines reach ROUTE_1 (10,28) and refuse to move further north, regardless of:
  - Different x coordinates (tried x=7, 10, 11)
  - Different approach paths
  - Different walk instruction sequences
  - Facing changes before walking

### parcel-errand-4-pallet-sign.json
- Starts: OAKS_LAB, exits lab, stays in Pallet Town
- Actions: Walk within Pallet Town and test talk mechanics
- Result: PASSES - Talk system functional in Pallet Town, both machines agree

## Harness Findings

### Route 1 North Boundary Blocked at y=28
**Severity**: Blocks all further progress toward Viridian City/Mart

The lens and cartridge both refuse to move north of ROUTE_1 y-coordinate 28. This appears to be a boundary issue in the test harness itself, not a lens difference, because:
1. Both machines behave identically (this is SAME, not DIFFER)
2. Multiple distinct paths tested yield the same blocking behavior
3. The block persists across different walk sequences and x coordinates
4. No in-game obstacles detected at (10,28) via map analysis

**Suspected cause**: Either:
- The kanto.json map bundle has a geometry/collision issue in Route 1's northern cells
- The Route 1 → Viridian City connection offset is misconfigured in the bundle
- The compare.mjs coordinate mapping has an issue near the map boundary

**Impact**: Cannot reach Viridian City, Viridian Mart, or test parcel acquisition/return dialogue

## Unable to Complete
Scenarios 5-7 would test:
- Entering Viridian Mart and acquiring parcel from clerk
- Returning to Pallet Town and exiting Route 1
- Re-entering Oak's Lab and delivering parcel to Oak
- Verifying Pokedex handover dialogue
- Verifying bag state after parcel delivery
- Checking for BLUE appearance/dialogue during delivery

All of these are blocked by the Route 1 north boundary issue.
