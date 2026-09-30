// The lens's own name and version, in one place.
//
// Snap's review checklist for Lens Explorer asks for a version that is shown on
// launch and logged on launch, so a bug report can name the build it came
// from. Bump LENS_VERSION with every published build and put what changed in
// the release notes; nothing else reads the number.

export const LENS_NAME: string = "Pocket Diorama";
export const LENS_VERSION: string = "1.0.0";

/** The one line every launch prints and the first page of the lens shows. */
export function lensBanner(): string {
  return LENS_NAME + " v" + LENS_VERSION;
}
