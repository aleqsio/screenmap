# Capture comparison implementation choice

Use the existing variant-id capture model for arbitrary capture combinations. Add explicit `platform`, `osVersion`, `language`, `appearance`, and `device` descriptor fields. A variant id remains the file/inventory identity. A Capture Selection is the independent axis request; it can have no matching capture.

Candidates checked: existing React state and `URLSearchParams`, existing Radix ToggleGroup/native select controls, and the current screenmap producer/loader. They already provide browser history, controls and capture/hash validation under the repository's existing MIT dependency set. Reuse them. No new parser, synchronization package or dependency is needed. Comparison shares one Visit and resolves capture geometry separately per panel.

Never substitute a different platform, OS, language, appearance or named Capture State. Old `en-light`/`ar-dark` ids supply language/appearance only; their OS version remains unknown. Other legacy ids remain opaque.
