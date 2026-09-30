# Viridian City North Region - Playtesting Plan

## Summary

Testing the VIRIDIAN_CITY north half (Pokemon Center, School House, Nickname House, Trainer Tips signs, locked Gym door) is currently BLOCKED by a harness gap: **all warp destinations in kanto.json are undefined**.

## Harness Gap

The golden gate extraction does not populate `warp.map` (warp destination map IDs) in the extracted kanto.json bundle. This prevents the headless lens from navigating to Viridian City or entering any of its buildings.

### Evidence
- All 222 maps in kanto.json have warps with `map: undefined` or no warps
- Example: VIRIDIAN_CITY has 5 warps at coordinates (23,25), (29,19), (21,15), (21,9), (32,7) but all have `destMap: undefined`
- The lens's `takeWarp()` function requires `destMap` to route between maps
- No maps link to VIRIDIAN_CITY due to this issue

### Impact
Cannot run any scenarios that:
1. Navigate from Route 1 to Viridian City (edge crossing)
2. Enter Pokemon Center from the main map
3. Enter School House from the main map
4. Enter Nickname House from the main map
5. Test any interactions in Viridian City without a pre-made save state

## Planned Scenarios (Once Warp Data Is Available)

### Scenario 1: Pokemon Center - Nurse Healing
- **Start**: Viridian City main map, near Pokemon Center entrance
- **Objective**: Test nurse interaction, healing mechanic, and PC interaction
- **Actions**:
  1. Walk to Pokemon Center door
  2. Enter (trigger warp to VIRIDIAN_POKECENTER)
  3. Talk to nurse at (3,1)
  4. Confirm healing text
  5. Check party HP restored
  6. Walk to PC at (10,5)
  7. Access PC
  8. Exit Pokemon Center

### Scenario 2: School House - Blackboard and Girl
- **Start**: Viridian City main map, near School House
- **Objective**: Test school interiors and NPC interaction
- **Actions**:
  1. Walk to School House door
  2. Enter (trigger warp to VIRIDIAN_SCHOOL_HOUSE)
  3. Talk to girl at (3,5)
  4. Confirm text appears correctly
  5. Check blackboard content (if accessible)
  6. Exit School House

### Scenario 3: Nidoran House - Man and Spearow
- **Start**: Viridian City main map
- **Objective**: Test nickname house interiors and NPCs
- **Actions**:
  1. Walk to Nickname House door
  2. Enter (trigger warp to VIRIDIAN_NICKNAME_HOUSE)
  3. Talk to man at (5,3)
  4. Confirm text about Nidoran
  5. Observe Spearow at (5,5)
  6. Check little girl at (1,4) doesn't block path
  7. Exit house

### Scenario 4: Trainer Tips Signs
- **Start**: Viridian City main map
- **Objective**: Test sign text reading
- **Actions**:
  1. Walk to Trainer Tips sign at (19,1) - north
  2. Face and read sign
  3. Confirm text matches cartridge
  4. Walk to Trainer Tips sign at (21,29) - south
  5. Face and read sign
  6. Confirm text matches cartridge

### Scenario 5: Gym Door (Locked)
- **Start**: Viridian City main map
- **Objective**: Test locked Gym door behavior
- **Actions**:
  1. Walk to Gym entrance at (29,19)
  2. Attempt to enter
  3. Confirm door is locked (no warp trigger)
  4. Check if any message appears about coming back later
  5. Walk away

### Scenario 6: Viridian City Layout and NPCs
- **Start**: Viridian City main map
- **Objective**: Test main map NPCs and positions
- **Actions**:
  1. Walk around north section
  2. Pass Gambler at (30,8) - test STAY movement
  3. Pass Old Man (WALK movement) - confirm wandering behavior
  4. Pass Girl at (17,9) - test STAY movement
  5. Observe all positions match cartridge

## Current Blockers

| Item | Status | Reason |
|------|--------|--------|
| Navigation to Viridian City | BLOCKED | Warp destinations undefined |
| Pokemon Center testing | BLOCKED | Cannot enter building |
| School House testing | BLOCKED | Cannot enter building |
| Nickname House testing | BLOCKED | Cannot enter building |
| Gym door interaction | BLOCKED | Cannot reach warp tile |
| Sign reading | BLOCKED | Cannot navigate to signs |
| Main map NPC testing | BLOCKED | Cannot reach Viridian City |

## Next Steps

1. **Golden Gate**: Extract warp destination map IDs for all 222 maps
2. **Verify**: Re-run this test plan with populated warp data
3. **Document**: Record any differences found between lens and cartridge
