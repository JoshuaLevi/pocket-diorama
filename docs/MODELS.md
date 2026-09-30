# Models (Assets/Models)

`gameboy.glb` is the Game Boy the screen lives in (`play/screen/GameBoyShell.ts`):
a textured DMG, 15,144 triangles, three 1024px textures, exported by Sketchfab.
Joshua downloaded it; the numbers the shell needs (the LCD window, the body)
are measured off its mesh and live in `GameBoyShell.ts`, so swapping the
model means re-measuring there and nowhere else.

Author and licence, from the file's own asset record: "Gameboy" by hirairmak
(https://sketchfab.com/hirairmak), CC-BY-4.0
(http://creativecommons.org/licenses/by/4.0/), source
https://sketchfab.com/3d-models/gameboy-6a326e173eb649a6b265bd4a5b5fcdcf.
The attribution travels in the glb's `asset.extras` and belongs in the
lens's credits.

The file in the repository is not the download as it came: `tools/gameboy-split.py`
cuts the one mesh into a body and five parts (ButtonA, ButtonB, Dpad, Select,
Start), each pivoted at its centre, so the shell can press them. Same
vertices, normals, UVs, material and textures; new uint16 index buffers. Run
it again on the original (`~/Downloads/gameboy.glb`) after changing the
regions in the script or the constants in `GameBoyShell.ts`.
