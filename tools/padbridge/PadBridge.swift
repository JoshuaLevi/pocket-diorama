// An Xbox pad on the Mac, playing the lens in the Lens Studio preview.
//
// Lens Studio has no gamepad API. The GameController package this project vendors
// talks Bluetooth from the GLASSES and does not exist in the editor at all, so a pad
// paired to the laptop cannot reach the preview by any route the lens owns.
//
// What the preview does read is the keyboard (KeyPressEvent, bound in
// Assets/Scripts/play/KeyboardKeys.ts). So this bridge reads the pad through macOS's
// own GameController framework and types the keys that file already listens for:
//
//     d-pad / left stick -> I J K L      A -> Z      B -> X
//     Menu (start)       -> space        View -> shift (SELECT)
//     LB / RB            -> O / P        (zoom out / in)
//
// IJKL rather than the arrow keys on purpose: the preview's own camera steals the
// arrows and WASD.
//
// Two things this has to get right:
//
//   - A HELD direction must keep arriving. macOS generates key repeat for real
//     keyboards, not for synthetic events, and the lens reads a hold as a stream of
//     repeated presses (each one extends a short pulse). So directions are re-posted
//     while held; the buttons are not, because a menu confirm must fire once.
//
//   - Keys go to whatever is focused. A stick nudged while another app is in front
//     would type into it, so nothing is posted unless Lens Studio is frontmost --
//     pass --any-app to lift that.
//
// Build and run with tools/padbridge/run.sh. Needs Accessibility permission for the
// process that runs it (System Settings > Privacy & Security > Accessibility);
// posting keystrokes is exactly the capability that gate exists for.

import AppKit
import CoreGraphics
import Foundation
import GameController

// ANSI virtual key codes. Constants rather than a lookup: this is the whole set.
let KEY_I: CGKeyCode = 34
let KEY_J: CGKeyCode = 38
let KEY_K: CGKeyCode = 40
let KEY_L: CGKeyCode = 37
let KEY_Z: CGKeyCode = 6
let KEY_X: CGKeyCode = 7
let KEY_SPACE: CGKeyCode = 49
let KEY_SHIFT: CGKeyCode = 56
let KEY_O: CGKeyCode = 31
let KEY_P: CGKeyCode = 35

let LENS_STUDIO_BUNDLE_ID = "com.snap.LensStudio"

/// Stick deflection past which an axis counts as a direction. Matches the dead zone
/// the lens applies to the on-glasses pad, so both feel the same.
let STICK_DEAD_ZONE: Float = 0.5

/// Poll rate. Fast enough that a tap is never missed, slow enough to be free.
let POLL_INTERVAL: TimeInterval = 1.0 / 60.0

/// How often a held direction re-posts. The lens's own key pulse is 0.12s, so this
/// has to be comfortably shorter or walking stutters.
let REPEAT_INTERVAL: TimeInterval = 0.05

var verbose = false
var anyApp = false
// Reads the pad and prints what it sees, posting nothing. The first thing to run:
// it proves macOS sees the pad and that every button arrives, and it needs no
// permission at all, so a pad problem is told apart from a permission problem
// before either can be blamed for the other.
var testMode = false
for argument in CommandLine.arguments.dropFirst() {
    switch argument {
    case "--verbose", "-v": verbose = true
    case "--any-app": anyApp = true
    case "--test", "-t": testMode = true
    case "--help", "-h":
        print("usage: padbridge [--verbose] [--any-app] [--test]")
        exit(0)
    default:
        FileHandle.standardError.write(Data("unknown argument: \(argument)\n".utf8))
        exit(2)
    }
}

// Line-buffered so a piped run (a log, a tee) shows what it found as it happens.
setvbuf(stdout, nil, _IOLBF, 0)

let eventSource = CGEventSource(stateID: .hidSystemState)

/// Keys currently held down by this process, so a disconnect, a focus change or
/// ctrl-C can let go of every one of them rather than leaving a key stuck down.
var heldKeys: [CGKeyCode: TimeInterval] = [:]

func postKey(_ key: CGKeyCode, down: Bool, repeated: Bool = false) {
    guard let event = CGEvent(keyboardEventSource: eventSource, virtualKey: key, keyDown: down)
    else { return }
    if repeated {
        event.setIntegerValueField(.keyboardEventAutorepeat, value: 1)
    }
    event.post(tap: .cghidEventTap)
}

func name(of key: CGKeyCode) -> String {
    switch key {
    case KEY_I: return "I"
    case KEY_J: return "J"
    case KEY_K: return "K"
    case KEY_L: return "L"
    case KEY_Z: return "Z"
    case KEY_X: return "X"
    case KEY_SPACE: return "space"
    case KEY_SHIFT: return "shift"
    case KEY_O: return "O"
    case KEY_P: return "P"
    default: return "key\(key)"
    }
}

/// `repeats` is what separates a direction from a button: a held direction keeps
/// firing, a held A does not.
func apply(_ key: CGKeyCode, pressed: Bool, repeats: Bool, now: TimeInterval) {
    let wasHeld = heldKeys[key] != nil
    if pressed && !wasHeld {
        heldKeys[key] = now
        postKey(key, down: true)
        if verbose { print("  down \(name(of: key))") }
        return
    }
    if pressed && wasHeld && repeats {
        if now - (heldKeys[key] ?? now) >= REPEAT_INTERVAL {
            heldKeys[key] = now
            postKey(key, down: true, repeated: true)
        }
        return
    }
    if !pressed && wasHeld {
        heldKeys.removeValue(forKey: key)
        postKey(key, down: false)
        if verbose { print("  up   \(name(of: key))") }
    }
}

func releaseAll() {
    for key in heldKeys.keys {
        postKey(key, down: false)
    }
    heldKeys.removeAll()
}

func lensStudioIsFrontmost() -> Bool {
    guard let front = NSWorkspace.shared.frontmostApplication else { return false }
    if front.bundleIdentifier == LENS_STUDIO_BUNDLE_ID { return true }
    // Both installed versions ship the same bundle id, but a renamed copy would not,
    // so fall back to the name the user actually sees.
    return (front.localizedName ?? "").hasPrefix("Lens Studio")
}

/// Whether this process may post keystrokes at all. Without the permission every
/// post is silently dropped, which looks exactly like a broken pad.
func accessibilityGranted() -> Bool {
    return AXIsProcessTrusted()
}

var announcedController = ""
var announcedBlocked = false
var lastTestLine = ""
/** Whether the pad has ever reported anything at all: a button, or a stick. */
var sawInput = false
var polls = 0



func poll() {
    let now = Date().timeIntervalSinceReferenceDate

    var found: (GCController, GCExtendedGamepad)? = nil
    for controller in GCController.controllers() {
        if let gamepad = controller.extendedGamepad {
            found = (controller, gamepad)
            break
        }
    }
    guard let (controller, pad) = found else {
        if announcedController != "" {
            print("pad disconnected; waiting")
            announcedController = ""
            releaseAll()
        }
        return
    }
    if announcedController == "" {
        let label = controller.vendorName ?? "controller"
        announcedController = label
        print("pad connected: \(label)")
    }

    let stickX = pad.leftThumbstick.xAxis.value
    let stickY = pad.leftThumbstick.yAxis.value
    // Anything at all counts, including the triggers and a stick barely off
    // centre: this is only asking whether the pad is talking to us.
    if !sawInput {
        let anyButton = pad.buttonA.isPressed || pad.buttonB.isPressed ||
            pad.buttonX.isPressed || pad.buttonY.isPressed ||
            pad.buttonMenu.isPressed || (pad.buttonOptions?.isPressed ?? false) ||
            pad.leftShoulder.isPressed || pad.rightShoulder.isPressed ||
            pad.dpad.up.isPressed || pad.dpad.down.isPressed ||
            pad.dpad.left.isPressed || pad.dpad.right.isPressed ||
            pad.leftTrigger.value > 0.1 || pad.rightTrigger.value > 0.1
        if anyButton || abs(stickX) > 0.2 || abs(stickY) > 0.2 {
            sawInput = true
            print("pad is talking: first input read")
        }
    }
    polls += 1
    // Roughly every five seconds until it does.
    if !sawInput && polls % 300 == 0 {
        print("nothing from the pad yet (\(polls / 60)s). Press a button; if this " +
              "keeps printing, macOS is not handing us its input.")
    }
    let up = pad.dpad.up.isPressed || stickY > STICK_DEAD_ZONE
    let down = pad.dpad.down.isPressed || stickY < -STICK_DEAD_ZONE
    let left = pad.dpad.left.isPressed || stickX < -STICK_DEAD_ZONE
    let right = pad.dpad.right.isPressed || stickX > STICK_DEAD_ZONE

    if testMode {
        var pressed: [String] = []
        if up { pressed.append("up") }
        if down { pressed.append("down") }
        if left { pressed.append("left") }
        if right { pressed.append("right") }
        if pad.buttonA.isPressed { pressed.append("A") }
        if pad.buttonB.isPressed { pressed.append("B") }
        if pad.buttonX.isPressed { pressed.append("X") }
        if pad.buttonY.isPressed { pressed.append("Y") }
        if pad.buttonMenu.isPressed { pressed.append("Menu") }
        if pad.buttonOptions?.isPressed ?? false { pressed.append("View") }
        if pad.leftShoulder.isPressed { pressed.append("LB") }
        if pad.rightShoulder.isPressed { pressed.append("RB") }
        let line = pressed.isEmpty ? "(nothing held)" : pressed.joined(separator: " ")
        if line != lastTestLine {
            lastTestLine = line
            print(line)
        }
        return
    }

    if !anyApp && !lensStudioIsFrontmost() {
        if !heldKeys.isEmpty { releaseAll() }
        if !announcedBlocked {
            print("Lens Studio is not frontmost; input is held back (--any-app to lift)")
            announcedBlocked = true
        }
        return
    }
    if announcedBlocked {
        print("Lens Studio frontmost again; input flowing")
        announcedBlocked = false
    }

    apply(KEY_I, pressed: up, repeats: true, now: now)
    apply(KEY_K, pressed: down, repeats: true, now: now)
    apply(KEY_J, pressed: left, repeats: true, now: now)
    apply(KEY_L, pressed: right, repeats: true, now: now)

    apply(KEY_Z, pressed: pad.buttonA.isPressed, repeats: false, now: now)
    apply(KEY_X, pressed: pad.buttonB.isPressed, repeats: false, now: now)
    apply(KEY_SPACE, pressed: pad.buttonMenu.isPressed, repeats: false, now: now)
    apply(KEY_SHIFT, pressed: pad.buttonOptions?.isPressed ?? false, repeats: false, now: now)

    // Zoom is per repeat by design in the lens, so holding a shoulder zooms smoothly.
    apply(KEY_O, pressed: pad.leftShoulder.isPressed, repeats: true, now: now)
    apply(KEY_P, pressed: pad.rightShoulder.isPressed, repeats: true, now: now)
}

print("padbridge: d-pad/stick -> IJKL, A -> Z, B -> X, Menu -> space, View -> shift, LB/RB -> O/P zoom")
if testMode {
    print("test mode: reading the pad, posting nothing. Press buttons; ctrl-C to stop.")
} else if !accessibilityGranted() {
    print("")
    print("NOT PERMITTED YET: this process may not post keystrokes.")
    print("Grant Accessibility to the app running it (Terminal, iTerm, or Claude Code)")
    print("in System Settings > Privacy & Security > Accessibility, then run it again.")
    print("Until then the pad is read but nothing reaches Lens Studio.")
    print("")
    // Ask, rather than only telling. An app that has never requested the permission
    // is not in that list to be ticked, which is its own dead end; this puts it
    // there and leaves the choice where it belongs.
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
}
if GCController.controllers().isEmpty {
    print("no pad found yet. Plug the Xbox pad in with a USB cable, or pair it over")
    print("Bluetooth: hold its pairing button until the Xbox light flashes fast, then")
    print("System Settings > Bluetooth > Connect. Either way this keeps running and")
    print("picks the pad up the moment it arrives.")
}
// A command-line tool is never the frontmost APP -- it has no NSApplication to
// be frontmost with -- and macOS hands controller input to the frontmost app
// only. Without this the pad connects, reports its profile, and then never
// delivers a single button: exactly the "it connects but nothing happens" this
// line exists to fix. Available since macOS 11.3.
if #available(macOS 11.3, *) {
    GCController.shouldMonitorBackgroundEvents = true
}
GCController.startWirelessControllerDiscovery(completionHandler: {})

signal(SIGINT, SIG_IGN)
let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
interrupt.setEventHandler {
    releaseAll()
    print("\nstopped")
    exit(0)
}
interrupt.resume()

let timer = Timer(timeInterval: POLL_INTERVAL, repeats: true) { _ in poll() }
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
